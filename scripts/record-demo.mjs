import { mkdir,writeFile,mkdtemp,rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { createApp } from '../server/server.js';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const out=path.resolve('evidence');await mkdir(out,{recursive:true});
const dir=await mkdtemp(path.join(os.tmpdir(),'flamai-demo-'));const app=createApp({dataDir:dir});const {port}=await app.listen(0,'127.0.0.1');
const browser=await chromium.launch({headless:true,...(process.env.BROWSER_CHANNEL?{channel:process.env.BROWSER_CHANNEL}:{})});
const contexts=[],frames=[];
async function page(name){const c=await browser.newContext({viewport:{width:1440,height:1100}});contexts.push(c);await c.addInitScript(n=>localStorage.setItem('flamai-name',n),name);const p=await c.newPage();p.on('dialog',d=>d.accept());await p.goto(`http://127.0.0.1:${port}/?room=design-lab`);await p.waitForFunction(()=>document.getElementById('status').textContent==='Live · connected');return p;}
async function settled(p){await p.waitForFunction(async()=>{const {board,connection}=await import('/main.js');return !board.dirty&&!board.workerPending&&!board.optimistic.size&&connection.pending.size===0;});}
async function tool(p,name,color,width){await p.locator(`[data-tool=${name}]`).click();if(color)await p.locator('#color').evaluate((e,v)=>{e.value=v;e.dispatchEvent(new Event('input'));},color);if(width)await p.locator('#width').evaluate((e,v)=>{e.value=v;e.dispatchEvent(new Event('input'));},String(width));}
async function draw(p,points){const box=await p.locator('#drawing').boundingBox();await p.mouse.move(box.x+points[0][0]*box.width,box.y+points[0][1]*box.height);await p.mouse.down();for(const q of points.slice(1))await p.mouse.move(box.x+q[0]*box.width,box.y+q[1]*box.height,{steps:12});await p.mouse.up();await settled(p);}
async function text(p,value,x,y,width=12){await tool(p,'text','#263c55',width);await p.locator('#text').fill(value);await draw(p,[[x,y]]);}
try{
const a=await page('Alice'),b=await page('Bob');
async function capture(title,description,live=false){if(!live){await settled(a);await settled(b);}const left=(await a.screenshot()).toString('base64'),right=(await b.screenshot()).toString('base64');frames.push({title,description,left,right});console.log(title);}
await capture('01 / One shared studio','Two independent browser sessions. Same room, separate identities.');
await text(a,'A little spark. A shared possibility.',.08,.10,15);await text(a,'IDEA',.12,.32,12);await text(a,'EXPLORE',.42,.32,12);await text(a,'CREATE',.73,.32,12);
await tool(a,'rectangle','#ed7546',5);await draw(a,[[.08,.27],[.28,.50]]);await draw(a,[[.38,.27],[.60,.50]]);await draw(a,[[.69,.27],[.91,.50]]);
await capture('02 / Alice sketches a direction','Native Canvas text and shapes stream to Bob. No drawing library.');
await tool(b,'line','#5c71ac',5);await draw(b,[[.28,.39],[.38,.39]]);await draw(b,[[.60,.39],[.69,.39]]);
await tool(b,'brush','#ed7546',8);const r=await b.locator('#drawing').boundingBox();await b.mouse.move(r.x+r.width*.1,r.y+r.height*.7);await b.mouse.down();await b.mouse.move(r.x+r.width*.6,r.y+r.height*.66,{steps:30});
await capture('03 / Live before release','Bob is still holding the pointer. Alice already sees his stroke.',true);await b.mouse.up();
await a.locator('#undo').click();await capture('04 / Truly shared history','Alice undoes Bob’s mark. Both canvases agree, and the actor is visible.');
await b.locator('#redo').click();await capture('05 / Restore together','Bob restores the shared mark at its original drawing order.');
await a.locator('#save').click();await a.waitForFunction(()=>document.getElementById('save-state').dataset.state==='saved');await capture('06 / Ready to keep','Revision-aware saving, portable vector files and PNG export.');
await a.screenshot({path:path.join(out,'pro-studio-desktop.png'),fullPage:true});
// Record a labeled side-by-side replay of real browser screenshots, 4 seconds per step.
const recorder=await browser.newPage({viewport:{width:1920,height:1080}});
await recorder.setContent('<canvas id="film" width="1920" height="1080"></canvas>');
const video=await recorder.evaluate(async frames=>{
  const canvas=document.getElementById('film'),ctx=canvas.getContext('2d');
  const images=await Promise.all(frames.map(async f=>{const load=data=>new Promise(resolve=>{const i=new Image();i.onload=()=>resolve(i);i.src='data:image/png;base64,'+data;});return{...f,a:await load(f.left),b:await load(f.right)};}));
  const stream=canvas.captureStream(12),chunks=[];const mime=MediaRecorder.isTypeSupported('video/webm;codecs=vp9')?'video/webm;codecs=vp9':'video/webm';const recording=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:2200000});
  const done=new Promise(resolve=>recording.onstop=async()=>resolve(Array.from(new Uint8Array(await new Blob(chunks,{type:mime}).arrayBuffer()))));recording.ondataavailable=e=>chunks.push(e.data);recording.start();
  const start=performance.now();await new Promise(resolve=>{const timer=setInterval(()=>{const t=(performance.now()-start)/1000,index=Math.min(images.length-1,Math.floor(t/4)),f=images[index];ctx.fillStyle='#162238';ctx.fillRect(0,0,1920,1080);ctx.fillStyle='#ff956d';ctx.font='bold 30px sans-serif';ctx.fillText('FlamAI PRO  /  COLLABORATION IN ACTION',36,48);ctx.fillStyle='#ffffff';ctx.font='26px sans-serif';ctx.fillText(f.title,36,94);ctx.font='18px sans-serif';ctx.fillStyle='#b8c7de';ctx.fillText(f.description,36,130);ctx.fillStyle='#f6f8fb';ctx.fillRect(28,165,922,840);ctx.fillRect(970,165,922,840);ctx.fillStyle='#263c55';ctx.font='bold 20px sans-serif';ctx.fillText('ALICE · SESSION A',48,196);ctx.fillText('BOB · SESSION B',990,196);ctx.drawImage(f.a,38,215,900,688);ctx.drawImage(f.b,980,215,900,688);ctx.fillStyle='#ff956d';ctx.fillRect(28,1033,1864*Math.min(1,t/(images.length*4)),5);ctx.fillStyle='#9eafc8';ctx.font='16px sans-serif';ctx.fillText('Recorded acceptance walkthrough · real browser screenshots · 4 seconds per step',36,1069);if(t>=images.length*4){clearInterval(timer);resolve();}},80);});recording.stop();return await done;
},frames);
await writeFile(path.join(out,'two-user-demo.webm'),Buffer.from(video));
await writeFile(path.join(out,'demo.html'),'<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>FlamAI Pro · two-user demonstration</title><style>body{margin:0;padding:4%;background:#162238;color:white;font:16px system-ui}video{width:100%;max-height:82vh}p{color:#c1cde0}</style><h1>FlamAI Pro — together, in real time.</h1><p>A 24-second labeled replay of real screenshots from two independent browser sessions. Shows live streaming before release, cross-user undo/redo and saving.</p><video controls src="two-user-demo.webm"></video></html>');
}finally{for(const c of contexts)await c.close();await browser.close();await app.close();await rm(dir,{recursive:true,force:true});}
