const {test,expect}=require('@playwright/test');
const {launchWorkspace,closeWorkspace}=require('./workspace-test-utils.cjs');
const WebSocket=require('ws');
const fs=require('node:fs/promises');
const connect=url=>new Promise((resolve,reject)=>{
 const socket=new WebSocket(url);socket.on('error',reject);
 socket.once('open',()=>resolve(socket));
});
const disconnect=socket=>new Promise(resolve=>{socket.once('close',resolve);socket.close();});
test('phone frames cache static scenes, stop without viewers and survive 100 reconnects',async({},info)=>{
 const soakMs=Math.max(20500,Number(process.env.WPA_FRAME_SOAK_MS)||0);
 test.setTimeout(soakMs+80000);let app,socket;
 try{
  const f=await launchWorkspace(info,30000);app=f.app;const page=f.page;
  const url=await page.evaluate(async()=>{
   window.frameStore=(await import('/src/renderer/state/useStore.ts')).useStore;
   const s=window.frameStore.getState();s.setLiveSaveEnabled(false);
   s.dispatchUndo({type:'RESET',payload:{id:'frames',name:'Frames',slides:[{id:'one',type:'text',content:'STATIC FRAME',styles:{fontFamily:'Arial',fontSize:60,textColor:'#fff',backgroundColor:'#000'}}]}});s.setLiveIndex(0);
   const result=await window.electronAPI.screenShareStart();if(!result.ok)throw Error(result.error);
   s.setScreenShareActive(true);await window.__perf.reset();return result.url;
  });
  const endpoint=new URL(url);endpoint.hostname='127.0.0.1';endpoint.protocol='ws:';
  const count=()=>page.evaluate(()=>window.frameStore.getState().screenShareClientCount);
  const samples=()=>page.evaluate(()=>window.__perf.snapshot().aggregates.filter(s=>s.kind==='screen-frame'));
  await page.waitForTimeout(2200);expect(await samples()).toHaveLength(0);
  socket=await connect(endpoint.href);const frames=[];
  socket.on('message',(raw,binary)=>{if(binary)frames.push({time:Date.now(),data:Buffer.from(raw).toString('base64')});});
  await expect.poll(()=>frames.length).toBeGreaterThan(0);
  // Repeated 600 ms stalls exercise the existing phone client's four-second margin.
  await page.evaluate(()=>{window.__frameStress=setInterval(()=>{const until=performance.now()+600;while(performance.now()<until){}},1700);});
  await page.waitForTimeout(soakMs);
  await page.evaluate(()=>clearInterval(window.__frameStress));
  const staticSamples=await samples(),encodes=staticSamples.find(s=>s.label==='encoded')?.count??0;
  expect(encodes).toBe(1);expect(frames.length).toBeGreaterThanOrEqual(10);
  expect(new Set(frames.map(f=>f.data)).size).toBe(1);
  const gaps=frames.slice(1).map((f,i)=>f.time-frames[i].time);expect(Math.max(...gaps)).toBeLessThan(4000);
  await page.evaluate(()=>{const s=window.frameStore.getState();s.dispatchUndo({type:'SET',payload:{...s.presentation,slides:s.presentation.slides.map(x=>({...x,content:'CHANGED FRAME'}))}});});
  await expect.poll(()=>new Set(frames.map(f=>f.data)).size).toBe(2);
  await disconnect(socket);socket=undefined;await expect.poll(count).toBe(0);
  const totals=async()=>(await samples()).reduce((sum,s)=>sum+s.count,0);
  const stopped=await totals();await page.waitForTimeout(2300);expect(await totals()).toBe(stopped);
  const listeners=()=>app.evaluate(({ipcMain})=>ipcMain.eventNames().reduce((sum,name)=>sum+ipcMain.listenerCount(name),0));
  const before=await listeners();
  for(let i=0;i<100;i++){socket=await connect(endpoint.href);await expect.poll(count).toBe(1);await disconnect(socket);socket=undefined;await expect.poll(count).toBe(0);}
  expect(await listeners()).toBe(before);
  await fs.writeFile(info.outputPath('screen-frame-report.json'),JSON.stringify({encodes,staticFrames:gaps.length+1,totalFrames:frames.length,staticEncodeReduction:1-encodes/(gaps.length+1),maxFrameGapMs:Math.max(...gaps),reconnects:100,mainListeners:before,soakMs},null,2));
 }finally{socket?.terminate();await closeWorkspace(app);}
});

test('looping phone video pauses without viewers and resumes at elapsed loop time',async({},info)=>{
 test.setTimeout(45000);let app,socket;
 try{
  const f=await launchWorkspace(info,30000);app=f.app;const page=f.page;
  const endpoint=await page.evaluate(async()=>{
   const canvas=document.createElement('canvas');canvas.width=320;canvas.height=180;
   const stream=canvas.captureStream(10),recorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp8'}),chunks=[];
   recorder.ondataavailable=e=>chunks.push(e.data);
   const complete=new Promise(resolve=>recorder.onstop=resolve);let n=0;
   const draw=setInterval(()=>{const ctx=canvas.getContext('2d');ctx.fillStyle=`rgb(${n++%255},100,200)`;ctx.fillRect(0,0,320,180);},50);
   recorder.start();await new Promise(resolve=>setTimeout(resolve,1800));recorder.stop();await complete;clearInterval(draw);stream.getTracks().forEach(track=>track.stop());
   const url=URL.createObjectURL(new Blob(chunks,{type:'video/webm'}));
   window.__phoneVideos=[];const create=document.createElement.bind(document);
   document.createElement=(tag,...args)=>{const el=create(tag,...args);if(tag==='video')window.__phoneVideos.push(el);return el;};
   window.videoStore=(await import('/src/renderer/state/useStore.ts')).useStore;const s=window.videoStore.getState();s.setLiveSaveEnabled(false);
   window.__videoStarted=performance.now();s.dispatchUndo({type:'RESET',payload:{id:'video-frames',name:'Video',slides:[{id:'v',type:'video',content:'',mediaUrl:url}]}});s.setLiveIndex(0);
   const started=await window.electronAPI.screenShareStart();if(!started.ok)throw Error(started.error);s.setScreenShareActive(true);return started.url;
  });
  const url=new URL(endpoint);url.hostname='127.0.0.1';url.protocol='ws:';
  socket=await connect(url.href);let received=0;socket.on('message',(raw,binary)=>{if(binary)received++;});
  await expect.poll(()=>received,{timeout:10000}).toBeGreaterThan(1);
  await disconnect(socket);socket=undefined;
  await expect.poll(()=>page.evaluate(()=>window.videoStore.getState().screenShareClientCount)).toBe(0);
  const paused=()=>page.evaluate(()=>window.__phoneVideos.filter(v=>!v.isConnected).every(v=>v.paused));
  await expect.poll(paused).toBe(true);await page.waitForTimeout(3100);expect(await paused()).toBe(true);
  socket=await connect(url.href);let resumed=0;socket.on('message',(raw,binary)=>{if(binary)resumed++;});
  await expect.poll(()=>resumed).toBeGreaterThan(0);
  const result=await page.evaluate(()=>{
   const v=window.__phoneVideos.find(v=>!v.isConnected&&v.duration>0),expected=((performance.now()-window.__videoStarted)/1000)%v.duration;
   const diff=Math.abs(expected-v.currentTime);return {paused:v.paused,error:Math.min(diff,v.duration-diff),time:v.currentTime,duration:v.duration};
  });
  expect(result.paused).toBe(false);expect(result.error).toBeLessThan(.4);
 }finally{socket?.terminate();await closeWorkspace(app);}
});
