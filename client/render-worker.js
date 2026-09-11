import { renderOperation, WIDTH, HEIGHT } from './canvas.js';
const screen = new OffscreenCanvas(WIDTH,HEIGHT), ctx=screen.getContext('2d');
const cache = new OffscreenCanvas(WIDTH,HEIGHT), cachedCtx=cache.getContext('2d');
let previous=[], cached=0, epoch=-1;
const checkpoints=new Map();
self.onmessage=({data})=>{
  const start=performance.now(), ops=data.operations;
  let changed=0;
  if(epoch===data.epoch) {
    while(changed<Math.min(previous.length,ops.length)) {
      const a=previous[changed],b=ops[changed];
      if(a.id!==b.id||a.points.length!==b.points.length||a.hidden!==b.hidden||a.done!==b.done)break;
      changed++;
    }
  }
  if(epoch!==data.epoch||changed<cached){
    for(const key of checkpoints.keys())if(key>changed)checkpoints.delete(key);
    cached=Math.max(0,...checkpoints.keys());cachedCtx.clearRect(0,0,WIDTH,HEIGHT);
    if(cached)cachedCtx.drawImage(checkpoints.get(cached),0,0);
  }
  while(cached<ops.length&&ops[cached].done){
    renderOperation(cachedCtx,ops[cached]);cached++;
    if(cached%100===0){const c=new OffscreenCanvas(WIDTH,HEIGHT);c.getContext('2d').drawImage(cache,0,0);checkpoints.set(cached,c);while(checkpoints.size>4)checkpoints.delete(checkpoints.keys().next().value);}
  }
  ctx.clearRect(0,0,WIDTH,HEIGHT);ctx.drawImage(cache,0,0);
  for(let i=cached;i<ops.length;i++)renderOperation(ctx,ops[i]);
  // Complete queued raster work here, not through a readback on the UI thread.
  ctx.getImageData(0,0,1,1);
  const bitmap=screen.transferToImageBitmap();previous=ops;epoch=data.epoch;
  self.postMessage({bitmap,epoch,duration:performance.now()-start},[bitmap]);
};
