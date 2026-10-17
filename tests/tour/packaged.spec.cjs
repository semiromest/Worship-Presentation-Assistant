/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS Playwright entrypoint. */
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const version = require('../../package.json').version;
let root;
let running = [];
let smokeProfiles = [];
let smokeSession;
let smokeBase;
const logs = new Map();
async function executable() {
  if (process.env.WPA_PACKAGED_EXE) return path.resolve(process.env.WPA_PACKAGED_EXE);
  const dir = path.resolve('release', version, 'win-unpacked');
  const name = (await fs.readdir(dir)).find(name => name.endsWith('.exe') && name.includes('Worship'));
  if (!name) throw new Error('Build the unpacked application first');
  return path.join(dir, name);
}
function environment() {
  const env = { ...process.env, APPDATA: path.join(root, 'appdata'), LOCALAPPDATA: path.join(root, 'localappdata') };
  delete env.ELECTRON_RUN_AS_NODE; delete env.VITE_DEV_SERVER_URL;
  if (smokeSession) env.WPA_SMOKE_SESSION = smokeSession; else delete env.WPA_SMOKE_SESSION;
  return env;
}
async function launch(mode = 'smoke') {
  const app = await electron.launch({ executablePath: await executable(), args: ['--wpa-' + mode], env: environment() });
  require('./teardown.cjs').trackElectron(app);
  running.push(app);
  logs.set(app, []);
  app.process().stdout?.on('data', chunk => logs.get(app)?.push(String(chunk)));
  app.process().stderr?.on('data', chunk => logs.get(app)?.push(String(chunk)));
  await app.context().tracing.start({ screenshots: true, snapshots: true });
  await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false }); });
  const page = await app.firstWindow();
  await page.locator('[data-app-shell] > nav').waitFor();
  if(mode==='practice') await require('./guide-flow.cjs').waitForPractice(page);
  await page.keyboard.press('Escape');
  const profile = await app.evaluate(({ app }) => app.getPath('userData'));
  if (mode === 'smoke') { smokeProfiles.push(profile); smokeBase = profile; smokeSession = await app.evaluate(() => process.env.WPA_SMOKE_SESSION); }
  if (mode === 'practice') expect(path.resolve(profile).toLowerCase().startsWith(path.resolve(smokeBase).toLowerCase() + path.sep)).toBe(true);
  return { app, page, profile };
}
async function close(app) { await app.context().tracing.stop().catch(() => {}); await require('./teardown.cjs').closeElectron(app); running = running.filter(item => item !== app); }
async function invoke(app, channel, args = [], unauthorized = false) {
  return app.evaluate(async ({ ipcMain, BrowserWindow }, { channel, args, unauthorized }) => {
    const wc = BrowserWindow.getAllWindows()[0].webContents;
    const event = { sender: wc, senderFrame: unauthorized ? {} : wc.mainFrame };
    try { return { ok: true, value: await ipcMain._invokeHandlers.get(channel)(event, ...args) }; }
    catch (error) { return { ok: false, error: String(error) }; }
  }, { channel, args, unauthorized });
}
test.beforeEach(async () => {
  smokeSession = undefined; smokeBase = undefined;
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'wpa-packaged-tour-'));
  await fs.mkdir(path.join(root, 'appdata'));
  await fs.mkdir(path.join(root, 'localappdata'));
});
// eslint-disable-next-line no-empty-pattern -- Only testInfo is needed, no browser fixture.
test.afterEach(async ({}, info) => {
  for (const app of running) {
    if (info.status !== info.expectedStatus)
      await app.windows()[0]?.screenshot({ path: info.outputPath('failure-' + running.indexOf(app) + '.png') }).catch(() => {});
    await fs.mkdir(info.outputDir, { recursive: true });
    await fs.writeFile(info.outputPath('process-' + running.indexOf(app) + '.log'), (logs.get(app) ?? []).join(''));
    await app.context().tracing.stop(info.status !== info.expectedStatus ? { path: info.outputPath('trace-' + running.indexOf(app) + '.zip') } : {}).catch(() => {});
    await require('./teardown.cjs').closeElectron(app);
  }
  running = [];
  for (const profile of smokeProfiles) {
    if (path.dirname(profile) === os.tmpdir() && path.basename(profile).startsWith('wpa-smoke-'))
      await fs.rm(profile, { recursive: true, force: true, maxRetries: 5 });
  }
  smokeProfiles = []; logs.clear();
  if (path.dirname(root) === os.tmpdir() && path.basename(root).startsWith('wpa-packaged-tour-'))
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5 });
});
test('packaged smoke: single help entry and no automatic tour',async()=>{
  const instance=await launch();const {page}=instance;
  expect(await instance.app.evaluate(({app})=>app.isPackaged)).toBe(true);expect(await page.evaluate(()=>'__tourTest' in window)).toBe(false);
  await page.keyboard.press('Alt+9');await require('./guide-flow.cjs').openLearning(page);await expect(page.getByTestId('practice-open')).toBeVisible();
  for(const id of ['tour-map-open','tour-map','tour-card','page-suggestion'])await expect(page.getByTestId(id)).toHaveCount(0);
  await page.reload();await page.locator('[data-app-shell] > nav').waitFor();await expect(page.getByTestId('tour-map')).toHaveCount(0);
});

