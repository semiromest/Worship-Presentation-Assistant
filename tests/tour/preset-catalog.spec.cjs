const {test,expect}=require('@playwright/test');
const {launchWorkspace,closeWorkspace}=require('./workspace-test-utils.cjs');
const tr=require('../../src/renderer/locales/tr/translation.json');
test('library lists metadata, paints covers on demand, opens full decks and preserves edits during delayed open',async({},info)=>{
 test.setTimeout(60000);let app;
 try{
  const f=await launchWorkspace(info,30000);app=f.app;const page=f.page;const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.evaluate(async()=>{
   await window.__tourTest.language('tr');window.catalogStore=(await import('/src/renderer/state/useStore.ts')).useStore;
   const s=window.catalogStore.getState();s.setLiveSaveEnabled(false);s.setUiMotionEnabled(false);
   for(let i=0;i<24;i++)await window.electronAPI.savePresetEntry({name:'Saved '+i,presentation:{id:'saved-'+i,name:'Saved '+i,slides:Array.from({length:100},(_,j)=>({id:'s'+j,type:'text',content:'COVER '+i+' SLIDE '+j,styles:{fontFamily:'Arial',fontSize:40,textColor:'#fff',backgroundColor:'#000'}}))}});
   const list=await window.electronAPI.listPresetEntries();window.initialCatalog=list;s.setPresets(list);s.setActiveTab('presentations');
   (await import('/src/renderer/documentSession.ts')).documentSession.opened(null);
  });
  const list=await page.evaluate(()=>window.initialCatalog);expect(list).toHaveLength(24);expect(list.every(p=>p.presentation.slides.length===0&&p.summary.slideCount===100)).toBe(true);
  await app.evaluate(({ipcMain})=>{
   global.catalogFullReads=0;const original=ipcMain._invokeHandlers.get('get-preset-entry');ipcMain.removeHandler('get-preset-entry');
   ipcMain.handle('get-preset-entry',async(event,name)=>{global.catalogFullReads++;if(global.holdCatalogRead)await new Promise(resolve=>global.releaseCatalogRead=resolve);return original(event,name);});
  });
  const card=page.locator('[data-motion-item="preset"][data-motion-id="Saved 0"]');await card.scrollIntoViewIfNeeded();
  await expect(card).toContainText('100');await expect(card).toContainText('COVER 0 SLIDE 0');expect(await app.evaluate(()=>global.catalogFullReads)).toBe(0);
  await card.getByRole('button',{name:tr.common.openPreset,exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>window.catalogStore.getState().presentation.slides.length)).toBe(100);
  expect(await app.evaluate(()=>global.catalogFullReads)).toBe(1);
  await page.evaluate(()=>window.catalogStore.getState().setActiveTab('presentations'));
  await app.evaluate(()=>global.holdCatalogRead=true);
  const second=page.locator('[data-motion-item="preset"][data-motion-id="Saved 1"]');await second.scrollIntoViewIfNeeded();
  await second.getByRole('button',{name:tr.common.openPreset,exact:true}).click();
  await expect.poll(()=>app.evaluate(()=>typeof global.releaseCatalogRead)).toBe('function');
  await page.evaluate(()=>{const s=window.catalogStore.getState();s.dispatchUndo({type:'SET',payload:{...s.presentation,name:'EDIT WHILE LOADING'}});});
  await app.evaluate(()=>{global.holdCatalogRead=false;global.releaseCatalogRead();});await expect(page.getByText(tr.desktop.documentChanged,{exact:true})).toBeVisible();
  expect(await page.evaluate(()=>window.catalogStore.getState().presentation.name)).toBe('EDIT WHILE LOADING');await page.keyboard.press('Escape');
  await page.evaluate(async()=>{const api=await import('/src/renderer/presetLibrary.ts');await api.renameLibraryPreset('Saved 2','Renamed');await api.deleteLibraryPreset('Saved 3');});
  const names=await page.evaluate(()=>window.catalogStore.getState().presets.map(p=>p.name));expect(names).toContain('Renamed');expect(names).not.toContain('Saved 2');expect(names).not.toContain('Saved 3');
  await page.evaluate(()=>window.catalogStore.getState().setLiveSaveEnabled(true));
  await expect.poll(()=>page.evaluate(()=>window.catalogStore.getState().presets.some(p=>p.name.startsWith('__live_autosave_')))).toBe(true);
  const recovered=await page.evaluate(async()=>{const entry=window.catalogStore.getState().presets.find(p=>p.name.startsWith('__live_autosave_'));return (await window.electronAPI.getPresetEntry(entry.name)).presentation;});
  expect(recovered.name).toBe('EDIT WHILE LOADING');expect(recovered.slides).toHaveLength(100);expect(errors).toEqual([]);
 }finally{await closeWorkspace(app);}
});
