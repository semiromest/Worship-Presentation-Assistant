/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS Electron fixture. */
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
let root, app, page;
test.beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'wpa-guide-e2e-'));
  const env = { ...process.env, WPA_TEST_PROFILE: path.join(root, 'normal'), VITE_DEV_SERVER_URL: 'http://127.0.0.1:5199/' };
  delete env.ELECTRON_RUN_AS_NODE; delete env.WPA_SMOKE_SESSION;
  app = await electron.launch({ args: [path.resolve('tests/tour/electron-bootstrap.cjs'), '--wpa-practice'], env });
  require('./teardown.cjs').trackElectron(app);
  await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false }); });
  page = await app.firstWindow();
  page.on('pageerror', error => console.log('Renderer:', error.message));
  await page.waitForFunction(() => !!window.__tourTest);
  await page.evaluate(() => window.__tourTest.language('en'));
  await require('./guide-flow.cjs').waitForPractice(page,'welcome');
  await expect(page.getByTestId('guide-resume')).toBeVisible();
});
// eslint-disable-next-line no-empty-pattern -- Playwright requires destructured fixture arguments; no browser page is requested.
test.afterEach(async ({}, info) => {
  if (page && !page.isClosed() && info.status !== info.expectedStatus) await page.screenshot({ path: info.outputPath('failure.png') }).catch(() => {});
  if (app) await require('./teardown.cjs').closeElectron(app);
  if (root && path.dirname(root) === os.tmpdir() && path.basename(root).startsWith('wpa-guide-e2e-')) await fs.rm(root, { recursive: true, force: true, maxRetries: 4 });
});
async function chapter(name){
  await expect(page.getByTestId('guide-close')).toBeEnabled();
  if(await page.getByTestId('guide-pause').count())await page.getByTestId('guide-pause').click();
  await expect(page.getByTestId('guide-resume')).toBeEnabled();
  await page.locator('summary').filter({hasText:'Go to section'}).click();
  await page.getByTestId('guide-chapter-'+name).click();
  await expect(page.getByTestId('guide-resume')).toBeVisible();await page.getByTestId('guide-resume').click();
}
const { seeResult, finishReorder } = require('./guide-flow.cjs');
const step = id => expect(page.locator('[data-guide-step]')).toHaveAttribute('data-guide-step', id);
async function reachAdd() {
  await page.getByTestId('guide-resume').click(); await step('presentations');
  await page.getByTestId('guide-next').click(); await step('sidebar');
  await page.getByTestId('guide-next').click(); await step('nav-slides');
  await page.getByRole('button', { name: 'Slides', exact: true }).click(); await step('add');
}
test('guided startup language, paused chapter chooser and archived fresh restart',async()=>{
  for(const language of ['tr','de','es','ko','en']){
    await page.getByTestId('guide-language').selectOption(language);
    expect(await page.evaluate(()=>localStorage.getItem('i18nextLng'))).toBe(language);
    await expect(page.getByTestId('guide-resume')).toBeVisible();
    await expect(page.locator('[data-guide-card]')).not.toContainText('guide.');
  }
  const before=await page.evaluate(()=>window.electronAPI.readPracticeWorkspace(null));
  for(const name of ['presentations','slides','bible','media','hymns','countdown','screen','calendar','editor','settings']){
    await page.locator('summary').filter({hasText:'Go to section'}).click();
    await page.getByTestId('guide-chapter-'+name).click();
    await expect(page.getByRole('button',{name:name==='bible'?'Bible':name[0].toUpperCase()+name.slice(1),exact:true})).toHaveAttribute('aria-current','page');
    expect((await page.evaluate(()=>window.electronAPI.readPracticeWorkspace(null))).guide.paused).toBe(true);
  }
  const archived=await page.evaluate(()=>window.electronAPI.readPracticeWorkspace(null));
  expect(archived.deck.slides.some(slide=>slide.items?.some(item=>item.id.startsWith('practice-editor-')))).toBe(true);
  await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:0});});
  await page.getByTestId('guide-restart').click();expect((await page.evaluate(()=>window.electronAPI.readPracticeWorkspace(null))).runId).toBe(before.runId);
  await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:1});});
  await page.getByTestId('guide-restart').click();await step('welcome');
  const after=await page.evaluate(()=>window.electronAPI.readPracticeWorkspace(null));expect(after.runId).not.toBe(before.runId);expect(after.deck.slides).toEqual([]);
  const profile=await app.evaluate(({app})=>app.getPath('userData'));const archives=await fs.readdir(path.join(profile,'practice-archives'));
  expect(archives).toHaveLength(1);expect(JSON.parse(await fs.readFile(path.join(profile,'practice-archives',archives[0]),'utf8')).workspace.deck).toEqual(archived.deck);
  await page.getByTestId('guide-language').selectOption('tr');await page.reload();await expect(page.getByTestId('guide-language')).toHaveValue('tr');
});
test('guided save failure keeps window open; native X saves paused edits and closes practice',async()=>{
  await reachAdd();
  await app.evaluate(({ipcMain})=>{
    const original=ipcMain._invokeHandlers.get('practice:guide');global.__guideOriginal=original;ipcMain.removeHandler('practice:guide');
    ipcMain.handle('practice:guide',(...args)=>{if(args[3]==='pause')throw new Error('Injected save failure');return original(...args);});
  });
  await page.getByTestId('guide-close').click();await expect(page.getByRole('alert')).toBeVisible();expect(page.isClosed()).toBe(false);
  await expect(page.locator('[data-practice-portal]')).toHaveCount(0);
  await app.evaluate(({ipcMain})=>{ipcMain.removeHandler('practice:guide');ipcMain.handle('practice:guide',global.__guideOriginal);});
  const profile=await app.evaluate(({app})=>app.getPath('userData'));
  await page.evaluate(async()=>{(await import('/src/renderer/state/useStore.ts')).useStore.getState().setPresentationName('Saved on X');});
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close());
  await expect.poll(()=>page.isClosed()).toBe(true);
  const saved=JSON.parse(await fs.readFile(path.join(profile,'practice-workspace.json'),'utf8'));expect(saved.guide.paused).toBe(true);expect(saved.deck.name).toBe('Saved on X');
});
test('guided delayed observe preserves edits made after its deck snapshot',async()=>{
  await reachAdd();
  await app.evaluate(({ipcMain})=>{
    const original=ipcMain._invokeHandlers.get('practice:guide');ipcMain.removeHandler('practice:guide');
    ipcMain.handle('practice:guide',async(...args)=>{if(args[3]==='observe'&&args[2]==='add')await new Promise(resolve=>setTimeout(resolve,500));return original(...args);});
  });
  await page.getByRole('button',{name:'Add New Slide',exact:true}).click();
  await page.evaluate(async()=>{(await import('/src/renderer/state/useStore.ts')).useStore.getState().setPresentationName('Later edit');});
  await step('add-result');await page.getByTestId('guide-pause').click();
  expect((await page.evaluate(()=>window.electronAPI.readPracticeWorkspace(null))).deck.name).toBe('Later edit');
});
test('guided native close before renderer initialization waits for the saved workspace',async()=>{
  await reachAdd();const profile=await app.evaluate(({app})=>app.getPath('userData'));
  await app.evaluate(({ipcMain})=>{const read=ipcMain._invokeHandlers.get('practice:workspace:read');ipcMain.removeHandler('practice:workspace:read');ipcMain.handle('practice:workspace:read',async(...args)=>{await new Promise(resolve=>setTimeout(resolve,1000));return read(...args);});});
  await page.reload({waitUntil:'domcontentloaded'});
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close());
  await expect.poll(()=>page.isClosed()).toBe(true);
  const saved=JSON.parse(await fs.readFile(path.join(profile,'practice-workspace.json'),'utf8'));expect(saved.guide.step).toBe('add');expect(saved.guide.paused).toBe(true);
});
test('guided startup pause failure retains the loaded run for a saved close retry',async()=>{
  await reachAdd();const old=await page.evaluate(()=>window.electronAPI.readPracticeWorkspace(null));
  await app.evaluate(({ipcMain})=>{const guide=ipcMain._invokeHandlers.get('practice:guide');ipcMain.removeHandler('practice:guide');let fail=true;ipcMain.handle('practice:guide',(...args)=>{if(args[3]==='pause'&&fail){fail=false;throw new Error('Recovery pause failed');}return guide(...args);});});
  const recovery=app.waitForEvent('window');await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.forcefullyCrashRenderer());page=await recovery;
  await page.waitForFunction(()=>!!window.__tourTest);
  await expect(page.locator('[data-guide-step]')).toHaveAttribute('data-guide-step',old.guide.step,{timeout:15000});
  await expect(page.getByRole('alert')).toBeVisible();const profile=await app.evaluate(({app})=>app.getPath('userData'));
  await page.getByTestId('guide-close').click();await expect.poll(()=>page.isClosed()).toBe(true);
  const saved=JSON.parse(await fs.readFile(path.join(profile,'practice-workspace.json'),'utf8'));expect(saved.deck.id).toBe(old.deck.id);expect(saved.guide.paused).toBe(true);
});