test('packaged practice: language isolation, ten paused chapters, archived restart and saved close',async()=>{
  const normal=await launch();await normal.page.keyboard.press('Alt+9');
  await normal.page.getByRole('combobox',{name:'Language',exact:true}).selectOption('de');
  let candidate=await launch('practice');const page=candidate.page;
  await candidate.app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.unmaximize();w.setSize(800,600);});
  await page.getByTestId('guide-language').selectOption('tr');await page.reload();await expect(page.getByTestId('guide-language')).toHaveValue('tr');
  expect(await normal.page.evaluate(()=>localStorage.getItem('i18nextLng'))).toBe('de');
  const before=await page.evaluate(()=>window.electronAPI.readPracticeWorkspace(null));
  for(const name of ['presentations','slides','bible','media','hymns','countdown','screen','calendar','editor','settings']){
    await page.locator('summary').filter({hasText:'Bölüme geç'}).click();
    await page.getByTestId('guide-chapter-'+name).click();
    await expect(page.locator('[data-guide-anchor="nav-'+name+'"]').filter({visible:true})).toHaveAttribute('aria-current','page');
    expect((await page.evaluate(()=>window.electronAPI.readPracticeWorkspace(null))).guide.paused).toBe(true);
  }
  await page.getByTestId('guide-restart').click();await expect(page.locator('[data-guide-step]')).toHaveAttribute('data-guide-step','welcome');
  const fresh=await page.evaluate(()=>window.electronAPI.readPracticeWorkspace(null));expect(fresh.runId).not.toBe(before.runId);expect(fresh.deck.slides).toEqual([]);
  expect((await fs.readdir(path.join(candidate.profile,'practice-archives')))).toHaveLength(1);
  await page.screenshot({path:test.info().outputPath('practice-start-800x600.png')});
  await page.getByTestId('guide-resume').click();await expect(page.locator('[data-guide-step]')).toHaveAttribute('data-guide-step','presentations');
  await page.getByTestId('guide-close').click();await expect.poll(()=>page.isClosed()).toBe(true);await close(candidate.app);
  await expect(normal.page.locator('[data-app-shell] > nav')).toBeVisible();candidate=await launch('practice');
  await expect(candidate.page.getByTestId('guide-language')).toHaveValue('tr');await expect(candidate.page.getByTestId('guide-resume')).toBeVisible();
  expect((await candidate.page.evaluate(()=>window.electronAPI.readPracticeWorkspace(null))).runId).toBe(fresh.runId);
});

