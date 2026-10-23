const {test,expect}=require('@playwright/test');
const fs=require('node:fs'),path=require('node:path');
const {buildSync}=require('esbuild');
const {launchWorkspace,closeWorkspace}=require('./workspace-test-utils.cjs');
const id='KI33ItOO_M4';
async function setDeck(page){
  await page.evaluate(async id=>{
    await window.__tourTest.language('tr');window.__offlineStore=(await import('/src/renderer/state/useStore.ts')).useStore;
    const s=window.__offlineStore.getState();s.setActiveTab('slides');s.setIsRightPanelOpen(true);s.setLiveSaveEnabled(false);s.setIsProjectorWindowOpen(false);
    s.dispatchUndo({type:'RESET',payload:{id:'offline',name:'Offline',slides:[{id:'music',type:'text',content:'Offline fixture',youtubeMusic:{id,title:'Offline fixture',duration:15},styles:{fontSize:76,textColor:'#fff',backgroundColor:'#000'}}]}});
    s.selectSlides({activeId:'music',ids:new Set(['music']),anchorIndex:0});
  },id);
}
test('optional download preserves playback and remains playable after restart without network',async({},info)=>{
  let app;
  try{
    const bundle=info.outputPath('offline-cache.cjs');
    buildSync({entryPoints:[path.resolve('src/main/offlineMusicCache.ts')],bundle:true,platform:'node',format:'cjs',outfile:bundle});
    const file=path.resolve('tests/fixtures/silent-opus.webm');
    let fixture=await launchWorkspace(info);app=fixture.app;let page=fixture.page;
    await app.evaluate(({app,ipcMain},{bundle,file,profile})=>{
      const req=process.getBuiltinModule('module').createRequire(bundle),fs=req('node:fs/promises');const {OfflineMusicCache}=req(bundle);
      global.__remoteAttempts=0;global.fetch=async()=>{global.__remoteAttempts++;throw Error('Network disabled by test');};
      global.__fixtureCache=new OfflineMusicCache(profile+'/offline-music',async()=>{
        await new Promise(r=>setTimeout(r,400));const bytes=await fs.readFile(file);
        return{audio:new ReadableStream({start(c){c.enqueue(bytes);c.close();}}),mimeType:'audio/webm',finished:()=>true,abort(){}};
      });
      for(const name of ['youtube-music:prepare','youtube-music:download','youtube-music:offline-status','youtube-music:cancel-download'])ipcMain.removeHandler(name);
      ipcMain.handle('youtube-music:prepare',()=>({ok:true}));ipcMain.handle('youtube-music:download',(_,id)=>global.__fixtureCache.download(id));
      ipcMain.handle('youtube-music:offline-status',(_,id)=>global.__fixtureCache.status(id));ipcMain.handle('youtube-music:cancel-download',(_,id)=>global.__fixtureCache.cancel(id));
      app.on('will-quit',()=>global.__fixtureCache.dispose());
    },{bundle,file,profile:fixture.profile});
    await setDeck(page);const audio=page.getByTestId('background-music-audio'),button=page.getByTestId('music-offline-download');
    await expect(button).toBeEnabled();await expect(button).toHaveText('İndir');
    await page.evaluate(file=>{const s=window.__offlineStore.getState();s.setBackgroundMusicCurrent('local-resource://mediafile/'+encodeURIComponent(file));s.setBackgroundMusicPlaying(true);},file);
    await expect.poll(()=>audio.evaluate(el=>el.currentTime)).toBeGreaterThan(.2);const source=await audio.getAttribute('src');
    await button.click();await expect(button).toHaveAttribute('aria-label','İndirmeyi iptal et');await button.click();await expect(button).toHaveText('İndir');
    expect(await audio.getAttribute('src')).toBe(source);expect(await audio.evaluate(el=>el.paused)).toBe(false);
    await button.click();await expect(button).toHaveText('Çevrimdışı hazır');expect(await audio.getAttribute('src')).toBe(source);
    await page.evaluate(()=>{const s=window.__offlineStore.getState();s.setBackgroundMusicPlaying(false);s.setBackgroundMusicCurrent(null);s.setIsProjectorWindowOpen(true);s.setLiveIndex(0);});
    await expect.poll(()=>audio.evaluate(el=>el.currentTime)).toBeGreaterThan(.2);expect(await app.evaluate(()=>global.__remoteAttempts)).toBe(0);
    await closeWorkspace(app);app=null;
    fixture=await launchWorkspace(info);app=fixture.app;page=fixture.page;
    await app.evaluate(()=>{global.__remoteAttempts=0;global.fetch=async()=>{global.__remoteAttempts++;throw Error('Network disabled after restart');};});
    await setDeck(page);await expect(page.getByTestId('music-offline-download')).toHaveText('Çevrimdışı hazır');
    expect(await page.evaluate(id=>window.electronAPI.youtubeMusicPrepare(id),id)).toEqual({ok:true});
    const fresh=page.getByTestId('background-music-audio');await page.evaluate(()=>window.__offlineStore.getState().setIsProjectorWindowOpen(true));
    await expect.poll(()=>fresh.evaluate(el=>el.currentTime)).toBeGreaterThan(.2);
    const url=await fresh.getAttribute('src');expect(url).toContain('local-resource://mediafile/');
    const range=await page.evaluate(async url=>{const r=await fetch(url,{headers:{Range:'bytes=0-31'}});return{status:r.status,bytes:(await r.arrayBuffer()).byteLength};},url);expect(range).toEqual({status:206,bytes:32});
    await page.evaluate(()=>window.__offlineStore.getState().setIsBlackout(true));expect(await fresh.evaluate(el=>el.paused)).toBe(false);
    await page.getByTestId('background-music-toggle').click();await page.getByTestId('background-music-play-pause').click();await expect.poll(()=>fresh.evaluate(el=>el.paused)).toBe(true);
    await page.getByTestId('background-music-play-pause').click();await expect.poll(()=>fresh.evaluate(el=>el.paused)).toBe(false);
    await page.getByTestId('background-music-stop').click();await expect(fresh).not.toHaveAttribute('src');
    await page.getByTestId('background-music-play-pause').click();await expect.poll(()=>fresh.evaluate(el=>el.currentTime)).toBeGreaterThan(.2);
    expect(await app.evaluate(()=>global.__remoteAttempts)).toBe(0);
    await page.screenshot({path:info.outputPath('offline-restarted.png')});
  }finally{await closeWorkspace(app);}
});
