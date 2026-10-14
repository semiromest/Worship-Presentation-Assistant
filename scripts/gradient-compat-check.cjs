const { _electron: electron, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const AdmZip = require('adm-zip');
const root = path.resolve('.tmp/gradient-compat');
async function run(label, entry, packaged) {
  const profile = path.join(root, label);
  await fs.mkdir(profile, { recursive: true });
  const env = { ...process.env, APPDATA: path.join(profile, 'appdata'), LOCALAPPDATA: path.join(profile, 'local') };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.VITE_DEV_SERVER_URL;
  const app = await electron.launch({
    ...(packaged ? { executablePath: entry, args: ['--wpa-smoke'] } : { args: [entry, '--wpa-smoke'] }),
    env,
    timeout: 60000,
  });
  try {
    const page = await app.firstWindow({ timeout: 30000 });
    await page.waitForLoadState('domcontentloaded');
    page.on('pageerror', (e) => console.log(label, 'page error', e.message));
    await page.evaluate(() => localStorage.setItem('i18nextLng', 'en'));
    await page.reload();
    await page.keyboard.press('Escape');
    const fixture = path.resolve('.tmp/gradient-electron-check/advanced.gpres'),
      output = path.join(profile, `resaved-${crypto.randomUUID()}.gpres`);
    await app.evaluate(
      ({ dialog }, { fixture, output }) => {
        dialog.showOpenDialog = async () => ({ filePaths: [fixture], canceled: false });
        dialog.showSaveDialog = async () => ({ filePath: output, canceled: false });
        dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
      },
      { fixture, output }
    );
    await page.locator('nav').getByText('Presentations', { exact: true }).click();
    await page.getByRole('button', { name: 'Open from File', exact: true }).click();
    await expect(page.getByText('advanced', { exact: true }).first()).toBeVisible({ timeout: 30000 });
    await page.locator('nav').getByText('Presentations', { exact: true }).click();
    const tools = page.locator('summary').filter({ hasText: 'File & PowerPoint tools' });
    if (await tools.count()) await tools.click();
    await page.getByRole('button', { name: 'Save as File', exact: true }).click();
    await expect
      .poll(
        async () =>
          fs.access(output).then(
            () => true,
            () => false
          ),
        { timeout: 30000 }
      )
      .toBe(true);
    const inputZip = new AdmZip(await fs.readFile(fixture)),
      outputZip = new AdmZip(await fs.readFile(output));
    const before = JSON.parse(inputZip.readAsText('presentation.json')),
      after = JSON.parse(outputZip.readAsText('presentation.json'));
    expect(after.slides.length).toBe(before.slides.length);
    for (let i = 0; i < before.slides.length; i++) {
      const a = before.slides[i],
        b = after.slides[i];
      for (const key of ['content', 'group', 'parts']) expect(b[key]).toEqual(a[key]);
      expect(!!b.partsMode).toBe(!!a.partsMode);
      expect(b.activePart ?? 0).toBe(a.activePart ?? 0);
      expect(b.styles.generatedBackground).toEqual(a.styles.generatedBackground);
      const src = a.styles.backgroundImage,
        dst = b.styles.backgroundImage;
      const read = (zip, ref) =>
        ref.startsWith('data:') ? Buffer.from(ref.split(',')[1], 'base64') : zip.readFile(ref);
      expect(read(outputZip, dst).equals(read(inputZip, src))).toBe(true);
      expect(b.styles.generatedGroupBackground?.recipe).toEqual(a.styles.generatedGroupBackground?.recipe);
    }
    await page.screenshot({ path: path.join(profile, 'resaved.png') });
    return { version: label, uiOpenSave: true, preservesTextGroupsPartsRecipesAndJpeg: true, file: output };
  } catch (e) {
    await (await app.firstWindow()).screenshot({ path: path.join(profile, 'failure.png') }).catch(() => {});
    throw e;
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
    await app.close().catch(() => {});
  }
}
async function main() {
  await fs.mkdir(root, { recursive: true });
  const results = [];
  for (const [label, entry, packaged] of [
    ['1.4.17', path.resolve('.tmp/gradient-baseline-source/dist-electron/main.js'), false],
    ['1.4.13', path.resolve('release/1.4.13/win-unpacked/Worship Presentation Assistant.exe'), true],
  ]) {
    console.log('Compatibility', label);
    results.push(await run(label, entry, packaged));
  }
  await fs.writeFile(path.join(root, 'results.json'), JSON.stringify({ platform: process.platform, results }, null, 2));
  console.log(JSON.stringify(results, null, 2));
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