test('practice gate: packaged capabilities deny direct IPC and preserve normal profile', async () => {
  const normal = await launch();
  const candidate = await launch('practice');
  await expect(candidate.page.getByTestId('practice-banner')).toBeVisible();
  await candidate.app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.unmaximize(); w.setSize(800, 600); });
  await expect.poll(() => candidate.page.evaluate(() => window.innerWidth)).toBeLessThan(810);
  await candidate.page.screenshot({ path: test.info().outputPath('practice-800x600.png') });
  expect(await candidate.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getTitle())).toContain('PRACTICE');
  for (const channel of ['open-projector', 'toggle-projector', 'update-projector', 'close-projector', 'share:start',
    'share:publish', 'screen-share:start', 'screen-share:frame', 'public-tunnel:start', 'drive-sign-in', 'drive-delete-file',
    'save-file', 'export-pptx', 'delete-bible-data', 'import-bible-xml', 'updater:install', 'stt:start']) {
    const result = await invoke(candidate.app, channel, ['probe', {}]);
    expect(result.ok, channel).toBe(false);
  }
  expect((await invoke(candidate.app, 'practice:progress', [], true)).ok).toBe(false);
  expect(await candidate.page.evaluate(async () => {
    try { await navigator.mediaDevices.getUserMedia({ audio: true }); return true; } catch { return false; }
  })).toBe(false);
  expect(await candidate.page.evaluate(async () => (await navigator.permissions.query({ name: 'microphone' })).state)).toBe('denied');
  const http = require('node:http'); let requests = 0;
  const server = http.createServer((_request, response) => { requests++; response.end('reachable'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const networkUrl = 'http://127.0.0.1:' + server.address().port + '/';
  try {
    expect(await normal.app.evaluate(async ({ net }, url) => (await net.fetch(url)).text(), networkUrl)).toBe('reachable');
    expect(await candidate.app.evaluate(async ({ net }, url) => {
      try { await net.fetch(url); return true; } catch { return false; }
    }, networkUrl)).toBe(false);
    expect(requests).toBe(1);
    expect(await candidate.page.evaluate(async () => {
      try { await fetch('https://example.com/'); return true; } catch { return false; }
    })).toBe(false);
  } finally { await new Promise(resolve => server.close(resolve)); }
  expect(await candidate.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
  expect(await candidate.page.evaluate(() => window.electronAPI.getProjectorOutputs())).toEqual([]);
  expect(await candidate.page.evaluate(() => window.electronAPI.getRemoteUrl())).toBe('');
  expect(await candidate.page.evaluate(() => window.electronAPI.getUpdaterInfo())).toMatchObject({ updaterActive: false });
  expect(await normal.page.evaluate(() => window.electronAPI.getRemoteUrl())).toMatch(/^http:/);
  const preset = { name: 'Practice probe', presentation: { id: 'practice-probe', name: 'Probe', slides: [] } };
  await candidate.page.evaluate(preset => window.electronAPI.savePreset(preset), preset);
  expect(await normal.page.evaluate(async () => (await window.electronAPI.loadPresets()).some(p => p.name === 'Practice probe'))).toBe(false);
  const paths = await Promise.all([normal, candidate].map(i => i.app.evaluate(({ app }) => [app.getPath('userData'), app.getPath('sessionData'), app.getPath('temp')])));
  paths[0].forEach((value, i) => expect(value).not.toBe(paths[1][i]));
  const WebSocket = require('ws'); const url = new URL(await normal.page.evaluate(() => window.electronAPI.getRemoteUrl()));
  url.protocol = 'ws:'; url.hostname = '127.0.0.1'; url.pathname = '/';
  await Promise.all([normal, candidate].map(i => i.page.evaluate(() => { window.__remoteProbe = 0; window.electronAPI.onRemoteAction(() => window.__remoteProbe++); })));
  const socket = new WebSocket(url.href);
  await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  socket.send(JSON.stringify({ type: 'command', action: 'next' })); socket.close();
  await expect.poll(() => normal.page.evaluate(() => window.__remoteProbe)).toBeGreaterThan(0);
  expect(await candidate.page.evaluate(() => window.__remoteProbe)).toBe(0);
});
test('practice gate: single writer, verified result, readonly progress, corruption and crash resume', async () => {
  const normal = await launch();
  let candidate = await launch('practice');
  const second = spawn(await executable(), ['--wpa-practice'], { env: environment(), stdio: 'ignore', windowsHide: true });
  expect(await new Promise((resolve, reject) => { second.once('exit', resolve); second.once('error', reject); })).toBe(0);
  expect(await normal.page.evaluate(() => window.electronAPI.openPractice())).toMatchObject({ ok: true });
  expect((await invoke(candidate.app, 'practice:set-status', ['presentations', 'completed'])).ok).toBe(false);
  expect((await invoke(normal.app, 'practice:set-status', ['slides', 'skipped'])).ok).toBe(false);
  expect((await invoke(candidate.app, 'practice:set-status', ['presentations', 'inProgress'])).ok).toBe(false);
  expect((await invoke(candidate.app, 'practice:set-status', ['slides', 'skipped'])).ok).toBe(false);
  await candidate.page.locator('summary').filter({hasText:'Go to section'}).click();
  await candidate.page.getByTestId('guide-chapter-slides').click();await candidate.page.getByTestId('guide-resume').click();
  await expect(candidate.page.locator('[data-guide-step]')).toHaveAttribute('data-guide-step', 'add');
  await candidate.page.getByRole('button', { name: 'Add New Slide', exact: true }).click();
  await expect(candidate.page.locator('[data-guide-step]')).toHaveAttribute('data-guide-step', 'add-result');
  await expect.poll(() => normal.page.evaluate(async () => (await window.electronAPI.getPracticeProgress()).guide.step)).toBe('add-result');
  await normal.page.keyboard.press('Alt+9'); await require('./guide-flow.cjs').openLearning(normal.page);
  await expect(normal.page.getByTestId('practice-open')).toBeVisible();
  const checkpoint=await normal.page.evaluate(()=>window.electronAPI.getPracticeProgress());
  expect(checkpoint.ok).toBe(true); expect(checkpoint.guide.step).toBe('add-result');
  expect(checkpoint.progress.exercises['slide-add']).toBe('completed');
  const progressBytes=await fs.readFile(path.join(candidate.profile,'practice-progress.json'),'utf8');
  await normal.page.evaluate(()=>window.electronAPI.getPracticeProgress());
  expect(await fs.readFile(path.join(candidate.profile,'practice-progress.json'),'utf8')).toBe(progressBytes);
  const recoveredWindow = candidate.app.waitForEvent('window');
  await candidate.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.forcefullyCrashRenderer());
  candidate.page = await recoveredWindow;
  await candidate.page.locator('[data-app-shell] > nav').waitFor();
  expect(await candidate.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
  expect((await candidate.page.evaluate(() => window.electronAPI.getPracticeProgress())).progress.exercises['slide-add']).toBe('completed');
  await close(candidate.app); candidate = await launch('practice');
  expect((await candidate.page.evaluate(() => window.electronAPI.getPracticeProgress())).guide.step).toBe('add-result');
  await fs.writeFile(path.join(candidate.profile, 'practice-progress.json'), '{broken');
  await expect.poll(()=>normal.page.evaluate(()=>window.electronAPI.getPracticeProgress())).toEqual({ok:false,error:'unreadable'});
  expect(JSON.parse(await fs.readFile(path.join(candidate.profile,'practice-workspace.json'),'utf8')).guide.step).toBe('add-result');
  expect((await invoke(candidate.app, 'practice:set-status', ['media', 'inProgress'])).ok).toBe(false);
  expect(await fs.readFile(path.join(candidate.profile, 'practice-progress.json'), 'utf8')).toBe('{broken');
});
test('practice gate: removed flags, conflicting modes and linked profiles fail before windows', async () => {
  await launch();
  for (const args of [['--wpa-profile=' + root], ['--wpa-isolation-spike'], ['--wpa-practice', '--wpa-smoke']]) {
    const child = spawn(await executable(), args, { env: environment(), stdio: 'ignore', windowsHide: true });
    expect(await new Promise(resolve => child.once('exit', resolve))).not.toBe(0);
  }
  const practice = await launch('practice'); const profile = practice.profile;
  await close(practice.app);
  await fs.rename(profile, profile + '-real');
  await fs.symlink(profile + '-real', profile, 'junction');
  const child = spawn(await executable(), ['--wpa-practice'], { env: environment(), stdio: 'ignore', windowsHide: true });
  expect(await new Promise(resolve => child.once('exit', resolve))).not.toBe(0);
});
test('practice gate: abrupt main loss preserves progress and normal application', async () => {
  const normal = await launch();
  const candidate = await launch('practice');
  await candidate.page.locator('summary').filter({hasText:'Go to section'}).click();
  await candidate.page.getByTestId('guide-chapter-slides').click();await candidate.page.getByTestId('guide-resume').click();
  await expect(candidate.page.locator('[data-guide-step]')).toHaveAttribute('data-guide-step', 'add');
  expect(await candidate.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
  const main = candidate.app.process();
  // The packaged Windows launcher PID can differ from Electron's main PID.
  const pid = await candidate.app.evaluate(() => process.pid);
  const { execFileSync } = require('node:child_process');
  const captured = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    'Get-CimInstance Win32_Process -Filter "ParentProcessId = ' + pid + '" | Select-Object ProcessId,ExecutablePath | ConvertTo-Json -Compress'], { encoding: 'utf8' }) || '[]');
  const children = Array.isArray(captured) ? captured : [captured]; const exe = await executable();
  running = running.filter(app => app !== candidate.app);
  try {
    const exited = new Promise(resolve => main.once('exit', resolve)); process.kill(pid); await exited;
    // Allow Windows to finish releasing its native process-singleton handles.
    await new Promise(resolve => setTimeout(resolve, 2000));
    await expect(normal.page.locator('[data-app-shell] > nav')).toBeVisible();
    const restarted = await launch('practice');
    expect((await restarted.page.evaluate(() => window.electronAPI.getPracticeProgress())).guide.step).toBe('add');
    expect(await restarted.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
  } finally {
    for (const child of children) {
      if (!child.ExecutablePath || path.resolve(child.ExecutablePath).toLowerCase() !== exe.toLowerCase()) continue;
      const current = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        'Get-CimInstance Win32_Process -Filter "ProcessId = ' + Number(child.ProcessId) + '" | Select-Object ExecutablePath,ParentProcessId | ConvertTo-Json -Compress'], { encoding: 'utf8' }) || 'null');
      if (current?.ExecutablePath && Number(current.ParentProcessId) === pid && path.resolve(current.ExecutablePath).toLowerCase() === exe.toLowerCase())
        try { process.kill(Number(child.ProcessId)); } catch { /* already gone */ }
    }
  }
});


