const { test, expect } = require('@playwright/test');
const { launchWorkspace, closeWorkspace } = require('./workspace-test-utils.cjs');
async function seed(page) {
  await page.evaluate(async () => {
    await window.__tourTest.language('tr');
    window.__gradientStore = (await import('/src/renderer/state/useStore.ts')).useStore;
    const s = window.__gradientStore.getState();
    s.setActiveTab('slides');
    s.setIsRightPanelOpen(false);
    s.setLiveSaveEnabled(false);
    const group = { id: 'hymn', title: 'İlahi', part: 1, parts: 2, color: '#a78bfa' };
    s.dispatchUndo({
      type: 'RESET',
      payload: {
        id: 'gradient-workflow',
        name: 'Gradient workflow',
        slides: [
          { id: 'one', type: 'text', content: 'İlk metin', group, styles: { backgroundColor: '#000', fontSize: 70 } },
          {
            id: 'two',
            type: 'text',
            content: 'Diğer grup slaytı',
            group: { ...group, part: 2 },
            styles: { backgroundColor: '#000', fontSize: 70 },
          },
          { id: 'three', type: 'text', content: 'Bağımsız metin', styles: { backgroundColor: '#000', fontSize: 70 } },
          { id: 'image', type: 'image', content: 'Resim', styles: {} },
          {
            id: 'part1',
            type: 'text',
            content: 'İlahi bir',
            partsMode: true,
            parts: ['İlk kıta', 'İkinci kıta'],
            styles: { backgroundColor: '#000', fontSize: 70 },
          },
          {
            id: 'part2',
            type: 'text',
            content: 'İlahi iki',
            partsMode: true,
            parts: ['Üçüncü kıta', 'Dördüncü kıta'],
            styles: { backgroundColor: '#000', fontSize: 70 },
          },
        ],
      },
    });
    s.selectSlides({ activeId: 'one', ids: new Set(['one', 'three', 'image']), anchorIndex: 0 });
  });
}
const slides = (page) => page.evaluate(() => window.__gradientStore.getState().presentation.slides);
const editor = (page) => page.locator('[aria-labelledby="slide-editor-title"]');
/** The designer applies settled changes itself; this status confirms the write to the editor draft. */
const applied = (designer, count = 1) => designer.locator('.gradient-status').filter({ hasText: count + ' slayta uygulandı' });
async function resize(app, width, height) {
  await app.evaluate(
    ({ BrowserWindow }, { width, height }) => {
      const w = BrowserWindow.getAllWindows()[0];
      w.unmaximize();
      w.setContentSize(width, height);
    },
    { width, height }
  );
}

