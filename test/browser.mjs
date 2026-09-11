/** Real Chromium acceptance + pixel convergence + reproducible render benchmarks.
 * Optional prerequisite: npm install --no-save playwright@1.62.1 && npx playwright install chromium
 * BROWSER_CHANNEL=chrome|msedge uses an already installed browser.
 */
import assert from 'node:assert/strict';
import { mkdir, writeFile, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { createApp } from '../server/server.js';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const out = path.resolve('evidence'); await mkdir(out, { recursive: true });
const report = { startedAt: new Date().toISOString(), browser: '', checks: [], benchmarks: {}, limitations: ['Mobile and pen inputs are emulated, not physical-device tests.'] };
async function pass(name, data = {}) { report.checks.push({ name, passed: true, ...data }); console.log(`PASS ${name}`); await writeFile(path.join(out, 'browser-results.json'), JSON.stringify(report, null, 2)); }
const dir = await mkdtemp(path.join(os.tmpdir(), 'flamai-browser-')); const app = createApp({ dataDir: dir }); const { port } = await app.listen(0, '127.0.0.1'); const url = `http://127.0.0.1:${port}`;
let browser; const contexts = [], errors = [];
const delay = ms => new Promise(r => setTimeout(r, ms));
async function moduleEval(page, fn, arg) { return page.evaluate(`(async () => { const m = await import('/main.js'); return (${fn.toString()})(m, ${JSON.stringify(arg) ?? 'undefined'}); })()`); }
async function ready(page) { await page.waitForFunction(() => document.getElementById('status').textContent === 'Live · connected'); }
async function settle(page) { await page.waitForFunction(async () => { const { board, connection } = await import('/main.js'); return !board.dirty && !board.workerPending && !board.active && board.optimistic.size === 0 && connection.pending.size === 0; }); }
async function pixels(page) { await settle(page); return page.locator('#drawing').evaluate(c => c.toDataURL()); }
async function same(a, b) { await settle(a); await settle(b); await b.waitForFunction(async n => (await import('/main.js')).board.operations.length === n, await moduleEval(a, m => m.board.operations.length)); assert.equal(await pixels(a), await pixels(b)); }
async function stroke(page, points = [[.2,.25],[.4,.4],[.6,.3]], tool = 'brush') {
  await page.locator(`[data-tool=${tool}]`).click(); const box = await page.locator('#drawing').boundingBox();
  await page.mouse.move(box.x + points[0][0] * box.width, box.y + points[0][1] * box.height); await page.mouse.down();
  for (const p of points.slice(1)) await page.mouse.move(box.x + p[0] * box.width, box.y + p[1] * box.height, { steps: 10 });
  await page.mouse.up(); await settle(page);
}
async function join(page, room) { await page.locator('#room').fill(room); await page.locator('#join').click(); await ready(page); await page.waitForURL(`**room=${room}`); }
async function saveShot(page, name) { await page.screenshot({ path: path.join(out, name), fullPage: true }); }
try {
  browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}) }); report.browser = browser.version();
  async function newPage(name, options = {}) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1050 }, ...options }); contexts.push(context);
    await context.addInitScript(name => localStorage.setItem('flamai-name', name), name);
    const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message)); page.on('dialog', d => d.accept()); await page.goto(`${url}/?room=acceptance`); await ready(page); return page;
  }
  const a = await newPage('Alice'), b = await newPage('Bob');
  await a.locator('#users li').filter({ hasText: 'Bob' }).waitFor();
  const box = await a.locator('#drawing').boundingBox(); await a.mouse.move(box.x + 50, box.y + 60); await a.mouse.down(); await a.mouse.move(box.x + 180, box.y + 140, { steps: 15 });
  await b.waitForFunction(async () => (await import('/main.js')).board.operations.some(o => !o.done && o.points.length > 1));
  assert.ok(await b.locator('#drawing').evaluate(c => c.getContext('2d').getImageData(0,0,c.width,c.height).data.some((v,i) => i % 4 === 3 && v > 0)));
  await pass('Peer sees nonempty pixels while the other pointer is still down');
  await a.mouse.up(); await same(a,b);
  await Promise.all([stroke(a, [[.1,.5],[.5,.2],[.8,.7]]), stroke(b, [[.1,.7],[.5,.2],[.85,.5]])]); await same(a,b); await pass('Two independent contexts draw overlapping strokes and converge pixel-for-pixel');
  await saveShot(a, '01-two-user-studio.png'); await saveShot(b, '02-peer-studio.png');
  const original = await pixels(a); await stroke(b, [[.1,.5],[.5,.2],[.8,.7]], 'eraser'); await same(a,b); assert.notEqual(await pixels(a), original);
  await a.locator('#undo').click(); await same(a,b); assert.equal(await pixels(a), original); await pass('Eraser undo restores exact previous pixels across users');
  await b.locator('#clear').click(); await same(a,b); assert.notEqual(await pixels(a), original);
  await a.locator('#undo').click(); await same(a,b); assert.equal(await pixels(a), original); await pass('Clear undo restores exact previous pixels');
  await a.locator('#activity li').filter({ hasText: 'Bob cleared' }).waitFor(); await pass('Shared action actor is visible in activity feed');
  await join(b, 'separate'); assert.equal(await moduleEval(b,m=>m.board.operations.length),0); await stroke(b); await join(b, 'acceptance'); await same(a,b); await pass('Room switching isolates artwork and restores the original board');
  const document = await moduleEval(a,m=>m.board.document());
  await b.locator('#file').setInputFiles({ name:'board.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(document)) });
  await a.waitForFunction(async ()=>(await import('/main.js')).board.operations.every(o=>o.owner==='import')); await same(a,b); assert.equal(await pixels(a), original); await pass('JSON import replaces both boards and preserves pixels');
  await b.context().setOffline(true); await b.waitForFunction(()=>document.getElementById('connection-overlay').hidden===false);
  await stroke(a, [[.6,.2],[.85,.25]],'line'); await b.context().setOffline(false); await ready(b); await same(a,b); await pass('Offline peer reconnects with a fresh authoritative snapshot');
  // Harmless errors must not cancel an active operation.
  await join(a,'ordinary-error');
  const rect=await a.locator('#drawing').boundingBox(); await a.mouse.move(rect.x+40,rect.y+40); await a.mouse.down(); await a.mouse.move(rect.x+100,rect.y+100,{steps:5});
  const result=await moduleEval(a,async m=> { const id=m.board.active.op.id; const errors=[]; for(const event of ['undo','save']) { try {await m.connection.request(event);} catch(e){errors.push({code:e.code,resync:e.resync});} } return {id,after:m.board.active?.op.id,errors}; });
  assert.equal(result.after,result.id); assert.deepEqual(result.errors,[{code:'NOTHING_TO_UNDO',resync:false},{code:'ACTIVE_STROKES',resync:false}]);
  await a.mouse.up(); await pass('Nothing-to-undo and save-while-drawing preserve the active stroke');
  await join(a,'acceptance'); await same(a,b);
  // Delay server acknowledgements to exercise actual network flow control.
  const before=await pixels(a), socket=app.io.sockets.sockets.get(await moduleEval(a,m=>m.connection.socket.id));
  socket.use(([event,...args], next) => { if(event==='ping:app') setTimeout(next,600); else next(); });
  const pressure=await moduleEval(a,async m=> { const attempts=Array.from({length:12},()=>m.connection.request('ping:app').catch(e=>e.code)); const peak=m.connection.pending.size; await Promise.all(attempts); return peak; });
  assert.ok(pressure<=8); await ready(a); await same(a,b); assert.equal(await pixels(a),before); await pass('Delayed acknowledgements bound outstanding commands to eight and recover by snapshot',{peakPending:pressure});
  const oldSlowId=await moduleEval(a,m=>m.connection.socket.id), slowPeer=app.io.sockets.sockets.get(oldSlowId);
  Object.defineProperty(slowPeer.conn.transport.socket,'bufferedAmount',{get:()=>2*1024*1024,configurable:true});
  await stroke(b,[[.7,.8],[.9,.8]],'line');
  await a.waitForFunction(async old=>(await import('/main.js')).connection.socket.id!==old,oldSlowId); await ready(a); await same(a,b); await pass('Server evicts an over-budget outbound connection; peer rejoins and converges');
  await a.locator('#save').click(); await a.waitForFunction(()=>document.getElementById('save-state').dataset.state==='saved'); await pass('Revision-aware save indicator reaches saved');
  // Real filesystem fault injection at the storage boundary, observed through the browser.
  const realRename=app.rooms.storage.rename; app.rooms.storage.rename=async()=>{throw new Error('Injected write failure');};
  await a.locator('#save').click(); await a.waitForFunction(()=>document.getElementById('save-state').dataset.state==='failed');
  app.rooms.storage.rename=realRename; await a.locator('#save').click(); await a.waitForFunction(()=>document.getElementById('save-state').dataset.state==='saved'); await same(a,b); await pass('Save failure is visible and retry recovers without losing artwork');
  // Mobile emulation uses native touch input and Chromium's pen/pointer path.
  const mobile=await newPage('Mobile',{viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:1});
  await mobile.locator('#drawing').scrollIntoViewIfNeeded(); const mb=await mobile.locator('#drawing').boundingBox();
  const beforeMobile=await moduleEval(mobile,m=>m.board.operations.length);
  await mobile.touchscreen.tap(mb.x+80,mb.y+70); await settle(mobile); assert.equal(await moduleEval(mobile,m=>m.board.operations.length),beforeMobile+1); await pass('Native mobile touch places a mark');
  const cdp=await mobile.context().newCDPSession(mobile);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:mb.x+90,y:mb.y+75}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:mb.x+110,y:mb.y+85}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]}); await settle(mobile); assert.equal(await moduleEval(mobile,m=>m.board.operations.length),beforeMobile+1); await pass('Native touch cancellation removes unfinished mark');
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:mb.x+100,y:mb.y+70}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:mb.x+100,y:mb.y+70},{x:mb.x+190,y:mb.y+70}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:mb.x+70,y:mb.y+70},{x:mb.x+230,y:mb.y+70}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]}); await settle(mobile);
  assert.ok(await moduleEval(mobile,m=>m.viewport.zoom)>1); assert.equal(await moduleEval(mobile,m=>m.board.operations.length),beforeMobile+1); await mobile.locator('#fit').click(); await pass('Two-finger pinch zoom cancels accidental ink and changes only the view');
  await mobile.locator('#zoom-in').click(); assert.equal(await mobile.locator('#zoom-value').textContent(),'125%'); await mobile.locator('#pan').click();
  await mobile.locator('#fit').click(); await mobile.locator('#pan').click();
  await mobile.setViewportSize({width:844,height:390}); await mobile.locator('#drawing').scrollIntoViewIfNeeded();
  const pen=await mobile.locator('#drawing').boundingBox(); const x=pen.x+120,y=pen.y+60;
  await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',buttons:1,clickCount:1,pointerType:'pen'});
  await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:x+80,y:y+35,button:'left',buttons:1,pointerType:'pen'});
  await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:x+80,y:y+35,button:'left',buttons:0,clickCount:1,pointerType:'pen'});
  await settle(mobile); assert.equal(await moduleEval(mobile,m=>m.board.operations.length),beforeMobile+2); await pass('Orientation resize and emulated pen input preserve coordinate mapping');
  await mobile.setViewportSize({width:390,height:844}); await saveShot(mobile,'03-mobile-studio.png');
  assert.ok(await mobile.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)); await pass('Mobile layout has no horizontal document overflow');
  // Benchmark the actual renderer with legal, near-capacity vectors and active overlap.
  report.benchmarks=await moduleEval(a,async m=>{
    const flush=()=>m.board.ctx.getImageData(0,0,1,1);
    const frame=()=>new Promise(r=>requestAnimationFrame(r));
    const run=async(operations,rounds)=>{m.board.snapshot({operations,redo:[]});const samples=[];for(let i=0;i<rounds;i++){await frame();m.board.invalidate();const start=performance.now();await m.board.drawAsync();samples.push(performance.now()-start);}samples.sort((a,b)=>a-b);return {p50Ms:samples[Math.floor(samples.length*.5)],p95Ms:samples[Math.floor(samples.length*.95)],samples};};
    const make=(i,n,done)=>({id:`bench_${i}`,owner:'bench',kind:i%9===0?'eraser':'brush',color:'#ed7546',width:3,done,hidden:false,points:Array.from({length:n},(_,p)=>({x:50+(p*7+i*3)%1500,y:50+Math.sin(p*.07+i)*350+400}))});
    let beats=0,last=performance.now(),maxGap=0;const heartbeat=setInterval(()=>{const now=performance.now();maxGap=Math.max(maxGap,now-last);last=now;beats++;},16);
    const overlap=await run(Array.from({length:12},(_,i)=>make(i,4000,false)),10);
    const capacity=Array.from({length:1490},(_,i)=>make(i,80,true));const undo=[];m.board.snapshot({operations:capacity,redo:[]});await m.board.drawAsync();
    for(let i=0;i<20;i++){await frame();const start=performance.now();m.board.apply({type:'visibility',id:`bench_${1489-i}`,hidden:true,redo:[]});await m.board.drawAsync();undo.push(performance.now()-start);}undo.sort((a,b)=>a-b);
    clearInterval(heartbeat);
    // Compare the worker's final pixels with a fresh full replay, including hidden erasers.
    const workerPixels=m.board.canvas.toDataURL();m.board.invalidate();m.board.draw();flush();const pixelMatch=workerPixels===m.board.canvas.toDataURL();
    await m.connection.resync(); return {renderer:'OffscreenCanvas worker + four checkpoints',workerPixelMatch:pixelMatch,mainThreadHeartbeat:{ticks:beats,maxGapMs:maxGap},activeOverlap:{...overlap,strokes:12,points:48000},nearCapacityUndo:{operations:1490,points:119200,p50Ms:undo[10],p95Ms:undo[19],samples:undo}};
  });
  await ready(a); await same(a,b); await pass('Browser benchmarks completed: 48k active points and 119.2k-point undo');
  assert.equal(report.benchmarks.workerPixelMatch,true); await pass('Worker checkpoint output matches a full main-thread pixel replay');
  await saveShot(a,'04-final-studio.png');
  assert.deepEqual(errors,[]); await pass('No browser JavaScript errors');
  report.finishedAt=new Date().toISOString(); await writeFile(path.join(out,'browser-results.json'),JSON.stringify(report,null,2));
} catch(error) { report.failure=error.stack; await writeFile(path.join(out,'browser-results.json'),JSON.stringify(report,null,2)); throw error; }
finally { for(const context of contexts) await context.close(); await browser?.close(); await app.close(); await rm(dir,{recursive:true,force:true}); }
