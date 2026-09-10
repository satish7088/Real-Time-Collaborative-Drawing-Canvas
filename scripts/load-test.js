// Run against a disposable running server: npm run test:load -- 20 100
import { io } from 'socket.io-client';
import { performance } from 'node:perf_hooks';
const count = Number(process.argv[2] || 20), rounds = Number(process.argv[3] || 30);
if (!Number.isInteger(count) || count < 1 || count > 1000 || !Number.isInteger(rounds) || rounds < 1 || rounds > 100) throw new Error('Use 1–1000 clients and 1–100 rounds');
const url = process.env.TARGET_URL || 'http://localhost:3000'; const sockets = [], times = []; let received = 0;
const emit = (s, e, d) => new Promise((resolve, reject) => s.timeout(10000).emit(e, d, (err, r) => err || !r?.ok ? reject(err || Error(r?.error)) : resolve(r)));
try {
  const run = Date.now().toString(36);
  for (let i = 0; i < count; i++) {
    const s = io(url, { transports: ['websocket'], autoConnect: false, reconnection: false }); sockets.push(s);
    await new Promise((resolve, reject) => { s.once('connect', resolve); s.once('connect_error', reject); s.connect(); });
    await emit(s, 'join', { room: `load-${run}-${Math.floor(i / 25)}`, name: `Load ${i}` }); s.on('event', () => received++);
  }
  for (let round = 0; round < rounds; round++) {
    await Promise.all(sockets.map(async (s, i) => {
      const id = `${run}_${round}_${i}`, start = performance.now();
      await emit(s, 'begin', { id, kind: 'brush', color: '#123456', width: 3, point: { x: i, y: round } });
      await emit(s, 'points', { id, batch: 1, points: Array.from({ length: 10 }, (_, p) => ({ x: p + i, y: round + p })) });
      await emit(s, 'end', { id }); times.push(performance.now() - start);
    }));
    await new Promise(r => setTimeout(r, 50));
  }
  times.sort((a, b) => a - b); console.log(JSON.stringify({ clients: count, rounds, receivedEvents: received, operationAckP50Ms: times[Math.floor(times.length * .5)], operationAckP95Ms: times[Math.floor(times.length * .95)] }, null, 2));
} finally { for (const s of sockets) s.disconnect(); }
