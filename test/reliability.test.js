import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Rooms } from '../server/rooms.js';
import { DrawingState } from '../server/drawing-state.js';
import { Connection } from '../client/websocket.js';

test('ordinary history errors carry stable codes without changing revisions', () => {
  const state = new DrawingState();
  assert.throws(() => state.undo(), { code: 'NOTHING_TO_UNDO' });
  assert.throws(() => state.redoLast(), { code: 'NOTHING_TO_REDO' });
  assert.equal(state.seq, 0);
});
test('failed atomic save preserves previous snapshot and next save recovers', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'flamai-save-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const statuses = []; let fail = false;
  const rooms = new Rooms(dir, () => {}, (_, status) => statuses.push(status), {
    writeFile, rename: async (...args) => { if (fail) throw new Error('Injected disk failure'); return rename(...args); }
  });
  const room = await rooms.get('failure'); await rooms.save(room);
  const previous = await readFile(path.join(dir, 'failure.json'), 'utf8');
  room.state.begin({ id: 'stroke001', kind: 'brush', color: '#123456', width: 3, point: { x: 10, y: 10 } }, 'alice'); room.state.finish('stroke001', 'alice');
  fail = true; await assert.rejects(rooms.save(room), { code: 'SAVE_FAILED' });
  assert.equal(await readFile(path.join(dir, 'failure.json'), 'utf8'), previous);
  assert.equal(room.savedSeq, 0); assert.equal(statuses.at(-1).state, 'failed');
  fail = false; await rooms.save(room);
  assert.equal(JSON.parse(await readFile(path.join(dir, 'failure.json'), 'utf8')).operations.length, 1);
  assert.equal(statuses.at(-1).state, 'saved'); assert.equal(room.savedSeq, 2);
});
test('outstanding acknowledgements are bounded and pressure does not queue commands', async t => {
  const previousWindow = globalThis.window; let emitted = 0, closed = 0;
  const callbacks = [];
  const fake = { connected: true, on() {}, timeout() { return this; }, emit(event, data, callback) { emitted++; callbacks.push(callback); }, io: { engine: { close() { closed++; } } } };
  globalThis.window = { io: () => fake }; const connection = new Connection(); connection.ready = true;
  t.after(() => { clearInterval(connection.pingTimer); globalThis.window = previousWindow; });
  const pending = Array.from({ length: 8 }, () => connection.request('points', {}));
  await assert.rejects(connection.request('points', {}), { code: 'BACKPRESSURE' });
  assert.equal(connection.pending.size, 8); assert.equal(emitted, 8); assert.equal(closed, 1); assert.equal(connection.ready, false);
  callbacks.forEach(cb => cb(null, { ok: true })); await Promise.all(pending); assert.equal(connection.pendingBytes, 0);
});
