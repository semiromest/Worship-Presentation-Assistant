const {test,expect}=require('@playwright/test');
const {launchWorkspace,closeWorkspace}=require('./workspace-test-utils.cjs');
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
