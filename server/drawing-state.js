import { randomUUID } from 'node:crypto';

export const LIMITS = Object.freeze({ operations: 1500, points: 4096, totalPoints: 120000, batch: 128 });
export const SIZE = Object.freeze({ width: 1600, height: 1000 });
const kinds = new Set(['brush', 'eraser', 'line', 'rectangle', 'ellipse', 'text', 'clear']);
export function ensure(ok, message, code = 'VALIDATION') { if (!ok) throw Object.assign(new Error(message), { code }); }
export function point(p) {
  ensure(p && Number.isFinite(p.x) && Number.isFinite(p.y), 'Invalid point');
  return { x: Math.round(Math.max(0, Math.min(SIZE.width, p.x)) * 10) / 10,
    y: Math.round(Math.max(0, Math.min(SIZE.height, p.y)) * 10) / 10 };
}
function style(raw) {
  ensure(raw && kinds.has(raw.kind), 'Invalid drawing tool');
  ensure(/^#[0-9a-f]{6}$/i.test(raw.color), 'Invalid color');
  ensure(Number.isFinite(raw.width) && raw.width >= 1 && raw.width <= 64, 'Width must be 1–64');
  ensure(raw.kind !== 'text' || (typeof raw.text === 'string' && raw.text.trim().length > 0 && raw.text.length <= 200), 'Text must be 1–200 characters');
  return { kind: raw.kind, color: raw.color, width: raw.width, text: raw.kind === 'text' ? raw.text : '' };
}

/** All mutation methods are synchronous: the Node event loop is the room sequencer. */
export class DrawingState {
  constructor() { this.operations = []; this.redo = []; this.seq = 0; this.order = 0; this.totalPoints = 0; }
  event(type, payload) { return { seq: ++this.seq, type, ...payload }; }
  snapshot() { return { version: 1, ...SIZE, seq: this.seq, operations: structuredClone(this.operations), redo: [...this.redo] }; }
  begin(raw, owner) {
    ensure(raw && typeof raw.id === 'string' && /^[a-zA-Z0-9_-]{8,80}$/.test(raw.id), 'Invalid operation ID');
    ensure(!this.operations.some(o => o.id === raw.id), 'Duplicate operation');
    ensure(!this.operations.some(o => o.owner === owner && !o.done), 'Finish your current stroke first');
    ensure(this.operations.length < LIMITS.operations && this.totalPoints < LIMITS.totalPoints, 'Room capacity reached; export and start a new room');
    const op = { id: raw.id, owner, order: ++this.order, ...style(raw), points: [point(raw.point)], done: false, hidden: false, batch: 0, touched: Date.now() };
    this.operations.push(op); this.totalPoints++;
    return this.event('begin', { operation: structuredClone(op) });
  }
  owned(id, owner) {
    const op = this.operations.find(o => o.id === id);
    ensure(op && op.owner === owner && !op.done, 'Stroke is not active or not yours');
    return op;
  }
  append(raw, owner) {
    const op = this.owned(raw?.id, owner);
    ensure(Number.isInteger(raw.batch) && raw.batch === op.batch + 1, 'Point batch out of sequence; resync required', 'SEQUENCE_GAP');
    ensure(Array.isArray(raw.points) && raw.points.length > 0 && raw.points.length <= LIMITS.batch, 'Invalid point batch');
    ensure(op.points.length + raw.points.length <= LIMITS.points && this.totalPoints + raw.points.length <= LIMITS.totalPoints, 'Point capacity reached; finish this stroke');
    const points = raw.points.map(point);
    op.points.push(...points); op.batch = raw.batch; op.touched = Date.now(); this.totalPoints += points.length;
    return this.event('points', { id: op.id, batch: op.batch, points });
  }
  finish(id, owner) {
    const op = this.owned(id, owner); op.done = true; this.redo = [];
    return this.event('end', { id, redo: [] });
  }
  cancel(id, owner) {
    const op = this.owned(id, owner);
    this.operations = this.operations.filter(o => o !== op); this.totalPoints -= op.points.length;
    return this.event('cancel', { id });
  }
  undo() {
    const op = this.operations.findLast(o => o.done && !o.hidden);
    ensure(op, 'Nothing to undo', 'NOTHING_TO_UNDO'); op.hidden = true; this.redo.push(op.id);
    return this.event('visibility', { id: op.id, hidden: true, redo: [...this.redo] });
  }
  redoLast() {
    ensure(this.redo.length, 'Nothing to redo', 'NOTHING_TO_REDO');
    const id = this.redo.pop(); this.operations.find(o => o.id === id).hidden = false;
    return this.event('visibility', { id, hidden: false, redo: [...this.redo] });
  }
  // Imported documents are a new baseline: no client-supplied ownership or sequence survives.
  importDocument(doc, expectedSeq) {
    ensure(expectedSeq === this.seq, 'Board changed during import; review and try again', 'STALE_REVISION');
    ensure(!this.operations.some(o => !o.done), 'Wait until everyone finishes drawing', 'ACTIVE_STROKES');
    const ops = validateDocument(doc);
    this.operations = ops.map((o, i) => ({ ...o, id: randomUUID(), owner: 'import', order: i + 1, done: true, hidden: false, batch: 0 }));
    this.order = ops.length; this.redo = []; this.totalPoints = ops.reduce((n, o) => n + o.points.length, 0);
    const event = this.event('reset', {});
    event.snapshot = this.snapshot();
    return event;
  }
  restore(saved) {
    ensure(saved?.version === 1 && Array.isArray(saved.operations), 'Invalid saved room');
    const raw = saved.operations.filter(o => o.done);
    const clean = validateDocument({ version: 1, operations: raw });
    const ids = new Set();
    this.operations = clean.map((o, i) => {
      ensure(typeof raw[i].id === 'string' && !ids.has(raw[i].id), 'Invalid saved IDs'); ids.add(raw[i].id);
      return { ...o, id: raw[i].id, owner: String(raw[i].owner), author: String(raw[i].author || 'Former collaborator').slice(0,32), order: i + 1, hidden: !!raw[i].hidden, done: true, batch: 0 };
    });
    this.redo = Array.isArray(saved.redo) ? [...new Set(saved.redo)].filter(id => this.operations.some(o => o.id === id && o.hidden)) : [];
    this.order = this.operations.length; this.totalPoints = clean.reduce((n, o) => n + o.points.length, 0);
    this.seq = Number.isSafeInteger(saved.seq) && saved.seq >= 0 ? saved.seq : 0;
  }
}

export function validateDocument(doc) {
  ensure(doc?.version === 1 && Array.isArray(doc.operations) && doc.operations.length <= LIMITS.operations, 'Invalid FlamAI document');
  let total = 0;
  return doc.operations.map(raw => {
    const s = style(raw);
    ensure(Array.isArray(raw.points) && raw.points.length > 0 && raw.points.length <= LIMITS.points, 'Invalid document points');
    total += raw.points.length; ensure(total <= LIMITS.totalPoints, 'Document too large');
    return { ...s, points: raw.points.map(point) };
  });
}
