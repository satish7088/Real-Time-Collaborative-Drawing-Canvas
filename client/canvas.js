export const WIDTH = 1600, HEIGHT = 1000;

/** Pure vector renderer used for screen, cache and PNG. Erasers affect the same composite. */
export function renderOperation(ctx, op) {
  if (op.hidden || !op.points.length) return;
  if (op.kind === 'clear') { ctx.clearRect(0, 0, WIDTH, HEIGHT); return; }
  ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = op.width;
  ctx.strokeStyle = ctx.fillStyle = op.color;
  ctx.globalCompositeOperation = op.kind === 'eraser' ? 'destination-out' : 'source-over';
  const p = op.points, a = p[0], b = p[p.length - 1];
  ctx.beginPath();
  if (op.kind === 'text') { ctx.font = `${Math.max(14, op.width * 3)}px sans-serif`; ctx.textBaseline = 'top'; ctx.fillText(op.text, a.x, a.y); }
  else if (op.kind === 'rectangle') { ctx.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(a.x - b.x), Math.abs(a.y - b.y)); }
  else if (op.kind === 'ellipse') { ctx.ellipse((a.x + b.x) / 2, (a.y + b.y) / 2, Math.abs(b.x - a.x) / 2, Math.abs(b.y - a.y) / 2, 0, 0, 2 * Math.PI); ctx.stroke(); }
  else if (op.kind === 'line') { ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
  else if (p.length === 1) { ctx.arc(a.x, a.y, op.width / 2, 0, Math.PI * 2); ctx.fill(); }
  else {
    ctx.moveTo(a.x, a.y);
    for (let i = 1; i < p.length - 1; i++) ctx.quadraticCurveTo(p[i].x, p[i].y, (p[i].x + p[i + 1].x) / 2, (p[i].y + p[i + 1].y) / 2);
    ctx.lineTo(b.x, b.y); ctx.stroke();
  }
  ctx.restore();
}

