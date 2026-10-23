let testInfo;
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');

const { test, _electron: electron, expect } = require('@playwright/test');
const root = path.resolve('.');
let app, media;
async function main() {
  const wav = Buffer.alloc(44 + 22050 * 60 * 2);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(22050, 24); wav.writeUInt32LE(44100, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
  const local = testInfo.outputPath('music-modal.wav'); fs.writeFileSync(local, wav);
  media = http.createServer((_, res) => { res.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': wav.length }); res.end(wav); });
  await new Promise(resolve => media.listen(0, '127.0.0.1', resolve));
  await expect.poll(async () => { try { return (await fetch('http://127.0.0.1:5199')).ok; } catch { return false; } }, {timeout:45000}).toBe(true);
  const env = {...process.env, VITE_DEV_SERVER_URL:'http://127.0.0.1:5199'}; delete env.ELECTRON_RUN_AS_NODE;
  env.WPA_TEST_PROFILE=testInfo.outputPath('profile');
  app = await electron.launch({args:[path.resolve('tests/tour/electron-bootstrap.cjs')], env, cwd:root});
  await app.evaluate(({ipcMain, dialog}, {url, local}) => {
    dialog.showMessageBox = async () => ({response:1});
    global.__searches = []; global.__plays = []; global.__closeOutput = 0;
    for (const name of ['youtube-music:search','youtube-music:play','youtube-music:stop','youtube-music:prepare','select-audio-folder','read-audio-folder','toggle-projector']) ipcMain.removeHandler(name);
    ipcMain.handle('toggle-projector', () => { global.__closeOutput++; });
    ipcMain.handle('youtube-music:prepare', () => ({ok:true}));
    ipcMain.handle('youtube-music:stop', () => ({ok:true}));
    ipcMain.handle('youtube-music:search', (_, query, cursor) => {
      global.__searches.push([query,cursor]);
      if (query === 'error') return {ok:false,error:'search-failed'};
      return {ok:true,results:Array.from({length:cursor?5:20},(_,i)=>({id:`fixture-${String(cursor?20+i:i).padStart(3,'0')}`,title:`Amazing Grace — deneme müziği ${cursor?20+i:i}`,duration:60})),nextCursor:cursor?undefined:'next'};
    });
    ipcMain.handle('youtube-music:play', (_, id) => {global.__plays.push(id);return id==='fixture-err'?{ok:false,error:'play-failed'}:{ok:true,streamId:'qa-'+id,url:url+'/'+id};});
    ipcMain.handle('select-audio-folder', () => local.replace(/[\\/][^\\/]+$/, ''));
    // Use the loopback WAV for the local-source UI in dev; the production E2E checks actual file:// playback.
    ipcMain.handle('read-audio-folder', () => ({paths:[url + '/music-modal.wav']}));
  }, {url:`http://127.0.0.1:${media.address().port}`,local});
  const page = await app.firstWindow(); page.setDefaultTimeout(10000); const errors = []; page.on('pageerror',e=>errors.push(e.message));
  await page.waitForFunction(()=>!!window.__tourTest);
  await page.evaluate(async()=>{await window.__tourTest.language('tr');window.__musicStore=(await import('/src/renderer/state/useStore.ts')).useStore;const s=window.__musicStore.getState();s.setActiveTab('slides');s.setLiveSaveEnabled(false);s.setIsProjectorWindowOpen(false);s.dispatchUndo({type:'RESET',payload:{id:'modal',name:'Müzik penceresi',slides:[{id:'normal',type:'text',content:'Müzik penceresi denemesi'}]}});s.selectSlides({activeId:'normal',ids:new Set(['normal']),anchorIndex:0});});
  const toggle=page.getByTestId('background-music-toggle'), close=page.getByTestId('music-dialog-close'), query=page.getByTestId('youtube-music-query'), audio=page.getByTestId('background-music-audio');
  await toggle.click(); await expect(page.getByRole('dialog')).toBeVisible(); await expect(page.getByTestId('music-source-youtube')).toHaveAttribute('aria-pressed','true');
  expect(await app.evaluate(()=>global.__searches.length)).toBe(0); expect(await app.evaluate(()=>global.__plays.length)).toBe(0);
  await query.fill('test music'); await query.press('Enter'); await expect(page.getByTestId('youtube-result-fixture-019')).toBeAttached();
  const sizes=[];
  for (const [width,height] of [[1920,1080],[1366,768],[800,600]]) {
    await app.evaluate(({BrowserWindow},{width,height})=>{const w=BrowserWindow.getAllWindows()[0];w.unmaximize();w.setContentSize(width,height);},{width,height});
    await expect.poll(()=>page.evaluate(()=>innerWidth)).toBe(width);
    const metrics=await page.locator('.design-music-dialog').evaluate(el=>{const rect=el.getBoundingClientRect();const footer=el.querySelector('footer').getBoundingClientRect();return {width:innerWidth,height:innerHeight,rect:rect.toJSON(),footer:footer.toJSON(),overflow:el.scrollWidth>el.clientWidth,scroll:el.querySelector('[data-testid="youtube-music-results"]').scrollHeight>el.querySelector('[data-testid="youtube-music-results"]').clientHeight};});
    expect(metrics.rect.width).toBeLessThanOrEqual(720);expect(metrics.rect.height).toBeLessThanOrEqual(metrics.height*.85+1);expect(metrics.rect.x).toBeGreaterThanOrEqual(16);expect(metrics.rect.y).toBeGreaterThanOrEqual(16);expect(metrics.overflow).toBe(false);expect(metrics.scroll).toBe(true);
    const footerBefore=metrics.footer.y;
    await page.getByTestId('youtube-music-results').evaluate(el=>el.scrollTop=el.scrollHeight);
    expect(Math.abs(await page.locator('.design-music-footer').evaluate(el=>el.getBoundingClientRect().y)-footerBefore)).toBeLessThan(1);
    await page.getByTestId('youtube-music-results').evaluate(el=>el.scrollTop=0);
    sizes.push(metrics);await page.screenshot({path:testInfo.outputPath(`music-modal-${width}.png`)});
  }
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1366,768));
  await page.keyboard.press('Tab'); await expect.poll(()=>page.evaluate(()=>!!document.activeElement.closest('[role="dialog"]'))).toBe(true);
  await page.getByRole('dialog').locator('button').last().focus();await page.keyboard.press('Tab');await expect.poll(()=>page.evaluate(()=>!!document.activeElement.closest('[role="dialog"]'))).toBe(true);
  await close.focus();await page.keyboard.press('Shift+Tab');await expect.poll(()=>page.evaluate(()=>!!document.activeElement.closest('[role="dialog"]'))).toBe(true);
  await page.getByTestId('youtube-load-more').click(); await expect(page.getByTestId('youtube-result-fixture-024')).toBeAttached();
  await page.getByTestId('youtube-add-slide-fixture-000').click();expect(await app.evaluate(()=>global.__plays.length)).toBe(0);await expect(audio).not.toHaveAttribute('src');
  await page.getByTestId('youtube-result-fixture-000').click();await expect.poll(()=>audio.evaluate(el=>el.currentTime)).toBeGreaterThan(.3);
  await audio.evaluate(el=>window.__originalMusicAudio=el); const before=await audio.evaluate(el=>el.currentTime);
  await close.click(); await expect(toggle).toBeFocused(); await expect.poll(()=>audio.evaluate(el=>el.currentTime)).toBeGreaterThan(before+.3);
  await page.locator('[data-guide-anchor="nav-hymns"]').click();await page.locator('[data-guide-anchor="nav-slides"]').click();
  expect(await audio.evaluate(el=>el===window.__originalMusicAudio)).toBe(true);expect(await page.locator('audio').count()).toBe(1);
  await toggle.click();await expect(query).toHaveValue('test music');await expect(page.getByTestId('youtube-result-fixture-024')).toBeAttached();expect(await app.evaluate(()=>global.__searches.length)).toBe(2);
  await page.getByTestId('background-music-play-pause').click();await expect.poll(()=>audio.evaluate(el=>el.paused)).toBe(true);await page.getByTestId('background-music-play-pause').click();await expect.poll(()=>audio.evaluate(el=>el.paused)).toBe(false);
  await page.getByTestId('background-music-stop').click();await expect(audio).not.toHaveAttribute('src');
  await page.getByTestId('music-source-local').click();await page.getByTestId('background-music-menu').getByRole('button',{name:'Klasör Seç',exact:true}).click();await page.getByRole('button',{name:/music-modal.wav/}).click();await expect.poll(()=>audio.evaluate(el=>el.currentTime)).toBeGreaterThan(.2);
  await close.click();await toggle.click();await expect(page.getByTestId('music-source-youtube')).toHaveAttribute('aria-pressed','true');expect(await audio.evaluate(el=>el.paused)).toBe(false);
  await page.evaluate(()=>window.__musicStore.getState().setIsProjectorWindowOpen(true));await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toBeHidden();await expect(toggle).toBeFocused();expect(await app.evaluate(()=>global.__closeOutput)).toBe(0);expect(await page.evaluate(()=>window.__musicStore.getState().isProjectorWindowOpen)).toBe(true);
  await toggle.click();await page.mouse.click(5,100);await expect(page.getByRole('dialog')).toBeHidden();await expect(toggle).toBeFocused();
  await page.evaluate(()=>window.__musicStore.getState().setLiveIndex(1));await expect.poll(()=>audio.evaluate(el=>el.currentTime)).toBeGreaterThan(.3);
  const liveSource=await audio.getAttribute('src'), plays=await app.evaluate(()=>global.__plays.length);
  await toggle.click();await expect(page.getByTestId('youtube-result-fixture-000')).toBeDisabled();await close.click();
  await page.locator('[data-guide-anchor="nav-hymns"]').click();await page.locator('[data-guide-anchor="nav-slides"]').click();
  expect(await audio.getAttribute('src')).toBe(liveSource);expect(await app.evaluate(()=>global.__plays.length)).toBe(plays);expect(await audio.evaluate(el=>el===window.__originalMusicAudio&&!el.paused)).toBe(true);
  await page.evaluate(()=>{const s=window.__musicStore.getState();s.setLiveIndex(0);s.dispatchUndo({type:'SET',payload:{...s.presentation,slides:[{...s.presentation.slides[0],type:'text',youtubeMusic:{id:'fixture-err',title:'Failed live track',duration:60}}]}});});
  await expect(page.getByTestId('music-error-indicator')).toBeAttached();await expect(page.getByRole('dialog')).toBeHidden();await toggle.click();await expect(page.getByTestId('background-music-menu').getByRole('alert')).toBeVisible();await expect(page.getByTestId('youtube-result-fixture-000')).toBeDisabled();
  await page.evaluate(()=>window.__musicStore.getState().setIsProjectorWindowOpen(false));
  await query.fill('error');await query.press('Enter');await expect(page.getByTestId('background-music-menu').getByRole('alert')).toBeVisible();
  expect(errors).toEqual([]);fs.writeFileSync(testInfo.outputPath('music-modal-report.json'),JSON.stringify({sizes,errors,passed:true},null,2));
  console.log('PASS: modal layout at 3 sizes, scroll, YouTube default, search/pagination/persistence, focus/Escape/backdrop, silent add ownership, local/YouTube playback, pause/stop, stable audio across close and tabs, live error indicator without auto-open');
}
test("music modal preserves playback, focus, search and responsive layout", async ({}, info) => { testInfo=info;try { await main(); } finally { if(app){await app.evaluate(({app})=>setTimeout(()=>app.exit(0),0)).catch(()=>{});await app.close().catch(()=>{});}if(media)await new Promise(r=>media.close(r)); } });
