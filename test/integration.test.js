import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { io } from 'socket.io-client';
import { createApp } from '../server/server.js';
import { Connection } from '../client/websocket.js';

const request = (s, event, data = {}) => new Promise((resolve, reject) => s.timeout(3000).emit(event, data, (err, r) => err ? reject(err) : resolve(r)));
function next(s, event) { return new Promise((resolve, reject) => { const timer = setTimeout(() => { s.off(event, listener); reject(new Error(`Timed out: ${event}`)); }, 3000); const listener = x => { clearTimeout(timer); resolve(x); }; s.once(event, listener); }); }
const mark = id => ({ id, kind: 'brush', color: '#123456', width: 5, point: { x: 1, y: 2 } });

test('real sockets: streaming, ownership, rooms, undo, resync, import, save and restart', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'flamai-test-'));
  let app = createApp({ dataDir: dir }); const address = await app.listen(0, '127.0.0.1'); let url = `http://127.0.0.1:${address.port}`;
  const clients = [];
  t.after(async () => { for (const s of clients) s.disconnect(); await app.close(); await rm(dir, { recursive: true, force: true }); });
  async function client(room, name) {
    const socket = io(url, { transports: ['websocket'], autoConnect: false, reconnection: false }); clients.push(socket);
    const connected = next(socket, 'connect'); socket.connect(); await connected;
    const snapshot = next(socket, 'snapshot'); assert.equal((await request(socket, 'join', { room, name })).ok, true); await snapshot; return socket;
  }
  assert.equal((await fetch(`${url}/health`)).status, 200);
  for (const file of ['/', '/canvas.js', '/websocket.js', '/main.js', '/style.css', '/socket.io/socket.io.js']) assert.equal((await fetch(url + file)).status, 200, file);
  assert.equal((await fetch(`${url}/server/server.js`)).status, 404);
  const a = await client('studio', 'Alice'), b = await client('studio', 'Bob'), c = await client('isolated', 'Carol');
  const isolated = []; c.on('event', e => isolated.push(e));
  const bEvents = []; b.on('event', e => bEvents.push(e));
  const live = next(b, 'event'); assert.equal((await request(a, 'begin', mark('alice001'))).ok, true); assert.equal((await live).type, 'begin');
  const streamed = next(b, 'event'); await request(a, 'points', { id: 'alice001', batch: 1, points: [{ x: 42, y: 50 }] });
  assert.equal((await streamed).type, 'points'); assert.equal(app.rooms.items.get('studio').state.operations[0].done, false);
  assert.equal((await request(b, 'end', { id: 'alice001' })).ok, false);
  await request(a, 'end', { id: 'alice001' });
  const undone = next(a, 'event'); assert.equal((await request(b, 'undo')).ok, true); assert.equal((await undone).hidden, true);
  const redone = next(a, 'event'); await request(b, 'redo'); assert.equal((await redone).hidden, false);
  assert.equal(isolated.length, 0);
  for (let i = 1; i < bEvents.length; i++) assert.equal(bEvents[i].seq, bEvents[i - 1].seq + 1);
  const cursor = next(b, 'cursor'); a.emit('cursor', { x: 100, y: 100 }); assert.deepEqual((await cursor).point, { x: 100, y: 100 });
  const partialBegin = next(b, 'event'); await request(a, 'begin', mark('partial1')); await partialBegin;
  const cancelled = next(b, 'event'); a.disconnect(); assert.equal((await cancelled).type, 'cancel');
  const rejoined = await client('studio', 'Alice again'); const snap = next(rejoined, 'snapshot'); await request(rejoined, 'sync');
  const snapshot = await snap; assert.equal(snapshot.operations.length, 1); assert.equal(snapshot.operations[0].points.length, 2);
  assert.equal((await request(b, 'load', { document: { version: 1, operations: [] }, expectedSeq: 0 })).ok, false);
  const save = await request(b, 'save'); assert.equal(save.ok, true);
  const disk = JSON.parse(await readFile(path.join(dir, 'studio.json'), 'utf8')); assert.equal(disk.operations.length, 1);
  for (const s of clients) s.disconnect(); await app.close();
  app = createApp({ dataDir: dir }); const restarted = await app.listen(0, '127.0.0.1'); url = `http://127.0.0.1:${restarted.port}`;
  const d = await client('studio', 'After restart'); const restored = next(d, 'snapshot'); await request(d, 'sync'); const restoredState = await restored;
  assert.equal(restoredState.operations[0].id, 'alice001'); assert.equal(restoredState.operations[0].points.length, 2);
  assert.equal((await request(d, 'load', { document: { version: 1, operations: [] }, expectedSeq: restoredState.seq })).ok, true);
  assert.equal(app.rooms.items.get('studio').state.operations.length, 0);
});

test('invalid join and corrupted room files report errors without overwriting data', async t => {
  const { writeFile } = await import('node:fs/promises'); const dir = await mkdtemp(path.join(os.tmpdir(), 'flamai-corrupt-'));
  await writeFile(path.join(dir, 'broken.json'), 'broken-json'); const app = createApp({ dataDir: dir }); const { port } = await app.listen(0, '127.0.0.1');
  const s = io(`http://127.0.0.1:${port}`, { transports: ['websocket'], autoConnect: false });
  t.after(async () => { s.disconnect(); await app.close(); await rm(dir, { recursive: true, force: true }); });
  const connected = next(s, 'connect'); s.connect(); await connected;
  assert.equal((await request(s, 'join', { room: '../escape', name: 'A' })).ok, false);
  assert.equal((await request(s, 'join', { room: 'broken', name: 'A' })).ok, false);
  assert.equal(await readFile(path.join(dir, 'broken.json'), 'utf8'), 'broken-json');
});

test('browser connection wrapper automatically reconnects and receives a fresh snapshot', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'flamai-reconnect-'));
  const app = createApp({ dataDir: dir }); const { port } = await app.listen(0, '127.0.0.1');
  const previousWindow = globalThis.window;
  globalThis.window = { io: options => io(`http://127.0.0.1:${port}`, options) };
  const connection = new Connection();
  t.after(async () => { clearInterval(connection.pingTimer); connection.socket.disconnect(); globalThis.window = previousWindow; await app.close(); await rm(dir, { recursive: true, force: true }); });
  function snapshot() { return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { connection.removeEventListener('snapshot', listener); reject(new Error('Reconnect snapshot timeout')); }, 5000);
    const listener = e => { clearTimeout(timer); resolve(e.detail); }; connection.addEventListener('snapshot', listener, { once: true });
  }); }
  const initial = snapshot(); connection.connect('recover', 'Alice'); await initial;
  await connection.request('begin', mark('recover1')); await connection.request('end', { id: 'recover1' });
  const oldId = connection.socket.id; const recovered = snapshot(); connection.socket.io.engine.close();
  const state = await recovered;
  assert.equal(connection.ready, true); assert.notEqual(state.self.id, oldId);
  assert.equal(state.operations.length, 1); assert.equal(state.operations[0].id, 'recover1');
});
