/** View-only zoom/pan: never changes shared coordinates or exported artwork. */
export function attachViewport(board) {
  const $ = id => document.getElementById(id), viewport = $('viewport'), wrap = $('canvas-wrap'), canvas = board.canvas;
  let zoom = 1, pan = false, dragging = null, pinch = null;
  const touches = new Map();
  function setZoom(value, anchor = { x: viewport.clientWidth / 2, y: viewport.clientHeight / 2 }) {
    const old = zoom; zoom = Math.max(1, Math.min(4, value));
    const x = (viewport.scrollLeft + anchor.x) * zoom / old - anchor.x, y = (viewport.scrollTop + anchor.y) * zoom / old - anchor.y;
    wrap.style.setProperty('--zoom', `${zoom * 100}%`); $('zoom-value').textContent = `${Math.round(zoom * 100)}%`;
    viewport.scrollLeft = x; viewport.scrollTop = y;
  }
  $('zoom-in').onclick = () => setZoom(zoom * 1.25); $('zoom-out').onclick = () => setZoom(zoom / 1.25);
  $('fit').onclick = () => { setZoom(1); viewport.scrollTo(0, 0); };
  $('pan').onclick = () => { if (board.active) board.cancel(); pan = !pan; $('pan').setAttribute('aria-pressed', String(pan)); canvas.style.cursor = pan ? 'grab' : 'crosshair'; };
  $('grid').onclick = () => $('grid').setAttribute('aria-pressed', String(wrap.classList.toggle('show-grid')));
  $('focus').onclick = () => $('focus').setAttribute('aria-pressed', String(document.body.classList.toggle('focus')));
  canvas.addEventListener('pointerdown', e => {
    if (e.pointerType === 'touch') touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.size === 2) {
      board.cancel(); const [a, b] = [...touches.values()]; pinch = { distance: Math.hypot(a.x - b.x, a.y - b.y), zoom }; e.stopImmediatePropagation(); e.preventDefault(); canvas.setPointerCapture(e.pointerId); return;
    }
    if (pan) { dragging = { id: e.pointerId, x: e.clientX, y: e.clientY, left: viewport.scrollLeft, top: viewport.scrollTop }; canvas.setPointerCapture(e.pointerId); e.stopImmediatePropagation(); e.preventDefault(); }
  }, true);
  canvas.addEventListener('pointermove', e => {
    if (touches.has(e.pointerId)) touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && touches.size >= 2) { const [a, b] = [...touches.values()]; setZoom(pinch.zoom * Math.hypot(a.x - b.x, a.y - b.y) / Math.max(1, pinch.distance)); e.stopImmediatePropagation(); e.preventDefault(); }
    else if (dragging?.id === e.pointerId) { viewport.scrollLeft = dragging.left + dragging.x - e.clientX; viewport.scrollTop = dragging.top + dragging.y - e.clientY; e.stopImmediatePropagation(); e.preventDefault(); }
  }, true);
  for (const event of ['pointerup', 'pointercancel']) canvas.addEventListener(event, e => {
    touches.delete(e.pointerId); if (pinch || dragging) e.stopImmediatePropagation(); if (touches.size < 2) pinch = null; if (dragging?.id === e.pointerId) dragging = null;
  }, true);
  viewport.addEventListener('wheel', e => { if (e.ctrlKey || e.metaKey) { e.preventDefault(); setZoom(zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1)); } }, { passive: false });
  return { setZoom, get zoom() { return zoom; } };
}
