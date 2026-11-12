const { test, expect } = require('@playwright/test');
const { launchWorkspace, closeWorkspace } = require('./workspace-test-utils.cjs');
const { settings } = require('../../src/renderer/locales/en/translation.json');

test('support stays disabled in both settings layouts and is excluded from search', async ({}, info) => {
  const { app, page } = await launchWorkspace(info, 30000);
  try {
    expect(await page.evaluate(() => window.electronAPI.openSupport('https://example.com'))).toBe(false);
    await page.locator('[data-guide-anchor="nav-settings"]').click();
    const title = settings.navigation.categories.support.title;
    const sidebar = page.locator('.settings-category-sidebar');
    const select = page.locator('#settings-category');

    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      window.unmaximize();
      window.setContentSize(1366, 768);
    });
    const button = sidebar.getByRole('button', { name: title, exact: true });
    await expect(button).toBeVisible();
    await expect(button).toBeDisabled();

    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].setContentSize(800, 600);
    });
    await expect(select).toBeVisible();
    await expect(select.locator('option[value="support"]')).toBeDisabled();
    await expect(select).toHaveValue('general');

    await page.getByRole('searchbox', { name: settings.navigation.search }).fill(title);
    await expect(page.getByText(settings.navigation.noResults)).toBeVisible();
    await expect(page.getByTestId('support-development')).toHaveCount(0);
  } finally {
    await closeWorkspace(app);
  }
});
