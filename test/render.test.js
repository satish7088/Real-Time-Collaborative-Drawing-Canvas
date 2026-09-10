import test from 'node:test';
import assert from 'node:assert/strict';
import { renderOperation } from '../client/canvas.js';

test('eraser composites destructively, clear resets, and shapes/text use native Canvas', () => {
  const calls = []; const ctx = new Proxy({}, { get(target, name) { return target[name] ?? ((...args) => calls.push([name, ...args])); }, set(target, name, value) { calls.push([name, value]); target[name] = value; return true; } });
  const base = { points: [{ x: 1, y: 2 }, { x: 20, y: 30 }], color: '#123456', width: 4 };
  renderOperation(ctx, { ...base, kind: 'eraser' }); assert.ok(calls.some(c => c[0] === 'globalCompositeOperation' && c[1] === 'destination-out'));
  for (const [kind, method] of [['clear', 'clearRect'], ['rectangle', 'strokeRect'], ['ellipse', 'ellipse'], ['text', 'fillText'], ['line', 'lineTo']]) {
    calls.length = 0; renderOperation(ctx, { ...base, kind, text: '<script>plain text</script>' }); assert.ok(calls.some(c => c[0] === method), kind);
  }
  calls.length = 0; renderOperation(ctx, { ...base, kind: 'brush', hidden: true }); assert.equal(calls.length, 0);
});
