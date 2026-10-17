/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS Electron fixture. */
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
let profile, app, page;
let processLog = [];
async function launch() {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ args: [path.resolve('tests/tour/electron-bootstrap.cjs')],
    env: { ...env, WPA_TEST_PROFILE: profile,
      VITE_DEV_SERVER_URL: 'http://127.0.0.1:5199/' } });
  app.process().stdout?.on('data', data => processLog.push(String(data)));
  app.process().stderr?.on('data', data => processLog.push(String(data)));
  await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false }); });
  page = await app.firstWindow();
  page.on('pageerror', error => { processLog.push('Renderer error: ' + error.message); console.log('Renderer error:', error.message); });
  page.on('console', message => processLog.push('Renderer: ' + message.text()));
  await page.context().tracing.start({ screenshots: true, snapshots: true });
  await page.waitForFunction(() => !!window.__tourTest);
  await expect.poll(() => page.evaluate(() => Object.keys(window.__tourTest.tour.getState().ready).length)).toBe(4);

  await page.evaluate(() => window.__tourTest.language('en'));
}
test.beforeEach(async () => { processLog = []; profile = await fs.mkdtemp(path.join(os.tmpdir(), 'wpa-tour-e2e-')); });
// eslint-disable-next-line no-empty-pattern -- Only testInfo is used.
test.afterEach(async ({}, info) => {
  if (page && !page.isClosed() && info.status !== info.expectedStatus) {
    await page.screenshot({ path: info.outputPath('failure.png') }).catch(() => {});
  }
  if (page && !page.isClosed()) await page.context().tracing.stop({ path: info.outputPath('trace.zip') }).catch(() => {});
  if (info.status !== info.expectedStatus) { await fs.mkdir(info.outputDir, { recursive: true }); await fs.writeFile(info.outputPath('electron.log'), processLog.join('')); }
  if (app) await app.close();
  app = page = undefined;
  // Only remove the exact directory returned by mkdtemp, after Electron exits.
  if (profile && path.dirname(profile) === os.tmpdir() && path.basename(profile).startsWith('wpa-tour-e2e-'))
    await fs.rm(profile, { recursive: true, force: true, maxRetries: 4 });
});
async function existingProfile() {
  await fs.mkdir(path.join(profile, 'Local Storage'));
  await launch();
}
test('normal help: one learning entry, no automatic surfaces, keyboard reference launches practice', async()=>{
  await launch(); await page.keyboard.press('Alt+9'); await require('./guide-flow.cjs').openLearning(page);
  await expect(page.getByTestId('practice-open')).toBeVisible();
  for(const id of ['tour-map-open','tour-map','tour-card','page-suggestion'])await expect(page.getByTestId(id)).toHaveCount(0);
  await expect(page.locator('[data-testid^="intro-settings-"]')).toHaveCount(0);
  await app.evaluate(({ipcMain})=>{ipcMain.removeHandler('practice:open');ipcMain.handle('practice:open',()=>{global.__openedPractice=(global.__openedPractice??0)+1;return {ok:true};});});
  await page.getByTestId('practice-open').click();expect(await app.evaluate(()=>global.__openedPractice)).toBe(1);
  await page.keyboard.press('?');await expect(page.getByTestId('cheatsheet-practice')).toBeVisible();
  await page.getByTestId('cheatsheet-practice').click();expect(await app.evaluate(()=>global.__openedPractice)).toBe(2);
  await expect(page.getByTestId('cheatsheet-practice')).toHaveCount(0);
  await page.reload();await page.locator('[data-app-shell] > nav').waitFor();
  await expect(page.getByTestId('tour-map')).toHaveCount(0);await expect(page.getByTestId('page-suggestion')).toHaveCount(0);
});

test('guide spike: Joyride interactive targets, portal, inert lease and cleanup', async () => {
  await existingProfile();
  await page.evaluate(() => {
    const button = document.createElement('button'); button.dataset.spikeTarget = ''; button.textContent = 'Portal action';
    Object.assign(button.style, { position: 'fixed', top: '160px', left: '320px', zIndex: '10' });
    button.onclick = () => { window.__spikeClicks = (window.__spikeClicks || 0) + 1; }; document.body.appendChild(button);
    const other = document.createElement('div'); other.dataset.preexistingInert = ''; other.inert = true; document.body.appendChild(other);
  });
  for (const useInert of [false, true]) {
    await page.evaluate(async useInert => { const module = await import('/tests/tour/guide-spike.tsx'); window.__unmountSpike = module.mount(useInert); }, useInert);
    const card = page.locator('[data-guide-card]'); await expect(card).toBeVisible();
    await page.getByRole('button', { name: 'Slides', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Slides', exact: true })).toHaveAttribute('aria-current', 'page');
    const before = await page.evaluate(() => window.__tourTest.snapshot());
    await page.keyboard.press('Alt+3'); await page.keyboard.press('Delete');
    expect(await page.evaluate(() => window.__tourTest.snapshot())).toBe(before);
    expect(await page.getByRole('button', { name: 'Bible', exact: true }).evaluate(el => !!el.closest('[inert]'))).toBe(useInert);
    await card.getByRole('button', { name: 'Next target' }).focus(); await page.keyboard.press('Enter');
    const action = page.locator('[data-spike-target]'); await action.click(); await action.focus(); await page.keyboard.press('Space');
    await expect.poll(() => page.evaluate(() => window.__spikeClicks)).toBe(useInert ? 4 : 2);
    await page.keyboard.press('Tab'); expect(await page.evaluate(() => !!document.activeElement.closest('[data-practice-portal]'))).toBe(true);
    await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.unmaximize(); w.setSize(800, 600); });
    await expect.poll(() => card.evaluate(el => { const r = el.getBoundingClientRect(); return r.x >= 0 && r.y >= 0 && r.right <= innerWidth && r.bottom <= innerHeight; })).toBe(true);
    if (useInert) await page.evaluate(() => document.querySelector('[data-spike-target]').remove());
    else await page.keyboard.press('Escape');
    await expect(card).toHaveCount(0);
    await page.evaluate(() => window.__unmountSpike());
    await expect(page.locator('[data-app-shell]')).not.toHaveAttribute('inert');
    expect(await page.locator('nav [inert]').count()).toBe(0);
    await expect(page.locator('[data-preexisting-inert]')).toHaveAttribute('inert', '');
  }
});


test('guide spike: renderer loss restores usable document without inherited inert', async () => {
  await existingProfile();
  await page.evaluate(async () => { const module = await import('/tests/tour/guide-spike.tsx'); module.mount(true); });
  await expect(page.locator('[data-guide-card]')).toBeVisible();
  await app.evaluate(async ({ BrowserWindow }) => { const contents = BrowserWindow.getAllWindows()[0].webContents; await new Promise(resolve => { contents.once('render-process-gone', resolve); contents.forcefullyCrashRenderer(); }); });
  await app.close(); app = page = undefined; await launch();
  await expect(page.locator('[data-app-shell] > nav')).toBeVisible();
  await expect(page.locator('[data-app-shell]')).not.toHaveAttribute('inert');
  await page.getByRole('button', { name: 'Slides', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Slides', exact: true })).toHaveAttribute('aria-current', 'page');
});
