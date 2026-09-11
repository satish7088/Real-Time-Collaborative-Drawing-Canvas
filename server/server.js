import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { Rooms, roomName } from './rooms.js';
import { ensure, point } from './drawing-state.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const palette = ['#ef6b45', '#6757d9', '#008a7e', '#b2478c', '#2373c8', '#997014', '#ce4257', '#537d39'];
const assets = new Map([['/', ['index.html', 'text/html']], ...['style','pro'].map(n => [`/${n}.css`, [`${n}.css`, 'text/css']]), ...['canvas', 'websocket', 'main', 'viewport', 'render-worker'].map(n => [`/${n}.js`, [`${n}.js`, 'text/javascript']])]);

export function createApp({ dataDir = process.env.DATA_DIR || path.join(here, '../data'), allowedOrigin = process.env.ALLOWED_ORIGIN } = {}) {
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws: wss:; img-src 'self' blob: data:; frame-ancestors 'none'");
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/health') { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ ok: true })); }
    const asset = assets.get(url.pathname);
    if (!asset) { res.writeHead(404); return res.end('Not found'); }
    try { const body = await readFile(path.join(here, '../client', asset[0])); res.setHeader('Content-Type', `${asset[1]}; charset=utf-8`); res.setHeader('Cache-Control', 'no-cache'); res.end(req.method === 'HEAD' ? undefined : body); }
    catch { res.writeHead(500); res.end('Unable to serve application'); }
  });
  const io = new Server(server, {
    maxHttpBufferSize: 5 * 1024 * 1024,
    transports: ['websocket'],
    allowRequest: (req, done) => {
      const origin = req.headers.origin;
      let valid = !origin;
      try { valid ||= allowedOrigin ? origin === allowedOrigin : new URL(origin).host === req.headers.host; } catch {}
      done(null, valid);
    }
  });
  const rooms = new Rooms(dataDir, (error, room) => { console.error('Persistence:', error.message); if (room) io.to(room.id).emit('notice', { message: 'Disk save failed. Export JSON now; the board remains in memory.' }); }, (room, status) => io.to(room.id).emit('save:status', { room: room.id, ...status }));
  const users = room => io.to(room.id).emit('users', [...room.users.values()]);
  const publish = (room, event) => {
    for (const id of room.users.keys()) {
      const peer = io.sockets.sockets.get(id); if (!peer || peer.data.slow) continue;
      const buffered = peer.conn.transport.socket?.bufferedAmount || 0;
      if (peer.conn.writeBuffer.length >= 64 || buffered > 1024 * 1024) {
        peer.data.slow = true; queueMicrotask(() => peer.conn.close(true)); continue;
      }
      peer.emit('event', event);
    }
    if (event.type !== 'points' && event.type !== 'begin') rooms.schedule(room);
  };
  io.on('connection', socket => {
    let room = null, joining = false, tokens = 240, last = Date.now();
    const rate = () => { const now = Date.now(); tokens = Math.min(240, tokens + (now - last) * .12); last = now; ensure(tokens >= 1, 'Too many events; slow down'); tokens--; };
    const leave = () => {
      if (!room) return;
      for (const op of [...room.state.operations]) if (op.owner === socket.id && !op.done) publish(room, room.state.cancel(op.id, socket.id));
      room.users.delete(socket.id); room.lastUsed = Date.now(); socket.leave(room.id); users(room); room = null;
    };
    const handle = (name, fn, needsRoom = true) => socket.on(name, async (data, ack) => {
      try { rate(); if (needsRoom) ensure(room && !joining, 'Join a room first'); const result = await fn(data); if (typeof ack === 'function') ack({ ok: true, ...result }); }
      catch (e) { const result = { ok: false, error: e.message, code: e.code || 'VALIDATION', resync: name === 'points' || name === 'end' || e.code === 'SEQUENCE_GAP' }; if (typeof ack === 'function') ack(result); else socket.emit('notice', { message: e.message, code: result.code }); }
    });
    handle('join', async raw => {
      ensure(!joining, 'Already joining'); const id = roomName(raw?.room);
      ensure(typeof raw?.name === 'string' && raw.name.trim().length > 0 && raw.name.length <= 32, 'Name must be 1–32 characters');
      joining = true;
      try {
        const next = await rooms.get(id); ensure(next.users.size < 50 || next === room, 'Room is full (50 people)');
        ensure(socket.connected, 'Connection closed'); leave(); room = next;
        const taken = new Set([...room.users.values()].map(u => u.color));
        const user = { id: socket.id, name: raw.name.trim(), color: palette.find(c => !taken.has(c)) || palette[room.users.size % palette.length] };
        room.users.set(socket.id, user); room.lastUsed = Date.now(); socket.join(room.id);
        socket.emit('snapshot', { ...room.state.snapshot(), room: room.id, self: user, savedSeq: room.savedSeq, activity: room.activity }); users(room);
        return { room: room.id };
      } finally { joining = false; }
    }, false);
    handle('sync', () => {
      // Abandon the caller's uncertain in-flight stroke before replacing its local replica.
      for (const op of [...room.state.operations]) if (op.owner === socket.id && !op.done) publish(room, room.state.cancel(op.id, socket.id));
      socket.emit('snapshot', { ...room.state.snapshot(), room: room.id, self: room.users.get(socket.id), savedSeq: room.savedSeq, activity: room.activity }); return {};
    });
    const activity = (action, target = '') => { const entry = { actor: room.users.get(socket.id)?.name || 'Collaborator', action, target, seq: room.state.seq, at: Date.now() }; room.activity.unshift(entry); room.activity.length = Math.min(20, room.activity.length); io.to(room.id).emit('activity', entry); };
    handle('begin', raw => { const event = room.state.begin(raw, socket.id); const author = room.users.get(socket.id).name; event.operation.author = author; room.state.operations.at(-1).author = author; publish(room, event); return {}; });
    handle('points', raw => { publish(room, room.state.append(raw, socket.id)); return {}; });
    handle('end', raw => { publish(room, room.state.finish(raw?.id, socket.id)); if (room.state.operations.find(o => o.id === raw.id)?.kind === 'clear') activity('cleared the canvas'); return {}; });
    handle('cancel', raw => { publish(room, room.state.cancel(raw?.id, socket.id)); return {}; });
    handle('undo', () => { const event = room.state.undo(); publish(room, event); activity('undid', room.state.operations.find(o => o.id === event.id)?.author || 'Imported mark'); return {}; });
    handle('redo', () => { const event = room.state.redoLast(); publish(room, event); activity('redid', room.state.operations.find(o => o.id === event.id)?.author || 'Imported mark'); return {}; });
    handle('cursor', raw => { socket.to(room.id).volatile.emit('cursor', { id: socket.id, point: raw === null ? null : point(raw) }); return {}; });
    handle('save', async () => { const current = room; ensure(!current.state.operations.some(o => !o.done), 'Finish active strokes before saving', 'ACTIVE_STROKES'); return await rooms.save(current); });
    handle('load', raw => { const event = room.state.importDocument(raw?.document, raw?.expectedSeq); publish(room, event); activity('loaded a board'); return {}; });
    handle('ping:app', () => ({ time: Date.now() }), false);
    socket.on('disconnect', leave);
  });
  const cleanup = setInterval(() => {
    for (const room of rooms.items.values()) for (const op of [...room.state.operations]) {
      if (!op.done && Date.now() - op.touched > 30000) publish(room, room.state.cancel(op.id, op.owner));
    }
    rooms.evictIdle().catch(console.error);
  }, 10000); cleanup.unref();
  return { server, io, rooms,
    async listen(port = 3000, host = '0.0.0.0') { await new Promise(resolve => server.listen(port, host, resolve)); return server.address(); },
    async close() { clearInterval(cleanup); await new Promise(resolve => io.close(resolve)); await rooms.close(); }
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = createApp();
  app.server.on('error', error => { console.error('Server failed:', error.message); process.exitCode = 1; });
  await app.listen(Number(process.env.PORT || 3000));
  console.log(`FlamAI Canvas is ready at http://localhost:${process.env.PORT || 3000}`);
  let closing = false;
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => {
    if (closing) return; closing = true;
    try { await app.close(); process.exit(0); } catch (e) { console.error(e); process.exit(1); }
  });
}
