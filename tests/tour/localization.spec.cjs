const { test, expect } = require('@playwright/test');
const { launchWorkspace, closeWorkspace } = require('./workspace-test-utils.cjs');

test('five languages localize section creation, the inspector and native-process replacement choices', async ({}, info) => {
  const { app, page } = await launchWorkspace(info, 30000);
  try {
    await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.unmaximize(); w.setContentSize(800, 600); });
    await page.evaluate(async () => {
      window.localeStore = (await import('/src/renderer/state/useStore.ts')).useStore;
      const s = window.localeStore.getState(); s.setLiveSaveEnabled(false); s.setActiveTab('slides'); s.setIsRightPanelOpen(true); s.setServiceSectionsEnabled(true);
    });
    for (const language of ['en', 'tr', 'de', 'es', 'ko']) {
      const strings = require(`../../src/renderer/locales/${language}/translation.json`);
      await page.evaluate(async language => { await window.__tourTest.language(language); await window.electronAPI.desktopLanguage(language); }, language);
      await expect(page.getByTestId('right-panel')).toContainText(strings.slidesWorkspace.appearance);
      await expect(page.getByRole('button', { name: strings.sections.create, exact: true }).first()).toBeVisible();
      await page.evaluate(() => { window.localeChoice = 'pending'; void window.electronAPI.desktopReplaceChoice().then(value => window.localeChoice = value); });
      const dialog = page.locator('.app-choice-dialog');
      await expect(dialog.getByRole('heading')).toHaveText(strings.desktop.replaceChoice.title);
      for (const key of ['save', 'discard', 'cancel']) await expect(dialog.getByRole('button', { name: strings.desktop.replaceChoice[key], exact: true })).toBeVisible();
      expect(await dialog.evaluate(el => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight && el.scrollWidth <= el.clientWidth; })).toBe(true);
      await dialog.getByRole('button', { name: strings.desktop.replaceChoice.cancel, exact: true }).click();
      await expect.poll(() => page.evaluate(() => window.localeChoice)).toBe('cancel');
    }
  } finally { await closeWorkspace(app); }
});