test('guided learning: ten sections, real outcomes, Esc resume, crash and retained normal data', async () => {
  const normal = await launch(); const normalPresets = await normal.page.evaluate(() => window.electronAPI.loadPresets());
  let candidate = await launch('practice'); let page = candidate.page;
  await candidate.app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.unmaximize(); w.setSize(800, 600); });
  const step = id => expect(page.locator('[data-guide-step]')).toHaveAttribute('data-guide-step', id);
  await page.getByTestId('guide-resume').click(); await step('presentations');
  await page.getByTestId('guide-next').click(); await step('sidebar');
  await page.getByTestId('guide-next').click(); await step('nav-slides');
  await expect(page.getByTestId('guide-next')).toHaveCount(0);
  await page.getByRole('button', { name: 'Slides', exact: true }).click(); await step('add');
  await expect.poll(() => page.locator('[data-guide-card]').evaluate(el => { const r = el.getBoundingClientRect(); return r.x >= 0 && r.y >= 0 && r.right <= innerWidth && r.bottom <= innerHeight; })).toBe(true);
  await expect.poll(() => page.getByRole('button', { name: 'Add New Slide', exact: true }).evaluate(el => { const r = el.getBoundingClientRect(); return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); })).toBe(true);
  await expect.poll(() => page.locator('[data-guide-card]').evaluate(el => { let opacity = 1; for (let node = el; node; node = node.parentElement) opacity *= Number(getComputedStyle(node).opacity); return opacity; })).toBe(1);
  await page.screenshot({ path: test.info().outputPath('guide-add-800x600.png') });
  const before = await page.evaluate(async () => (await window.electronAPI.readPracticeWorkspace(null)).deck);
  await page.keyboard.press('Alt+3'); await page.keyboard.press('Delete'); await step('add');
  await page.getByRole('button', { name: 'Add New Slide', exact: true }).click(); await require('./guide-flow.cjs').seeResult(page,'add-result'); await require('./guide-flow.cjs').finishReorder(page); await step('select');
  const selection = await page.evaluate(() => window.electronAPI.readPracticeWorkspace(null));
  await page.keyboard.press('Escape'); await expect(page.getByTestId('guide-resume')).toBeVisible();
  await expect(page.locator('[data-app-shell]')).not.toHaveAttribute('inert');
  const paused = await page.evaluate(() => window.electronAPI.readPracticeWorkspace(null)); expect(paused.guide.paused).toBe(true);
  await page.getByTestId('guide-resume').click(); await step('select');
  expect((await page.evaluate(() => window.electronAPI.readPracticeWorkspace(null))).active.target).toBe(selection.active.target);
  const recovery = candidate.app.waitForEvent('window');
  await candidate.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.forcefullyCrashRenderer());
  page = candidate.page = await recovery;
  await require('./guide-flow.cjs').waitForPractice(page,'select');
  await expect(page.getByTestId('guide-resume')).toBeVisible(); await page.getByTestId('guide-resume').click(); await step('select');
  expect((await page.evaluate(() => window.electronAPI.readPracticeWorkspace(null))).deck.slides.length).toBe(selection.deck.slides.length);
  await page.locator('[data-slide-id="' + selection.active.target + '"]').click(); await step('delete');
  await page.keyboard.press('Delete'); await step('nav-bible'); expect((await page.evaluate(()=>window.electronAPI.getPracticeProgress())).progress.exercises['slide-delete']).toBe('completed');
  await require('./guide-flow.cjs').finishRemaining(page, true);
  const kept = await page.evaluate(() => window.electronAPI.readPracticeWorkspace(null));
  expect(kept.deck.slides.length).toBe(before.slides.length + 6);
  expect(kept.deck.slides.some(slide => slide.id === selection.active.target)).toBe(false);
  expect(kept.guide.skipped).toEqual([]);
  await candidate.app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.unmaximize(); w.setSize(800, 600); });
  await page.screenshot({ path: test.info().outputPath('guide-800x600.png') });
  await page.getByTestId('guide-close').click(); await close(candidate.app); candidate = await launch('practice');
  expect((await candidate.page.evaluate(() => window.electronAPI.readPracticeWorkspace(null))).deck).toEqual(kept.deck);
  expect(await normal.page.evaluate(() => window.electronAPI.loadPresets())).toEqual(normalPresets);
  await normal.page.keyboard.press('Alt+9');
  await require('./guide-flow.cjs').openLearning(normal.page);
  await expect(normal.page.getByTestId('practice-open')).toBeVisible();
  const completed=await normal.page.evaluate(()=>window.electronAPI.getPracticeProgress());
  expect(completed.ok).toBe(true); expect(Object.keys(completed.progress.exercises)).toHaveLength(10);
  expect(Object.values(completed.progress.exercises)).toEqual(Array(10).fill('completed'));
  expect((await normal.page.evaluate(() => window.electronAPI.getPracticeProgress())).guide.step).toBe('done');
  expect(await candidate.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
  await candidate.page.getByTestId('guide-restart').click();
  await expect(candidate.page.locator('[data-guide-step]')).toHaveAttribute('data-guide-step','welcome');
  const fresh=await candidate.page.evaluate(()=>window.electronAPI.readPracticeWorkspace(null));expect(fresh.runId).not.toBe(kept.runId);expect(fresh.deck.slides).toEqual([]);
  await expect.poll(()=>normal.page.evaluate(async()=>{
    const value=await window.electronAPI.getPracticeProgress();return value.ok ? value.progress.exercises : null;
  })).toEqual({});
  expect((await candidate.page.evaluate(()=>window.electronAPI.loadPresets())).some(p=>p.presentation.id===kept.deck.id)).toBe(true);
  await candidate.app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close());
  await expect.poll(()=>candidate.page.isClosed()).toBe(true);
});