test('guided teardown reports blocked persistence and terminates only its test process',async()=>{
  await reachAdd(); const child=app.process();
  await app.evaluate(({ipcMain})=>{
    const guide=ipcMain._invokeHandlers.get('practice:guide'); ipcMain.removeHandler('practice:guide');
    ipcMain.handle('practice:guide',(...args)=>{if(args[3]==='pause')throw new Error('Teardown persistence blocked');return guide(...args);});
  });
  await expect(require('./teardown.cjs').closeElectron(app,{graceMs:1000,killMs:2000})).rejects.toThrow('did not acknowledge graceful teardown');
  await expect.poll(()=>child.exitCode!==null || child.signalCode!==null).toBe(true);
});
test('guided first two sections: StrictMode, real results, keys, focus and five languages', async () => {
  await reachAdd(); await expect(page.getByTestId('guide-next')).toHaveCount(0);
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.unmaximize(); w.setSize(800, 600); });
  for (const lang of ['tr','de','es','ko','en']) {
    await page.evaluate(lang => window.__tourTest.language(lang), lang);
    await expect(page.locator('[data-guide-card]')).not.toContainText('guide.');
    await expect.poll(() => page.locator('[data-guide-card]').evaluate(el => { const r = el.getBoundingClientRect(); return r.x >= 0 && r.y >= 0 && r.bottom <= innerHeight && r.right <= innerWidth; })).toBe(true);
    await expect.poll(() => page.locator('[data-guide-card]').evaluate(el => { const a=el.getBoundingClientRect(),b=document.querySelector('[data-guide-anchor="add-slide"]').getBoundingClientRect(); return a.right<=b.left || a.left>=b.right || a.bottom<=b.top || a.top>=b.bottom; })).toBe(true);
  }
  const before = await page.evaluate(() => window.__tourTest.snapshot());
  await expect.poll(() => page.locator('[data-guide-card]').evaluate(el => { const a = el.getBoundingClientRect(), b = document.querySelector('[data-guide-anchor="add-slide"]').getBoundingClientRect(); return a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom; })).toBe(true);
  for (const key of ['Alt+3','Delete','Control+z','m']) await page.keyboard.press(key);
  expect(await page.evaluate(() => window.__tourTest.snapshot())).toBe(before);
  const add = page.getByRole('button', { name: 'Add New Slide', exact: true });
  await add.focus(); await page.keyboard.press('Enter'); await seeResult(page,'add-result'); await finishReorder(page); await step('select');
  const value = await page.evaluate(() => window.electronAPI.readPracticeWorkspace(null));
  await page.keyboard.press('Escape'); await expect(page.getByTestId('guide-resume')).toBeVisible();
  await expect(page.locator('[data-app-shell]')).not.toHaveAttribute('inert');
  await page.getByTestId('guide-resume').click(); await step('select');
  const sample = page.locator('[data-slide-id="' + value.active.target + '"]');
  await expect.poll(() => sample.evaluate(el => !el.closest('[inert]'))).toBe(true);
  await sample.focus(); await expect(sample).toBeFocused(); await page.keyboard.press('Space'); await step('delete');
  await page.keyboard.press('Escape'); await expect(page.getByTestId('guide-resume')).toBeEnabled();
  await app.evaluate(({ ipcMain }) => {
    const original = ipcMain._invokeHandlers.get('practice:guide'); ipcMain.removeHandler('practice:guide');
    ipcMain.handle('practice:guide', async (...args) => { if (args[3] === 'resume') await new Promise(resolve => setTimeout(resolve, 1000)); return original(...args); });
  });
  await page.getByTestId('guide-resume').click(); await page.keyboard.press('Delete');
  await page.keyboard.press('Escape'); await expect(page.getByTestId('guide-resume')).toBeVisible();
  expect((await page.evaluate(() => window.electronAPI.readPracticeWorkspace(null))).guide.paused).toBe(true);
  await page.getByTestId('guide-resume').click();
  await expect(page.getByTestId('guide-pause')).toBeEnabled(); await step('delete');
  expect((await page.evaluate(() => window.electronAPI.readPracticeWorkspace(null))).deck.slides.some(slide => slide.id === value.active.target)).toBe(true);
  await page.keyboard.press('Delete'); await step('nav-bible'); expect((await page.evaluate(()=>window.electronAPI.getPracticeProgress())).progress.exercises['slide-delete']).toBe('completed');
  const after = await page.evaluate(() => window.electronAPI.readPracticeWorkspace(null));
  expect(after.deck.slides.length).toBe(value.deck.slides.length - 1); expect(after.guide.skipped).toEqual([]);
  await page.screenshot({ path: test.info().outputPath('guided-done-800x600.png') });
  await page.getByTestId('guide-pause').click(); await expect(page.locator('[data-practice-portal]')).toHaveCount(0);
  expect(await page.locator('[data-app-shell] [inert]:not([aria-hidden="true"])').count()).toBe(0);
  await expect(page.getByTestId('right-panel')).toHaveAttribute('inert', '');
});
test('guided recovery: missing target, skip, advanced jump and no false completion', async () => {
  await page.getByTestId('guide-resume').click(); await step('presentations');
  await chapter('slides'); await step('add');
  await expect(page.getByRole('button', { name: 'Slides', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect.poll(()=>page.locator('[data-guide-anchor="add-slide"]').evaluate(el=>!el.closest('[inert]'))).toBe(true);
  await page.locator('[data-guide-anchor="add-slide"]').evaluate(el => el.remove());
  await expect(page.getByTestId('guide-recovery')).toBeVisible();
  expect(await page.locator('[data-app-shell] [inert]:not([aria-hidden="true"])').count()).toBe(0);
  await page.getByTestId('guide-skip').click(); await step('select');
  const value = await page.evaluate(() => window.electronAPI.readPracticeWorkspace(null));
  expect(value.guide.skipped).toContain('add');
  const progress = await page.evaluate(() => window.electronAPI.getPracticeProgress());
  expect(progress.progress.exercises['slide-add']).toBe('skipped');
  await page.keyboard.press('Escape'); await expect(page.getByTestId('guide-resume')).toBeVisible();
});
test('guided recovery: inactivity help and renderer crash resume retain the sample', async () => {
  await reachAdd();
  await expect(page.getByTestId('guide-recovery')).toBeVisible({ timeout: 35000 });
  await page.getByTestId('guide-retry').click();
  await page.getByRole('button', { name: 'Add New Slide', exact: true }).click(); await seeResult(page,'add-result'); await finishReorder(page); await step('select');
  const old = await page.evaluate(() => window.electronAPI.readPracticeWorkspace(null));
  const recovery = app.waitForEvent('window');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.forcefullyCrashRenderer());
  page = await recovery; await page.waitForFunction(() => !!window.__tourTest);
  await page.evaluate(() => window.__tourTest.language('en'));
  await require('./guide-flow.cjs').waitForPractice(page,'select');
  await expect(page.getByTestId('guide-resume')).toBeVisible();
  await page.getByTestId('guide-resume').click(); await step('select');
  const resumed = await page.evaluate(() => window.electronAPI.readPracticeWorkspace(null));
  expect(resumed.active.target).toBe(old.active.target); expect(resumed.deck.slides.length).toBe(old.deck.slides.length);
});

const { finishRemaining } = require('./guide-flow.cjs');
test('guided result screen waits for Continue, survives renderer loss and keeps recovery controls',async()=>{
  await reachAdd();const baseline=await page.evaluate(()=>window.electronAPI.readPracticeWorkspace(null));await page.getByRole('button',{name:'Add New Slide',exact:true}).click();await step('add-result');
  await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.unmaximize();w.setSize(800,600);});
  const original=await page.evaluate(()=>window.electronAPI.readPracticeWorkspace(null));
  expect(original.active).toBe(null);expect(original.deck.slides).toHaveLength(baseline.deck.slides.length+1);
  for(const lang of ['tr','de','es','ko','en']){
    await page.evaluate(lang=>window.__tourTest.language(lang),lang);
    await expect(page.locator('[data-guide-card]')).not.toContainText('guide.');
    await expect.poll(()=>page.locator('[data-guide-card]').evaluate(el=>{const r=el.getBoundingClientRect();return r.x>=0&&r.y>=0&&r.right<=innerWidth&&r.bottom<=innerHeight;})).toBe(true);
  }
  for(const key of ['Alt+3','Delete','Control+z'])await page.keyboard.press(key);
  await step('add-result');expect((await page.evaluate(()=>window.electronAPI.readPracticeWorkspace(null))).deck).toEqual(original.deck);
  await page.keyboard.press('Escape');await expect(page.getByTestId('guide-resume')).toBeVisible();
  await expect(page.locator('[data-practice-portal]')).toHaveCount(0);
  const recovery=app.waitForEvent('window');await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.forcefullyCrashRenderer());
  page=await recovery;await require('./guide-flow.cjs').waitForPractice(page,'add-result');await expect(page.getByTestId('guide-resume')).toBeVisible();
  await app.evaluate(({ipcMain})=>{
    const original=ipcMain._invokeHandlers.get('practice:guide');ipcMain.removeHandler('practice:guide');let once=true;
    ipcMain.handle('practice:guide',async(...args)=>{const value=await original(...args);if(once&&args[3]==='resume'){once=false;value.guide.result.slides[0].items='oops';}return value;});
  });
  await page.getByTestId('guide-resume').click();await expect(page.getByTestId('guide-retry')).toBeVisible();
  await expect(page.getByTestId('guide-close')).toBeVisible();await expect(page.getByTestId('guide-skip')).toHaveCount(0);
  await page.getByTestId('guide-retry').click();await expect(page.getByTestId('guide-result')).toBeVisible();
  const restored=await page.evaluate(()=>window.electronAPI.readPracticeWorkspace(null));expect(restored.guide.result).toEqual(original.guide.result);expect(restored.deck).toEqual(original.deck);
  await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.unmaximize();w.setSize(800,600);});
  await page.screenshot({path:test.info().outputPath('result-800x600.png')});
  await page.getByTestId('guide-next').focus();await page.keyboard.press('Enter');await step('reorder');
  expect((await page.evaluate(()=>window.electronAPI.readPracticeWorkspace(null))).deck.slides).toHaveLength(original.deck.slides.length+1);
});

