const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');

test('real application: YouTube search, playback, pause, switch, stop and local audio', async ({}, info) => {
  const env = { ...process.env, WPA_TEST_PROFILE: info.outputPath('profile') };
  delete env.ELECTRON_RUN_AS_NODE; delete env.VITE_DEV_SERVER_URL;
  const app = await electron.launch({ args: [path.resolve('tests/tour/electron-bootstrap.cjs'), '--wpa-smoke'], env });
  let page;
  const errors = [];
  const logs = [];
  app.process().stdout?.on('data', chunk => logs.push(String(chunk)));
  app.process().stderr?.on('data', chunk => logs.push(String(chunk)));
  try {
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false }); });
    page = await app.firstWindow();
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') logs.push(message.text()); });
    page.on('requestfailed', request => logs.push('Network: ' + request.failure()?.errorText));
    await page.locator('nav').waitFor();
    await page.keyboard.press('Escape');
    // Keep this automated playback test inaudible without changing the app's volume state.
    await page.evaluate(() => { const audio = document.querySelector('[data-testid="background-music-audio"]'); audio.muted = true; document.addEventListener('error', event => { if (event.target === audio) window.musicTestError = { code: audio.error?.code, message: audio.error?.message, src: audio.getAttribute('src') }; }, true); });
    if (await page.getByTestId('music-dialog-close').isVisible()) await page.getByTestId('music-dialog-close').click();
    else await page.getByTestId('background-music-toggle').click();
    await page.getByTestId('music-source-youtube').click();
    await page.getByTestId('youtube-music-query').fill('Amazing Grace piano instrumental hymn with lyrics');
    await page.getByTestId('youtube-music-query').press('Enter');
    await expect(page.getByTestId('youtube-result-KI33ItOO_M4')).toBeVisible({ timeout: 30000 });
    await page.getByTestId('youtube-result-KI33ItOO_M4').click();
    const audio = () => page.getByTestId('background-music-audio').evaluate(el => ({ time: el.currentTime, paused: el.paused, src: el.getAttribute('src'), error: el.error?.code }));
    await page.waitForFunction(() => document.querySelector('[data-testid="background-music-audio"]').currentTime > 5 || !!document.querySelector('[data-testid="background-music-menu"] [role="alert"]'), { timeout: 60000 });
    if ((await audio()).time <= 5) console.log('Media failure:', await page.evaluate(() => window.musicTestError));
    expect((await audio()).time).toBeGreaterThan(5);
    console.log('YouTube playback started in application');
    const source = (await audio()).src;
    await page.getByTestId('background-music-play-pause').click();
    await expect.poll(async () => (await audio()).paused).toBe(true);
    const paused = (await audio()).time;
    await new Promise(resolve => setTimeout(resolve, 1500));
    expect(Math.abs((await audio()).time - paused)).toBeLessThan(0.15);
    await page.getByTestId('background-music-play-pause').click();
    await expect.poll(async () => (await audio()).time).toBeGreaterThan(paused + 1);
    expect((await audio()).src).toBe(source);
    // Closing the menu must leave the same audio playing.
    if (await page.getByTestId('music-dialog-close').isVisible()) await page.getByTestId('music-dialog-close').click();
    else await page.getByTestId('background-music-toggle').click();
    await expect.poll(async () => (await audio()).time, { timeout: 40000 }).toBeGreaterThan(30);
    if (await page.getByTestId('music-dialog-close').isVisible()) await page.getByTestId('music-dialog-close').click();
    else await page.getByTestId('background-music-toggle').click();
    await page.screenshot({ path: info.outputPath('youtube-playing.png') });
    console.log('First track passed 30 seconds with pause/resume and menu closed');
    await page.getByTestId('youtube-music-query').fill('Amazing Grace Piano Instrumental');
    await page.getByTestId('youtube-music-query').press('Enter');
    await expect(page.getByTestId('youtube-result-SIfMHRHdTAI')).toBeVisible({ timeout: 30000 });
    await page.getByTestId('youtube-result-SIfMHRHdTAI').click();
    await expect.poll(async () => (await audio()).time, { timeout: 60000 }).toBeGreaterThan(5);
    expect((await audio()).src).not.toBe(source);
    expect((await audio()).error).toBeUndefined();
    await page.getByTestId('background-music-stop').click();
    await expect.poll(async () => (await audio()).src).toBeNull();
    await expect(page.getByTestId('background-music-play-pause')).toBeDisabled();
    const oldStatus = await page.evaluate(async source => (await fetch(source)).status, source).catch(() => 0);
    expect([0, 404]).toContain(oldStatus);
    // Cancel a pending selection: its eventual response must not restart playback.
    await page.getByTestId('youtube-result-SIfMHRHdTAI').click();
    await page.getByTestId('background-music-stop').click();
    await expect(page.getByTestId('background-music-stop')).toBeDisabled();
    await new Promise(resolve => setTimeout(resolve, 2000));
    expect((await audio()).src).toBeNull();

    const fixtureDir = info.outputPath('local-music');
    await fs.mkdir(fixtureDir, { recursive: true });
    const samples = 22050 * 4;
    const wav = Buffer.alloc(44 + samples * 2);
    wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
    wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(22050, 24); wav.writeUInt32LE(44100, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
    wav.write('data', 36); wav.writeUInt32LE(samples * 2, 40);
    await fs.writeFile(path.join(fixtureDir, 'local-test.wav'), wav);
    await app.evaluate(({ dialog }, fixtureDir) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fixtureDir] }); }, fixtureDir);
    await page.getByTestId('music-source-local').click();
    await page.getByTestId('background-music-menu').getByRole('button').filter({ hasText: /Choose Folder|Klasör Seç/ }).click();
    await page.getByRole('button', { name: /local-test.wav/ }).click();
    await expect.poll(async () => (await audio()).time, { timeout: 10000 }).toBeGreaterThan(0.5);
    expect((await audio()).error).toBeUndefined();
    expect(await page.evaluate(() => window.electronAPI.youtubeMusicPlay('invalid'))).toEqual({ ok: false, error: 'invalid-video' });
    expect(errors).toEqual([]);
    await page.getByTestId('background-music-stop').click();
    // Explicitly close the main window to verify the hidden token window cannot keep the app alive.
    await app.evaluate(({ BrowserWindow }) => {
      const control = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().startsWith('file:'));
      control.close();
    });
    await expect.poll(() => page.isClosed()).toBe(true);
  } finally {
    if (page && !page.isClosed()) await page.screenshot({ path: info.outputPath('last-state.png') }).catch(() => {});
    await fs.writeFile(info.outputPath('renderer-errors.json'), JSON.stringify(errors, null, 2));
    await fs.writeFile(info.outputPath('process.log'), logs.join(''));
    if (info.status !== info.expectedStatus) console.log(logs.join('').split('\n').filter(line => /youtube-music|Network:|Content Security|blocked|CORS/i.test(line)).join('\n'));
    await app.close().catch(() => {});
  }
});
