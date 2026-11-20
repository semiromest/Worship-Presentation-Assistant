const {test,expect}=require('@playwright/test');
const {launchWorkspace,closeWorkspace}=require('./workspace-test-utils.cjs');

test('stage follows all slide types, media fallbacks and blackout', async ({}, info) => {
  const { app, page } = await launchWorkspace(info, 30000);
  try {
    const { resolve } = require('node:path');
    const { pathToFileURL } = require('node:url');
    const photo = pathToFileURL(resolve('build/ico.png')).href;
    const missing = 'data:image/png;base64,invalid';
    const slides = [
      { id: 'text', type: 'text', scripture: true,
        content: ('Uzun bir metin sahne ekranında taşmadan görünmeli. Sözlerin satırları ekran genişliğine göre bölünür. ').repeat(5).trim() },
      { id: 'image', type: 'image', content: 'Görsel açıklaması', mediaUrl: photo },
      { id: 'video', type: 'video', content: 'Video açıklaması', thumbnailUrl: photo },
      { id: 'countdown', type: 'countdown', content: JSON.stringify({ totalSeconds: 90, paused: true }) },
      { id: 'screen', type: 'screen', content: 'Paylaşılan ekran', mediaUrl: 'screen:0:0' },
      { id: 'loop', type: 'loop', content: '', loopItems: [{ id: 'photo', type: 'image', mediaUrl: photo, duration: 5 }] },
      { id: 'captions', type: 'captions', content: '', captions: { showOriginal: true } },
      { id: 'canvas', type: 'text', content: '', items: [
        { id: 'caption', type: 'text', content: 'Tuval üzerindeki metin', x: 0, y: 0, width: 100, height: 20, zIndex: 1, styles: {} },
      ] },
      { id: 'missing', type: 'image', content: '', mediaUrl: missing },
      { id: 'no-poster', type: 'video', content: '' },
    ].map(slide => ({ ...slide, operatorNotes: `Not ${slide.id}` }));

    await page.evaluate(async (slides) => {
      await window.__tourTest.language('tr');
      const { useStore } = await import('/src/renderer/state/useStore.ts');
      window.__stageStore = useStore;
      const state = useStore.getState();
      state.setActiveTab('slides');
      state.setLiveSaveEnabled(false);
      state.dispatchUndo({ type: 'RESET', payload: { id: 'stage-types', name: 'Sahne testi', slides } });
      state.setLiveIndex(0);
      state.setIsBlackout(false);
      const [display] = await window.electronAPI.getDisplays();
      state.setDisplays([{ ...display, isPrimary: false }]);
    }, slides);
    await page.getByRole('button', { name: 'Ekran Çıkışları', exact: true }).click();
    const picker = page.getByRole('dialog', { name: 'Ekran Çıkışları' });
    const opening = app.waitForEvent('window');
    await picker.getByRole('button', { name: 'Aç', exact: true }).click();
    const output = await opening;
    const errors = [];
    output.on('pageerror', error => errors.push(error.message));
    await picker.getByRole('combobox', { name: 'Ekran modu' }).selectOption('stage');
    await page.keyboard.press('Escape');
    await output.setViewportSize({ width: 800, height: 600 });

    const current = output.locator('.stage-current');
    const next = output.getByRole('region', { name: 'Sırada' });
    await page.evaluate(() => {
      const state = window.__stageStore.getState();
      state.selectSlides({ activeId: 'image', ids: new Set(['image']), anchorIndex: 1 });
    });
    const notes = page.getByRole('region', { name: 'Sahne Ekranı Notları' });
    await expect(notes.getByRole('textbox')).toHaveValue('Not image');
    await expect(notes.getByText('Şarkı tonu (akorlar)')).toHaveCount(0);
    const cues = ['Uzun bir metin', 'Görsel açıklaması', 'Video açıklaması', 'Geri sayım', 'Canlı ekran',
      'Döngü slaytı', 'Canlı Altyazı', 'Tuval üzerindeki metin', 'Görsel slayt', 'Video slayt'];
    async function assertCue(panel, index) {
      await expect(panel).toContainText(cues[index]);
      await expect(panel.locator('.stage-notes')).toContainText(slides[index].operatorNotes);
      const image = panel.locator('img');
      if (index === 1 || index === 2) {
        await expect(image).toBeVisible();
        await expect.poll(() => image.evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
      } else {
        await expect(image).toHaveCount(0);
      }
    }

    for (let index = 0; index < slides.length; index++) {
      await page.evaluate(index => window.__stageStore.getState().setLiveIndex(index), index);
      await expect(current.locator('.stage-progress')).toHaveText(`${index + 1} / ${slides.length}`);
      await assertCue(current, index);
      if (index + 1 < slides.length) await assertCue(next, index + 1);
      else await expect(next).toContainText('Başka slayt yok');
      await expect(output.locator('video')).toHaveCount(0);
      await expect.poll(() => output.locator('.stage-panel, .stage-text-viewport').evaluateAll(panels =>
        panels.flatMap(panel => {
          const x = panel.scrollWidth - panel.clientWidth;
          const y = panel.scrollHeight - panel.clientHeight;
          return x > 0 || y > 0 ? [{ x, y, panel: panel.className }] : [];
        })), slides[index].id).toEqual([]);
      if (index === 0) {
        await expect.poll(() => current.locator('.stage-text').evaluate(text => new Promise(resolve => {
          let styleChanges = 0;
          const observer = new MutationObserver(records => { styleChanges += records.length; });
          observer.observe(text, { attributes: true, attributeFilter: ['style'] });
          setTimeout(() => { observer.disconnect(); resolve(styleChanges); }, 400);
        }))).toBe(0);
      }
    }

    await page.evaluate(() => window.__stageStore.getState().setIsBlackout(true));
    await expect(current).toHaveCount(0);
    await page.evaluate(() => window.__stageStore.getState().setIsBlackout(false));
    await assertCue(current, slides.length - 1);
    expect(errors).toEqual([]);
  } finally {
    await closeWorkspace(app);
  }
});

test('stage keeps imported chords aligned, readable and in sync with the control window', async ({}, info) => {
  const { app, page } = await launchWorkspace(info, 30000);
  try {
    await page.evaluate(async () => {
      await window.__tourTest.language('tr');
      const { prepareHymnText } = await import('/src/renderer/hymnLyrics.ts');
      const { getQuickSearchActions } = await import('/src/renderer/quickSearch/quickSearchBridge.ts');
      const { useStore } = await import('/src/renderer/state/useStore.ts');
      const state = useStore.getState();
      state.setLiveSaveEnabled(false);
      const verse = '[G]Amazing [C]grace, [D/F#]how [G]sweet [Em]the [C]sound.';
      const hymn = prepareHymnText(Array(5).fill(verse).join('\n') + '\n\n[D]The next [G]verse.');
      getQuickSearchActions().addHymn({ id: 'stage-hymn', title: 'Stage hymn', key: 'G', ...hymn }, true);
      const { presentation } = useStore.getState();
      state.setLiveIndex(presentation.slides.length - 1);
      state.setIsBlackout(false);
      // Expose the real test display in the picker on single-monitor runners.
      const [display] = await window.electronAPI.getDisplays();
      state.setDisplays([{ ...display, isPrimary: false }]);
    });
    await page.getByRole('button', { name: 'Ekran Çıkışları', exact: true }).click();
    const outputs = page.getByRole('dialog', { name: 'Ekran Çıkışları' });
    const stageWindow = app.waitForEvent('window');
    await outputs.getByRole('button', { name: 'Aç', exact: true }).click();
    const output = await stageWindow;
    await outputs.getByRole('combobox', { name: 'Ekran modu' }).selectOption('stage');
    await page.keyboard.press('Escape');
    const current = output.locator('.stage-current');
    const next = output.getByRole('region', { name: 'Sırada' });
    await expect(current.locator('.stage-chord-symbol').first()).toHaveText('G');
    await expect(next.locator('.stage-chord-symbol').first()).toHaveText('D');
    await expect(current.locator('.stage-progress')).toContainText('1/2');

    let previousSize = 0;
    for (const [width, height] of [[800, 600], [1366, 768], [1920, 1080]]) {
      await output.setViewportSize({ width, height });
      const lyricSize = () => current.locator('.stage-chord-anchor').first().evaluate(
        (anchor) => Number.parseFloat(getComputedStyle(anchor).fontSize),
      );
      await expect.poll(() => output.locator('.stage-text-viewport').evaluateAll((views) =>
        views.map((view) => {
          const symbol = view.querySelector('.stage-chord-symbol');
          const lyric = symbol.parentElement;
          return {
            vertical: Math.max(0, view.scrollHeight - view.clientHeight),
            horizontal: Math.max(0, view.scrollWidth - view.clientWidth),
            chordSizeRatio: Math.round(100 * parseFloat(getComputedStyle(symbol).fontSize) /
              parseFloat(getComputedStyle(lyric).fontSize)),
          };
        })), `content at ${width} × ${height}`).toEqual([
        { vertical: 0, horizontal: 0, chordSizeRatio: 70 },
        { vertical: 0, horizontal: 0, chordSizeRatio: 70 },
      ]);
      const fittedSize = await lyricSize();
      expect(fittedSize).toBeGreaterThan(previousSize);
      previousSize = fittedSize;
      await output.screenshot({ path: info.outputPath(`stage-${width}.png`) });
    }

    const notesName = 'Sahne Ekranı Notları';
    const notes = page.getByRole('region', { name: notesName });
    const transpose = notes.getByRole('button', { name: 'Yarım ton yükselt' });
    await expect(transpose).toBeVisible();
    await notes.getByRole('textbox', { name: notesName }).fill('Nakarata hazır olun');
    await expect(current.getByRole('complementary', { name: notesName })).toContainText('Nakarata hazır olun');
    const switchTab = (tab) => page.evaluate(async (tab) => {
      const { useStore } = await import('/src/renderer/state/useStore.ts');
      useStore.getState().setActiveTab(tab);
    }, tab);
    await switchTab('settings');
    const category = page.locator('#settings-category');
    if (await category.isVisible()) await category.selectOption('presentation');
    else await page.locator('.settings-category-sidebar').getByRole('button', { name: 'Sunum', exact: true }).click();
    const nextSlideSwitch = page.getByRole('switch', { name: 'Sahne ekranında sıradaki slaytı göster' });
    await expect(nextSlideSwitch).toBeChecked();
    const currentHeight = await current.evaluate(panel => panel.clientHeight);
    await nextSlideSwitch.click();
    await expect(next).toHaveCount(0);
    await expect.poll(() => current.evaluate(panel => panel.clientHeight)).toBeGreaterThan(currentHeight);
    await output.reload();
    await expect(current.locator('.stage-chord-symbol').first()).toHaveText('G');
    await expect(next).toHaveCount(0);
    await nextSlideSwitch.click();
    await expect(next.locator('.stage-chord-symbol').first()).toHaveText('D');
    const stageNotesSwitch = page.getByRole('switch', { name: notesName });
    await expect(stageNotesSwitch).toBeChecked();
    await stageNotesSwitch.click();
    await expect(stageNotesSwitch).not.toBeChecked();
    await expect(output.locator('.stage-chord-symbol')).toHaveCount(0);
    await expect(output.getByRole('complementary', { name: notesName })).toHaveCount(0);
    await expect(current).toContainText('Amazing grace');
    await switchTab('slides');
    await expect(notes).toHaveCount(0);
    await switchTab('settings');
    await stageNotesSwitch.click();
    await expect(stageNotesSwitch).toBeChecked();
    await expect(current.locator('.stage-chord-symbol').first()).toHaveText('G');
    await expect(current.getByRole('complementary', { name: notesName })).toContainText('Nakarata hazır olun');
    await switchTab('slides');
    await expect(notes.getByRole('textbox', { name: notesName })).toHaveValue('Nakarata hazır olun');
    await transpose.click();
    await transpose.click();
    await expect(current.locator('.stage-chord-symbol').first()).toHaveText('A');
    await expect(next.locator('.stage-chord-symbol').first()).toHaveText('E');
  } finally {
    await closeWorkspace(app);
  }
});

const recorder=`(()=>{window.__startupFrames=[];let n=0;function frame(){const layers=[...document.querySelectorAll('[data-slide-transition]')].map(el=>({text:el.innerText,opacity:getComputedStyle(el).opacity,animation:el.style.animation}));window.__startupFrames.push({t:performance.now(),text:document.body?.innerText||'',loading:!!document.querySelector('[data-projector-loading]'),layers});if(n++<150)requestAnimationFrame(frame);}requestAnimationFrame(frame);})()`;
async function setup(info){
  const fixture=await launchWorkspace(info,30000);const {app,page}=fixture;
  await app.evaluate(({app},source)=>app.on('browser-window-created',(_,win)=>win.webContents.on('dom-ready',()=>win.webContents.executeJavaScript(source).catch(()=>{}))),recorder);
  await page.evaluate(async()=>{
    window.__startupStore=(await import('/src/renderer/state/useStore.ts')).useStore;
    const s=window.__startupStore.getState();s.setActiveTab('slides');s.setLiveSaveEnabled(false);
    s.dispatchUndo({type:'RESET',payload:{id:'startup',name:'Startup regression',transition:{type:'fade',duration:400},slides:[
      {id:'first',type:'text',content:'FIRST WRONG SLIDE',styles:{fontSize:100,textColor:'#fff',backgroundColor:'#f00'}},
      {id:'selected',type:'text',content:'SELECTED CORRECT SLIDE',styles:{fontSize:100,textColor:'#fff',backgroundColor:'#080'}},
    ]}});s.setLiveIndex(0);s.selectSlides({activeId:'selected',ids:new Set(['selected']),anchorIndex:1});
  });return fixture;
}
async function assertCorrectFirstFrame(output){
  await output.waitForFunction(()=>window.__startupFrames?.some(f=>f.layers.some(l=>l.text.includes('SELECTED CORRECT SLIDE'))));
  await output.waitForTimeout(100);
  const frames=await output.evaluate(()=>window.__startupFrames);
  expect(frames.every(f=>!f.text.includes('FIRST WRONG SLIDE')&&!f.text.includes('New Slide Content')&&!f.text.includes('Yeni Slayt İçeriği'))).toBe(true);
  const first=frames.find(f=>f.layers.length);expect(first.layers).toHaveLength(1);expect(first.layers[0].text).toContain('SELECTED CORRECT SLIDE');
  expect(first.layers[0].opacity).toBe('1');expect(first.layers[0].animation).toBe('');
}
test('opening, reopening and reloading projector show only the selected slide from the first slide frame',async({},info)=>{
  test.setTimeout(90000);let app;
  try{const f=await setup(info);app=f.app;const page=f.page;
    for(let i=0;i<3;i++){
      const opening=app.waitForEvent('window');await page.locator('.design-broadcast-button').click();const output=await opening;
      await assertCorrectFirstFrame(output);
      if(i===0){await output.reload();await assertCorrectFirstFrame(output);}
      await output.screenshot({path:info.outputPath(`startup-${i}.png`)});
      await page.locator('.design-broadcast-button').click();await expect.poll(()=>app.windows().filter(p=>p.url().includes('mode=projector')).length).toBe(0);
    }
  }finally{await closeWorkspace(app);}
});
test('projector stays black until a full snapshot arrives; early navigation does not reveal defaults',async({},info)=>{
  let app;
  try{const f=await setup(info);app=f.app;const page=f.page;
    await app.evaluate(({app})=>{
      global.__heldFrames=[];global.__holdSnapshot=true;
      app.on('browser-window-created',(_,win)=>{global.__startupOutput=win;const send=win.webContents.send.bind(win.webContents);global.__releaseFrame=send;
        win.webContents.send=(channel,...args)=>{if(channel==='projector-update'&&args[0]?.fullPresentation&&global.__holdSnapshot){global.__heldFrames.push(args[0]);return;}return send(channel,...args);};
      });
    });
    const opening=app.waitForEvent('window');await page.locator('.design-broadcast-button').click();const output=await opening;
    await output.locator('[data-projector-loading]').waitFor();
    await expect.poll(()=>app.evaluate(()=>global.__heldFrames.length)).toBeGreaterThan(0);
    await app.evaluate(()=>global.__releaseFrame('projector-update',{liveIndex:1,liveSlideId:'selected'}));
    await output.waitForTimeout(200);await expect(output.locator('[data-slide-transition]')).toHaveCount(0);
    expect(await output.locator('[data-projector-loading]').evaluate(el=>getComputedStyle(el).backgroundColor)).toBe('rgb(0, 0, 0)');
    await app.evaluate(()=>{global.__holdSnapshot=false;global.__releaseFrame('projector-update',global.__heldFrames.at(-1));});
    await assertCorrectFirstFrame(output);
    // Blackout at startup must also prevent any underlying slide from mounting.
    await page.locator('.design-broadcast-button').click();
    await page.evaluate(()=>window.__startupStore.getState().setIsBlackout(true));
    const blackoutOpening=app.waitForEvent('window');await page.locator('.design-broadcast-button').click();const blackout=await blackoutOpening;
    await blackout.waitForFunction(async()=>{const {useStore}=await import('/src/renderer/state/useStore.ts');return useStore.getState().projectorReady;});
    await expect(blackout.locator('[data-slide-transition]')).toHaveCount(0);expect(await blackout.locator('body').innerText()).toBe('');
  }finally{await closeWorkspace(app);}
});

test('projector reload recovers cached patches without a control resync and rejects old receiver tokens',async({},info)=>{
 let app;
 try{
  const f=await setup(info);app=f.app;const page=f.page;
  await app.evaluate(({BrowserWindow,app})=>{
   const control=BrowserWindow.getAllWindows()[0],send=control.webContents.send.bind(control.webContents);
   control.webContents.send=(channel,...args)=>{if(channel==='projector-ready-ack')return;return send(channel,...args);};
   app.on('browser-window-created',(_,win)=>{const original=win.webContents.send.bind(win.webContents);global.__cacheOutput=win;
    win.webContents.send=(channel,...args)=>{if(channel==='projector-update')global.__lastReceiver=args[0].receiverToken;return original(channel,...args);};});
  });
  const opening=app.waitForEvent('window');await page.locator('.design-broadcast-button').click();const output=await opening;
  await expect(output.locator('body')).toContainText('SELECTED CORRECT SLIDE');
  const oldToken=await app.evaluate(()=>global.__lastReceiver);
  await page.evaluate(async()=>{const s=window.__startupStore.getState(),slide={...s.presentation.slides[1],content:'PATCHED CACHED SLIDE'};
   await window.electronAPI.updateProjector({patch:{slidesPatch:[{id:slide.id,nextSlide:slide}]},liveIndex:1,liveSlideId:slide.id});});
  await expect(output.locator('body')).toContainText('PATCHED CACHED SLIDE');
  await output.reload();await expect(output.locator('body')).toContainText('PATCHED CACHED SLIDE');
  expect(await app.evaluate(()=>global.__lastReceiver)).not.toBe(oldToken);
  await app.evaluate((_electron,token)=>global.__cacheOutput.webContents.send('projector-update',{receiverToken:token,isBlackout:true}),oldToken);
  await output.waitForTimeout(100);await expect(output.locator('body')).toContainText('PATCHED CACHED SLIDE');
 }finally{await closeWorkspace(app);}
});
