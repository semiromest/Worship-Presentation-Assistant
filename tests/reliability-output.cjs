const { _electron } = require('playwright');
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const AdmZip = require('adm-zip');
async function main() {
  const executablePath = process.argv[2]; if (!executablePath) throw new Error('Packaged executable required');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wpa-output-')), output = path.resolve('.tmp/reliability-output'); await fs.mkdir(output, { recursive: true });
  await fs.rm(path.join(output, 'result.json'), { force: true });
  const env = { ...process.env, APPDATA: path.join(root, 'appdata'), LOCALAPPDATA: path.join(root, 'localappdata') }; delete env.ELECTRON_RUN_AS_NODE; delete env.VITE_DEV_SERVER_URL;
  const app = await _electron.launch({ executablePath, args: ['--wpa-smoke'], env }); let profile, controlId;
  const processExit = new Promise(resolve => app.process().once('exit', (code, signal) => resolve({ code, signal })));
  const invoke = (channel, args = []) => app.evaluate(async ({ ipcMain, BrowserWindow }, input) => { const wc = BrowserWindow.fromId(input.controlId).webContents; return ipcMain._invokeHandlers.get(input.channel)({ sender: wc, senderFrame: wc.mainFrame }, ...input.args); }, { channel, args, controlId });
  const evidence = { kind: 'packaged-primary-display-occlusion', physicalMultiDisplay: false, workaroundEnabled: false, phases: [] };
  try {
    assert.equal(await app.evaluate(({ app }) => app.isPackaged), true);
    profile = await app.evaluate(({ app }) => app.getPath('userData'));
    const page = await app.firstWindow(); await page.locator('[data-app-shell]').waitFor(); await page.keyboard.press('Escape');
    controlId = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].id);
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false }); });
    const videoBytes = await page.evaluate(async () => {
      const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 180; const ctx = canvas.getContext('2d');
      const stream = canvas.captureStream(10), recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' }), chunks = [];
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      const stopped = new Promise(resolve => { recorder.onstop = resolve; }); recorder.start();
      for (let i = 0; i < 24; i++) { ctx.fillStyle = i % 2 ? '#e04040' : '#4060e0'; ctx.fillRect(0, 0, 320, 180); await new Promise(resolve => setTimeout(resolve, 100)); }
      recorder.stop(); await stopped; stream.getTracks().forEach(track => track.stop()); return [...new Uint8Array(await new Blob(chunks).arrayBuffer())];
    });
    const videoFile = path.join(root, 'animated.webm'); await fs.writeFile(videoFile, Buffer.from(videoBytes));
    for (const kind of ['video', 'countdown']) {
      const startTime = Date.now();
      const slide = kind === 'video' ? { id: kind, type: 'video', content: 'Video', mediaUrl: 'local-resource://mediafile/' + encodeURIComponent(videoFile), styles: { objectFit: 'cover' } }
        : { id: kind, type: 'countdown', content: JSON.stringify({ minutes: 1, seconds: 0, totalSeconds: 60, startTime, paused: false }), styles: { backgroundColor: '#000000', textColor: '#ffffff' } };
      const deck = { id: kind, name: kind, slides: [slide], transition: { type: 'none', duration: 0 } }, zip = new AdmZip(); zip.addFile('presentation.json', Buffer.from(JSON.stringify(deck))); const file = path.join(root, kind + '.gpres'); await fs.writeFile(file, zip.toBuffer());
      await app.evaluate(({ app }, file) => app.emit('second-instance', {}, [file]), file);
      await page.locator('[data-desktop-open-request] button').first().click(); await page.locator('[data-desktop-open-request]').waitFor({ state: 'detached' });
      const displays = await invoke('get-displays'); await invoke('open-projector', [displays[0].id, { fullPresentation: deck, liveIndex: 0, liveSlideId: kind }]);
      let projector; for (let i = 0; i < 100 && !projector; i++) { projector = app.windows().find(w => w.url().includes('mode=projector')); if (!projector) await new Promise(r => setTimeout(r, 100)); }
      assert.ok(projector); await projector.waitForLoadState();
      if (kind === 'video') await projector.waitForFunction(() => [...document.querySelectorAll('video')].some(video => video.readyState >= 2 && !video.paused));
      else await projector.getByText(/0:\d\d/).first().waitFor();
      await app.evaluate(({ BrowserWindow }) => {
        const projector = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('mode=projector'));
        const state = { frames: 0, images: new Set() }; globalThis.__outputEvidence = state;
        projector.webContents.beginFrameSubscription(false, image => { state.frames++; if (state.images.size < 100) state.images.add(image.resize({ width: 32, height: 18 }).toBitmap({ scaleFactor: 1 }).toString('base64')); });
      });
      const coverId = await app.evaluate(async ({ BrowserWindow }) => {
        const projector = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('mode=projector'));
        const cover = new BrowserWindow({ ...projector.getBounds(), frame: false, alwaysOnTop: true, focusable: false, backgroundColor: '#222222', webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true } });
        await cover.loadURL('data:text/html,<html><body style="background:%23222222">Occlusion test</body></html>'); return cover.id;
      });
      const before = kind === 'video' ? await projector.locator('video').first().evaluate(video => ({ currentTime: video.currentTime, frames: video.getVideoPlaybackQuality().totalVideoFrames, droppedFrames: video.getVideoPlaybackQuality().droppedVideoFrames })) : { wallTime: Date.now() };
      await new Promise(r => setTimeout(r, 8000));
      const after = kind === 'video' ? await projector.locator('video').first().evaluate(video => ({ currentTime: video.currentTime, frames: video.getVideoPlaybackQuality().totalVideoFrames, droppedFrames: video.getVideoPlaybackQuality().droppedVideoFrames })) : { wallTime: Date.now(), text: await projector.locator('body').innerText() };
      const composed = await app.evaluate(({ BrowserWindow }) => { const projector = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('mode=projector')); projector.webContents.endFrameSubscription(); const state = globalThis.__outputEvidence; globalThis.__outputEvidence = null; return { frames: state.frames, distinctImages: state.images.size }; });
      await app.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id)?.destroy(), coverId);
      assert.ok(composed.frames >= 3 && composed.distinctImages >= 2, 'Occluded output must produce changing composed frames');
      if (kind === 'video') assert.ok(after.frames > before.frames + 10, 'Video decoding must advance while occluded');
      else { const text = after.text.match(/(\d+):(\d\d)/); assert.ok(text); const actual = Number(text[1]) * 60 + Number(text[2]), expected = Math.max(0, 60 - Math.floor((after.wallTime - startTime) / 1000)); assert.ok(Math.abs(actual - expected) <= 1); }
      evidence.phases.push({ kind, before, after, composed });
      await projector.screenshot({ path: path.join(output, kind + '.png'), timeout: 5000 }).catch(() => {});
      for (const display of displays) await invoke('close-projector', [display.id]);
    }
    await app.evaluate(({ app }) => { setTimeout(() => app.quit(), 100); });
    let quitTimeout;
    try {
      evidence.shutdown = { mode: 'app.quit', ...await Promise.race([processExit, new Promise((_, reject) => { quitTimeout = setTimeout(() => reject(new Error('Normal app.quit did not finish in 15 seconds')), 15000); })]) };
    } finally { clearTimeout(quitTimeout); }
    assert.equal(evidence.shutdown.code, 0, 'Normal shutdown must exit cleanly');
    assert.equal(evidence.shutdown.signal, null);
    await fs.writeFile(path.join(output, 'result.json'), JSON.stringify(evidence, null, 2)); console.log(JSON.stringify(evidence));
  } catch (error) { await fs.writeFile(path.join(output, 'failure.txt'), String(error)); throw error; }
  finally { await app.evaluate(({ app }) => app.exit(0)).catch(() => {}); await app.close().catch(() => {}); if (profile && path.resolve(profile).startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(profile).startsWith('wpa-smoke-')) await fs.rm(profile, { recursive: true, force: true }).catch(() => {}); await fs.rm(root, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
