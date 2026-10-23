const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs/promises');

test('unprepared audio remains playing beyond the initial segment', async () => {
  const env = { ...process.env, WPA_TEST_PROFILE: info.outputPath('profile') };
  delete env.ELECTRON_RUN_AS_NODE; delete env.VITE_DEV_SERVER_URL;
  const app = await electron.launch({ args: [path.resolve('tests/tour/electron-bootstrap.cjs'), '--wpa-smoke'], env });
  const logs = [];
  app.process().stderr?.on('data', data => logs.push(String(data)));
  try {
    const page = await app.firstWindow();
    await page.locator('nav').waitFor();
    await page.keyboard.press('Escape');
    await page.locator('nav [data-guide-anchor="nav-slides"]').click();
    await page.evaluate(async () => window.electronAPI.openProjector(String((await window.electronAPI.getDisplays())[0].id)));
    await page.getByRole('button', { name: /^(Mute|Sesi kapat)$/ }).click();
    if (await page.getByTestId('music-dialog-close').isVisible()) await page.getByTestId('music-dialog-close').click();
    else await page.getByTestId('background-music-toggle').click();
    await page.getByTestId('music-source-youtube').click();
    await page.getByTestId('youtube-music-query').fill('Amazing Grace piano instrumental hymn with lyrics');
    await page.getByTestId('youtube-music-query').press('Enter');
    await page.getByTestId('youtube-result-KI33ItOO_M4').click({ timeout: 30000 });
    await expect.poll(() => page.getByTestId('background-music-audio').evaluate(el => el.currentTime), { timeout: 45000 }).toBeGreaterThan(30);
  } finally {
    console.log('Audio process:', logs.join('').split('\n').filter(line => /youtube-music/i.test(line)).join('\n'));
    await app.evaluate(({ app }) => { setTimeout(() => app.exit(0), 0); }).catch(() => {});
    await app.close().catch(() => {});
  }
});

test('local audio plays, pauses, resumes and stops in the production application', async ({}, info) => {
  const directory = info.outputPath('local-audio');
  await fs.mkdir(directory, { recursive: true });
  const samples = 22050 * 12;
  const wav = Buffer.alloc(44 + samples * 2);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(22050, 24); wav.writeUInt32LE(44100, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(samples * 2, 40);
  await fs.writeFile(path.join(directory, 'local-test.wav'), wav);
  const env = { ...process.env, WPA_TEST_PROFILE: info.outputPath('profile') };
  delete env.ELECTRON_RUN_AS_NODE; delete env.VITE_DEV_SERVER_URL;
  const app = await electron.launch({ args: [path.resolve('tests/tour/electron-bootstrap.cjs'), '--wpa-smoke'], env });
  try {
    await app.evaluate(({ dialog }, directory) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] }); }, directory);
    const page = await app.firstWindow();
    await page.locator('nav').waitFor();
    await page.keyboard.press('Escape');
    if (await page.getByTestId('music-dialog-close').isVisible()) await page.getByTestId('music-dialog-close').click();
    else await page.getByTestId('background-music-toggle').click();
    await page.getByTestId('music-source-local').click();
    await page.getByTestId('background-music-menu').getByRole('button', { name: /Choose Folder/ }).click();
    await page.getByRole('button', { name: /^local-test\.wav/ }).click();
    const audio = page.getByTestId('background-music-audio');
    await expect.poll(() => audio.evaluate(el => el.currentTime)).toBeGreaterThan(2);
    expect(await audio.evaluate(el => el.error)).toBeNull();
    await page.getByTestId('background-music-play-pause').click();
    expect(await audio.evaluate(el => el.paused)).toBe(true);
    await page.getByTestId('background-music-play-pause').click();
    await expect.poll(() => audio.evaluate(el => el.paused)).toBe(false);
    await page.getByTestId('background-music-stop').click();
    expect(await audio.evaluate(el => el.paused)).toBe(true);
    expect(await audio.evaluate(el => el.currentTime)).toBe(0);
  } finally {
    await app.evaluate(({ app }) => { setTimeout(() => app.exit(0), 0); }).catch(() => {});
    await app.close().catch(() => {});
  }
});
