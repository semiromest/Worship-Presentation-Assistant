let testInfo;
const path=require('node:path'),assert=require('node:assert/strict');
const {test,_electron:electron}=require('@playwright/test');const root=path.resolve('.');let app;
async function main(){
  for(let i=0;i<250;i++){try{if((await fetch('http://127.0.0.1:5199')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
  const env={...process.env,VITE_DEV_SERVER_URL:'http://127.0.0.1:5199'};delete env.ELECTRON_RUN_AS_NODE;
  env.WPA_TEST_PROFILE=testInfo.outputPath('profile');
  app=await electron.launch({args:[path.resolve('tests/tour/electron-bootstrap.cjs')],env,cwd:root});const page=await app.firstWindow();
  await page.waitForFunction(()=>!!window.__tourTest);
  await app.evaluate(({BrowserWindow})=>{const win=BrowserWindow.getAllWindows()[0];win.unmaximize();win.setBounds({width:1366,height:768});});
  await page.evaluate(async()=>{await window.__tourTest.language('tr');const {useStore}=await import('/src/renderer/state/useStore.ts');window.__partsStore=useStore;const s=useStore.getState();s.setActiveTab('slides');s.setLiveSaveEnabled(false);s.setServiceSectionsEnabled(false);s.setIsRightPanelOpen(true);s.dispatchUndo({type:'RESET',payload:{id:'parts-keys',name:'Parça tuşları kontrolü',slides:[{id:'intro',type:'text',content:'Giriş'},{id:'hymn',type:'text',content:'Birinci kıta',partsMode:true,parts:['Birinci kıta','İkinci kıta','Üçüncü kıta'],activePart:0,group:{id:'g',title:'Örnek ilahi',part:1,parts:3},styles:{fontSize:82,backgroundColor:'#000',textColor:'#fff'}},{id:'end',type:'text',content:'Kapanış'}]}});s.selectSlides({activeId:'hymn',ids:new Set(['hymn']),anchorIndex:1});});
  const part=()=>page.evaluate(()=>window.__partsStore.getState().presentation.slides.find(s=>s.id==='hymn').activePart);
  const selected=()=>page.evaluate(()=>window.__partsStore.getState().selectedSlideId);
  await page.locator('[data-hymn-part="0"]').click();
  for(const [key,expected] of [['ArrowDown',1],['ArrowDown',2],['ArrowDown',2],['ArrowUp',1],['ArrowUp',0],['ArrowUp',0]]){
    await page.keyboard.press(key);assert.equal(await part(),expected);assert.equal(await selected(),'hymn');
  }
  assert.equal(await page.evaluate(()=>document.activeElement.getAttribute('data-hymn-part')),'0');
  await page.locator('[data-hymn-parts-list]').focus();await page.keyboard.press('ArrowDown');assert.equal(await part(),1);assert.equal(await selected(),'hymn');
  await page.keyboard.press('Alt+ArrowUp');assert.equal(await page.evaluate(()=>window.__partsStore.getState().presentation.slides[0].id),'hymn');assert.equal(await part(),1);
  await page.keyboard.press('Control+z');assert.equal(await page.evaluate(()=>window.__partsStore.getState().presentation.slides[0].id),'intro');
  await page.evaluate(()=>{const s=window.__partsStore.getState();s.setIsProjectorWindowOpen(true);s.toggleSlideLock('intro');});
  await page.locator('[data-slide-id="hymn"]').click();
  await page.locator('[data-hymn-part="1"]').click();await page.keyboard.press('ArrowDown');assert.equal(await part(),2);assert.equal(await page.evaluate(()=>window.__partsStore.getState().liveSlideId),'intro');assert.equal(await selected(),'hymn');
  await page.locator('[data-slide-id="hymn"]').focus();await page.keyboard.press('ArrowUp');assert.equal(await part(),1);assert.equal(await page.evaluate(()=>window.__partsStore.getState().liveSlideId),'intro');
  await page.keyboard.press('ArrowDown');assert.equal(await part(),2);assert.equal(await page.evaluate(()=>window.__partsStore.getState().liveSlideId),'intro');
  await page.locator('[data-hymn-parts-list]').screenshot({path:testInfo.outputPath('parts-keyboard-focus.png')});
  await page.evaluate(()=>{const s=window.__partsStore.getState();s.toggleSlideLock('intro');s.setIsProjectorWindowOpen(false);});
  await page.locator('[data-slide-id="hymn"]').focus();
  await page.keyboard.press('ArrowUp');assert.equal(await part(),1);assert.equal(await selected(),'hymn');
  await page.keyboard.press('ArrowUp');assert.equal(await part(),0);assert.equal(await selected(),'hymn');
  await page.keyboard.press('ArrowDown');assert.equal(await part(),1);assert.equal(await selected(),'hymn');
  assert.equal(await page.evaluate(()=>window.__partsStore.getState().presentation.slides.find(s=>s.id==='hymn').content),'İkinci kıta');
  await page.keyboard.press('Control+z');assert.equal(await part(),0);assert.equal(await selected(),'hymn');
  await page.keyboard.press('ArrowRight');assert.equal(await selected(),'end');
  await page.keyboard.press('ArrowUp');await page.keyboard.press('ArrowDown');assert.equal(await selected(),'end');assert.equal(await part(),0);
  await page.keyboard.press('ArrowLeft');assert.equal(await selected(),'hymn');
  await page.waitForFunction(()=>document.activeElement?.getAttribute('data-slide-id')==='hymn');
  const textarea=page.locator('#slide-content-textarea');
  await textarea.click();assert.equal(await page.evaluate(()=>document.activeElement.id),'slide-content-textarea');
  await page.keyboard.press('ArrowDown');assert.equal(await part(),0);assert.equal(await selected(),'hymn');
  await page.evaluate(()=>{const s=window.__partsStore.getState();s.dispatchUndo({type:'SET',payload:{...s.presentation,slides:s.presentation.slides.map(x=>x.id==='hymn'?{...x,partsMode:false}:x)}});});
  await page.locator('[data-slide-id="hymn"]').focus();await page.keyboard.press('ArrowDown');assert.equal(await part(),0);assert.equal(await selected(),'hymn');
  console.log('PASS: part arrows, both boundaries, list and button focus, focus follows part, Alt+Up reorder, Ctrl+Z, locked output unchanged, card Up/Down change parts immediately, Left/Right navigate slides, non-hymn and parts-off no-op, native textarea keys, part undo');
}
test("vertical arrows change hymn parts and horizontal arrows change slides", async ({}, info) => { testInfo=info;try { await main(); } finally { if(app){await app.evaluate(({app})=>setTimeout(()=>app.exit(0),0)).catch(()=>{});await app.close().catch(()=>{});} } });