test('inline gradient designer auto-applies to the editor draft, persists a library and quick-applies to the exact selection', async ({}, info) => {
  test.setTimeout(150000);
  let app;
  try {
    let f = await launchWorkspace(info, 30000);
    app = f.app;
    let page = f.page;
    await seed(page);
    const before = await slides(page);
    await page.getByTestId('gradient-quick-apply').click();
    await expect(page.getByText('＋ ile görsel/video ekleyin veya seçili slaytın arka planını kaydedin.', { exact: false })).toBeVisible();
    await page.getByRole('button', { name: 'Editörde gradyan oluştur', exact: true }).click();
    const e = editor(page),
      designer = e.getByTestId('gradient-designer'),
      save = e.locator('[data-guide-anchor="editor-save"]');
    await expect(designer).toBeVisible();
    await expect(e.getByRole('radio', { name: 'Gradyan', exact: true })).toHaveAttribute('aria-checked', 'true');
    // Opening the designer from the gallery writes nothing by itself.
    await expect(save).toBeDisabled();
    await designer.locator('details.gradient-more > summary').click();
    await designer.getByRole('button', { name: 'Yeniden üret', exact: true }).click();
    await expect(applied(designer)).toBeVisible({ timeout: 40000 });
    await expect(e.getByTestId('editor-canvas-background')).toHaveCSS('background-image', /url\(/);
    // A settled change lands in the editor draft; the presentation waits for the editor's Save.
    expect(await slides(page)).toEqual(before);
    await expect(save).toBeEnabled();
    for (const [w, h] of [
      [1920, 1080],
      [1366, 768],
      [800, 600],
    ]) {
      await resize(app, w, h);
      const footer = designer.locator('.gradient-footer');
      await footer.scrollIntoViewIfNeeded();
      expect(
        await footer.evaluate((el) => {
          const r = el.getBoundingClientRect();
          return r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight;
        })
      ).toBe(true);
      expect(await e.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
      await page.screenshot({ path: info.outputPath('gradient-editor-' + w + '.png'), animations: 'disabled' });
    }
    await resize(app, 1366, 768);
    await designer.getByRole('switch', { name: 'Hareketli', exact: true }).check();
    await designer.getByRole('group', { name: 'Animasyon', exact: true }).getByRole('button', { name: 'Aurora', exact: true }).click();
    await expect(applied(designer)).toBeVisible({ timeout: 40000 });
    await designer.getByRole('button', { name: 'Kütüphaneye kaydet', exact: true }).click();
    await designer.getByLabel('Gradyan adı', { exact: true }).fill('Deneme okyanus');
    await designer.getByRole('button', { name: 'Tasarımı kaydet', exact: true }).click();
    await expect(designer.getByText('Gradyan kütüphaneye kaydedildi.', { exact: true })).toBeVisible();
    expect(await slides(page)).toEqual(before);
    // Every auto-applied step is undoable in the editor, and redo brings them back.
    const undo = e.getByRole('button', { name: 'Geri Al (Ctrl+Z)', exact: true }),
      redo = e.getByRole('button', { name: 'İleri Al (Ctrl+Y)', exact: true });
    let undos = 0;
    while ((await save.isEnabled()) && undos < 5) {
      await undo.click();
      undos++;
      await page.waitForTimeout(100);
    }
    await expect(save).toBeDisabled();
    expect(undos).toBeGreaterThan(0);
    for (let i = 0; i < undos; i++) await redo.click();
    await expect(save).toBeEnabled();
    await save.click();
    await expect(save).toBeDisabled();
    await page.evaluate(() => window.__gradientStore.getState().setActiveTab('slides'));
    let result = await slides(page);
    expect(result.filter((s) => s.styles?.backgroundImage).map((s) => s.id)).toEqual(['one']);
    expect(result[0].items).toBeUndefined();
    await page.evaluate(() => {
      const s = window.__gradientStore.getState();
      s.selectSlides({ activeId: 'one', ids: new Set(['one', 'three', 'image']), anchorIndex: 0 });
    });
    for (const [w, h] of [
      [1920, 1080],
      [1366, 768],
      [800, 600],
    ]) {
      await resize(app, w, h);
      await page.evaluate(() => window.__gradientStore.getState().setIsRightPanelOpen(false));
      await page.getByTestId('gradient-quick-apply').click();
      const popup = page.getByRole('button', { name: 'Deneme okyanus', exact: true });
      await expect(popup).toBeVisible();
      expect(
        await popup.evaluate((el) => {
          const r = el.getBoundingClientRect();
          return r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight;
        })
      ).toBe(true);
      await expect(page.locator('.base-popover-popup:visible')).toHaveCSS('opacity', '1');
      await page.screenshot({ path: info.outputPath('gradient-gallery-' + w + '.png'), animations: 'disabled' });
      await page.keyboard.press('Escape');
      await expect(popup).toHaveCount(0);
      await expect(page.getByTestId('gradient-quick-apply')).toBeFocused();
    }
    await page.evaluate(() => window.__gradientStore.setState({ isProjectorWindowOpen: true, liveSlideId: 'one' }));
    await page.getByTestId('gradient-quick-apply').click();
    await expect(page.getByText('Canlı slayt dahil', { exact: true })).toBeVisible();
    await expect(page.getByText('1 uygun olmayan slayt atlanacak.', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Deneme okyanus', exact: true }).click();
    await page.evaluate(() => window.__gradientStore.setState({ isProjectorWindowOpen: false }));
    result = await slides(page);
    expect(result.filter((s) => s.styles?.backgroundImage).map((s) => s.id)).toEqual(['one', 'three']);
    expect(result.some((s) => s.styles?.generatedGroupBackground)).toBe(false);
    await expect(page.getByRole('button', { name: 'Deneme okyanus', exact: true })).toHaveCount(0);
    await expect(page.getByTestId('gradient-quick-apply')).toBeFocused();
    await page.keyboard.press('Control+z');
    await expect
      .poll(async () => (await slides(page)).filter((s) => s.styles?.backgroundImage).map((s) => s.id))
      .toEqual(['one']);
    expect((await slides(page)).filter((s) => s.styles?.backgroundImage).map((s) => s.id)).toEqual(['one']);
    await page.getByTestId('gradient-quick-apply').click();
    await page.evaluate(() => {
      const s = window.__gradientStore.getState();
      s.selectSlides({ activeId: 'three', ids: new Set(['three']), anchorIndex: 2 });
    });
    await expect(page.getByRole('button', { name: 'Deneme okyanus', exact: true })).toHaveCount(0);
    await resize(app, 1366, 768);
    // Parts-mode text slides allow background selection without enabling item editing.
    await page.evaluate(() => window.__gradientStore.getState().openEditor('part1'));
    await e.locator('[data-rail-slide="part1"]').click();
    await e.locator('[data-rail-slide="part2"]').click({ modifiers: ['Control'] });
    await e.getByRole('radio', { name: 'Seçili slaytlar (2)', exact: true }).click();
    await designer.getByRole('list', { name: 'Kayıtlı gradyanlar', exact: true }).getByRole('button', { name: 'Deneme okyanus', exact: true }).click();
    await e.locator('[data-guide-anchor="editor-save"]').click();
    await expect
      .poll(
        async () =>
          (await slides(page)).filter((s) => ['part1', 'part2'].includes(s.id) && s.styles?.backgroundImage).length
      )
      .toBe(2);
    result = await slides(page);
    for (const id of ['part1', 'part2']) {
      const s = result.find((s) => s.id === id),
        original = before.find((s) => s.id === id);
      expect(s.styles.backgroundImage).toBeTruthy();
      expect(s.parts).toEqual(original.parts);
      expect(s.partsMode).toBe(true);
      expect(s.items).toBeUndefined();
    }
    const entry = await page.evaluate(async () => (await window.electronAPI.listGradientLibrary())[0]);
    expect(entry.recipe.motion.enabled).toBe(true);
    await closeWorkspace(app);
    app = null;
    f = await launchWorkspace(info, 30000);
    app = f.app;
    page = f.page;
    await seed(page);
    expect((await page.evaluate(() => window.electronAPI.listGradientLibrary()))[0]).toEqual(entry);
    await page.getByTestId('gradient-quick-apply').click();
    await page.getByRole('button', { name: 'Deneme okyanus', exact: true }).click();
    await page.evaluate(() => window.__gradientStore.getState().openEditor('one'));
    await editor(page).getByRole('tab', { name: 'Slayt', exact: true }).click();
    const d = editor(page).getByTestId('gradient-designer');
    await d.getByRole('button', { name: /Deneme okyanus.*sil|sil.*Deneme okyanus/i }).click();
    expect(await page.evaluate(() => window.electronAPI.listGradientLibrary())).toEqual([]);
    expect(await page.evaluate(async (image) => (await fetch(image)).ok, entry.image)).toBe(true);
    expect((await slides(page))[0].styles.backgroundImage).toBe(entry.image);
  } finally {
    await closeWorkspace(app);
  }
});

test('late gradient results and generation/save failures cannot mutate a presentation', async ({}, info) => {
  test.setTimeout(90000);
  let app;
  try {
    const f = await launchWorkspace(info, 30000);
    app = f.app;
    const page = f.page;
    await seed(page);
    const before = await slides(page);
    await app.evaluate(({ ipcMain }) => {
      global.gradientRequests = [];
      global.gradientSaves = 0;
      ipcMain.removeHandler('gradient:generate');
      ipcMain.handle(
        'gradient:generate',
        (_, recipe) => new Promise((resolve, reject) => global.gradientRequests.push({ recipe, resolve, reject }))
      );
      ipcMain.removeHandler('gradient:save');
      ipcMain.handle('gradient:save', () => {
        global.gradientSaves++;
        throw new Error('Test disk failure');
      });
    });
    await page.getByTestId('gradient-quick-apply').click();
    await page.getByRole('button', { name: 'Editörde gradyan oluştur', exact: true }).click();
    const e = editor(page),
      d = e.getByTestId('gradient-designer'),
      save = e.locator('[data-guide-anchor="editor-save"]'),
      regenerate = d.getByRole('button', { name: 'Yeniden üret', exact: true });
    await d.locator('details.gradient-more > summary').click();
    const count = () => app.evaluate(() => global.gradientRequests.length);
    const saves = () => app.evaluate(() => global.gradientSaves);
    const background = () => e.getByTestId('editor-canvas-background').evaluate((el) => el.style.backgroundImage);
    const finish = (index) =>
      app.evaluate((_, index) => {
        const r = global.gradientRequests[index];
        r.resolve({
          token: 'token-' + index,
          recipe: r.recipe,
          image: 'data:image/jpeg;base64,' + Buffer.from('image-' + index).toString('base64'),
          contrast: [],
          byteLength: 4,
          hash: 'hash-' + index,
        });
      }, index);
    await regenerate.click();
    await expect.poll(count).toBe(1);
    const previous = await background();
    await regenerate.click();
    await expect.poll(count).toBe(2);
    // A result for a superseded recipe is neither previewed nor saved, even after the settle delay.
    await finish(0);
    await page.waitForTimeout(800);
    expect(await background()).toBe(previous);
    expect(await saves()).toBe(0);
    // The current result settles and is saved; a disk failure is reported and writes nothing.
    await finish(1);
    await expect(d.getByRole('alert')).toBeVisible();
    expect(await saves()).toBe(1);
    expect(await slides(page)).toEqual(before);
    await expect(save).toBeDisabled();
    // A render failure is reported the same way.
    await regenerate.click();
    await expect.poll(count).toBe(3);
    await app.evaluate(() => global.gradientRequests[2].reject(new Error('Test render failure')));
    await expect(d.getByRole('alert')).toBeVisible();
    expect(await saves()).toBe(1);
    expect(await slides(page)).toEqual(before);
    await expect(save).toBeDisabled();
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('gradient:save');
      ipcMain.handle(
        'gradient:save',
        () =>
          new Promise((resolve) => {
            global.gradientPendingSave = resolve;
          })
      );
    });
    await regenerate.click();
    await expect.poll(count).toBe(4);
    await finish(3);
    await expect.poll(() => app.evaluate(() => !!global.gradientPendingSave)).toBe(true);
    await e.locator('[data-rail-slide="three"]').click();
    await app.evaluate(() => global.gradientPendingSave('local-resource://media/delayed.jpg'));
    // Leaving the slide never drops a finished change: it reaches the editor draft, the presentation waits for Save.
    await expect(save).toBeEnabled();
    expect(await slides(page)).toEqual(before);
  } finally {
    await closeWorkspace(app);
  }
});

test('compact gradient panel adapts to content width and preserves colors, motion and keyboard access', async ({}, info) => {
  test.setTimeout(180000);
  let app;
  try {
    const f = await launchWorkspace(info, 30000);
    app = f.app;
    const page = f.page;
    await seed(page);
    await page.getByTestId('gradient-quick-apply').click();
    await page.getByRole('button', { name: 'Editörde gradyan oluştur', exact: true }).click();
    const e = editor(page),
      d = e.getByTestId('gradient-designer'),
      before = await slides(page);
    const motion = d.getByRole('switch', { name: 'Hareketli', exact: true }),
      animations = d.getByRole('group', { name: 'Animasyon', exact: true }),
      looks = d.getByRole('group', { name: 'Stil', exact: true }),
      aurora = animations.getByRole('button', { name: 'Aurora', exact: true });
    await expect(animations).toHaveCount(0);
    await motion.check();
    await aurora.click();
    await d.locator('details.gradient-more > summary').click();
    const speed = d.getByRole('slider', { name: /Hareket hızı/ }),
      amount = d.getByRole('slider', { name: /Hareket miktarı/ });
    await speed.focus();
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowRight');
    await amount.focus();
    await page.keyboard.press('End');
    await page.keyboard.press('ArrowLeft');
    const values = [await speed.inputValue(), await amount.inputValue()];
    await animations.getByRole('button', { name: 'Dalgalar', exact: true }).click();
    await aurora.click();
    await expect(aurora).toHaveAttribute('aria-pressed', 'true');
    await expect(speed).toHaveValue(values[0]);
    await expect(amount).toHaveValue(values[1]);
    await d
      .locator('input[type=color]')
      .first()
      .evaluate((input) => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '#123456');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });
    // A hand-picked color leaves every palette unselected.
    await expect(d.locator('.gradient-palette-chip[aria-pressed=true]')).toHaveCount(0);
    await looks.getByRole('button', { name: 'Yumuşak', exact: true }).click();
    await expect(d.locator('input[type=color]').first()).toHaveValue('#123456');
    await aurora.click();
    await expect(speed).toHaveValue(values[0]);
    await expect(amount).toHaveValue(values[1]);
    await looks.getByRole('button', { name: 'Akışkan', exact: true }).click();
    await expect(d.locator('input[type=color]').first()).toHaveValue('#123456');
    await d.getByRole('button', { name: 'Okyanus', exact: true }).click();
    await expect(d.getByRole('button', { name: 'Okyanus', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(d.locator('input[type=color]').first()).toHaveValue('#071b38');
    // Two-color styles have no motion; switching back restores the four-color field.
    await looks.getByRole('button', { name: 'Düz geçiş', exact: true }).click();
    await expect(d.locator('input[type=color]')).toHaveCount(2);
    await expect(motion).toHaveCount(0);
    await expect(d.getByRole('slider', { name: /Koyuluk/ })).toHaveValue('0');
    await looks.getByRole('button', { name: 'Akışkan', exact: true }).click();
    await expect(d.locator('input[type=color]')).toHaveCount(4);
    await motion.check();
    await aurora.click();
    for (const lang of ['tr', 'en', 'de', 'es', 'ko']) {
      await page.evaluate((lang) => window.__tourTest.language(lang), lang);
      for (const width of [220, 250, 255, 256, 270, 287, 288, 300]) {
        await d.evaluate((node, width) => {
          const panel = node.closest('#editor-inspector'),
            style = getComputedStyle(node);
          const content = node.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
          panel.style.width = panel.getBoundingClientRect().width + width - content + 'px';
          panel.style.maxWidth = 'none';
        }, width);
        const layout = await d.evaluate((node) => {
          const cols = (cls) => getComputedStyle(node.querySelector(cls)).gridTemplateColumns.split(' ').length;
          return {
            palettes: getComputedStyle(node.querySelector('.gradient-palettes')).display,
            colors: cols('.gradient-colors'),
            overflow: node.scrollWidth > node.clientWidth,
            controls: [...node.querySelectorAll('input[type=color]')].map(
              (input) => input.getBoundingClientRect().height
            ),
          };
        });
        expect(layout.palettes, lang + ' ' + width).toBe('flex');
        expect(layout.colors, lang + ' ' + width).toBe(4);
        expect(layout.overflow, lang + ' ' + width).toBe(false);
        // The compact designer uses 28px color swatches.
        expect(layout.controls.every((height) => height >= 28)).toBe(true);
      }
    }
    await d.evaluate((node) => {
      const panel = node.closest('#editor-inspector');
      panel.style.removeProperty('width');
      panel.style.removeProperty('max-width');
    });
    await page.evaluate(() => window.__tourTest.language('tr'));
    const capture = async (filename) => {
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const png = await app.evaluate(async ({ BrowserWindow }) =>
        (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64')
      );
      require('node:fs').writeFileSync(info.outputPath(filename), Buffer.from(png, 'base64'));
    };
    const within = async (locator) =>
      expect(
        await locator.evaluate((node) => {
          const r = node.getBoundingClientRect(),
            clip = node.closest('#editor-inspector-panel').getBoundingClientRect();
          // At 800x600/150%, existing editor headers leave less height than a whole
          // button. Require its complete label and clickable center to remain exposed.
          const range = document.createRange();
          range.selectNodeContents(node);
          const text = range.getBoundingClientRect();
          const center = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
          const hit = document.elementFromPoint(center.x, center.y);
          return {
            visible:
              r.left >= 0 &&
              r.right <= innerWidth + 1 &&
              text.top >= Math.max(0, clip.top) - 1 &&
              text.bottom <= Math.min(innerHeight, clip.bottom) + 1 &&
              !!hit &&
              (hit === node || node.contains(hit)),
          };
        })
      ).toEqual({ visible: true });
    await expect(applied(d)).toBeVisible({ timeout: 40000 });
    const saveToLibrary = d.getByRole('button', { name: 'Kütüphaneye kaydet', exact: true });
    for (const [width, height] of [
      [1920, 1080],
      [1366, 768],
      [800, 600],
    ])
      for (const zoom of [1, 1.25, 1.5]) {
        await resize(app, width, height);
        await app.evaluate(
          ({ BrowserWindow }, zoom) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(zoom),
          zoom
        );
        await expect.poll(() => page.evaluate(() => innerWidth)).toBeCloseTo(width / zoom, 0);
        if ((await e.locator('#editor-inspector').getAttribute('aria-hidden')) === 'true')
          await e.getByRole('button', { name: 'Editör panelleri', exact: true }).click();
        await d.locator('.gradient-colors').scrollIntoViewIfNeeded();
        await capture('compact-gradient-colors-' + width + '-' + zoom + '.png');
        await saveToLibrary.scrollIntoViewIfNeeded();
        await within(saveToLibrary);
        expect(await d.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
        await saveToLibrary.click();
        const name = d.getByLabel('Gradyan adı', { exact: true });
        await expect(name).toBeVisible();
        await name.fill('Yerleşim denemesi');
        const confirm = d.getByRole('button', { name: 'Tasarımı kaydet', exact: true });
        await confirm.scrollIntoViewIfNeeded();
        await within(confirm);
        await capture('compact-gradient-' + width + '-' + zoom + '.png');
        await saveToLibrary.click();
      }
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1));
    await resize(app, 800, 600);
    await expect(e.locator('[data-guide-anchor=editor-save]')).toBeEnabled();
    expect(await slides(page)).toEqual(before);
    // The background type switch removes the gradient and stays reachable by keyboard.
    const clear = e.getByRole('radio', { name: 'Renk', exact: true });
    await clear.scrollIntoViewIfNeeded();
    await clear.focus();
    await expect(clear).toBeFocused();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    await expect(clear).toBeFocused();
    await clear.click();
    await expect(d).toHaveCount(0);
    await clear.focus();
    await page.keyboard.press('Escape');
    await expect(e.locator('#editor-inspector')).toHaveAttribute('aria-hidden', 'true');
  } finally {
    await closeWorkspace(app);
  }
});
