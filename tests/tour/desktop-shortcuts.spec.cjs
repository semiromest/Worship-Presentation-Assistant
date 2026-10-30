const { test, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
const { launchWorkspace, closeWorkspace } = require('./workspace-test-utils.cjs');

test('legacy shortcuts migrate and IPC cannot override fixed bindings', async ({}, info) => {
  const expected = { previous: 'Control+Alt+Left', next: 'Control+Alt+Right', blackout: 'Control+Alt+B' };
  const settingsFile = path.join(info.outputPath('profile'), 'desktop-settings.json');
  await fs.mkdir(path.dirname(settingsFile), { recursive: true });
  await fs.writeFile(settingsFile, JSON.stringify({
    shortcutsEnabled: false, spellcheck: false, spellcheckLanguage: 'tr', notifications: true,
    shortcuts: { previous: 'Control+Shift+Left', next: 'Control+Shift+Right', blackout: 'B' },
  }));
  const { app, page } = await launchWorkspace(info, 30000);
  try {
    const migrated = JSON.parse(await fs.readFile(settingsFile, 'utf8'));
    expect(migrated).toEqual({ shortcutsEnabled: false, spellcheck: false, spellcheckLanguage: 'tr', notifications: true, shortcuts: expected });
    // Record registrations without claiming any shortcuts in the user's desktop.
    await app.evaluate(({ globalShortcut }) => {
      global.shortcutCalls = [];
      globalShortcut.register = accelerator => { global.shortcutCalls.push(accelerator); return true; };
    });
    const status = await page.evaluate(async prefs => window.electronAPI.desktopSettings({
      ...prefs, shortcutsEnabled: true, shortcuts: { previous: 'A', next: 'D', blackout: 'B' },
    }), migrated);
    expect(status.preferences.shortcuts).toEqual(expected);
    expect(status.registered).toEqual({ previous: true, next: true, blackout: true });
    expect(await app.evaluate(() => global.shortcutCalls)).toEqual(Object.values(expected));
    expect(JSON.parse(await fs.readFile(settingsFile, 'utf8')).shortcuts).toEqual(expected);
    await page.evaluate(async () => {
      await window.__tourTest.language('tr');
      const { useStore } = await import('/src/renderer/state/useStore.ts');
      useStore.getState().setActiveTab('settings');
    });
    const section = page.locator('section[aria-busy]').filter({ has: page.getByRole('heading', { name: 'Yardımcı araçlar', exact: true }) });
    await expect(section.getByRole('heading', { name: 'Yardımcı araçlar', exact: true })).toBeVisible({ timeout: 30000 });
    await expect(section.locator('kbd')).toHaveCount(0);
    await expect(section.locator('input[type="text"]')).toHaveCount(0);
    await expect(page.getByText('Genel kısayollar etkin', { exact: false })).toHaveCount(0);
    await expect(section.getByRole('button', { name: 'Kaydet', exact: true })).toHaveCount(0);
    await expect(section.getByRole('button', { name: 'Varsayılan dosya uygulamasını seç', exact: true })).toHaveCount(0);
    await expect(section.getByText(/Bilinmiyor/)).toHaveCount(0);
    const readPreferences = async () => JSON.parse(await fs.readFile(settingsFile, 'utf8'));
    for (const [key, label, initial] of [
      ['shortcutsEnabled', 'Genel kısayolları etkinleştir', true],
      ['spellcheck', 'Yazım denetimi', false],
      ['notifications', 'Arka plan işlemleri tamamlanınca bildir', true],
    ]) {
      const control = section.getByRole('switch', { name: label, exact: true });
      await expect(control).toHaveAttribute('aria-checked', String(initial));
      await control.click();
      await expect.poll(async () => (await readPreferences())[key]).toBe(!initial);
      await expect(section).toHaveAttribute('aria-busy', 'false');
      await expect(control).toHaveAttribute('aria-checked', String(!initial));
      await control.click();
      await expect.poll(async () => (await readPreferences())[key]).toBe(initial);
      await expect(section).toHaveAttribute('aria-busy', 'false');
    }
    await section.getByRole('combobox').selectOption('en-US');
    await expect.poll(async () => (await readPreferences()).spellcheckLanguage).toBe('en-US');
    await expect(section).toHaveAttribute('aria-busy', 'false');
    await page.evaluate(prefs => window.electronAPI.desktopSettings(prefs), migrated);
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('desktop:settings');
      ipcMain.handle('desktop:settings', () => { throw new Error('Injected save failure'); });
    });
    const spellcheck = section.getByRole('switch', { name: 'Yazım denetimi', exact: true });
    await expect(spellcheck).toHaveAttribute('aria-checked', 'false');
    await spellcheck.click();
    await expect(section.getByRole('alert')).toContainText('Injected save failure');
    await expect(spellcheck).toHaveAttribute('aria-checked', 'false');
    expect((await readPreferences()).spellcheck).toBe(false);
  } finally { await closeWorkspace(app); }
});
