import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { DrawingState, ensure } from './drawing-state.js';

export function roomName(value) {
  ensure(typeof value === 'string' && /^[a-z0-9][a-z0-9_-]{0,39}$/.test(value), 'Room: 1–40 lowercase letters, digits, hyphens or underscores');
  return value;
}
export class Rooms {
  constructor(directory, onError = console.error) { this.directory = directory; this.items = new Map(); this.loading = new Map(); this.onError = onError; }
  async get(id) {
    roomName(id);
    if (this.items.has(id)) return this.items.get(id);
    if (this.loading.has(id)) return this.loading.get(id);
    ensure(this.items.size + this.loading.size < 100, 'Server room capacity reached');
    const pending = this.load(id); this.loading.set(id, pending);
    try { return await pending; } finally { this.loading.delete(id); }
  }
  async load(id) {
    await mkdir(this.directory, { recursive: true });
    const state = new DrawingState();
    try { state.restore(JSON.parse(await readFile(path.join(this.directory, `${id}.json`), 'utf8'))); }
    catch (error) { if (error.code !== 'ENOENT') throw new Error(`Cannot load room ${id}; existing file preserved: ${error.message}`); }
    const room = { id, state, users: new Map(), timer: null, write: Promise.resolve(), lastUsed: Date.now(), savedAt: null };
    this.items.set(id, room); return room;
  }
  schedule(room) {
    if (room.timer) return;
    room.timer = setTimeout(() => { room.timer = null; this.save(room).catch(e => this.onError(e, room)); }, 800);
    room.timer.unref?.();
  }
  async save(room) {
    clearTimeout(room.timer); room.timer = null;
    // Snapshot synchronously before queuing I/O; each room's atomic renames are serialized.
    const snapshot = room.state.snapshot(); snapshot.operations = snapshot.operations.filter(o => o.done);
    const data = JSON.stringify(snapshot);
    const target = path.join(this.directory, `${room.id}.json`);
    room.write = room.write.catch(() => {}).then(async () => {
      await writeFile(`${target}.tmp`, data, 'utf8'); await rename(`${target}.tmp`, target);
      room.savedAt = new Date().toISOString();
    });
    await room.write; return { savedAt: room.savedAt, seq: snapshot.seq };
  }
  async evictIdle() {
    for (const [id, room] of this.items) {
      if (!room.users.size && Date.now() - room.lastUsed > 300000) {
        try { await this.save(room); if (!room.users.size) this.items.delete(id); }
        catch (e) { this.onError(e, room); }
      }
    }
  }
  async close() { await Promise.all([...this.items.values()].map(r => this.save(r))); }
}
