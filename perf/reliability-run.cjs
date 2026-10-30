/* Real packaged executable only. Usage:
 * node perf/reliability-run.cjs --exe C:/.../app.exe --out .tmp/reliability --runs 15
 * node perf/reliability-run.cjs --exe C:/.../app.exe --out .tmp/soak --soak-minutes 120
 * Separate baseline-a/b and candidate outputs are inputs to reliability-compare.cjs.
 */
const { _electron }=require('playwright');
const fs=require('node:fs/promises');const path=require('node:path');const os=require('node:os');const crypto=require('node:crypto');
const AdmZip=require('adm-zip');const {median,quantile,summarizeMemory}=require('./reliability-math.cjs');
const WebSocket=require('ws');
const {execFile}=require('node:child_process');
const arg=name=>{const i=process.argv.indexOf('--'+name);return i<0?undefined:process.argv[i+1];};
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const invoke=(app,channel,args=[])=>app.evaluate(async({ipcMain,BrowserWindow},{channel,args})=>{const wc=BrowserWindow.fromId(globalThis.__reliabilityControlId).webContents;return ipcMain._invokeHandlers.get(channel)({sender:wc,senderFrame:wc.mainFrame},...args);},{channel,args});
const { frameColor: color }=require('./reliability-math.cjs');
async function presentedFrame(app,index){
 return app.evaluate(async({BrowserWindow},{index,expected})=>{
  const windows=BrowserWindow.getAllWindows().filter(w=>!w.isDestroyed()&&!w.webContents.isDestroyed());const control=BrowserWindow.fromId(globalThis.__reliabilityControlId);const output=windows.find(w=>w.webContents.getURL().includes('mode=projector'));
  if(!control||!output)throw new Error('Missing control/projector');
  const start=performance.now();let lastPixel;
  control.webContents.send('remote-action',{action:'goto',value:index});
  while(performance.now()-start<10000){
   const image=await output.webContents.capturePage(),bitmap=image.resize({width:16,height:9}).toBitmap({scaleFactor:1}),at=(2*16+4)*4;
   lastPixel=[bitmap[at+2],bitmap[at+1],bitmap[at]];
   if(lastPixel.every((value,i)=>Math.abs(value-expected[i])<=2))return performance.now()-start;
   await new Promise(resolve=>setTimeout(resolve,8));
  }
  throw new Error('Expected projector capture did not arrive: '+JSON.stringify({index,expected,lastPixel}));
 },{index,expected:color(index)});
}
async function main(){
 const executable=arg('exe');if(!executable||!path.isAbsolute(executable))throw new Error('A real packaged executable is required; no dev fallback');
 await fs.access(executable);const output=path.resolve(arg('out')||'.tmp/reliability');await fs.mkdir(output,{recursive:true});
 const runs=Number(arg('runs')||15),duration=Number(arg('soak-minutes')||0)*60000;
 const report={kind:'packaged',executable,executableSha256:crypto.createHash('sha256').update(await fs.readFile(executable)).digest('hex'),host:{platform:os.platform(),release:os.release(),cpu:os.cpus()[0]?.model,totalMemory:os.totalmem()},started:new Date().toISOString(),cacheCondition:'OS disk cache uncontrolled; each launch uses a fresh isolated smoke profile',runs:[],samples:[],limitations:['No physical multi-display, occlusion, AltGr or macOS verification is implied.','No baseline comparison is inferred from candidate-only runs.','Legacy roundTrip fields are outer automation-loop wall time, including frame readback waits for nonempty decks; they are not pure renderer IPC round trips.']};
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'wpa-reliability-'));
 if(process.platform==='win32')report.host.powerScheme=await new Promise(resolve=>execFile('powercfg.exe',['/GETACTIVESCHEME'],{windowsHide:true},(error,stdout)=>resolve(error?'unavailable':stdout.trim())));
 report.protocol='reliability-v6-nofocus-capture-mixed-color-v1';report.frameObservation='Command to matching capturePage image readback; 8ms polling; includes capture overhead and can force composition; not physical screen scanout or passive frame presentation. Test windows cannot take native keyboard focus.';report.mode=duration?'soak':'benchmark';report.commandsPerScenario=duration?30:300;
 const decks=new Map();
 for(const count of [0,100,500]){
  const zip=new AdmZip(),mediaCount=Math.floor(count/5);
  for(let i=0;i<mediaCount;i++){
   const width=1024,height=342,stride=width*3,bitmap=Buffer.alloc(54+stride*height),rgb=color(i);
   bitmap.write('BM');bitmap.writeUInt32LE(bitmap.length,2);bitmap.writeUInt32LE(54,10);bitmap.writeUInt32LE(40,14);bitmap.writeInt32LE(width,18);bitmap.writeInt32LE(height,22);bitmap.writeUInt16LE(1,26);bitmap.writeUInt16LE(24,28);bitmap.writeUInt32LE(stride*height,34);bitmap.fill(Buffer.from([rgb[2],rgb[1],rgb[0]]),54);
   const name='media/fixture-'+i+'.bmp';zip.addFile(name,bitmap);zip.getEntry(name).header.method=0;
  }
  const deck={id:'reliability-'+count,name:'Reliability '+count,transition:{type:'none',duration:0},slides:Array.from({length:count},(_,i)=>({id:String(i),type:i<mediaCount?'image':'text',...(i<mediaCount?{mediaUrl:'media/fixture-'+i+'.bmp'}:{}),content:'İbadet sunumu '+i,styles:{objectFit:'cover',fontFamily:'Inter, sans-serif',fontSize:48,textColor:'#ffffff',backgroundColor:'#'+color(i).map(v=>v.toString(16).padStart(2,'0')).join('')}}))};
  decks.set(count,deck);zip.addFile('presentation.json',Buffer.from(JSON.stringify(deck)));
  for(const entry of zip.getEntries())entry.header.time=new Date('2020-01-01T00:00:00Z');
  const archive=zip.toBuffer();(report.fixtures??=[]).push({count,bytes:archive.length,sha256:crypto.createHash('sha256').update(archive).digest('hex')});
  await fs.writeFile(path.join(root,count+'.gpres'),archive);
 }
 const started=Date.now();let cycle=0;
 do {
  const boot=Date.now();const env={...process.env,WPA_PERF:'1',APPDATA:path.join(root,'appdata'),LOCALAPPDATA:path.join(root,'localappdata')};delete env.ELECTRON_RUN_AS_NODE;delete env.VITE_DEV_SERVER_URL;
  const app=await _electron.launch({executablePath:executable,args:['--wpa-smoke'],env,timeout:60000});
  const logFile=path.join(output,'process-'+cycle+'.log');
  app.process().stdout?.on('data',chunk=>void fs.appendFile(logFile,chunk));
  app.process().stderr?.on('data',chunk=>void fs.appendFile(logFile,chunk));
  app.process().on('exit',(code,signal)=>void fs.appendFile(logFile,JSON.stringify({event:'process-exit',code,signal,time:new Date().toISOString()})+'\n'));
  let profile,samplingTimer,phone,pendingSample=Promise.resolve();
  try{
   if(!await app.evaluate(({app})=>app.isPackaged))throw new Error('Refusing development build');
   await app.evaluate(({app,BrowserWindow,screen,powerMonitor})=>{
    globalThis.__reliabilityControlId=BrowserWindow.getAllWindows()[0].id;
    const observe=window=>{window.setFocusable(false);let escape=false;
     window.webContents.on('before-input-event',(_event,input)=>{if(input.type==='keyDown'&&input.key==='Escape'){escape=true;console.error('[reliability] escape',window.id);}});
     window.on('close',()=>console.error('[reliability] window-close',JSON.stringify({id:window.id,escape,url:window.webContents.getURL()})));
     window.webContents.on('render-process-gone',(_event,details)=>console.error('[reliability] renderer-gone',JSON.stringify(details)));
    };
    BrowserWindow.getAllWindows().forEach(observe);app.on('browser-window-created',(_event,window)=>observe(window));
    for(const event of ['display-added','display-removed','display-metrics-changed'])screen.on(event,()=>console.error('[reliability]',event,JSON.stringify(screen.getAllDisplays().map(d=>({id:d.id,bounds:d.bounds})))));
    for(const event of ['lock-screen','unlock-screen','suspend','resume'])powerMonitor.on(event,()=>console.error('[reliability]',event));
   });
   report.displayPower=await app.evaluate(({powerSaveBlocker,powerMonitor})=>{const id=powerSaveBlocker.start('prevent-display-sleep');return {blocked:powerSaveBlocker.isStarted(id),idleSeconds:powerMonitor.getSystemIdleTime(),idleState:powerMonitor.getSystemIdleState(60)};});
   profile=await app.evaluate(({app})=>app.getPath('userData'));
   report.displays=await invoke(app,'get-displays');
   const page=await app.firstWindow();const errors=[];page.on('pageerror',error=>errors.push(String(error)));page.on('crash',()=>errors.push('Control renderer crashed'));
   app.on('window',window=>{window.on('pageerror',error=>errors.push(String(error)));window.on('crash',()=>errors.push('Output renderer crashed'));});
   await page.locator('[data-app-shell]').waitFor({timeout:60000});await page.keyboard.press('Escape');
   await page.evaluate(()=>{window.__reliability={longTasks:[]};new PerformanceObserver(list=>window.__reliability.longTasks.push(...list.getEntries().map(e=>({start:e.startTime,duration:e.duration})))).observe({type:'longtask',buffered:true});});
   let run={cycle,bootToShellMs:Date.now()-boot,scenarios:[],errors};
   await page.waitForFunction(()=>['candidate','baseline'].includes(document.documentElement.dataset.previewOptimization));
   report.previewOptimization=await page.evaluate(()=>document.documentElement.dataset.previewOptimization);
   if(!['baseline','candidate'].includes(report.previewOptimization))throw new Error('Measurement build does not expose its optimization variant');
   let phonePreviews=[],expectation;
   const remoteUrl=new URL(await invoke(app,'get-remote-url'));remoteUrl.protocol='ws:';remoteUrl.hostname='127.0.0.1';remoteUrl.pathname='/remote';
   phone=new WebSocket(remoteUrl);
   phone.on('message',raw=>{
    const message=JSON.parse(String(raw));
    if(message.type==='welcome')phonePreviews=message.data.allPreviews||[];
    if(message.type==='allPreviews')phonePreviews=message.data;
    if(message.type==='previewsDelta')for(const patch of message.data)phonePreviews[patch.i]=patch.url;
    if(expectation&&!expectation.completedAt&&phonePreviews.length===expectation.count&&phonePreviews.every(value=>typeof value==='string'&&value.startsWith('data:image/')))expectation.completedAt=performance.now();
   });
   await new Promise((resolve,reject)=>{phone.once('open',resolve);phone.once('error',reject);});
   await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:1,checkboxChecked:false});});
   let previousPids=new Set();
   const sample=async phase=>{
    const processes=await app.evaluate(({app})=>app.getAppMetrics().map(p=>({pid:p.pid,type:p.type,name:p.name,cpu:p.cpu,memory:p.memory})));
    const heaps=await Promise.all(app.windows().map(async window=>{
     const cdp=await app.context().newCDPSession(window);try{return {url:window.url(),heap:(await cdp.send('Runtime.getHeapUsage')).usedSize,dom:await cdp.send('Memory.getDOMCounters')};}finally{await cdp.detach();}
    }));
    heaps.push({url:'main',heap:await app.evaluate(()=>process.memoryUsage().heapUsed)});
    const preview=await page.evaluate(()=>window.__previewDiagnostics?.()??null);
    const mainIpcListeners=await app.evaluate(({ipcMain})=>({channels:ipcMain.eventNames().length,total:ipcMain.eventNames().reduce((n,event)=>n+ipcMain.listenerCount(event),0)}));
    const rendererIpcListeners=await page.evaluate(()=>window.electronAPI.getPreloadPerfSnapshot().listeners??null);
    const currentPids=new Set(processes.map(p=>p.pid));
    const pidChanges={added:[...currentPids].filter(pid=>!previousPids.has(pid)),removed:[...previousPids].filter(pid=>!currentPids.has(pid))};previousPids=currentPids;
    const value={elapsedMs:Date.now()-started,cycle,phase,processes,pidChanges,heapBytes:heaps.reduce((sum,p)=>sum+p.heap,0),privateBytes:processes.reduce((sum,p)=>sum+(p.memory?.privateBytes||0)*1024,0),heaps,preview,mainIpcListeners,rendererIpcListeners,utilityProcesses:processes.filter(p=>p.type==='Utility').length,heavyWorkerProcesses:processes.filter(p=>p.name==='presenter-heavy-worker').length};
    report.samples.push(value);await fs.appendFile(path.join(output,'memory.jsonl'),JSON.stringify(value)+'\n');return value;
   };
   let phase='active',sampling=false;
   samplingTimer=setInterval(()=>{if(sampling)return;sampling=true;pendingSample=sample(phase).catch(error=>{run.samplingError=String(error);errors.push('Memory sampling failed: '+String(error));}).finally(()=>{sampling=false;});},5000);
   do {
   phase='active';
   for(const count of [0,100,500]){
    await invoke(app,'perf:reset');
    const file=path.join(root,count+'.gpres'),openStart=Date.now();
    const previewStart=await page.evaluate(()=>performance.now());expectation={count,startedAt:performance.now(),completedAt:null};
    if(count===0&&phonePreviews.length===0)expectation.completedAt=performance.now();
    await app.evaluate(({app},file)=>app.emit('second-instance',{},[file]),file);
    await page.locator('[data-desktop-open-request] button').first().click();
    await page.locator('[data-desktop-open-request]').waitFor({state:'detached',timeout:60000});
    const openMs=Date.now()-openStart;const timings=[],frames=[];
    if(count){
     const displays=await invoke(app,'get-displays');const original=decks.get(count);await invoke(app,'open-projector',[displays[0].id,{fullPresentation:original,liveIndex:0,liveSlideId:'0'}]);
     const deadline=Date.now()+15000;while(Date.now()<deadline&&!await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().some(w=>w.webContents.getURL().includes('mode=projector')&&!w.webContents.isLoading())))await sleep(100);
     await app.evaluate(async({BrowserWindow})=>{const output=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('mode=projector'));output.showInactive();output.moveTop();await output.webContents.capturePage();});
    }
    for(let i=0;i<(duration?30:300);i++){
     const t=performance.now();
     if(count)frames.push(await presentedFrame(app,(i+1)%count));
     else await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>!w.webContents.getURL().includes('mode=projector')).webContents.send('remote-action',{action:'goto',value:0}));
     timings.push(performance.now()-t);
    }
    const previewDeadline=Date.now()+120000;while(!expectation.completedAt&&Date.now()<previewDeadline)await sleep(50);
    if(!expectation.completedAt)throw new Error('Phone preview grid did not finish');
    const previewCompleteMs=expectation.completedAt-expectation.startedAt;
    const previewTasks=await page.evaluate(({start,end})=>window.__reliability.longTasks.filter(task=>task.start>=start&&task.start<=end),{start:previewStart,end:previewStart+previewCompleteMs});
    run.scenarios.push({count,openMs,previewCompleteMs,previewLongTaskMs:previewTasks.reduce((sum,task)=>sum+task.duration,0),perf:await invoke(app,'perf:snapshot'),roundTripMedianMs:median(timings),roundTripP95Ms:quantile(timings,.95),roundTripMs:timings,composedFrameMedianMs:frames.length?median(frames):null,composedFrameP95Ms:frames.length?quantile(frames,.95):null,composedFrameMs:frames});
    await sample('active');
   }
   await app.evaluate(({BrowserWindow})=>{for(const window of BrowserWindow.getAllWindows())if(window.webContents.getURL().includes('mode=projector'))window.webContents.endFrameSubscription();globalThis.__reliabilityFrames=null;});
   for(const display of await invoke(app,'get-displays'))await invoke(app,'close-projector',[display.id]);
   if(duration){
    // Force a generation change while new preview work is still pending.
    for(const count of [100,500,100]){
     await app.evaluate(({app},file)=>app.emit('second-instance',{},[file]),path.join(root,count+'.gpres'));
     await page.locator('[data-desktop-open-request] button').first().click();
     await page.locator('[data-desktop-open-request]').waitFor({state:'detached',timeout:60000});
     await sleep(350);
    }
   }
   await app.evaluate(({app},file)=>app.emit('second-instance',{},[file]),path.join(root,'0.gpres'));
   await page.locator('[data-desktop-open-request] button').first().click();
   await page.locator('[data-desktop-open-request]').waitFor({state:'detached',timeout:60000});
   await sleep(1000); // Allow the 300ms presentation throttle and cancelled encoding to settle.
   phase='recovery';const recoveryEnd=Date.now()+(duration?5*60000:5000);
   while(Date.now()<recoveryEnd){await sleep(5000);if(Date.now()-started>=duration&&duration)break;}
   run.longTasks=await page.evaluate(()=>window.__reliability.longTasks);report.runs.push(run);
   await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));
   await page.bringToFront();
   await page.screenshot({path:path.join(output,'control-'+cycle+'.png'),timeout:5000}).catch(error=>{run.screenshotWarning=String(error);});
   if(duration){cycle++;report.memory=summarizeMemory(report.samples);await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({cycle,elapsedMinutes:(Date.now()-started)/60000,memory:report.memory}));run={cycle,bootToShellMs:null,scenarios:[],errors};await page.evaluate(()=>window.__reliability.longTasks=[]);}
   }while(duration&&Date.now()-started<duration);
   if(duration&&summarizeMemory(report.samples).decision==='investigate'){
    clearInterval(samplingTimer);await pendingSample;
    report.heapSnapshots=[];
    for(const [index,window]of app.windows().entries()){
     const file=path.join(output,'renderer-'+index+'.heapsnapshot'),cdp=await app.context().newCDPSession(window);
     const handle=await fs.open(file,'wx');let writes=Promise.resolve();
     cdp.on('HeapProfiler.addHeapSnapshotChunk',({chunk})=>{writes=writes.then(()=>handle.writeFile(chunk));});
     try{await cdp.send('HeapProfiler.takeHeapSnapshot');await writes;report.heapSnapshots.push(file);}
     finally{await handle.close();await cdp.detach();}
    }
    const mainSnapshot=path.join(output,'main.heapsnapshot');
    await app.evaluate((_electron,file)=>process.getBuiltinModule('v8').writeHeapSnapshot(file),mainSnapshot);report.heapSnapshots.push(mainSnapshot);
   }
  }catch(error){for(const [i,window] of app.windows().entries())await window.screenshot({path:path.join(output,'failure-'+i+'.png')}).catch(()=>{});await fs.writeFile(path.join(output,'failure.txt'),String(error)+'\n'+await app.windows()[0]?.locator('body').innerText().catch(()=>''));throw error;}
  finally{clearInterval(samplingTimer);phone?.terminate();await pendingSample;await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await app.close().catch(()=>{});if(profile&&path.resolve(profile).startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(profile).startsWith('wpa-smoke-'))await fs.rm(profile,{recursive:true,force:true}).catch(()=>{});}
  cycle++;report.memory=summarizeMemory(report.samples);await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({cycle,elapsedMinutes:(Date.now()-started)/60000,memory:report.memory}));
 }while(duration?Date.now()-started<duration:cycle<runs);
 report.finished=new Date().toISOString();report.durationMs=Date.now()-started;report.memory=summarizeMemory(report.samples);await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));
 await fs.rm(root,{recursive:true,force:true});
}
main().catch(error=>{console.error(error);process.exitCode=1;});