export class CanvasBoard {
  constructor(canvas, cursorCanvas, callbacks) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d'); this.cursorCanvas = cursorCanvas; this.cursorCtx = cursorCanvas.getContext('2d'); this.callbacks = callbacks;
    this.cache = document.createElement('canvas'); this.cache.width = WIDTH; this.cache.height = HEIGHT; this.cacheCtx = this.cache.getContext('2d');
    this.operations = []; this.byId = new Map(); this.optimistic = new Map(); this.redo = []; this.cached = 0; this.dirty = true; this.enabled = false;
    this.tool = 'brush'; this.color = '#263c32'; this.width = 5; this.text = ''; this.cursors = new Map(); this.users = new Map();
    canvas.addEventListener('pointerdown', e => this.down(e));
    canvas.addEventListener('pointermove', e => this.move(e));
    canvas.addEventListener('pointerup', e => this.up(e));
    canvas.addEventListener('pointercancel', () => this.cancel());
    canvas.addEventListener('lostpointercapture', () => { if (this.active) this.cancel(); });
    canvas.addEventListener('pointerleave', () => callbacks.cursor(null));
    this.flushTimer = setInterval(() => this.flush(), 24);
    let frames = 0, t0 = performance.now();
    const tick = now => { if (this.dirty) { this.draw(); this.dirty = false; } this.drawCursors(now); frames++;
      if (now - t0 >= 1000) { callbacks.fps(Math.round(frames * 1000 / (now - t0))); frames = 0; t0 = now; } this.frame = requestAnimationFrame(tick); };
    this.frame = requestAnimationFrame(tick);
  }
  position(e) { const r = this.canvas.getBoundingClientRect(); return { x: Math.round(Math.max(0, Math.min(WIDTH, (e.clientX - r.left) * WIDTH / r.width)) * 10) / 10, y: Math.round(Math.max(0, Math.min(HEIGHT, (e.clientY - r.top) * HEIGHT / r.height)) * 10) / 10 }; }
  down(e) {
    if (!this.enabled || this.active || this.optimistic.size || (e.pointerType === 'mouse' && e.button !== 0)) return;
    if (this.tool === 'text' && !this.text.trim()) { this.callbacks.error('Enter some text first.'); return; }
    e.preventDefault(); this.canvas.setPointerCapture(e.pointerId);
    // UUID fallback supports LAN HTTP where crypto.randomUUID may not be available.
    const id = globalThis.crypto?.randomUUID?.() || `mark_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const op = { id, kind: this.tool, color: this.color, width: this.width, text: this.text, points: [this.position(e)], order: Number.MAX_SAFE_INTEGER, done: false };
    this.active = { op, pointerId: e.pointerId, pending: [], batch: 0 }; this.optimistic.set(id, op); this.dirty = true;
    this.callbacks.send('begin', { id, kind: op.kind, color: op.color, width: op.width, text: op.text, point: op.points[0] });
    if (this.tool === 'text') this.up(e);
  }
  move(e) {
    const now = performance.now();
    if (!this.lastCursor || now - this.lastCursor > 45) { this.callbacks.cursor(this.position(e)); this.lastCursor = now; }
    if (!this.active || e.pointerId !== this.active.pointerId) return;
    e.preventDefault(); const events = e.getCoalescedEvents?.() || [e];
    for (const sample of events.length ? events : [e]) this.addPoint(this.position(sample));
  }
  addPoint(p, force = false) {
    if (!this.active) return;
    const { op, pending } = this.active, last = op.points.at(-1);
    if (op.points.length >= 4096) { this.up(); this.callbacks.error('Long stroke completed at the point limit. Start another stroke to continue.'); return; }
    if (Math.hypot(p.x - last.x, p.y - last.y) < (force ? .1 : .9)) return;
    op.points.push(p); pending.push(p); this.dirty = true;
    if (pending.length >= 128) this.flush();
  }
  flush() {
    if (!this.active?.pending.length) return;
    const a = this.active;
    this.callbacks.send('points', { id: a.op.id, batch: ++a.batch, points: a.pending.splice(0, 128) });
  }
  up(e) {
    if (!this.active || (e && e.pointerId !== this.active.pointerId)) return;
    if (e && this.active.op.kind !== 'text') this.addPoint(this.position(e), true);
    if (!this.active) return;
    this.flush(); const a = this.active; this.active = null; a.op.done = true;
    this.callbacks.send('end', { id: a.op.id });
    if (this.canvas.hasPointerCapture(a.pointerId)) this.canvas.releasePointerCapture(a.pointerId);
  }
  cancel() {
    if (!this.active) return;
    const id = this.active.op.id; this.active = null; this.optimistic.delete(id); this.invalidate(); this.callbacks.send('cancel', { id });
  }
  offline() { this.enabled = false; this.active = null; this.optimistic.clear(); this.cursors.clear(); this.invalidate(); }
  snapshot(data) {
    this.active = null; this.optimistic.clear(); this.operations = data.operations; this.redo = data.redo;
    this.byId = new Map(this.operations.map(o => [o.id, o])); this.enabled = true; this.invalidate(); this.callbacks.changed();
  }
  apply(event) {
    const op = this.byId.get(event.id);
    if (event.type === 'begin') { this.operations.push(event.operation); this.byId.set(event.operation.id, event.operation); }
    else if (event.type === 'points' && op) { op.points.push(...event.points); op.batch = event.batch; }
    else if (event.type === 'end' && op) { op.done = true; this.optimistic.delete(op.id); this.redo = event.redo; }
    else if (event.type === 'cancel') { this.operations = this.operations.filter(o => o.id !== event.id); this.byId.delete(event.id); this.optimistic.delete(event.id); if (this.active?.op.id === event.id) this.active = null; this.invalidate(); }
    else if (event.type === 'visibility' && op) { op.hidden = event.hidden; this.redo = event.redo; this.invalidate(); }
    else if (event.type === 'reset') this.snapshot(event.snapshot);
    this.dirty = true; this.callbacks.changed();
  }
  invalidate() { this.cached = 0; this.cacheCtx.clearRect(0, 0, WIDTH, HEIGHT); this.dirty = true; }
  draw() {
    // Cache only the immutable completed prefix. Later marks must retain begin order,
    // even when an earlier stroke is still streaming or an eraser crosses it.
    while (this.cached < this.operations.length) {
      const op = this.operations[this.cached];
      if (!op.done || this.optimistic.has(op.id)) break;
      renderOperation(this.cacheCtx, op); this.cached++;
    }
    this.ctx.clearRect(0, 0, WIDTH, HEIGHT); this.ctx.drawImage(this.cache, 0, 0);
    for (let i = this.cached; i < this.operations.length; i++) { const op = this.operations[i]; renderOperation(this.ctx, this.optimistic.get(op.id) || op); }
    for (const [id, op] of this.optimistic) if (!this.byId.has(id)) renderOperation(this.ctx, op);
  }
  drawCursors(now) {
    const ctx = this.cursorCtx; ctx.clearRect(0, 0, WIDTH, HEIGHT);
    for (const [id, c] of this.cursors) {
      const user = this.users.get(id);
      if (!user || !c.point || now - c.at > 5000) continue;
      const { x, y } = c.point; ctx.fillStyle = user.color; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 5, y + 19); ctx.lineTo(x + 11, y + 12); ctx.lineTo(x + 20, y + 10); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.font = '18px sans-serif'; const label = user.name.slice(0, 24); const w = ctx.measureText(label).width + 14;
      const lx = Math.min(WIDTH - w, x + 15), ly = Math.min(HEIGHT - 25, y + 20);
      ctx.fillRect(lx, ly, w, 25); ctx.fillStyle = '#fff'; ctx.fillText(label, lx + 7, ly + 18);
    }
  }
  document() { return { version: 1, width: WIDTH, height: HEIGHT, operations: this.operations.filter(o => o.done && !o.hidden).map(({ kind, color, width, text, points }) => ({ kind, color, width, text, points })) }; }
  png() {
    const out = document.createElement('canvas'); out.width = WIDTH; out.height = HEIGHT;
    const context = out.getContext('2d');
    for (const op of this.operations) if (op.done) renderOperation(context, op);
    context.globalCompositeOperation = 'destination-over'; context.fillStyle = '#fff'; context.fillRect(0, 0, WIDTH, HEIGHT);
    return new Promise(resolve => out.toBlob(resolve, 'image/png'));
  }
}
