const { _electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const AdmZip = require('adm-zip');
async function main() {
  const executable = process.argv[2]; if (!executable) throw new Error('Packaged executable required');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wpa-reliability-e2e-'));
  const output = path.resolve('.tmp/reliability-e2e'); await fs.mkdir(output, { recursive: true });
  await fs.rm(path.join(output, 'result.json'), { force: true });
  const env = { ...process.env, APPDATA: path.join(root, 'appdata'), LOCALAPPDATA: path.join(root, 'localappdata') };
  delete env.ELECTRON_RUN_AS_NODE; delete env.VITE_DEV_SERVER_URL;
  const app = await _electron.launch({ executablePath: executable, args: ['--wpa-smoke'], env });
  const logs = []; app.process().stdout?.on('data', c => logs.push(String(c))); app.process().stderr?.on('data', c => logs.push(String(c)));
  const checks = []; let profile, controlId;
  const invoke = (channel, args = [], unauthorized = false) => app.evaluate(async ({ ipcMain, BrowserWindow }, input) => {
    const wc = BrowserWindow.fromId(input.controlId).webContents;
    return ipcMain._invokeHandlers.get(input.channel)({ sender: wc, senderFrame: input.unauthorized ? {} : wc.mainFrame }, ...input.args);
  }, { channel, args, unauthorized, controlId });
  try {
    assert.equal(await app.evaluate(({ app }) => app.isPackaged), true);
    profile = await app.evaluate(({ app }) => app.getPath('userData'));
    controlId = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].id);
    await app.evaluate(({ app }) => { globalThis.__recentWrites = 0; app.addRecentDocument = () => { globalThis.__recentWrites++; }; });
    const page = await app.firstWindow(); const errors = []; page.on('pageerror', e => errors.push(String(e)));
    await page.locator('[data-app-shell]').waitFor(); await page.keyboard.press('Escape');
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false }); });
    const defaults = await invoke('desktop:ready');
    assert.equal(defaults.preferences.shortcutsEnabled, false); assert.equal(defaults.preferences.spellcheck, true); checks.push('safe-defaults');
    assert.equal(defaults.preferences.spellcheckLanguage, 'auto');
    await assert.rejects(invoke('desktop:ready', [], true), /Unauthorized/);
    await assert.rejects(invoke('open-file', [], true), /Unauthorized/);
    await assert.rejects(invoke('desktop:settings', [{ ...defaults.preferences, shortcutsEnabled: 'yes' }]), /Invalid/);
    checks.push('sender-and-shortcut-validation');
    await invoke('desktop:settings', [{ ...defaults.preferences, spellcheckLanguage: 'tr' }]);
    await invoke('desktop:language', ['en']);
    assert.ok((await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.session.getSpellCheckerLanguages())).includes('tr'));
    assert.equal(JSON.parse(await fs.readFile(path.join(profile, 'desktop-settings.json'), 'utf8')).spellcheckLanguage, 'tr');
    await assert.rejects(invoke('desktop:settings', [{ ...defaults.preferences, spellcheckLanguage: 'invalid' }]), /Invalid/);
    checks.push('independent-persistent-spelling-language');
    await app.context().setOffline(true);
    const css = await page.evaluate(() => window.electronAPI.cacheGoogleFont('Inter'));
    assert.ok(css.includes('@font-face') && css.includes('data:font/ttf;base64,') && !css.includes('https:'));
    const thumbnail = await invoke('generate-thumbnail', [{ id: 'native-font', type: 'text', content: 'İıĞğŞşÇçÖöÜü', styles: { fontFamily: 'Inter', fontSize: 48, textColor: '#ffffff', backgroundColor: '#000000' } }]);
    assert.match(thumbnail, /^data:image\/webp;base64,/);
    const pixels = Buffer.from(thumbnail.split(',')[1], 'base64'); await fs.writeFile(path.join(output, 'native-font.webp'), pixels);
    const { createCanvas, loadImage } = require('@napi-rs/canvas'); const image = await loadImage(pixels), canvas = createCanvas(image.width, image.height), context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
    assert.ok(context.getImageData(0, 0, image.width, image.height).data.some((value, i) => i % 4 !== 3 && value > 32), 'Native font preview must contain visible glyphs'); checks.push('offline-bundled-font-and-native-worker');
    const make = async (name, content) => {
      const deck = { id: name, name, slides: [{ id: '1', type: 'text', content, styles: { fontFamily: 'Inter', fontSize: 48 } }], transition: { type: 'none', duration: 0 } };
      const zip = new AdmZip(); zip.addFile('presentation.json', Buffer.from(JSON.stringify(deck)));
      const file = path.join(root, name + '.gpres'); await fs.writeFile(file, zip.toBuffer()); return { file, deck };
    };
    const first = await make('first', 'Birinci sunum'), second = await make('second', 'İkinci sunum');
    await app.evaluate(({ app }, file) => app.emit('second-instance', {}, [file]), first.file);
    await page.locator('[data-desktop-open-request] button').first().click();
    await page.locator('[data-desktop-open-request]').waitFor({ state: 'detached' });
    const displays = await invoke('get-displays');
    await invoke('open-projector', [displays[0].id, { fullPresentation: first.deck, liveIndex: 0, liveSlideId: '1' }]);
    let projector;
    for (let i = 0; i < 100 && !projector; i++) { projector = app.windows().find(p => p.url().includes('mode=projector')); if (!projector) await new Promise(r => setTimeout(r, 100)); }
    assert.ok(projector); await projector.getByText('Birinci sunum', { exact: true }).waitFor();
    await page.waitForFunction(() => [...document.fonts].some(font => font.family.replace(/['"]/g, '') === 'Inter' && font.status === 'loaded'));
    const focused = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getFocusedWindow()?.id);
    await app.evaluate(({ app }, file) => app.emit('second-instance', {}, [file]), second.file);
    await page.locator('[data-desktop-open-request]').waitFor();
    assert.equal(await projector.getByText('Birinci sunum', { exact: true }).count(), 1);
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getFocusedWindow()?.id), focused);
    await page.locator('[data-desktop-open-request] button').last().click();
    await page.locator('[data-desktop-open-request]').waitFor({ state: 'detached' }); checks.push('live-open-request-does-not-replace-or-focus');
    const savedFile = path.join(root, 'saved.gpres');
    await app.evaluate(({ dialog }, file) => { dialog.showSaveDialog = async () => ({ filePath: file, canceled: false }); }, savedFile);
    assert.equal(await invoke('save-file', [JSON.stringify(first.deck)]), savedFile);
    const saved = new AdmZip(await fs.readFile(savedFile)); assert.equal(JSON.parse(saved.readAsText('presentation.json')).slides[0].content, 'Birinci sunum'); checks.push('atomic-save-roundtrip');
    await invoke('desktop:document', [{ dirty: false, path: first.file }]);
    for (const file of [first.file, ...Array.from({ length: 21 }, (_, i) => path.join(root, 'output-' + i + '.gpres'))]) {
      await app.evaluate(({ dialog }, target) => { dialog.showSaveDialog = async () => ({ filePath: target, canceled: false }); }, file);
      await invoke('save-file', [JSON.stringify(first.deck)]);
    }
    await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows().find(w => !w.webContents.getURL().includes('mode=projector')).webContents.startDrag = item => { globalThis.__dragOutput = item.file; }; });
    await invoke('desktop:drag-output', [first.file]);
    assert.equal(await app.evaluate(() => globalThis.__dragOutput), first.file);
    await assert.rejects(invoke('desktop:drag-output', [path.join(root, 'unknown.gpres')]), /Unknown/);
    checks.push('active-document-drag-survives-output-eviction');
    const pptxFile = path.join(root, 'completed.pptx');
    await app.evaluate(({ dialog }, file) => { dialog.showSaveDialog = async () => ({ filePath: file, canceled: false }); }, pptxFile);
    assert.equal((await invoke('export-pptx', [JSON.stringify(first.deck)])).success, true);
    await page.locator('[data-saved-outputs] summary').click();
    const dragHandle = page.locator('[data-saved-output]').filter({ hasText: 'completed.pptx' });
    await dragHandle.waitFor(); assert.equal(await dragHandle.getAttribute('draggable'), 'true');
    await dragHandle.dispatchEvent('dragstart');
    await app.evaluate(async (_electron, file) => { const deadline = Date.now() + 5000; while (globalThis.__dragOutput !== file && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10)); }, pptxFile);
    assert.equal(await app.evaluate(() => globalThis.__dragOutput), pptxFile);
    await page.locator('[data-saved-outputs] summary').click();
    await page.getByRole('dialog', { name: 'Recent saved outputs' }).waitFor({ state: 'detached' });
    checks.push('completed-pptx-has-authorized-drag-handle');
    assert.equal(await app.evaluate(() => globalThis.__recentWrites), 0); checks.push('smoke-does-not-write-system-recents');
    for (const display of displays) await invoke('close-projector', [display.id]);
    await invoke('desktop:settings', [{ ...defaults.preferences, notifications: false, spellcheck: false }]);
    assert.equal(JSON.parse(await fs.readFile(path.join(profile, 'desktop-settings.json'), 'utf8')).spellcheck, false); checks.push('preferences-persist');
    // Closing the native projector can temporarily move keyboard focus away from
    // the control window. Exercise the closed summary's keyboard route only
    // after the control window and the intended DOM target own focus again.
    await app.evaluate(({ BrowserWindow }, id) => { const control = BrowserWindow.fromId(id); control.show(); control.focus(); }, controlId);
    await page.waitForFunction(() => document.hasFocus());
    await page.locator('[data-saved-outputs] summary').press('Alt+9');
    await page.getByText('Helper tools', { exact: true }).waitFor();
    await page.screenshot({ path: path.join(output, 'settings.png') });
    assert.deepEqual(errors, []); checks.push('no-renderer-errors');
    await fs.writeFile(path.join(output, 'result.json'), JSON.stringify({ packaged: true, checks, errors, logs }, null, 2));
    console.log(JSON.stringify({ checks }));
  } catch (error) {
    for (const [i, window] of app.windows().entries()) await window.screenshot({ path: path.join(output, 'failure-' + i + '.png') }).catch(() => {});
    await fs.writeFile(path.join(output, 'failure.txt'), String(error) + '\n' + logs.join('\n')); throw error;
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {}); await app.close().catch(() => {});
    if (profile && path.resolve(profile).startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(profile).startsWith('wpa-smoke-')) await fs.rm(profile, { recursive: true, force: true }).catch(() => {});
    await fs.rm(root, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
