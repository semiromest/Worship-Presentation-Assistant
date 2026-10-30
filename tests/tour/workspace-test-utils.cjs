function silentWav(seconds=60){const wav=Buffer.alloc(44+22050*seconds*2);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(22050,24);wav.writeUInt32LE(44100,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);return wav;}
async function launchWorkspace(info, readyTimeout=10000) {
  const path=require('node:path');
  const { _electron: electron }=require('@playwright/test');
  const profile=info.outputPath('profile');
  const env={...process.env,WPA_TEST_PROFILE:profile,VITE_DEV_SERVER_URL:'http://127.0.0.1:5199'};
  delete env.ELECTRON_RUN_AS_NODE;
  const app=await electron.launch({args:[path.resolve('tests/tour/electron-bootstrap.cjs')],cwd:process.cwd(),env});
  const page=await app.firstWindow();page.setDefaultTimeout(10000);
  const startupErrors=[];
  page.on('pageerror',error=>startupErrors.push(error.message));
  await page.waitForFunction(()=>!!window.__tourTest,{},{timeout:readyTimeout});
  // The dev seam is published before PracticeFrame's async initialization.
  // Seed tests only after App mounts, otherwise its startup can overwrite the
  // requested tab/deck and make unrelated workspace assertions race startup.
  try { await page.locator('[data-app-shell]').waitFor({state:'visible',timeout:readyTimeout}); }
  catch(error){
    console.log('Workspace startup failed',JSON.stringify({url:page.url(),errors:startupErrors,body:await page.locator('body').innerText().catch(()=>'<closed>')}));
    await closeWorkspace(app);throw error;
  }
  return {app,page,profile};
}
async function closeWorkspace(app) {
  if(!app)return;
  await app.evaluate(({app})=>setTimeout(()=>app.exit(0),0)).catch(()=>{});
  await app.close().catch(()=>{});
}
module.exports={silentWav,launchWorkspace,closeWorkspace};