test('guided result retry reloads a committed outcome after a failed acknowledgement',async()=>{
  await reachAdd();const baseline=await page.evaluate(()=>window.electronAPI.readPracticeWorkspace(null));
  await app.evaluate(({ipcMain})=>{
    const original=ipcMain._invokeHandlers.get('practice:guide');ipcMain.removeHandler('practice:guide');let once=true;
    ipcMain.handle('practice:guide',async(...args)=>{const value=await original(...args);if(once&&args[3]==='observe'&&value.guide.step==='add-result'){once=false;throw new Error('Response lost after commit');}return value;});
  });
  await page.getByRole('button',{name:'Add New Slide',exact:true}).click();await expect(page.getByRole('alert')).toBeVisible();
  await page.evaluate(async()=>{(await import('/src/renderer/state/useStore.ts')).useStore.getState().setPresentationName('Edited before Retry');});
  await page.getByTestId('guide-retry').click();await step('add-result');await expect(page.getByTestId('guide-result')).toBeVisible();
  const value=await page.evaluate(()=>window.electronAPI.readPracticeWorkspace(null));expect(value.deck.slides).toHaveLength(baseline.deck.slides.length+1);expect(value.active).toBe(null);
  await page.getByTestId('guide-next').click();await step('reorder');
  expect((await page.evaluate(()=>window.electronAPI.readPracticeWorkspace(null))).deck.name).toBe('Edited before Retry');
});

