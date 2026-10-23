const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

test('music slides: add silently, live playback, pause, blackout, cancellation, close and reopen file', async ({}, info) => {
  // A silent WAV makes playback assertions deterministic without an external provider or audible sound.
  const samples = 22050 * 30;
  const wav = Buffer.alloc(44 + samples * 2);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(22050, 24); wav.writeUInt32LE(44100, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(samples * 2, 40);
  const server = http.createServer((_, response) => { response.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': wav.length }); response.end(wav); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'wpa-music-slide-'));
  const env = { ...process.env, WPA_TEST_PROFILE: profile, VITE_DEV_SERVER_URL: 'http://127.0.0.1:5199/' };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: [path.resolve('tests/tour/electron-bootstrap.cjs')], env });
  let control;
  try {
    await app.evaluate(({ dialog, ipcMain }, url) => {
      dialog.showMessageBox = async () => ({ response: 1 });
      global.__musicRequests = [];
      ipcMain.removeHandler('youtube-music:prepare');
      ipcMain.handle('youtube-music:prepare', () => ({ ok: true }));
      ipcMain.removeHandler('youtube-music:search');
      ipcMain.handle('youtube-music:search', () => ({ ok: true, results: [
        { id: 'KI33ItOO_M4', title: 'Practice music', duration: 30 },
        { id: 'SIfMHRHdTAI', title: 'Delayed music', duration: 30 },
      ] }));
      ipcMain.removeHandler('youtube-music:play');
      ipcMain.handle('youtube-music:play', async (_, id) => {
        global.__musicRequests.push(id);
        if (id === 'SIfMHRHdTAI') await new Promise(resolve => setTimeout(resolve, 1000));
        return { ok: true, streamId: 'fixture-' + id, url: url + '/' + id };
      });
    }, `http://127.0.0.1:${server.address().port}`);
    control = await app.firstWindow();
    const rendererErrors = [];
    control.on('pageerror', error => rendererErrors.push(error.message));
    await control.waitForFunction(() => !!window.__tourTest);
    await control.evaluate(async () => {
      await window.__tourTest.language('en');
      window.__musicStore = (await import('/src/renderer/state/useStore.ts')).useStore;
      const store = window.__musicStore.getState();
      store.dispatchUndo({ type: 'RESET', payload: { name: 'Music test', slides: [{ id: 'normal', type: 'text', content: 'Normal slide', styles: { fontSize: 48, textColor: '#fff', backgroundColor: '#000' } }] } });
      store.setLiveIndex(0);
      store.setActiveTab('slides');
    });
    if (await control.getByTestId('music-dialog-close').isVisible()) await control.getByTestId('music-dialog-close').click();
    else await control.getByTestId('background-music-toggle').click();
    await control.getByTestId('music-source-youtube').click();
    await control.getByTestId('youtube-music-query').fill('test music');
    await control.getByTestId('youtube-music-query').press('Enter');
    await control.getByTestId('youtube-add-slide-KI33ItOO_M4').click();
    const musicId = await control.evaluate(() => window.__musicStore.getState().presentation.slides[1].id);
    expect(await control.evaluate(() => [...window.__musicStore.getState().selectedSlideIds])).toEqual([musicId]);
    const audio = control.getByTestId('background-music-audio');
    expect(await audio.getAttribute('src')).toBeNull();
    expect(await app.evaluate(() => global.__musicRequests.length)).toBe(0);
    if (await control.getByTestId('music-dialog-close').isVisible()) await control.getByTestId('music-dialog-close').click();
    else await control.getByTestId('background-music-toggle').click();
    await control.locator(`[data-slide-id="${musicId}"]`).click();
    expect(await app.evaluate(() => global.__musicRequests.length)).toBe(0);
    const displayId = await control.evaluate(async () => {
      const id = String((await window.electronAPI.getDisplays())[0].id);
      await window.electronAPI.openProjector(id, { fullPresentation: window.__musicStore.getState().presentation, liveIndex: 0 });
      return id;
    });
    await expect.poll(() => control.evaluate(() => window.__musicStore.getState().isProjectorWindowOpen)).toBe(true);
    await audio.evaluate(element => {
      window.__musicLevels = [];
      element.addEventListener('volumechange', () => window.__musicLevels.push({ time: performance.now(), volume: element.volume }));
    });
    await control.locator(`[data-slide-id="${musicId}"]`).click();
    await expect.poll(() => audio.evaluate(element => element.currentTime)).toBeGreaterThan(0.7);
    expect(await audio.evaluate(element => element.volume)).toBe(1);
    expect(await control.evaluate(() => window.__musicLevels.some(sample => sample.volume > 0 && sample.volume < 1))).toBe(true);
    expect(await app.evaluate(() => global.__musicRequests.length)).toBe(1);
    expect(await control.locator('audio').count()).toBe(1);
    const output = app.windows().find(page => page.url().includes('mode=projector'));
    await output.waitForFunction(() => !!window.__tourTest);
    expect(await output.getByTestId('background-music-audio').count()).toBe(0);
    const gain = control.getByTestId('music-slide-volume');
    await gain.focus(); await control.keyboard.press('Home');
    for (let i = 0; i < 50; i++) await control.keyboard.press('ArrowRight');
    await control.evaluate(() => window.__musicStore.getState().setMediaVolume(0.8));
    await expect.poll(() => audio.evaluate(element => element.volume)).toBeCloseTo(0.4, 4);
    await control.locator('#slide-content-textarea').fill('Evening worship');
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('select-media-file');
      ipcMain.handle('select-media-file', () => 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080"><rect width="1920" height="1080" fill="white"/></svg>'));
    });
    await control.getByTestId('music-preset-simple').click();
    await control.getByTestId('music-slide-editor').getByRole('button', { name: 'Gradient', exact: true }).click();
    const applyGradient = control.getByRole('dialog').getByRole('button', { name: /Apply/ });
    await expect(applyGradient).toBeEnabled({ timeout: 20000 });
    await applyGradient.click();
    await expect.poll(() => control.evaluate(() => !!window.__musicStore.getState().presentation.slides[1].styles.generatedBackground)).toBe(true);
    await control.getByTestId('music-preset-photo').click();
    await expect.poll(() => control.evaluate(() => window.__musicStore.getState().presentation.slides[1].styles.backgroundDim)).toBe(0.45);
    await control.getByTestId('music-background-dim').focus(); await control.keyboard.press('End');
    await expect.poll(() => output.locator('[data-background-dim]').last().evaluate(element => getComputedStyle(element).opacity)).toBe('0.8');
    expect(await control.locator(`[data-slide-id="${musicId}"] [data-background-dim]`).evaluate(element => getComputedStyle(element).opacity)).toBe('0.8');
    await control.evaluate(() => window.__musicStore.getState().dispatchUndo({ type: 'UNDO' }));
    await expect.poll(() => control.evaluate(() => window.__musicStore.getState().presentation.slides[1].styles.backgroundDim)).toBe(0.45);
    await control.evaluate(() => window.__musicStore.getState().dispatchUndo({ type: 'REDO' }));
    await expect.poll(() => control.evaluate(() => window.__musicStore.getState().presentation.slides[1].styles.backgroundDim)).toBe(0.8);
    await control.getByRole('button', { name: 'Editor', exact: true }).click();
    await expect.poll(() => control.locator('section[aria-labelledby="slide-editor-title"] [data-background-dim]').count()).toBeGreaterThan(0);
    expect(await control.locator('section[aria-labelledby="slide-editor-title"] [data-background-dim]').last().evaluate(element => getComputedStyle(element).opacity)).toBe('0.8');
    await control.locator('nav').getByRole('button', { name: 'Slides', exact: true }).click();
    expect(await app.evaluate(() => global.__musicRequests.length)).toBe(1);
    expect(await control.evaluate(() => window.__musicStore.getState().presentation.slides[1].youtubeMusic.title)).toBe('Practice music');
    if (await control.getByTestId('music-dialog-close').isVisible()) await control.getByTestId('music-dialog-close').click();
    else await control.getByTestId('background-music-toggle').click();
    await control.getByTestId('background-music-play-pause').click();
    await expect.poll(() => audio.evaluate(element => element.paused)).toBe(true);
    await control.getByTestId('background-music-play-pause').click();
    await expect.poll(() => audio.evaluate(element => element.paused)).toBe(false);
    await control.evaluate(() => window.__musicStore.getState().setIsBlackout(true));
    expect(await audio.evaluate(element => element.paused)).toBe(false);
    await control.evaluate(() => window.__musicStore.getState().setIsBlackout(false));
    await control.screenshot({ path: info.outputPath('music-slide-controls.png') });
    await control.getByTestId('youtube-add-slide-SIfMHRHdTAI').click();
    const delayedId = await control.evaluate(() => window.__musicStore.getState().presentation.slides[2].id);
    expect(await app.evaluate(() => global.__musicRequests.length)).toBe(1);
    if (await control.getByTestId('music-dialog-close').isVisible()) await control.getByTestId('music-dialog-close').click();
    else await control.getByTestId('background-music-toggle').click();
    const oldSource = await audio.getAttribute('src');
    await control.locator(`[data-slide-id="${delayedId}"]`).click();
    await control.waitForTimeout(200);
    expect(await audio.getAttribute('src')).toBe(oldSource);
    expect(await app.evaluate(() => global.__musicRequests.length)).toBe(1);
    expect(await audio.evaluate(element => element.volume)).toBeLessThan(0.4);
    await expect.poll(() => app.evaluate(() => global.__musicRequests.length)).toBe(2);
    await control.locator(`[data-slide-id="${musicId}"]`).click();
    await expect.poll(() => audio.evaluate(element => element.currentTime)).toBeGreaterThan(0.7);
    expect(await app.evaluate(() => global.__musicRequests.length)).toBe(3);
    await control.locator('[data-slide-id="normal"]').click();
    await expect.poll(() => audio.evaluate(element => element.volume)).toBeLessThan(0.39);
    expect(await audio.evaluate(element => element.paused)).toBe(false);
    await expect.poll(() => audio.getAttribute('src')).toBeNull();
    await control.locator(`[data-slide-id="${delayedId}"]`).click();
    await expect.poll(() => app.evaluate(() => global.__musicRequests.length)).toBe(4);
    await control.locator('[data-slide-id="normal"]').click();
    await control.waitForTimeout(1200);
    expect(await audio.getAttribute('src')).toBeNull();
    expect(await audio.evaluate(element => element.paused)).toBe(true);
    await control.locator(`[data-slide-id="${musicId}"]`).click();
    await expect.poll(() => audio.evaluate(element => element.currentTime)).toBeGreaterThan(0.2);
    await control.evaluate(id => window.electronAPI.closeProjector(id), displayId);
    await expect.poll(() => audio.getAttribute('src')).toBeNull();
    await app.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows().find(window => !window.webContents.getURL().includes('mode=projector')); window.unmaximize(); window.setSize(800, 600); });
    await control.waitForFunction(() => innerWidth <= 800);
    for (const language of ['tr', 'en', 'de', 'es', 'ko']) {
      await control.evaluate(language => window.__tourTest.language(language), language);
      expect(await control.getByTestId('music-slide-editor').innerText()).not.toContain('musicSlide.');
      await control.getByTestId('music-slide-volume').scrollIntoViewIfNeeded();
      const box = await control.getByTestId('music-slide-volume').boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBeLessThanOrEqual(await control.evaluate(() => innerHeight));
    }
    await control.screenshot({ path: info.outputPath('music-editor-800x600.png') });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].maximize());
    await control.waitForFunction(() => innerWidth > 1024);
    await control.evaluate(() => window.__tourTest.language('en'));
    // Exercise the actual file-open normalization, not just JSON serialization.
    const deck = await control.evaluate(() => window.__musicStore.getState().presentation);
    await app.evaluate(({ ipcMain }, deck) => {
      ipcMain.removeHandler('open-file');
      ipcMain.handle('open-file', () => ({ path: 'fixture.gpres', content: JSON.stringify(deck) }));
    }, deck);
    await control.evaluate(() => {
      const store = window.__musicStore.getState();
      store.dispatchUndo({ type: 'RESET', payload: { name: 'Empty before reopen', slides: [store.presentation.slides[0]] } });
    });
    await control.getByRole('button', { name: 'Presentations', exact: true }).click();
    await control.getByRole('button', { name: 'Open from File', exact: true }).click();
    await expect.poll(() => control.evaluate(() => window.__musicStore.getState().presentation.slides[1]?.youtubeMusic?.id)).toBe('KI33ItOO_M4');
    expect(await control.evaluate(() => window.__musicStore.getState().presentation.slides[1].musicSettings.volume)).toBe(0.5);
    expect(await control.evaluate(() => window.__musicStore.getState().presentation.slides[1].styles.backgroundDim)).toBe(0.8);
    // Dev pages cannot load file:// audio; keep the local-library playback regression
    // on the controlled WAV. Real file loading is covered by the production smoke test.
    await app.evaluate(({ ipcMain }, url) => {
      ipcMain.removeHandler('select-audio-folder');
      ipcMain.handle('select-audio-folder', () => 'fixture-folder');
      ipcMain.removeHandler('read-audio-folder');
      ipcMain.handle('read-audio-folder', () => ({ paths: [url + '/local-test.wav'] }));
    }, `http://127.0.0.1:${server.address().port}`);
    if (await control.getByTestId('music-dialog-close').isVisible()) await control.getByTestId('music-dialog-close').click();
    else await control.getByTestId('background-music-toggle').click();
    await control.getByTestId('music-source-local').click();
    await control.getByTestId('background-music-menu').getByRole('button', { name: /Choose Folder/ }).click();
    const localTrack = control.getByRole('button', { name: /^local-test\.wav/ });
    await localTrack.click();
    await expect.poll(() => audio.evaluate(element => element.currentTime)).toBeGreaterThan(0.2);
    await localTrack.click();
    expect(await audio.evaluate(element => element.paused)).toBe(false);
    expect(rendererErrors).toEqual([]);
  } finally {
    if (control && !control.isClosed()) await control.screenshot({ path: info.outputPath('final-state.png') }).catch(() => {});
    await app.evaluate(({ app }) => { setTimeout(() => app.exit(0), 0); }).catch(() => {});
    await app.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
