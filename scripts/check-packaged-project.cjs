const {_electron:electron}=require('@playwright/test');const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict'),AdmZip=require('adm-zip');
(async()=>{
 const root=path.resolve('.tmp/gpres-packaged-check');await fs.mkdir(root,{recursive:true});
 const input=path.join(root,'Başlangıç.gpres');const z=new AdmZip();z.addFile('presentation.json',Buffer.from(JSON.stringify({id:'cli-check',name:'CLI',slides:[{id:'one',type:'text',content:'Packaged project open'}]})));await fs.writeFile(input,z.toBuffer());
 const executablePath=path.resolve(process.argv[2]||'release/gpres-project-20261028/win-unpacked/Worship Presentation Assistant.exe'),env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.VITE_DEV_SERVER_URL;
 const devRuntime=process.argv[2]==='--dev-runtime';
 if(devRuntime)env.WPA_TEST_PROFILE=path.join(root,'profile-'+Date.now());
 const app=await electron.launch(devRuntime?{args:[path.resolve('tests/tour/electron-bootstrap.cjs'),input],env}:{executablePath,args:['--wpa-smoke',input],env});let successful=false;const logs=[];app.process().stderr?.on('data',chunk=>logs.push(String(chunk)));app.process().stdout?.on('data',chunk=>logs.push(String(chunk)));
 try{
  const page=await app.firstWindow({timeout:30000}).catch(async error=>{console.log(logs.join(''));console.log(await Promise.race([app.evaluate(({app,BrowserWindow})=>({path:app.getAppPath(),windows:BrowserWindow.getAllWindows().length,argv:process.argv})),new Promise(resolve=>setTimeout(()=>resolve('Main diagnostic timeout'),3000))]));throw error;});const errors=[];page.on('pageerror',error=>errors.push(error.message));await page.locator('[data-app-shell]').waitFor({timeout:30000});
  await page.locator('.design-slide-grid [data-slide-id="one"]').first().waitFor({state:'visible',timeout:30000});
  await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},input);
  await page.locator('nav').getByRole('button',{name:/^(Presentations|Sunumlar)$/}).click();
  await page.getByRole('button',{name:/^(Open from File|Dosyadan Aç)$/}).click();
  await page.locator('.app-choice-dialog').getByRole('heading',{name:/^(Open this presentation\?|Bu sunumu açalım mı\?)$/}).waitFor();
  await page.keyboard.press('Escape');
  const output=path.join(root,'saved.gpres');await fs.unlink(output).catch(()=>{});
  await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},output);
  const saved=await page.evaluate(content=>window.electronAPI.saveFile(content),JSON.stringify({id:'saved',name:'Saved',slides:[{id:'one',type:'text',content:'Native packaged worker'}]}));assert.equal(saved,output);
  assert.equal(JSON.parse(new AdmZip(await fs.readFile(output)).readAsText('manifest.json')).containerVersion,1);assert.deepEqual(errors,[]);
  successful=true;console.log(JSON.stringify({runtime:devRuntime?'production-assets-with-test-bootstrap':'packaged-executable',cliAutoOpen:true,manualOpenConfirmation:true,workerSave:true,manifestVersion:1,rendererErrors:0,isolatedProfile:true}));
 }finally{if(successful)await app.evaluate(({app})=>setTimeout(()=>app.exit(0),0)).catch(()=>{});else app.process().kill();await Promise.race([app.close().catch(()=>{}),new Promise(resolve=>setTimeout(resolve,5000))]);}
})().catch(error=>{console.error(error);process.exitCode=1;});
