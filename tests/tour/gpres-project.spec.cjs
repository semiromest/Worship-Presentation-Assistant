const {test,expect}=require('@playwright/test');const fs=require('node:fs/promises'),path=require('node:path');const {pathToFileURL}=require('node:url');const sharp=require('sharp'),AdmZip=require('adm-zip');
const {launchWorkspace,closeWorkspace}=require('./workspace-test-utils.cjs');
test('project save, verified backup, missing media refusal and recovery use the real worker',async({},info)=>{
 test.setTimeout(90000);const target=info.outputPath('Proje çığ.gpres'),image=info.outputPath('source.png');await fs.mkdir(path.dirname(target),{recursive:true});await sharp({create:{width:4000,height:2000,channels:3,background:'#d8b500'}}).png().toFile(image);
 const {app,page}=await launchWorkspace(info,30000);
 try{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.evaluate(()=>window.__tourTest.language('tr'));await page.evaluate(()=>window.electronAPI.desktopLanguage('tr'));
  await app.evaluate(({dialog},target)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:target});dialog.showOpenDialog=async()=>({canceled:false,filePaths:[target]});dialog.showMessageBox=async()=>{throw Error('Unexpected native message box');};},target);
  const make=name=>JSON.stringify({id:'project-test',name,customMetadata:{preserved:true},slides:[{id:'slide',type:'image',content:'',customFlag:true,mediaUrl:pathToFileURL(image).href,styles:{objectFit:'contain'}}]});
  expect(await page.evaluate(content=>window.electronAPI.saveFile(content),make('First'))).toBe(target);
  let zip=new AdmZip(await fs.readFile(target));const manifest=JSON.parse(zip.readAsText('manifest.json'));expect(manifest.containerVersion).toBe(1);expect(manifest.files).toHaveLength(2);
  expect(await page.evaluate(content=>window.electronAPI.saveFile(content),make('Second'))).toBe(target);
  expect(JSON.parse(new AdmZip(await fs.readFile(target+'.bak')).readAsText('presentation.json')).name).toBe('First');
  const before=await fs.readFile(target),backup=await fs.readFile(target+'.bak');
  const missing=JSON.stringify({name:'Missing',slides:[{id:'bad',type:'image',content:'',mediaUrl:pathToFileURL(info.outputPath('missing.png')).href}]});
  await page.evaluate(content=>{window.saveResult='pending';void window.electronAPI.saveFile(content).then(result=>{window.saveResult=result;});},missing);
  const prompt=page.locator('.app-choice-dialog');await expect(prompt.getByRole('heading')).toHaveText('Proje kaydedilemedi');await expect(prompt).toContainText('missing.png');await prompt.getByRole('button',{name:'Tamam',exact:true}).click();await expect.poll(()=>page.evaluate(()=>window.saveResult)).toBe(null);
  expect(await fs.readFile(target)).toEqual(before);expect(await fs.readFile(target+'.bak')).toEqual(backup);
  await fs.writeFile(target,'corrupt project');
  await page.evaluate(()=>{window.openResult='pending';void window.electronAPI.openFile().then(result=>{window.openResult=result;});});
  await expect(prompt.getByRole('heading')).toHaveText('Proje yedeğini kurtar');await prompt.getByRole('button',{name:'Yedeği aç',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>typeof window.openResult==='object'&&JSON.parse(window.openResult.content).name)).toBe('First');
  expect(await fs.readFile(target,'utf8')).toBe('corrupt project');
  const next=info.outputPath('İkinci proje.gpres');await fs.writeFile(next,backup);
  await page.evaluate(async()=>{const {documentSession}=await import('/src/renderer/documentSession.ts');documentSession.opened(null);});
  await app.evaluate(({app},file)=>app.emit('second-instance',{},['Worship Presentation Assistant.exe',file]),next);
  // File-open intentionally uses the filename as the workspace title.
  await expect.poll(()=>page.evaluate(async()=>(await import('/src/renderer/state/useStore.ts')).useStore.getState().presentation.name)).toBe('İkinci proje');
  expect(await page.evaluate(async()=>{const s=(await import('/src/renderer/state/useStore.ts')).useStore.getState();return s.presentation.customMetadata.preserved&&s.presentation.slides[0].customFlag;})).toBe(true);
  await page.evaluate(async()=>{const {useStore}=await import('/src/renderer/state/useStore.ts');const s=useStore.getState();s.dispatchUndo({type:'SET',payload:{...s.presentation,name:'Unsaved work'}});});
  await expect.poll(()=>page.evaluate(async()=>(await import('/src/renderer/documentSession.ts')).documentSession.isDirty())).toBe(true);
  await app.evaluate(({app},file)=>app.emit('second-instance',{},['Worship Presentation Assistant.exe',file]),target);
  await expect(page.locator('[data-desktop-open-request]')).toHaveCount(1);
  expect(await page.evaluate(async()=>(await import('/src/renderer/state/useStore.ts')).useStore.getState().presentation.name)).toBe('Unsaved work');
  await page.evaluate(async()=>{const {useDesktopState}=await import('/src/renderer/desktopState.ts');await window.electronAPI.desktopRejectOpen(useDesktopState.getState().requests[0].id);const {documentSession}=await import('/src/renderer/documentSession.ts');documentSession.opened(null);});
  // Hold the real handler before disk I/O, then start an output during the
  // automatic open. The final commit must recheck current output state.
  await app.evaluate(({ipcMain})=>{const original=ipcMain._invokeHandlers.get('open-file');ipcMain.removeHandler('open-file');global.projectReadStarted=false;global.projectReadFinished=false;ipcMain.handle('open-file',async(...args)=>{global.projectReadStarted=true;await new Promise(resolve=>{global.releaseProjectRead=resolve;});const value=await original(...args);global.projectReadFinished=true;return value;});});
  await app.evaluate(({app},file)=>app.emit('second-instance',{},['Worship Presentation Assistant.exe',file]),next);
  await expect.poll(()=>app.evaluate(()=>global.projectReadStarted)).toBe(true);
  await page.evaluate(async()=>{const {useStore}=await import('/src/renderer/state/useStore.ts');useStore.setState({isProjectorWindowOpen:true});});
  await app.evaluate(()=>global.releaseProjectRead());await expect.poll(()=>app.evaluate(()=>global.projectReadFinished)).toBe(true);
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  expect(await page.evaluate(async()=>(await import('/src/renderer/state/useStore.ts')).useStore.getState().presentation.name)).toBe('Unsaved work');
  await expect(page.locator('[data-desktop-open-request]')).toHaveCount(1);
  // The defaults button only opens Windows' own settings; no UserChoice writes.
  await app.evaluate(({shell})=>{global.defaultSettingsUrl='';shell.openExternal=async url=>{global.defaultSettingsUrl=url;};});
  expect(await page.evaluate(()=>window.electronAPI.desktopDefaultApps())).toBe(true);
  expect(await app.evaluate(()=>global.defaultSettingsUrl)).toBe('ms-settings:defaultapps');expect(errors).toEqual([]);
 }finally{await closeWorkspace(app);}
});
