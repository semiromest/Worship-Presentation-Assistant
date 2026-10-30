const {test,_electron:electron}=require('@playwright/test');
const fs=require('node:fs/promises');const path=require('node:path');const {fileURLToPath,pathToFileURL}=require('node:url');const sharp=require('sharp');
const {closeWorkspace}=require('./workspace-test-utils.cjs');
test('original versus bounded image sources on actual slide workspace',async({},info)=>{
 const status=process.env.SCROLL_FIXTURE ? JSON.parse((await fs.readFile(process.env.SCROLL_FIXTURE,'utf8')).replace(/^\uFEFF/,'')) : await fetch(process.env.SCROLL_STATUS_URL || 'http://127.0.0.1:52771/api/status').then(r=>r.json());
 const source=status.slideMeta.map((s,i)=>({...s,id:'diagnostic-'+i}));
 const root=path.resolve('.tmp/scroll-diagnosis');await fs.mkdir(path.join(root,'images'),{recursive:true});
 await fs.writeFile(path.join(root,'source-fixture.json'),JSON.stringify(status));
 const small=[];
 for(let i=0;i<source.length;i++){
  const s=source[i];if(process.env.SCROLL_AFTER){small.push(s);continue;}if(s.type!=='image'){small.push(s);continue;}
  const dest=path.join(root,'images',i+'.webp');
  await sharp(fileURLToPath(s.mediaUrl)).rotate().resize({width:400,height:400,fit:'inside',withoutEnlargement:true}).webp({quality:70}).toFile(dest);
  small.push({...s,mediaUrl:pathToFileURL(dest).href});
 }
 const report={implementation:process.env.SCROLL_AFTER?'bounded-images-async-encode-row-ranges':'diagnostic',date:new Date().toISOString(),sourceSlideCount:source.length,protocol:process.env.SCROLL_AFTER?'Fresh isolated Electron profiles; real SlideGrid with ORIGINAL model sources and implemented bounded previews; cold and warm 8-second rAF scroll; dev build':'Fresh isolated Electron profiles; real SlideGrid; 400px diagnostic image substitutes; 8-second rAF scroll; dev build; no live user document mutation',runs:[]};
 for(const variant of (process.env.SCROLL_AFTER ? ['original','original','original'] : process.env.SCROLL_PROFILE ? ['original','small'] : ['original','small','small','original'])){
  const env={...process.env,WPA_TEST_PROFILE:info.outputPath(variant+'-'+report.runs.length),VITE_DEV_SERVER_URL:'http://127.0.0.1:5199'};delete env.ELECTRON_RUN_AS_NODE;
  const app=await electron.launch({args:[path.resolve('tests/tour/electron-bootstrap.cjs')],cwd:process.cwd(),env});
  try{
   const page=await app.firstWindow();await page.waitForFunction(()=>!!window.__tourTest,{},{timeout:30000});await page.locator('[data-app-shell]').waitFor({timeout:30000});
   await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.unmaximize();w.setContentSize(1366,768);w.show();});
   await page.evaluate(async(slides)=>{const {useStore}=await import('/src/renderer/state/useStore.ts');const s=useStore.getState();s.setLiveSaveEnabled(false);s.setIsRightPanelOpen(true);s.setSlideColumns(4);s.setActiveTab('slides');s.dispatchUndo({type:'RESET',payload:{id:'scroll-diagnostic',name:'Scroll diagnostic',slides}});},variant==='original'?source:small);
   await page.locator('[data-slide-id]').first().waitFor({timeout:15000});
   const cdp=await page.context().newCDPSession(page);
   if(process.env.SCROLL_PROFILE){await cdp.send('Profiler.enable');await cdp.send('Profiler.start');}
   const measure=()=>page.evaluate(async()=>{
    const el=document.querySelector('.design-slide-grid [data-guide-scroll]');const frames=[],tasks=[];const observer=new PerformanceObserver(list=>tasks.push(...list.getEntries().map(e=>({start:e.startTime,duration:e.duration}))));observer.observe({type:'longtask',buffered:false});
    const maxScroll=el.scrollHeight-el.clientHeight;const started=performance.now();let previous=started;let maximumCards=0;
    await new Promise(resolve=>{function tick(now){frames.push(now-previous);previous=now;const elapsed=now-started;const phase=(elapsed%4000)/4000;el.scrollTop=maxScroll*(phase<.5?phase*2:2-phase*2);maximumCards=Math.max(maximumCards,el.querySelectorAll('[data-slide-id]').length);if(elapsed<8000)requestAnimationFrame(tick);else resolve();}requestAnimationFrame(tick);});
    await new Promise(r=>setTimeout(r,100));observer.disconnect();
    const sorted=frames.slice(1).sort((a,b)=>a-b);const q=p=>sorted[Math.min(sorted.length-1,Math.floor(sorted.length*p))];
    return {visibility:document.visibilityState,viewport:[innerWidth,innerHeight],frames:sorted.length,frameMedianMs:q(.5),frameP95Ms:q(.95),frameP99Ms:q(.99),frameMaxMs:Math.max(...sorted),framesOver50:sorted.filter(x=>x>50).length,longTasks:tasks.length,longTaskTotalMs:tasks.reduce((a,e)=>a+e.duration,0),longTaskMaxMs:Math.max(0,...tasks.map(x=>x.duration)),maximumCards,heap:performance.memory?.usedJSHeapSize,images:[...el.querySelectorAll('img')].map(x=>({width:x.naturalWidth,height:x.naturalHeight,displayWidth:x.clientWidth})),perf:window.__perf?.snapshot?.()};
   });
   const result=await measure();
   if(process.env.SCROLL_AFTER){result.warm=await measure();if(!result.warm.images.some(x=>x.width>0)||result.warm.images.some(x=>x.width>1024))throw Error('Expected loaded bounded images');}
   if(process.env.SCROLL_PROFILE){const {profile}=await cdp.send('Profiler.stop');await fs.writeFile(path.join(root,variant+'.cpuprofile'),JSON.stringify(profile));const nodes=new Map(profile.nodes.map(n=>[n.id,n]));const totals=new Map();for(let i=0;i<(profile.samples||[]).length;i++){const n=nodes.get(profile.samples[i]);const key=(n?.callFrame.functionName||'(anonymous)')+' @ '+(n?.callFrame.url||'native');totals.set(key,(totals.get(key)||0)+(profile.timeDeltas[i]||0)/1000);}result.cpuSelfTime=[...totals].sort((a,b)=>b[1]-a[1]).slice(0,18);}
   result.processes=await app.evaluate(({app})=>app.getAppMetrics().map(m=>({type:m.type,cpu:m.cpu,memory:m.memory})));
   report.runs.push({variant,...result});await fs.writeFile(path.join(root,process.env.SCROLL_AFTER?'after-comparison.json':process.env.SCROLL_PROFILE?'profile-comparison.json':'comparison.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({variant,...result,images:undefined,perf:undefined,processes:undefined,warm:result.warm?{...result.warm,images:undefined,perf:undefined}:undefined}));
  }finally{await closeWorkspace(app);}
 }
});
