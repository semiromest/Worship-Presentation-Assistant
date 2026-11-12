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

test('phone remote follows hymn parts in instant live mode', async ({}, info) => {
  const { expect } = require('@playwright/test');
  const WebSocket = require('ws');
  const { launchWorkspace, closeWorkspace } = require('./workspace-test-utils.cjs');
  const { app, page } = await launchWorkspace(info, 30000);
  let socket;
  try {
    await page.evaluate(async () => {
      const { useStore } = await import('/src/renderer/state/useStore.ts');
      window.remotePartsStore = useStore;
      const state = useStore.getState();
      state.setActiveTab('slides');
      state.setLiveSaveEnabled(false);
      state.setIsRightPanelOpen(true);
      state.setNextSlidePreviewEnabled(true);
      state.setAutoGoLive(true);
      state.dispatchUndo({ type: 'RESET', payload: { id: 'remote-parts', name: 'Remote parts', slides: [
        { id: 'intro', type: 'text', content: 'Intro' },
        { id: 'hymn', type: 'text', content: 'Third stanza', partsMode: true, activePart: 2, parts: ['First stanza', 'Second stanza', 'Third stanza'] },
        { id: 'verse', type: 'text', content: 'Verse slide' },
      ] } });
    });
    await page.evaluate(async () => {
      const [display] = await window.electronAPI.getDisplays();
      const { presentation } = window.remotePartsStore.getState();
      await window.electronAPI.openProjector(String(display.id), { fullPresentation: presentation, liveIndex: 0 });
    });
    await expect.poll(() => app.windows().some(window => window.url().includes('mode=projector'))).toBe(true);
    const output = app.windows().find(window => window.url().includes('mode=projector'));
    await expect.poll(() => page.evaluate(() => window.remotePartsStore.getState().projectorReady)).toBe(true);
    await output.evaluate(async () => {
      const { useStore } = await import('/src/renderer/state/useStore.ts');
      window.firstProjectedHymnPart = null;
      useStore.subscribe(state => {
        if (state.liveSlideId === 'hymn' && window.firstProjectedHymnPart === null) {
          window.firstProjectedHymnPart = state.presentation.slides[state.liveIndex].activePart;
        }
      });
    });
    const url = new URL(await page.evaluate(() => window.electronAPI.remoteStart()));
    url.protocol = 'ws:';
    url.hostname = '127.0.0.1';
    url.pathname = '/';
    socket = new WebSocket(url.href);
    let status;
    socket.on('message', raw => {
      const message = JSON.parse(raw.toString());
      if (message.type === 'welcome') status = message.data.status;
      if (message.type === 'status') status = message.data;
    });
    await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
    const command = (action, value) => socket.send(JSON.stringify({ type: 'command', action, value }));
    const expectCue = (currentIndex, activePart) => expect.poll(() => status).toMatchObject({ currentIndex, activePart });

    await expectCue(0, null);
    command('next');
    await expectCue(1, 0);
    await expect(output.locator('body')).toContainText('First stanza');
    expect(await output.evaluate(() => window.firstProjectedHymnPart)).toBe(0);
    await expect(page.getByTestId('next-slide-preview')).toContainText('Second stanza');
    command('next');
    await expectCue(1, 1);
    await expect(page.locator('.design-live-preview')).toContainText('Second stanza');
    await expect(output.locator('body')).toContainText('Second stanza');
    command('next');
    command('next');
    await expectCue(2, null);
    command('prev');
    await expectCue(1, 2);
    command('prev');
    command('prev');
    await expectCue(1, 0);
    command('prev');
    await expectCue(0, null);

    command('goto', 1);
    await expectCue(1, 0);
    await page.evaluate(() => window.remotePartsStore.getState().toggleSlideLock('hymn'));
    command('next');
    command('goto', 2);
    await expect.poll(() => page.evaluate(() => window.remotePartsStore.getState().selectedSlideId)).toBe('verse');
    await expectCue(1, 0);

    await page.evaluate(() => {
      const state = window.remotePartsStore.getState();
      state.toggleSlideLock('hymn');
      state.setAutoGoLive(false);
    });
    command('next');
    await expectCue(2, null);
  } finally {
    socket?.close();
    await closeWorkspace(app);
  }
});
