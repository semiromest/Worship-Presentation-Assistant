/* Packaged startup probe using the application's isolated smoke profile. */
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {_electron}=require('@playwright/test');
const value=(name,fallback)=>{const i=process.argv.indexOf('--'+name);return i<0?fallback:process.argv[i+1];};
const quantile=(values,q)=>{const sorted=[...values].sort((a,b)=>a-b);return sorted[Math.min(sorted.length-1,Math.ceil(q*sorted.length)-1)];};
async function main(){
 const executable=value('exe'),output=path.resolve(value('out','.tmp/optimization-results'));
 if(!executable||!path.isAbsolute(executable))throw Error('An absolute packaged executable path is required');
 const runs=Number(value('runs','30')),warmups=Number(value('warmups','3'));
 const report={protocol:'optimization-v7-startup-smoke-v1',executable,sha256:crypto.createHash('sha256').update(await fs.readFile(executable)).digest('hex'),
  host:{platform:os.platform(),cpu:os.cpus()[0]?.model,memory:os.totalmem()},warmups,runs,samples:[],
  definitions:{usable:'Shell mounted, desktop initialized, native slide creation and edited content painted in the slide card.',
   profile:'Fresh app-generated smoke profile each launch; first-run help dismissed with Escape.',cache:'First three launches excluded; OS disk cache uncontrolled.'},
  limitations:['No reused-profile or physical cold-disk measurement.','No physical projector scanout.','macOS Gatekeeper must be evaluated separately.']};
 await fs.mkdir(output,{recursive:true});
 for(let i=0;i<runs+warmups;i++){
  const env={...process.env,WPA_PERF:'1'};delete env.ELECTRON_RUN_AS_NODE;delete env.VITE_DEV_SERVER_URL;delete env.WPA_SMOKE_SESSION;
  let app;const started=performance.now();
  try{
   app=await _electron.launch({executablePath:executable,args:['--wpa-smoke'],env,timeout:60000});
   const actual=await app.evaluate(({app})=>app.getPath('userData'));
   if(path.dirname(actual).toLowerCase()!==path.resolve(os.tmpdir()).toLowerCase()||!/^wpa-smoke-[a-f0-9-]+$/.test(path.basename(actual)))throw Error('Profile isolation failed');
   const page=await app.firstWindow();page.setDefaultTimeout(30000);
   const errors=[];page.on('pageerror',error=>errors.push(String(error)));
   await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(win=>win.setFocusable(false)));
   await page.locator('[data-app-shell]').waitFor();const shellMs=performance.now()-started;
   await page.keyboard.press('Escape');
   await page.waitForFunction(()=>!!document.documentElement.dataset.previewOptimization);
   await page.locator('[data-guide-anchor="nav-slides"]').click();
   await page.getByRole('button',{name:/^(Add New Slide|Yeni Slayt Ekle)$/}).click();
   await page.locator('#slide-content-textarea').fill('PERFORMANCE READY PROBE');
   await page.waitForFunction(()=>[...document.querySelectorAll('[data-slide-id]')].some(el=>el.textContent.includes('PERFORMANCE READY PROBE')));
   const usableMs=performance.now()-started;
   const detail=await page.evaluate(()=>({marks:performance.getEntriesByType('mark').filter(m=>m.name.startsWith('presenter:')).map(m=>({name:m.name,ms:m.startTime})),longTasks:window.__perf?.snapshot()?.aggregates?.filter(s=>s.kind==='longtask')??[]}));
   if(errors.length)throw Error(errors.join('\n'));
   if(i>=warmups){report.samples.push({shellMs,usableMs,detail});await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({run:i-warmups+1,shellMs:Math.round(shellMs),usableMs:Math.round(usableMs)}));}
   if(i===warmups)report.gpu=await app.evaluate(({app})=>app.getGPUFeatureStatus());
  }finally{if(app){await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await app.close().catch(()=>{});}}
 }
 report.summary=Object.fromEntries(['shellMs','usableMs'].map(key=>[key,{median:quantile(report.samples.map(s=>s[key]),.5),p95:quantile(report.samples.map(s=>s[key]),.95)}]));
 report.appAsarSha256=crypto.createHash('sha256').update(await fs.readFile(path.join(path.dirname(executable),'resources','app.asar'))).digest('hex');
 await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report.summary));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
