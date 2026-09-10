import test from 'node:test';
import assert from 'node:assert/strict';
import { DrawingState, LIMITS } from '../server/drawing-state.js';
const mark = (id, extra = {}) => ({ id, kind: 'brush', color: '#123456', width: 5, point: { x: 10, y: 20 }, ...extra });
function complete(s, id, owner = 'alice') { s.begin(mark(id), owner); s.finish(id, owner); }

test('overlapping strokes have begin order, independent of completion order', () => {
  const s = new DrawingState(); s.begin(mark('alice001'), 'alice'); s.begin(mark('bob00001', { kind: 'eraser' }), 'bob');
  s.finish('bob00001', 'bob'); s.append({ id: 'alice001', batch: 1, points: [{ x: 40, y: 40 }] }, 'alice'); s.finish('alice001', 'alice');
  assert.deepEqual(s.operations.map(o => o.id), ['alice001', 'bob00001']);
  assert.equal(s.undo().id, 'bob00001'); assert.equal(s.redoLast().id, 'bob00001');
});
test('global undo stacks across users and a new completion invalidates redo', () => {
  const s = new DrawingState(); complete(s, 'alice001'); complete(s, 'bob00001', 'bob');
  assert.equal(s.undo().id, 'bob00001'); assert.equal(s.undo().id, 'alice001');
  assert.equal(s.redoLast().id, 'alice001'); complete(s, 'carol001', 'carol');
  assert.throws(() => s.redoLast(), /Nothing/); assert.equal(s.operations.find(o => o.id === 'bob00001').hidden, true);
});
test('active operations are not undone, clear is an undoable operation', () => {
  const s = new DrawingState(); complete(s, 'alice001'); s.begin(mark('active01'), 'bob');
  assert.equal(s.undo().id, 'alice001'); s.cancel('active01', 'bob');
  s.begin(mark('clear001', { kind: 'clear' }), 'alice'); s.finish('clear001', 'alice');
  assert.equal(s.undo().id, 'clear001');
});
test('ownership, duplicate IDs and sequence validation prevent divergent point streams', () => {
  const s = new DrawingState(); s.begin(mark('alice001'), 'alice');
  assert.throws(() => s.begin(mark('alice001'), 'bob'), /Duplicate/);
  assert.throws(() => s.finish('alice001', 'bob'), /not yours/);
  const batch = { id: 'alice001', batch: 1, points: [{ x: 30, y: 40 }] };
  assert.throws(() => s.append({ ...batch, batch: 2 }, 'alice'), /sequence/);
  s.append(batch, 'alice'); assert.throws(() => s.append(batch, 'alice'), /sequence/);
  assert.equal(s.operations[0].points.length, 2); assert.equal(s.seq, 2);
});
test('malformed points cannot partially mutate a stroke; bounds are clamped', () => {
  const s = new DrawingState(); s.begin(mark('alice001'), 'alice');
  assert.throws(() => s.append({ id: 'alice001', batch: 1, points: [{ x: 1, y: 2 }, { x: NaN, y: 2 }] }, 'alice'), /Invalid point/);
  assert.equal(s.operations[0].points.length, 1);
  s.append({ id: 'alice001', batch: 1, points: [{ x: -100, y: 99999 }] }, 'alice');
  assert.deepEqual(s.operations[0].points[1], { x: 0, y: 1000 });
});
test('batch and operation point limits bound work', () => {
  const s = new DrawingState(); s.begin(mark('alice001'), 'alice');
  assert.throws(() => s.append({ id: 'alice001', batch: 1, points: Array(129).fill({ x: 0, y: 0 }) }, 'alice'), /batch/);
  let batch = 0;
  while (s.operations[0].points.length + 128 <= LIMITS.points) s.append({ id: 'alice001', batch: ++batch, points: Array(128).fill({ x: 0, y: 0 }) }, 'alice');
  assert.throws(() => s.append({ id: 'alice001', batch: ++batch, points: Array(128).fill({ x: 0, y: 0 }) }, 'alice'), /capacity/);
});
test('imports are validated atomically and reject stale revisions and active strokes', () => {
  const s = new DrawingState(); complete(s, 'alice001');
  const doc = { version: 1, operations: s.snapshot().operations };
  assert.throws(() => s.importDocument(doc, 0), /changed/);
  assert.throws(() => s.importDocument({ version: 1, operations: [{ kind: 'bogus' }] }, s.seq), /tool/);
  assert.equal(s.operations[0].id, 'alice001');
  s.begin(mark('bob00001'), 'bob'); assert.throws(() => s.importDocument(doc, s.seq), /finishes/); s.cancel('bob00001', 'bob');
  const event = s.importDocument(doc, s.seq); assert.equal(event.type, 'reset'); assert.equal(event.snapshot.seq, event.seq); assert.notEqual(s.operations[0].id, 'alice001'); assert.deepEqual(s.redo, []);
});
test('restore preserves undo/redo but excludes in-flight strokes', () => {
  const s = new DrawingState(); complete(s, 'alice001'); s.undo(); s.begin(mark('bob00001'), 'bob');
  const loaded = new DrawingState(); loaded.restore(s.snapshot()); assert.equal(loaded.operations.length, 1);
  assert.equal(loaded.redoLast().id, 'alice001'); assert.equal(loaded.operations[0].hidden, false);
});
