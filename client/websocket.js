/** Transport never queues offline mutations. A fresh authoritative snapshot repairs uncertainty. */
export class Connection extends EventTarget {
  constructor() {
    super(); this.ready = false;
    this.socket = window.io({ transports: ['websocket'], autoConnect: false, reconnectionDelay: 500, reconnectionDelayMax: 5000, randomizationFactor: .5 });
    this.socket.on('connect', () => this.join(this.room, this.name));
    this.socket.on('disconnect', () => { this.ready = false; this.fire('status', 'Reconnecting…'); this.fire('offline'); });
    this.socket.on('connect_error', e => { this.ready = false; this.fire('status', 'Connection unavailable'); this.fire('error', e.message); });
    for (const event of ['event', 'users', 'cursor', 'notice']) this.socket.on(event, data => this.fire(event, data));
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
    if (!this.socket.connected || (!this.ready && !allowUnready)) return Promise.reject(new Error('Connection is not ready. Please wait or join again.'));
    return new Promise((resolve, reject) => this.socket.timeout(6000).emit(event, data, (err, result) => {
      if (err) reject(new Error('Server acknowledgement timed out. Resyncing may discard an unfinished mark.'));
      else if (!result?.ok) reject(new Error(result?.error || 'Request failed'));
      else resolve(result);
    }));
  }
  async resync() {
    if (this.syncing || !this.socket.connected) return;
    this.syncing = true; this.ready = false; this.fire('offline'); this.fire('status', 'Syncing…');
    try { await this.request('sync', {}, true); }
    catch (e) { this.fire('error', e.message); this.fire('status', 'Sync failed · join again'); }
    finally { this.syncing = false; }
  }
  cursor(point) { if (this.ready) this.socket.volatile.emit('cursor', point); }
}
