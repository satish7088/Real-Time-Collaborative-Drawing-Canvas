/** Transport never queues offline mutations. A fresh authoritative snapshot repairs uncertainty. */
export class Connection extends EventTarget {
  constructor() {
    super(); this.ready = false; this.pending = new Map(); this.pendingBytes = 0; this.maxPending = 8; this.maxBytes = 65536; this.epoch = 0;
    this.socket = window.io({ transports: ['websocket'], autoConnect: false, reconnectionDelay: 500, reconnectionDelayMax: 5000, randomizationFactor: .5 });
    this.socket.on('connect', () => this.join(this.room, this.name));
    this.socket.on('disconnect', () => { this.epoch++; this.pending.clear(); this.pendingBytes = 0; this.ready = false; this.fire('status', 'Reconnecting…'); this.fire('offline'); });
    this.socket.on('connect_error', e => { this.ready = false; this.fire('status', 'Connection unavailable'); this.fire('error', e.message); });
    for (const event of ['event', 'users', 'cursor', 'notice', 'save:status', 'activity']) this.socket.on(event, data => this.fire(event, data));
    this.socket.on('snapshot', data => { this.ready = true; this.fire('snapshot', data); this.fire('status', 'Live · connected'); });
    this.pingTimer = setInterval(async () => {
      if (!this.ready) return;
      const t = performance.now();
      try { await this.request('ping:app', {}, true); this.fire('latency', Math.round(performance.now() - t)); } catch { this.fire('latency', null); }
    }, 2000);
  }
  fire(name, detail) { this.dispatchEvent(new CustomEvent(name, { detail })); }
  on(name, fn) { this.addEventListener(name, e => fn(e.detail)); }
  connect(room, name) { this.room = room; this.name = name; this.socket.connect(); }
  async join(room, name) {
    this.room = room; this.name = name; this.ready = false; this.fire('offline'); this.fire('status', 'Joining…');
    try { await this.request('join', { room, name }, true); }
    catch (e) { this.fire('error', e.message); this.fire('status', 'Could not join · retry'); }
  }
  request(event, data = {}, allowUnready = false) {
    if (!this.socket.connected || (!this.ready && !allowUnready)) return Promise.reject(Object.assign(new Error('Connection is not ready. Please wait or join again.'), { code: 'OFFLINE' }));
    const bytes = new TextEncoder().encode(JSON.stringify(data)).length;
    // A single bounded document import is allowed; drawing/control traffic shares the small budget.
    const budget = event === 'load' ? 5 * 1024 * 1024 : this.maxBytes;
    if (this.pending.size >= this.maxPending || this.pendingBytes + bytes > budget) {
      this.pause(); return Promise.reject(Object.assign(new Error('Connection cannot keep up. Drawing paused; recovering a fresh board.'), { code: 'BACKPRESSURE' }));
    }
    const key = Symbol(event), epoch = this.epoch; this.pending.set(key, bytes); this.pendingBytes += bytes;
    this.fire('queue', this.pending.size);
    return new Promise((resolve, reject) => this.socket.timeout(6000).emit(event, data, (err, result) => {
      if (this.pending.delete(key)) this.pendingBytes -= bytes;
      this.fire('queue', this.pending.size);
      if (epoch !== this.epoch) return reject(Object.assign(new Error('Connection changed; the board will refresh.'), { code: 'OFFLINE' }));
      if (err) { this.pause(); reject(Object.assign(new Error('Acknowledgement timed out. Recovering a fresh board.'), { code: 'ACK_TIMEOUT' })); }
      else if (!result?.ok) reject(Object.assign(new Error(result?.error || 'Request failed'), { code: result?.code || 'VALIDATION', resync: !!result?.resync }));
      else resolve(result);
    }));
  }
  pause() {
    if (!this.ready) return;
    this.ready = false; this.fire('offline'); this.fire('pressure', 'Slow connection · drawing paused while the board recovers.');
    // Close the uncertain transport instead of retaining an unbounded retry queue.
    // Automatic reconnect joins with a full snapshot; no drawing command is replayed.
    this.socket.io.engine?.close();
  }
  async resync() {
    if (this.syncing || !this.socket.connected) return;
    this.syncing = true; this.ready = false; this.fire('offline'); this.fire('status', 'Syncing…');
    try { await this.request('sync', {}, true); }
    catch (e) { this.fire('error', e.message); this.fire('status', 'Sync failed · join again'); }
    finally { this.syncing = false; }
  }
  cursor(point) { if (this.ready && this.pending.size < 4) this.socket.volatile.emit('cursor', point); }
}
