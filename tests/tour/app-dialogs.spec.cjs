const { test, expect } = require('@playwright/test');
const { closeWorkspace } = require('./workspace-test-utils.cjs');

test('themed dialogs handle close cancellation, queued alerts and save/discard choices', async ({}, info) => {
  const path = require('node:path');
  const { _electron: electron } = require('@playwright/test');
  const env = { ...process.env, WPA_TEST_PROFILE: info.outputPath('profile'), VITE_DEV_SERVER_URL: 'http://127.0.0.1:5199' };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: [path.resolve('tests/tour/electron-bootstrap.cjs')], cwd: process.cwd(), env });
  const page = await app.firstWindow();
  page.on('pageerror', e => console.log('PAGE ERROR:', e.message));
  page.on('console', m => { if (m.type() === 'error') console.log('CONSOLE:', m.text()); });
  page.setDefaultTimeout(10000);
  try {
    await page.waitForFunction(() => !!window.__tourTest, {}, { timeout: 25000 }).catch(async e => { console.log('URL:', page.url(), (await page.locator('body').innerText()).slice(0, 1000)); throw e; });
    await expect(page.locator('[data-app-shell]')).toBeVisible({ timeout: 25000 });
    await page.evaluate(() => window.__tourTest.language('tr'));
    // Fail immediately if a healthy renderer opens an OS message box.
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => { throw new Error('Unexpected native message box'); }; });
    const prompt = page.locator('.app-choice-dialog');
    await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0]; w.close(); w.close();
    });
    await expect(prompt).toBeVisible();
    await expect(prompt.getByRole('heading')).toHaveText('Çıkmak istediğinize emin misiniz?');
    await expect(prompt).toHaveCount(1);
    await page.screenshot({ path: info.outputPath('quit-dialog.png') });
    await page.keyboard.press('Escape');
    await expect(prompt).toHaveCount(0);
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
    await page.evaluate(async () => {
      const { confirmDialog, alertDialog } = await import('/src/renderer/dialogs.ts');
      window.confirmResult = 'pending';
      void confirmDialog('Silinsin mi?', { detail: 'Bu işlem geri alınamaz.' }).then(value => { window.confirmResult = value; });
      void alertDialog('İşlem tamamlandı', { detail: 'Sunum kaydedildi.' });
    });
    await expect(prompt.getByRole('heading')).toHaveText('Silinsin mi?');
    await prompt.getByRole('button', { name: 'Onayla', exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.confirmResult)).toBe(true);
    await expect(prompt.getByRole('heading')).toHaveText('İşlem tamamlandı');
    await page.keyboard.press('Escape');
    await expect(prompt).toHaveCount(0);
    await page.evaluate(() => {
      window.replaceResult = 'pending';
      void window.electronAPI.desktopReplaceChoice().then(value => { window.replaceResult = value; });
    });
    await expect(prompt.getByRole('heading')).toHaveText('Değişiklikler kaydedilsin mi?');
    await prompt.getByRole('button', { name: 'İptal', exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.replaceResult)).toBe('cancel');
    for (const [width, height] of [[800, 600], [1366, 768]]) {
      await app.evaluate(({ BrowserWindow }, size) => { const w = BrowserWindow.getAllWindows()[0]; w.unmaximize(); w.setContentSize(...size); }, [width, height]);
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
      await expect(prompt).toBeVisible();
      const bounds = await prompt.evaluate(el => { const r = el.getBoundingClientRect(); return { fits: r.x >= 15 && r.y >= 15 && r.right <= innerWidth - 15 && r.bottom <= innerHeight - 15, overflow: el.scrollWidth > el.clientWidth }; });
      expect(bounds).toEqual({ fits: true, overflow: false });
      await page.keyboard.press('Escape');
    }
    // A forged choice cannot authorize shutdown.
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    await expect(prompt).toBeVisible();
    await page.evaluate(() => window.electronAPI.respondAppDialog('unknown', 'quit'));
    await expect(prompt).toBeVisible();
    await prompt.getByRole('button', { name: 'Evet, Çık', exact: true }).click();
    await expect.poll(() => app.windows().length).toBe(0);
  } finally { await closeWorkspace(app); }
});
