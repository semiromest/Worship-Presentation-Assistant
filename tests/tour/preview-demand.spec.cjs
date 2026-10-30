const {test,expect}=require('@playwright/test');const {launchWorkspace,closeWorkspace}=require('./workspace-test-utils.cjs');const path=require('node:path'),fs=require('node:fs/promises');const {pathToFileURL}=require('node:url');const sharp=require('sharp');const WebSocket=require('ws');
const connect=base=>new Promise((resolve,reject)=>{const socket=new WebSocket(base.replace('http:','ws:'));const timer=setTimeout(()=>{socket.terminate();reject(Error('Missing welcome'));},10000);socket.on('error',reject);socket.on('message',raw=>{const msg=JSON.parse(raw);if(msg.type==='welcome'){clearTimeout(timer);resolve({socket,welcome:msg.data});}});});
test('1000 slides encode only requested phone images, preserve unchanged revisions and reconnect cleanly',async({},info)=>{
 test.setTimeout(90000);const file=info.outputPath('red.png');await fs.mkdir(path.dirname(file),{recursive:true});await sharp({create:{width:4000,height:2000,channels:3,background:'#ff0000'}}).png().toFile(file);
 const {app,page}=await launchWorkspace(info,30000);const sockets=[];
 try{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.evaluate(async source=>{window.demandStore=(await import('/src/renderer/state/useStore.ts')).useStore;const s=window.demandStore.getState();s.setLiveSaveEnabled(false);s.setActiveTab('slides');s.dispatchUndo({type:'RESET',payload:{id:'demand-deck',name:'Demand',slides:Array.from({length:1000},(_,i)=>({id:'phone-'+i,type:i===0?'image':'text',mediaUrl:i===0?source:undefined,content:'Slide '+i,styles:{fontFamily:'Arial',fontSize:48,textColor:'#ffffff',backgroundColor:'#000000'}}))}});s.setLiveIndex(0);},pathToFileURL(file).href);
  await expect.poll(()=>page.evaluate(()=>window.electronAPI.getPreviewAssetDiagnostics().then(x=>x.slots))).toBe(1000);
  expect(await page.evaluate(()=>window.__previewDiagnostics().generated)).toBe(0);
  expect(await page.evaluate(()=>window.electronAPI.getPreviewAssetDiagnostics().then(x=>x.bytes))).toBe(0);
  const advertised=await page.evaluate(()=>window.electronAPI.getRemoteUrl());const base='http://127.0.0.1:'+new URL(advertised).port;
  const one=await connect(base);sockets.push(one.socket);
  const urls=one.welcome.allPreviews;expect(urls).toHaveLength(1000);expect(urls.every(x=>x.startsWith('/preview/'))).toBe(true);
  const response=await fetch(base+urls[0]);expect(response.status).toBe(200);const image=Buffer.from(await response.arrayBuffer());expect((await sharp(image).metadata()).width).toBe(320);
  await expect.poll(()=>page.evaluate(()=>window.__previewDiagnostics().generated)).toBe(1);
  // A cache hit requires no renderer encode.
  await fetch(base+urls[0]);expect(await page.evaluate(()=>window.__previewDiagnostics().generated)).toBe(1);
  await page.evaluate(()=>{const s=window.demandStore.getState();s.dispatchUndo({type:'SET',payload:{...s.presentation,slides:s.presentation.slides.map((x,i)=>i===999?{...x,content:'Changed only last'}:x)}});});
  const two=await connect(base);sockets.push(two.socket);
  expect(two.welcome.allPreviews.filter((x,i)=>x!==urls[i])).toHaveLength(1);
  expect(two.welcome.allPreviews[0]).toBe(urls[0]);
  const changed=await fetch(base+two.welcome.allPreviews[999]);expect(changed.status).toBe(200);await changed.arrayBuffer();
  await expect.poll(()=>page.evaluate(()=>window.__previewDiagnostics().generated)).toBe(2);
  one.socket.close();two.socket.close();
  await expect.poll(()=>page.evaluate(()=>window.__previewDiagnostics().clients)).toBe(0);
  await page.evaluate(()=>{const s=window.demandStore.getState();s.dispatchUndo({type:'SET',payload:{...s.presentation,slides:s.presentation.slides.map((x,i)=>i===10?{...x,content:'Offline change'}:x)}});});
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));expect(await page.evaluate(()=>window.__previewDiagnostics().generated)).toBe(2);
  const three=await connect(base);sockets.push(three.socket);expect(three.welcome.allPreviews[10]).not.toBe(urls[10]);
  expect((await fetch(base+three.welcome.allPreviews[10])).status).toBe(200);
  await expect.poll(()=>page.evaluate(()=>window.__previewDiagnostics().generated)).toBe(3);
  expect((await fetch(base+urls[10])).status).toBe(404);
  const metrics=await page.evaluate(()=>window.electronAPI.getPreviewAssetDiagnostics());expect(metrics.bytes).toBeLessThanOrEqual(16*1024*1024);expect(metrics.entries).toBeLessThanOrEqual(256);expect(errors).toEqual([]);
 }finally{sockets.forEach(socket=>socket.terminate());await closeWorkspace(app);}
});
