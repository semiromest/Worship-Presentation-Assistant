const { _electron: electron, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const sharp = require('sharp');
const root = path.resolve('.tmp/gradient-runtime');
const recipe = {
  engineVersion: 1,
  seed: 20261014,
  colors: ['#071b38', '#135d86', '#348b9c', '#62609b'],
  palette: 'ocean',
  style: 'flow',
  darkness: 25,
  width: 1920,
  height: 1080,
};
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
  const results = [];
  const executable = process.env.WPA_GRADIENT_EXE;
  for (const scale of [1, 1.5, 2])
    for (const gpu of [true, false]) {
      const env = {
        ...process.env,
        APPDATA: path.join(root, crypto.randomUUID(), 'appdata'),
        LOCALAPPDATA: path.join(root, crypto.randomUUID(), 'local'),
      };
      delete env.ELECTRON_RUN_AS_NODE;
      delete env.VITE_DEV_SERVER_URL;
      const args = ['--wpa-smoke', `--force-device-scale-factor=${scale}`, ...(gpu ? [] : ['--disable-gpu'])];
      const app = await electron.launch({
        ...(executable
          ? { executablePath: path.resolve(executable), args }
          : { args: [path.resolve('dist-electron/main.js'), ...args] }),
        env,
        timeout: 60000,
      });
      try {
        await app.firstWindow({ timeout: 30000 });
        const result = await invoke(app, 'gradient:generate', [recipe, []]);
        const bytes = Buffer.from(result.image.split(',')[1], 'base64'),
          meta = await sharp(bytes).metadata();
        expect(result.hash).toBe('a5cc70a233b70a02524ef44ce1d89c0b5d5879fdb4e00c57c1a699656ae236e3');
        expect(meta.width).toBe(1920);
        expect(meta.height).toBe(1080);
        await invoke(app, 'gradient:discard');
        await expect(invoke(app, 'gradient:save', [result.token])).rejects.toThrow();
        const profile = await app.evaluate(({ app }) => app.getPath('userData'));
        expect(await fs.readdir(path.join(profile, 'media')).catch(() => [])).toHaveLength(0);
        if (scale === 1 && gpu) {
          const outcomes = await Promise.allSettled([
            invoke(app, 'gradient:generate', [recipe, []]),
            invoke(app, 'gradient:generate', [{ ...recipe, seed: 2 }, []]),
          ]);
          expect(outcomes[0].status).toBe('rejected');
          expect(outcomes[1].status).toBe('fulfilled');
          await invoke(app, 'gradient:discard');
        }
        results.push({
          scaleEmulated: scale,
          gpuEnabled: gpu,
          packaged: !!executable,
          width: meta.width,
          height: meta.height,
          jpegHash: result.hash,
          discardLeavesNoMedia: true,
        });
      } finally {
        await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
        await app.close().catch(() => {});
      }
    }
  await fs.writeFile(
    path.join(root, 'results.json'),
    JSON.stringify(
      {
        platform: process.platform,
        arch: process.arch,
        note: 'Forced Chromium scaling; physical Windows scaling and old GPU hardware not tested.',
        results,
      },
      null,
      2
    )
  );
  console.log(JSON.stringify(results, null, 2));
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