test('guided resumed imports: actual Base UI portal, keyboard and restored Bible selection', async () => {
  const anchor = id => page.locator('[data-guide-anchor="' + id + '"]').filter({ visible:true });
  await page.getByTestId('guide-resume').click(); await step('presentations');
  await chapter('bible'); await page.getByTestId('guide-next').click(); await step('bible-source');
  await anchor('bible-source').click(); await step('bible-book');
  await anchor('bible-book').click(); await step('bible-chapter');
  await expect(anchor('bible-chapter')).toHaveAttribute('aria-current','true');
  await anchor('bible-chapter').click(); await step('bible-verse');
  await anchor('bible-verse').click(); await step('bible-add');
  await page.keyboard.press('Escape'); await page.reload(); await page.waitForFunction(() => !!window.__tourTest);
  await page.evaluate(() => window.__tourTest.language('en'));
  await page.getByTestId('guide-resume').click(); await step('bible-add');
  await expect(anchor('bible-add')).toBeEnabled(); await anchor('bible-add').click(); await seeResult(page,'bible-result'); await step('nav-media');
  await chapter('bible'); await page.getByTestId('guide-next').click(); await step('bible-source');
  await anchor('bible-source').click(); await step('bible-import');
  await page.keyboard.press('Escape'); await page.reload(); await page.waitForFunction(() => !!window.__tourTest);
  await page.evaluate(() => window.__tourTest.language('en'));
  await page.getByTestId('guide-resume').click(); await step('bible-source');
  await anchor('bible-source').click(); await step('bible-import');
  await expect(anchor('bible-import')).toBeFocused(); await page.keyboard.press('Enter'); await step('bible-book');
  await page.keyboard.press('Escape');
  expect(await page.locator('[data-app-shell] [inert]:not([aria-hidden="true"])').count()).toBe(0);
});
test('guided remaining sections: actual import, selection, keyboard duration and saved results', async () => {
  test.setTimeout(120000);
  await reachAdd(); await page.getByRole('button', { name: 'Add New Slide', exact: true }).click(); await seeResult(page,'add-result'); await finishReorder(page); await step('select');
  const value = await page.evaluate(() => window.electronAPI.readPracticeWorkspace(null));
  await page.locator('[data-slide-id="' + value.active.target + '"]').click(); await step('delete');
  await page.keyboard.press('Delete'); await step('nav-bible'); expect((await page.evaluate(()=>window.electronAPI.getPracticeProgress())).progress.exercises['slide-delete']).toBe('completed');
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.unmaximize(); w.setSize(800, 600); });
  await finishRemaining(page);
  await page.screenshot({ path: test.info().outputPath('all-sections-800x600.png') });
});
