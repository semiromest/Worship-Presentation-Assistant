const { _electron: electron, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { build } = require('esbuild');
const sharp = require('sharp');
const root = path.resolve('.tmp/gradient-electron-check');
console.log('Gradient integration script starting');
async function launch(entry, args = []) {
  const env = {
    ...process.env,
    APPDATA: path.join(root, crypto.randomUUID(), 'appdata'),
    LOCALAPPDATA: path.join(root, crypto.randomUUID(), 'local'),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.VITE_DEV_SERVER_URL;
  console.log('Launching', entry);
  const launched = await electron.launch({ args: [entry, ...args], env, timeout: 30000 });
  console.log('Launched');
  launched.process().stderr?.on('data', (d) => process.stderr.write(d));
  return launched;
}
async function invoke(app, channel, args = []) {
  return app.evaluate(
    async ({ ipcMain, BrowserWindow }, { channel, args }) => {
      const wc = BrowserWindow.getAllWindows()[0].webContents;
      return ipcMain._invokeHandlers.get(channel)({ sender: wc, senderFrame: wc.mainFrame }, ...args);
    },
    { channel, args }
  );
}
async function main() {
  await fs.mkdir(root, { recursive: true });
  const input = path.resolve('tests/gradient/harness.tsx').replaceAll('\\', '/');
  const bundle = await build({
    stdin: {
      contents: `import {mount} from ${JSON.stringify(input)};window.mountGradient=mount;`,
      resolveDir: process.cwd(),
      loader: 'tsx',
    },
    bundle: true,
    format: 'iife',
    write: false,
    define: { 'import.meta.env.DEV': 'false' },
  });
  console.log('Harness built');
  const css = await fs.readFile(
    path.join(
      'dist/assets',
      (await fs.readdir('dist/assets')).find((n) => n.startsWith('index-') && n.endsWith('.css'))
    ),
    'utf8'
  );
  const ordinary = await sharp({ create: { width: 1920, height: 1080, channels: 3, background: '#1b603b' } })
    .jpeg()
    .toBuffer();
  const ordinaryUrl = `data:image/jpeg;base64,${ordinary.toString('base64')}`;
  const group = { id: 'g', title: 'Mezmur', part: 1, parts: 2 };
  const deck = {
    id: 'gradient-fixture',
    name: 'Gradient fixture',
    zoom: 1,
    slides: [
      {
        id: 'a',
        type: 'text',
        content: 'Rab çobanımdır;\neksiğim olmaz.\nMezmur 23:1',
        group,
        styles: { fontSize: 82, textColor: '#ffffff', backgroundColor: '#000000' },
      },
      {
        id: 'b',
        type: 'text',
        content: 'Sana ilahiler söylerim',
        partsMode: true,
        parts: ['Sana ilahiler söylerim', 'Seni yüceltirim'],
        activePart: 0,
        group: { ...group, part: 2 },
        styles: { fontSize: 82, textColor: '#ffffff', backgroundColor: '#000000' },
      },
      {
        id: 'c',
        type: 'text',
        content: 'Normal JPEG',
        styles: { fontSize: 70, textColor: '#fff', backgroundColor: '#000', backgroundImage: ordinaryUrl },
        items: [
          {
            id: 't',
            type: 'text',
            x: 10,
            y: 20,
            width: 80,
            height: 60,
            zIndex: 1,
            content: 'Normal JPEG',
            styles: {},
            textStyles: { fontSize: 70, textColor: '#fff', textDecoration: 'none' },
          },
        ],
      },
    ],
  };
  const results = [];
  let saved;
  for (const advanced of [false, true]) {
    console.log('Testing', advanced ? 'advanced' : 'simple');
    const app = await launch(path.resolve('dist-electron/main.js'), ['--wpa-smoke']);
    try {
      const page = await app.firstWindow({ timeout: 30000 });
      console.log('Window ready');
      await page.waitForLoadState('domcontentloaded');
      await page.addStyleTag({ content: css });
      await page.addScriptTag({ content: bundle.outputFiles[0].text });
      await page.evaluate(({ deck, advanced }) => window.mountGradient(deck, advanced), { deck, advanced });
      await expect(page.getByRole('button', { name: 'Create gradient', exact: true })).toBeVisible();
      const bg = await page
        .getByTestId('regression-item-background')
        .locator('[style*="background-image"]')
        .first()
        .evaluate((el) => getComputedStyle(el).backgroundImage);
      expect(bg).toContain('data:image/jpeg');
      await page.getByRole('button', { name: 'Create gradient', exact: true }).click();
      await expect(page.getByText(/Minimum contrast:/)).toBeVisible({ timeout: 30000 });
      const mediaDir = path.join(await app.evaluate(({ app }) => app.getPath('userData')), 'media');
      const before = await fs.readdir(mediaDir).catch(() => []);
      expect(before).toHaveLength(0);
      const apply = page.getByRole('button', { name: 'Apply (2 slides)', exact: true });
      await expect(apply).toBeEnabled();
      const image = await page
        .getByTestId('gradient-preview')
        .locator('[style*="background-image"]')
        .first()
        .evaluate((el) => el.style.backgroundImage);
      await page.screenshot({ path: path.join(root, `panel-${advanced ? 'advanced' : 'simple'}.png`) });
      await apply.click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      const applied = await page.evaluate(() => window.gradientHarness.read());
      expect(applied.slides[0].styles.backgroundImage).toBe(applied.slides[1].styles.backgroundImage);
      expect(applied.slides[1].partsMode).toBe(true);
      expect(applied.slides[0].items).toBeUndefined();
      expect(await page.evaluate(() => window.gradientHarness.past)).toBe(1);
      const file = path.join(mediaDir, applied.slides[0].styles.backgroundImage.split('/').pop());
      const bytes = await fs.readFile(file);
      const previewBytes = Buffer.from(image.match(/base64,([^"')]+)/)[1], 'base64');
      expect(bytes.equals(previewBytes)).toBe(true);
      expect((await sharp(bytes).metadata()).width).toBe(1920);
      const hash = crypto.createHash('sha256').update(bytes).digest('hex');
      await page.evaluate(() => window.gradientHarness.undo());
      await expect
        .poll(() => page.evaluate(() => window.gradientHarness.read().slides[0].styles.backgroundImage ?? null))
        .toBe(null);
      // Saving invokes the application's real .gpres pipeline with an isolated dialog destination.
      const output = path.join(root, advanced ? 'advanced.gpres' : 'simple.gpres');
      await app.evaluate(({ dialog }, output) => {
        dialog.showSaveDialog = async () => ({ filePath: output, canceled: false });
      }, output);
      await invoke(app, 'save-file', [JSON.stringify(applied)]);
      saved = output;
      results.push({
        advanced,
        previewSavedHash: hash,
        groupAndPartsPreserved: true,
        singleUndo: true,
        draftFiles: before.length,
        bytes: bytes.length,
      });
      // Cancel never writes a second asset.
      await page.getByRole('button', { name: 'Create gradient', exact: true }).click();
      await expect(page.getByText(/Minimum contrast:/)).toBeVisible({ timeout: 30000 });
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      expect((await fs.readdir(mediaDir)).length).toBe(1);
    } catch (error) {
      console.error('Integration failure', error);
      throw error;
    } finally {
      await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
      await app.close().catch(() => {});
    }
  }
  await fs.writeFile(
    path.join(root, 'results.json'),
    JSON.stringify({ platform: process.platform, arch: process.arch, results, fixture: saved }, null, 2)
  );
  console.log(JSON.stringify(results, null, 2));
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
