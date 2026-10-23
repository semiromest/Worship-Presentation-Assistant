const { test, expect } = require('@playwright/test');
const { launchWorkspace, closeWorkspace } = require('./workspace-test-utils.cjs');
async function setup(info) {
  const f = await launchWorkspace(info, 25000);
  await f.page.evaluate(async () => {
    window.headerStore = (await import('/src/renderer/state/useStore.ts')).useStore;
    const s = window.headerStore.getState();
    s.setUiMotionEnabled(false);
    s.setLiveSaveEnabled(false);
    s.setIsRightPanelOpen(false);
    s.dispatchUndo({
      type: 'RESET',
      payload: {
        id: 'header-test',
        name: 'Uzun başlıklı Pazar ibadeti sunumu — düzenlenebilir çalışma örneği',
        slides: [
          { id: 'one', type: 'text', content: 'Welcome' },
          { id: 'two', type: 'text', content: 'Second' },
        ],
      },
    });
    s.setPresets([]);
    s.setActiveTab('presentations');
  });
  try {
    await expect(f.page.locator('.presentation-current')).toBeVisible({ timeout: 25000 });
  } catch (error) {
    await closeWorkspace(f.app);
    throw error;
  }
  return f;
}
test('presentation header adapts to content width and keeps PowerPoint separate from file saving', async ({}, info) => {
  let app;
  try {
    const f = await setup(info);
    app = f.app;
    const p = f.page;
    for (const language of ['tr', 'en', 'de', 'es', 'ko']) {
      await p.evaluate((l) => window.__tourTest.language(l), language);
      for (const [width, height, zoom] of [
        [1920, 1080, 1],
        [1366, 768, 1],
        [800, 600, 1],
        [800, 600, 1.25],
        [800, 600, 1.5],
      ]) {
        await app.evaluate(
          ({ BrowserWindow }, { width, height, zoom }) => {
            const w = BrowserWindow.getAllWindows()[0];
            w.unmaximize();
            w.webContents.setZoomFactor(zoom);
            w.setContentSize(width, height);
          },
          { width, height, zoom }
        );
        await expect.poll(() => p.evaluate(() => innerWidth)).toBeCloseTo(width / zoom, 0);
        const header = p.locator('.presentations-header');
        const m = await header.evaluate((e) => {
          const r = e.getBoundingClientRect();
          return {
            overflow: e.scrollWidth > e.clientWidth + 1,
            inside: [...e.querySelectorAll('button,input')]
              .filter((b) => b.getClientRects().length)
              .every((b) => {
                const x = b.getBoundingClientRect();
                return x.left >= r.left - 1 && x.right <= r.right + 1;
              }),
            stacked: e.clientWidth < 900,
            info: e.querySelector('.presentation-current-info').getBoundingClientRect().bottom,
            actions: e.querySelector('.presentation-current-actions').getBoundingClientRect().top,
          };
        });
        expect(m.overflow).toBe(false);
        expect(m.inside, language + ':' + width + ':' + zoom).toBe(true);
        if (m.stacked) expect(m.actions).toBeGreaterThanOrEqual(m.info);
        const trigger = header.getByRole('button', { name: 'PowerPoint', exact: true });
        await trigger.click();
        const menu = p.getByRole('menu', { name: 'PowerPoint', exact: true });
        await expect(menu).toBeVisible();
        await expect(menu.getByRole('menuitem')).toHaveCount(2);
        const box = await menu.boundingBox();
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(await p.evaluate(() => innerWidth));
        await p.keyboard.press('Escape');
        await expect(menu).toBeHidden();
        await expect(trigger).toBeFocused();
        if ((language === 'tr' && zoom === 1) || (language === 'de' && width === 800 && zoom === 1.5)) {
          const png = await app.evaluate(async ({ BrowserWindow }) =>
            (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG()
          );
          require('fs').writeFileSync(info.outputPath(`header-${language}-${width}-${zoom}.png`), png);
        }
      }
    }
  } finally {
    await closeWorkspace(app);
  }
});
test('current presentation actions preserve rename, save, file and dialog behavior', async ({}, info) => {
  let app;
  try {
    const f = await setup(info);
    app = f.app;
    const p = f.page;
    await p.evaluate(() => window.__tourTest.language('tr'));
    await app.evaluate(({ ipcMain }) => {
      global.headerCalls = { save: 0, file: 0, open: 0, ppt: 0, confirm: 0 };
      global.allowNew = false;
      for (const c of ['save-preset', 'save-file', 'open-file', 'select-pptx-file', 'show-confirm-dialog'])
        ipcMain.removeHandler(c);
      ipcMain.handle('save-preset', (_, x) => {
        global.headerCalls.save++;
        return [{ ...x, createdAt: Date.now() }];
      });
      ipcMain.handle('save-file', () => {
        global.headerCalls.file++;
        return null;
      });
      ipcMain.handle('open-file', () => {
        global.headerCalls.open++;
        return null;
      });
      ipcMain.handle('select-pptx-file', () => {
        global.headerCalls.ppt++;
        return null;
      });
      ipcMain.handle('show-confirm-dialog', () => {
        global.headerCalls.confirm++;
        return global.allowNew;
      });
    });
    const current = p.locator('.presentation-current'),
      tools = p.locator('.presentations-tools');
    await current.locator('.presentation-name').click();
    const name = current.getByRole('textbox');
    await name.fill('Yeni çalışma adı');
    await name.press('Enter');
    await expect(current.locator('.presentation-name')).toHaveText('Yeni çalışma adı');
    await current.getByRole('button', { name: 'Kütüphaneye Kaydet', exact: true }).focus();
    await p.keyboard.press('Space');
    await expect.poll(() => app.evaluate(() => global.headerCalls.save)).toBe(1);
    await expect(current.getByRole('status')).toContainText('Kütüphaneye kaydedildi');
    await current.getByRole('button', { name: 'Dosyaya Kaydet', exact: true }).click();
    await expect.poll(() => app.evaluate(() => global.headerCalls.file)).toBe(1);
    await tools.getByRole('button', { name: 'Dosyadan Aç', exact: true }).click();
    await expect.poll(() => app.evaluate(() => global.headerCalls.open)).toBe(1);
    const ppt = tools.getByRole('button', { name: 'PowerPoint', exact: true });
    await ppt.focus();
    await p.keyboard.press('Enter');
    const menu = p.getByRole('menu');
    await expect(menu).toBeVisible();
    await p.keyboard.press('Home');
    await p.keyboard.press('Enter');
    await expect.poll(() => app.evaluate(() => global.headerCalls.ppt)).toBe(1);
    await expect(menu).toBeHidden();
    await tools.getByRole('button', { name: 'Otomatik Yedekler', exact: true }).click();
    await expect(p.getByRole('dialog')).toBeVisible();
    await p.keyboard.press('Escape');
    await expect(p.getByRole('dialog')).toBeHidden();
    const drive = tools.getByRole('button', { name: 'Google Drive', exact: true });
    await drive.click();
    await expect(p.getByRole('dialog')).toBeVisible();
    await p.keyboard.press('Escape');
    await expect(drive).toBeFocused();
    await current.getByRole('button', { name: 'Slaytları Düzenle', exact: true }).click();
    await expect.poll(() => p.evaluate(() => window.headerStore.getState().activeTab)).toBe('slides');
    await p.evaluate(() => window.headerStore.getState().setActiveTab('presentations'));
    await tools.getByRole('button', { name: 'Yeni Sunum', exact: true }).click();
    await expect.poll(() => app.evaluate(() => global.headerCalls.confirm)).toBe(1);
    expect(await p.evaluate(() => window.headerStore.getState().presentation.slides.length)).toBe(2);
    await app.evaluate(() => (global.allowNew = true));
    await tools.getByRole('button', { name: 'Yeni Sunum', exact: true }).click();
    await expect.poll(() => p.evaluate(() => window.headerStore.getState().presentation.slides.length)).toBe(1);
  } finally {
    await closeWorkspace(app);
  }
});
