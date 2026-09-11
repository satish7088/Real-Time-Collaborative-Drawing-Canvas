import { Connection } from './websocket.js';
import { CanvasBoard } from './canvas.js';
import { attachViewport } from './viewport.js';
const $ = id => document.getElementById(id);
let toastTimer, seq = 0, self, currentRoom, syncingError = false, savedSeq = 0, saveState = 'saved';
function toast(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, 6000); }
function preference(key, fallback) { try { return localStorage.getItem(key) || fallback; } catch { return fallback; } }
function remember(key, value) { try { localStorage.setItem(key, value); } catch {} }
const connection = new Connection();
async function send(event, data) {
  try { return await connection.request(event, data); }
  catch (e) {
    if (e.code !== 'OFFLINE') toast(e.message);
    if (event === 'begin' && data?.id) { board.optimistic.delete(data.id); if (board.active?.op.id === data.id) board.active = null; board.invalidate(); }
    if (e.resync && !syncingError) { syncingError = true; await connection.resync(); syncingError = false; }
    return null;
  }
}
const board = new CanvasBoard($('drawing'), $('cursors'), { send, cursor: p => connection.cursor(p), error: toast,
  fps: n => $('fps').textContent = `${n} FPS`, changed: () => updateHistory() });
const viewport = attachViewport(board);
function updateHistory() {
  $('undo').disabled = !connection.ready || !board.operations.some(o => o.done && !o.hidden);
  $('redo').disabled = !connection.ready || !board.redo.length;
  $('op-count').textContent = `${board.operations.filter(o => o.done && !o.hidden).length} marks`;
  const next = board.operations.findLast(o => o.done && !o.hidden);
  $('next-undo').textContent = next ? `Next: ${next.author || 'Imported'} · ${next.kind}` : 'No completed marks yet';
  updateSave();
}
function updateSave() {
  const active = board.operations.some(o => !o.done) || board.optimistic.size > 0;
  const state = saveState === 'failed' ? 'failed' : saveState === 'saving' ? 'saving' : (seq > savedSeq || active) ? 'unsaved' : 'saved';
  $('save-state').dataset.state = state;
  $('save-state').textContent = `${({ unsaved: 'Unsaved changes', saving: 'Saving…', saved: 'All changes saved', failed: 'Save failed · retry' })[state]} · r${savedSeq}/${seq}`;
}
function showActivity(entry, prepend = true) {
  const li = document.createElement('li'); li.textContent = `${entry.actor} ${entry.action}${entry.target ? ` ${entry.target}’s mark` : ''}`;
  if (prepend) $('activity').prepend(li); else $('activity').append(li);
  while ($('activity').children.length > 6) $('activity').lastChild.remove();
}
connection.on('snapshot', data => {
  seq = data.seq; savedSeq = data.savedSeq || 0; saveState = 'saved'; self = data.self; currentRoom = data.room; board.snapshot(data); $('connection-overlay').hidden = true; $('room').value = data.room;
  $('activity').replaceChildren(); for (const entry of data.activity || []) showActivity(entry, false);
  const url = new URL(location.href); url.searchParams.set('room', data.room); history.replaceState({}, '', url);
  $('save-note').textContent = `Room “${data.room}” · completed marks autosave. Export JSON for a portable backup.`;
});
connection.on('event', event => {
  if (!connection.ready) return;
  if (event.seq <= seq) return;
  if (event.seq !== seq + 1) { connection.resync(); return; }
  seq = event.seq; board.apply(event);
});
connection.on('offline', () => { board.offline(); $('connection-overlay').hidden = false; $('connection-overlay').textContent = 'Connection paused. Waiting for a fresh board…'; updateHistory(); });
connection.on('status', status => { $('status').textContent = status; $('status-dot').classList.toggle('online', connection.ready); updateHistory(); });
connection.on('error', toast); connection.on('notice', data => toast(data.message));
connection.on('pressure', message => { toast(message); $('connection-overlay').textContent = message; });
connection.on('queue', n => $('queue').textContent = `${n}/8 pending`);
connection.on('save:status', data => { if (data.room !== currentRoom) return; savedSeq = Math.max(savedSeq, data.savedSeq || 0); saveState = data.state; updateSave(); });
connection.on('activity', entry => showActivity(entry));
connection.on('latency', n => $('latency').textContent = n === null ? '— ms RTT' : `${n} ms RTT`);
connection.on('users', list => {
  board.users = new Map(list.map(u => [u.id, u])); $('users').replaceChildren();
  for (const user of list) { const li = document.createElement('li'); li.textContent = `${user.name}${user.id === self?.id ? ' (you)' : ''}`; li.title = user.name; li.style.setProperty('--user-color', user.color); $('users').append(li); }
});
connection.on('cursor', cursor => { if (cursor.point) board.cursors.set(cursor.id, { ...cursor, at: performance.now() }); else board.cursors.delete(cursor.id); });
const descriptions = { brush: 'Brush · drag to draw', eraser: 'Eraser · remove ink with a stroke', line: 'Line · drag from start to end', rectangle: 'Box · drag between opposite corners', ellipse: 'Ellipse · drag to set its bounds', text: 'Text · tap to place your words' };
function setTool(tool) { board.tool = tool; for (const button of $('tools').children) button.setAttribute('aria-pressed', String(button.dataset.tool === tool)); $('text-options').hidden = tool !== 'text'; $('tool-description').textContent = descriptions[tool]; }
$('tools').addEventListener('click', e => { const tool = e.target.closest('[data-tool]')?.dataset.tool; if (tool) setTool(tool); });
const colors = ['#263c32', '#eb764d', '#e4b54a', '#6e84a3', '#7871b0', '#83a58a', '#d095a6', '#ffffff'];
function setColor(color) { board.color = color; $('color').value = color; for (const b of $('swatches').children) b.setAttribute('aria-pressed', String(b.dataset.color === color)); }
for (const color of colors) { const b = document.createElement('button'); b.style.backgroundColor = color; b.dataset.color = color; b.title = `Ink ${color}`; b.setAttribute('aria-label', b.title); b.addEventListener('click', () => setColor(color)); $('swatches').append(b); }
setColor(board.color);
$('color').addEventListener('input', e => setColor(e.target.value));
$('width').addEventListener('input', e => { board.width = Number(e.target.value); $('width-value').textContent = `${board.width} px`; });
$('text').addEventListener('input', e => board.text = e.target.value); board.text = $('text').value;
$('undo').addEventListener('click', () => send('undo')); $('redo').addEventListener('click', () => send('redo'));
$('clear').addEventListener('click', async () => {
  if (!connection.ready || board.active || !confirm('Clear the shared canvas for everyone? Anyone can undo this.')) return;
  const id = `clear_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  if (await send('begin', { id, kind: 'clear', color: '#ffffff', width: 1, point: { x: 0, y: 0 } })) await send('end', { id });
});
$('room-form').addEventListener('submit', async e => {
  e.preventDefault(); remember('flamai-name', $('name').value); $('join').disabled = true;
  try { if (connection.socket.connected) await connection.join($('room').value, $('name').value); else connection.connect($('room').value, $('name').value); }
  finally { $('join').disabled = false; }
});
$('share').addEventListener('click', async () => { try { const url = new URL(location.href); url.searchParams.set('room', currentRoom || $('room').value); await navigator.clipboard.writeText(url.href); toast('Room link copied. Send it to a collaborator.'); } catch { toast('Copy the room link from your browser’s address bar.'); } });
$('save').addEventListener('click', async () => { const result = await send('save'); if (result) { savedSeq = Math.max(savedSeq, result.seq); saveState = 'saved'; updateSave(); toast('Board saved to disk.'); } });
function download(blob, name) { const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 30000); }
$('export').addEventListener('click', () => { download(new Blob([JSON.stringify(board.document())], { type: 'application/json' }), `flamai-${currentRoom || 'board'}.json`); toast('Exported completed visible marks.'); });
$('png').addEventListener('click', async () => { const blob = await board.png(); if (blob) download(blob, `flamai-${currentRoom || 'board'}.png`); else toast('PNG export failed. Try JSON export.'); });
$('import').addEventListener('click', () => { if (!connection.ready) return toast('Join a room before loading a board.'); $('file').click(); });
$('file').addEventListener('change', async e => {
  const file = e.target.files[0]; e.target.value = ''; if (!file) return;
  const expectedSeq = seq;
  try { if (file.size > 5 * 1024 * 1024) throw new Error('File must be smaller than 5 MB.'); const document = JSON.parse(await file.text());
    if (!confirm('Replace this room’s board and undo history for everyone? Export a backup first.')) return;
    const result = await send('load', { document, expectedSeq }); if (result) toast('Board loaded for everyone.');
  } catch (error) { toast(`Cannot load: ${error.message}`); }
});
window.addEventListener('keydown', e => {
  if (e.target.matches('input, textarea, select, [contenteditable]')) return;
  const key = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && key === 'z') { e.preventDefault(); send(e.shiftKey ? 'redo' : 'undo'); }
  else if ((e.ctrlKey || e.metaKey) && key === 'y') { e.preventDefault(); send('redo'); }
  else if (key === 'escape') board.cancel();
  else if (!e.ctrlKey && !e.metaKey && !e.altKey) { const tool = { b: 'brush', e: 'eraser', l: 'line', r: 'rectangle', o: 'ellipse', t: 'text' }[key]; if (tool) setTool(tool); }
});
document.addEventListener('visibilitychange', () => { if (document.hidden && board.active) board.up(); });
$('name').value = preference('flamai-name', `Guest ${Math.floor(Math.random() * 900 + 100)}`);
const requested = new URLSearchParams(location.search).get('room');
$('room').value = /^[a-z0-9][a-z0-9_-]{0,39}$/.test(requested || '') ? requested : 'studio';
connection.connect($('room').value, $('name').value);
// Exports let browser tests exercise the actual modules, without shipping an admin endpoint.
export { board, connection, send, viewport };
