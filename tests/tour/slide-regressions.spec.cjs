const { test, expect } = require('@playwright/test');
const { launchWorkspace, closeWorkspace } = require('./workspace-test-utils.cjs');
let app, page;
test.beforeEach(async ({}, info) => {
  ({ app, page } = await launchWorkspace(info, 30000));
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.unmaximize(); w.setContentSize(1366, 768); });
  await page.evaluate(async () => {
    await window.__tourTest.language('tr');
    window.__fixStore = (await import('/src/renderer/state/useStore.ts')).useStore;
    const s = window.__fixStore.getState(); s.setLiveSaveEnabled(false); s.setServiceSectionsEnabled(false); s.setActiveTab('slides'); s.setIsRightPanelOpen(true);
  });
});
test.afterEach(async () => { await closeWorkspace(app); app = null; });
async function seed(slides, selected = slides[0].id, selection = [selected]) {
  await page.evaluate(({ slides, selected, selection }) => { const s = window.__fixStore.getState(); s.dispatchUndo({ type: 'RESET', payload: { id: 'regression-deck', name: 'Regression', transition: { type: 'fade', duration: 800 }, slides } }); s.selectSlides({ activeId: selected, ids: new Set(selection), anchorIndex: slides.findIndex(s => s.id === selected) }); }, { slides, selected, selection });
}
const textSlide = id => ({ id, type: 'text', content: id, styles: { fontSize: 82, textColor: '#fff', backgroundColor: '#000' } });
const hymn = () => ({ ...textSlide('hymn'), content: 'First verse', partsMode: true, parts: ['First verse', 'Second verse', 'Third verse'], activePart: 0, group: { id: 'g', title: 'Example hymn', author: 'Example author', part: 1, parts: 3 } });

test('screen capture can preview sources, refresh, and add the chosen source as a slide', async ({}, info) => {
  const thumbnail = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 90"%3E%3Crect width="160" height="90" fill="%23334967"/%3E%3Crect x="15" y="12" width="130" height="66" rx="3" fill="%236b8cb5"/%3E%3C/svg%3E';
  await app.evaluate(({ ipcMain }, thumbnail) => {
    ipcMain.removeHandler('get-screen-sources');
    ipcMain.handle('get-screen-sources', () => [
      { id: 'screen:1:0', name: 'Deneme ekranı', thumbnail },
      { id: 'window:2:0', name: 'Deneme penceresi', thumbnail },
    ]);
  }, thumbnail);
  await page.evaluate(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const stream = canvas.captureStream(20);
      const [track] = stream.getVideoTracks();
      const timer = setInterval(() => {
        if (track.readyState === 'ended') clearInterval(timer);
        else { ctx.fillStyle = '#334967'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
      }, 50);
      window.__testScreenTrack = track;
      return stream;
    };
    window.__fixStore.getState().setActiveTab('screen');
  });
  const workspace = page.locator('.screen-page');
  const start = workspace.getByRole('button', { name: 'Önizlemeyi başlat', exact: true });
  const secondSource = workspace.getByRole('button', { name: /^Deneme penceresi/ });
  await expect(start).toBeDisabled();
  await workspace.getByRole('button', { name: /^Deneme ekranı/ }).press('Enter');
  await expect(workspace.locator('.screen-stage-thumbnail')).toBeVisible();
  await page.screenshot({ path: info.outputPath('screen-workspace.png'), animations: 'disabled' });
  await start.click();
  await expect(workspace.locator('video')).toBeVisible();
  await workspace.getByRole('button', { name: 'Yenile', exact: true }).click();
  await expect(workspace.getByRole('button', { name: 'Yenile', exact: true })).toBeEnabled();
  await expect(workspace.locator('video')).toBeVisible();
  await secondSource.click();
  await expect(secondSource).toHaveAttribute('aria-pressed', 'true');
  await expect(workspace.locator('video')).toBeHidden();
  expect(await page.evaluate(() => window.__testScreenTrack.readyState)).toBe('ended');

  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(800, 600));
  await expect.poll(() => workspace.evaluate(element => element.scrollWidth === element.clientWidth)).toBe(true);
  await workspace.getByRole('button', { name: 'Slayt Olarak Ekle', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__fixStore.getState().presentation.slides.at(-1)))
    .toMatchObject({ type: 'screen', mediaUrl: 'window:2:0', content: 'Deneme penceresi' });
});

test('calendar keeps a saved event on the selected day across tab changes', async ({}, info) => {
  const switchTab = tab => page.evaluate(tab => window.__fixStore.getState().setActiveTab(tab), tab);
  await switchTab('calendar');
  const calendar = page.locator('.calendar-page');
  await calendar.getByRole('button', { name: 'Sonraki ay', exact: true }).click();
  const nextDay = await calendar.locator('.calendar-day[aria-pressed="true"]').getAttribute('aria-label');
  await calendar.getByRole('button', { name: 'Bugün', exact: true }).click();
  const today = calendar.locator('.calendar-day[aria-current="date"]');
  await expect(today).toHaveAttribute('aria-pressed', 'true');
  expect(await today.getAttribute('aria-label')).not.toBe(nextDay);
  const spilloverDay = calendar.locator('.calendar-day[data-outside]').last();
  await spilloverDay.focus();
  await page.keyboard.press('Enter');
  await expect(calendar.locator('.calendar-day[aria-pressed="true"]')).toBeFocused();
  await calendar.getByRole('button', { name: 'Bugün', exact: true }).click();

  await calendar.getByRole('button', { name: 'Etkinlik Ekle', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox', { name: 'Başlık', exact: true }).fill('Takvim deneme etkinliği');
  await dialog.getByRole('button', { name: 'Yeşil', exact: true }).click();
  await dialog.getByRole('button', { name: 'Kaydet', exact: true }).click();
  const agenda = calendar.getByRole('complementary');
  await expect(agenda.getByText('Takvim deneme etkinliği', { exact: true })).toBeVisible();
  await switchTab('slides');
  await switchTab('calendar');
  await expect(agenda.getByText('Takvim deneme etkinliği', { exact: true })).toBeVisible();
  const desktopGutters = await calendar.evaluate(element => {
    const page = element.getBoundingClientRect();
    const month = element.querySelector('.calendar-month-panel').getBoundingClientRect();
    const agenda = element.querySelector('.calendar-agenda-panel').getBoundingClientRect();
    return [month.left - page.left, page.right - agenda.right, page.bottom - month.bottom];
  });
  for (const gutter of desktopGutters) expect(gutter).toBeCloseTo(12, 0);
  await page.screenshot({ path: info.outputPath('calendar-desktop.png'), animations: 'disabled' });

  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(800, 600));
  await expect.poll(() => calendar.evaluate(element => element.scrollWidth === element.clientWidth)).toBe(true);
});

test('editable scripture and hymn text frames fill the canvas with their text inset', async () => {
  const scripture = { ...textSlide('scripture'), scripture: true, content: 'Yuhanna 1:1\n\n1. Başlangıçta Söz vardı.' };
  const hymnSlide = { ...textSlide('hymn-verse'), content: 'İlahi dizesi', group: { id: 'song', kind: 'hymn', title: 'İlahi', part: 1, parts: 2 } };
  await seed([scripture, hymnSlide]);
  const canvas = page.locator('.editor-canvas-stage');
  const item = canvas.locator('[data-editor-item-id]');
  for (const slide of [scripture, hymnSlide]) {
    await page.evaluate(id => window.__fixStore.getState().openEditor(id), slide.id);
    await expect(item).toHaveText(slide.content);
    const frame = await item.evaluate(element => ({
      width: element.style.width,
      height: element.style.height,
      top: element.style.top,
      left: element.style.left,
      inset: getComputedStyle(element).padding,
    }));
    expect(frame).toEqual({ width: '100%', height: '100%', top: '0%', left: '0%', inset: '54px 96px' });
  }

  await item.dblclick();
  await item.locator('textarea').fill('Düzenlenmiş ilahi dizesi');
  await page.locator('[data-guide-anchor="editor-save"]').click();
  await expect.poll(() => page.evaluate(() => window.__fixStore.getState().presentation.slides.find(slide => slide.id === 'hymn-verse')))
    .toMatchObject({
      content: 'Düzenlenmiş ilahi dizesi',
      group: { id: 'song', kind: 'hymn', part: 1, parts: 2 },
      items: [{ type: 'text', x: 0, y: 0, width: 100, height: 100, textStyles: { fontSize: 82, insetPercent: 5 } }],
    });
});

test('opening a legacy image keeps it fitted and all four resize handles usable', async () => {
  const image = { id: 'legacy-image', type: 'image',
    mediaUrl: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="160" height="90"%3E%3Crect width="160" height="90" fill="orange"/%3E%3C/svg%3E',
    styles: { backgroundColor: '#000', textColor: '#fff', fontSize: 48, objectFit: 'cover' } };
  await seed([image]);
  await page.evaluate(() => window.__fixStore.getState().openEditor('legacy-image'));
  const canvas = page.locator('.editor-canvas-stage');
  const picture = canvas.locator('[data-editor-item-id] img');
  await expect(picture).toBeVisible();
  const measured = await picture.evaluate(img => {
    const frame = img.closest('.slide-surface').getBoundingClientRect();
    const item = img.getBoundingClientRect();
    return { width: item.width / frame.width, height: item.height / frame.height, fit: getComputedStyle(img).objectFit };
  });
  expect(measured.width).toBeCloseTo(1);
  expect(measured.height).toBeCloseTo(1);
  expect(measured.fit).toBe('cover');

  const item = canvas.locator('[data-editor-item-id]');
  await item.click();
  const handles = item.locator('[data-editor-resize-corner]');
  await expect(handles).toHaveCount(4);
  const hitTargets = () => handles.evaluateAll(elements => elements.map(element => {
    const { x, y, width, height } = element.getBoundingClientRect();
    // Aim outside the visible marker, on the enlarged part of the target.
    const point = { x: x + 5, y: y + height / 2 };
    return { width, height, hit: document.elementFromPoint(point.x, point.y) === element, point };
  }));
  const checkHitTargets = targets => {
    for (const target of targets) {
      expect(target.width).toBeCloseTo(30, 0);
      expect(target.height).toBeCloseTo(30, 0);
      expect(target.hit).toBe(true);
    }
  };
  const atFullSize = await hitTargets();
  checkHitTargets(atFullSize);
  const initialWidth = (await item.boundingBox()).width;
  const { x, y } = atFullSize[3].point;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 100, y - 70, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => (await item.boundingBox()).width).toBeLessThan(initialWidth - 50);

  await canvas.getByRole('button', { name: 'Uzaklaştır', exact: true }).click();
  checkHitTargets(await hitTargets());

  const beforeAltResize = await item.boundingBox();
  const corner = (await hitTargets())[3].point;
  await page.mouse.move(corner.x, corner.y);
  await page.keyboard.down('Alt');
  try {
    await page.mouse.down();
    await page.mouse.move(corner.x - 90, corner.y, { steps: 5 });
    await page.mouse.up();
  } finally {
    await page.keyboard.up('Alt');
  }
  await expect.poll(async () => (await item.boundingBox()).width).toBeLessThan(beforeAltResize.width - 50);
  const afterAltResize = await item.boundingBox();
  expect(afterAltResize.width / afterAltResize.height).toBeCloseTo(beforeAltResize.width / beforeAltResize.height, 2);
});

test('saving a live layer preserves a reusable draft without changing its published content', async () => {
  const trigger = page.getByTestId('live-overlays-trigger');
  await trigger.click();
  const draft = page.getByRole('textbox', { name: /Duyuru metni/ });
  await draft.fill('Yayındaki duyuru');
  await page.getByRole('button', { name: 'Yayına al', exact: true }).click();
  await draft.fill('Daha sonra yayınlanacak duyuru');
  await page.getByRole('radio', { name: 'Alt', exact: true }).click();
  await page.getByRole('button', { name: 'Yayına almadan kaydet', exact: true }).click();
  const readTicker = () => page.evaluate(async () => (await import('/src/renderer/state/useLiveOverlayStore.ts')).useLiveOverlayStore.getState().ticker);
  expect(await readTicker()).toEqual({ text: 'Yayındaki duyuru', position: 'top', onAir: true });
  await page.keyboard.press('Escape');
  await expect(draft).toBeHidden();
  await trigger.click();
  await expect(draft).toHaveValue('Daha sonra yayınlanacak duyuru');
  await expect(page.getByRole('radio', { name: 'Alt', exact: true })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('button', { name: 'Güncelle', exact: true }).click();
  expect(await readTicker()).toEqual({ text: 'Daha sonra yayınlanacak duyuru', position: 'bottom', onAir: true });
});

test('large section bodies keep bounded DOM and navigate to offscreen selections after resize', async () => {
  await expect(page.locator('.design-slide-grid')).toBeVisible();
  await page.evaluate(() => window.__fixStore.getState().setServiceSectionsEnabled(true));
  await seed(Array.from({ length: 5000 }, (_, i) => ({ ...textSlide('virtual-' + i),
    section: { id: 'section-' + Math.floor(i / 1000), title: 'Section ' + Math.floor(i / 1000) } })));
  const cardCount = () => page.evaluate(() => document.querySelectorAll('[data-section-slide]').length);
  await expect.poll(cardCount).toBeLessThan(100);
  await expect(page.locator('[data-section-id]')).toHaveCount(5);
  const scroll = page.locator('.design-slide-grid > [data-guide-scroll]');
  await page.evaluate(() => window.__fixStore.getState().selectSlides({ activeId: 'virtual-4500', ids: new Set(['virtual-4500']) }));
  await expect(page.locator('[data-slide-id="virtual-4500"]')).toBeInViewport();
  await expect.poll(cardCount).toBeLessThan(100);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1100, 768));
  await scroll.evaluate(el => { el.scrollTop = el.scrollHeight; el.dispatchEvent(new Event('scroll')); });
  await expect(page.locator('[data-slide-id="virtual-4999"]')).toBeInViewport();
  await expect.poll(cardCount).toBeLessThan(100);
  await page.locator('#slide-content-textarea').fill('Updated offscreen selection');
  await expect.poll(() => page.evaluate(() => window.__fixStore.getState().presentation.slides[4500].content)).toBe('Updated offscreen selection');
  await page.evaluate(() => window.__fixStore.getState().dispatchUndo({ type: 'UNDO' }));
  await expect.poll(() => page.evaluate(() => window.__fixStore.getState().presentation.slides[4500].content)).toBe('virtual-4500');
});

test('editor loads on first use and keeps the mounted workspace across tab changes', async () => {
  const workspace = page.locator('.editor-workspace');
  await expect(workspace).toHaveCount(0);
  await seed([textSlide('lazy-editor')]);
  await page.evaluate(() => window.__fixStore.getState().setActiveTab('editor'));
  await expect(workspace).toBeVisible();
  await page.evaluate(() => { window.__editorWorkspace = document.querySelector('.editor-workspace'); window.__fixStore.getState().setActiveTab('slides'); });
  await expect(workspace).toBeHidden();
  await page.evaluate(() => window.__fixStore.getState().setActiveTab('editor'));
  await expect(workspace).toBeVisible();
  expect(await page.evaluate(() => document.querySelector('.editor-workspace') === window.__editorWorkspace)).toBe(true);
});

test('confirming discard once closes the editor and clears the draft and its history', async () => {
  await seed([textSlide('original')]);
  const workspace = page.locator('.editor-workspace');
  const addText = workspace.getByRole('button', { name: 'Metin', exact: true });
  const discard = workspace.getByRole('button', { name: 'Kaydetmeden Çık', exact: true });
  const dialog = page.getByRole('dialog', { name: 'Kaydedilmemiş Değişiklikler' });
  const canvasItems = workspace.locator('[data-editor-item-id]');
  const openEditor = () => page.evaluate(() => window.__fixStore.getState().openEditor('original'));

  await openEditor();
  await expect(canvasItems).toHaveCount(1);
  await addText.click();
  await expect(canvasItems).toHaveCount(2);
  await discard.click();
  await dialog.getByRole('button', { name: 'İptal', exact: true }).click();
  await expect(workspace).toBeVisible();
  await expect(canvasItems).toHaveCount(2);

  await discard.click();
  await dialog.getByRole('button', { name: 'Kaydetmeden Çık', exact: true }).click();
  await expect(workspace).toBeHidden({ timeout: 3000 });
  await expect(page.locator('.design-slide-grid')).toBeVisible();
  expect(await page.evaluate(() => {
    const { editorDirty, presentation } = window.__fixStore.getState();
    return { editorDirty, slide: presentation.slides[0] };
  })).toMatchObject({ editorDirty: false, slide: textSlide('original') });

  await openEditor();
  await expect(canvasItems).toHaveCount(1);
  await expect(discard).toBeDisabled();
  await expect(workspace.getByRole('button', { name: 'Geri Al (Ctrl+Z)', exact: true })).toBeDisabled();
});

test('item cards share grid dimensions without adding card or item resize observers', async () => {
  await page.evaluate(() => {
    const NativeObserver = window.ResizeObserver;
    window.__resizeTargets = new Map();
    window.ResizeObserver = class extends NativeObserver {
      constructor(callback) { super(callback); this.targets = new Set(); }
      observe(target, options) { this.targets.add(target); window.__resizeTargets.set(this, this.targets); super.observe(target, options); }
      unobserve(target) { this.targets.delete(target); super.unobserve(target); }
      disconnect() { window.__resizeTargets.delete(this); super.disconnect(); }
    };
  });
  await seed([{ ...textSlide('measured-items'), items: [{ id: 'text-item', type: 'text', content: 'Measured text', x: 10, y: 10, width: 80, height: 80 }] }]);
  const card = page.locator('[data-slide-id="measured-items"]');
  await expect(card).toBeVisible();
  const measurements = () => card.evaluate(card => {
    const preview = card.querySelector('.aspect-video.isolate');
    const itemViewport = preview.firstElementChild;
    const targets = [...window.__resizeTargets.values()].flatMap(targets => [...targets]);
    return { parentObservers: targets.filter(target => target === preview).length,
      childObservers: targets.filter(target => target === itemViewport).length,
      width: preview.clientWidth, scale: itemViewport.firstElementChild.style.transform };
  });
  await expect.poll(async () => (await measurements()).parentObservers).toBe(0);
  expect((await measurements()).childObservers).toBe(0);
  const before = await measurements();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1100, 768));
  await expect.poll(()=>page.evaluate(()=>innerWidth)).toBe(1100);
  // A fixed column count scales the cards with the available width.
  await expect.poll(async () => (await measurements()).width).not.toBe(before.width);
  await expect.poll(async () => (await measurements()).scale).not.toBe(before.scale);
  const resized = await measurements();
  await page.locator('[data-columns-action="decrease"]').click();
  await expect.poll(async () => (await measurements()).width).not.toBe(resized.width);
  await expect.poll(async () => (await measurements()).scale).not.toBe(resized.scale);
  expect((await measurements()).parentObservers).toBe(0);
  expect((await measurements()).childObservers).toBe(0);
});

test('single and bulk deletion retain viewport in flat and section layouts', async () => {
  for (const sections of [false, true]) {
    await page.evaluate(sections => window.__fixStore.getState().setServiceSectionsEnabled(sections), sections);
    await seed(Array.from({ length: 100 }, (_, i) => textSlide('s' + i)), 's60');
    const scroll = page.locator('.design-slide-grid > [data-guide-scroll]');
    await scroll.evaluate(el => { el.scrollTop = 1800; el.dispatchEvent(new Event('scroll')); });
    await expect.poll(() => scroll.evaluate(el => el.scrollTop)).toBeGreaterThan(200);
    await page.waitForTimeout(120);
    const before = await scroll.evaluate(el => el.scrollTop);
    await page.locator('.design-editor-heading button').filter({ has: page.locator('svg.lucide-trash2') }).click();
    await expect.poll(() => page.evaluate(() => window.__fixStore.getState().presentation.slides.length)).toBe(99);
    expect(Math.abs(await scroll.evaluate(el => el.scrollTop) - before)).toBeLessThan(3);
    expect(await page.evaluate(() => window.__fixStore.getState().selectedSlideId)).toBe('s61');
    expect(await page.evaluate(() => [...window.__fixStore.getState().selectedSlideIds])).toEqual(['s61']);
    await page.evaluate(() => window.__fixStore.getState().selectSlides({ activeId: 's61', ids: new Set(['s61', 's62']), anchorIndex: 60 }));
    await page.locator('.design-selection-tools .design-delete').click();
    await expect.poll(() => page.evaluate(() => window.__fixStore.getState().presentation.slides.length)).toBe(97);
    expect(Math.abs(await scroll.evaluate(el => el.scrollTop) - before)).toBeLessThan(3);
  }
});

test('nonadjacent selection drags before the target in both layouts and undoes atomically', async () => {
  for (const sections of [false, true]) {
    await page.evaluate(sections => window.__fixStore.getState().setServiceSectionsEnabled(sections), sections);
    await seed(['a','b','c','d','e','f'].map(textSlide), 'c', ['a','c']);
    const source = page.locator('[data-slide-id="a"]'), target = page.locator('[data-slide-id="f"]');
    await expect(source).toBeInViewport();
    await expect(target).toBeInViewport();
    const sourceBox = await source.boundingBox();
    await page.mouse.move(sourceBox.x + 10, sourceBox.y + 40); await page.mouse.down();
    await page.mouse.move(sourceBox.x + 30, sourceBox.y + 50, { steps: 5 });
    await expect.poll(() => source.evaluate(el => Number(getComputedStyle(el).opacity))).toBe(0.5);
    const targetBox = await target.boundingBox();
    await page.mouse.move(targetBox.x + 10, targetBox.y + 40, { steps: 5 });
    await page.mouse.move(targetBox.x + 12, targetBox.y + 42);
    await expect(page.locator('[data-slide-insertion-indicator]')).toBeVisible();
    await page.mouse.up();
    await expect.poll(() => page.evaluate(() => window.__fixStore.getState().presentation.slides.map(s => s.id))).toEqual(['b','d','e','a','c','f']);
    expect(await page.evaluate(() => [...window.__fixStore.getState().selectedSlideIds].sort())).toEqual(['a','c']);
    await page.keyboard.press('Control+z');
    await expect.poll(() => page.evaluate(() => window.__fixStore.getState().presentation.slides.map(s => s.id))).toEqual(['a','b','c','d','e','f']);
  }
});

test('part edits persist after navigation and undo; credit size is independent of lyrics', async () => {
  await seed([hymn(), textSlide('end')]);
  const credit = page.locator('[data-slide-id="hymn"] [data-slide-credit]');
  const size = await credit.evaluate(el => getComputedStyle(el).fontSize);
  await page.locator('#slide-font-size').fill('140');
  await expect(credit).toHaveCSS('font-size', size);
  await page.locator('[data-hymn-part="1"]').click();
  const content = page.locator('#slide-content-textarea'); await content.fill('Edited second verse\nNew line');
  await expect.poll(() => page.evaluate(() => window.__fixStore.getState().presentation.slides[0].parts[1])).toBe('Edited second verse\nNew line');
  await page.locator('[data-hymn-part="2"]').click(); await page.locator('[data-hymn-part="1"]').click();
  await expect(content).toHaveValue('Edited second verse\nNew line');
  await page.keyboard.press('Control+z'); await page.keyboard.press('Control+z'); await page.keyboard.press('Control+z');
  await expect.poll(() => page.evaluate(() => window.__fixStore.getState().presentation.slides[0].parts[1])).toBe('Second verse');
});

test('hymn parts animate with selected transition and typing does not animate', async () => {
  await seed([hymn(), textSlide('end')]);
  await page.waitForTimeout(950);
  await page.locator('[data-hymn-part="1"]').click();
  const incoming = page.locator('.design-live-preview [data-part-transition="incoming"]');
  await expect(incoming).toHaveCSS('animation-name', 'tr-fadeIn');
  await expect(page.locator('.design-live-preview [data-part-transition]')).toHaveCount(2);
  await expect(page.locator('.design-live-preview [data-part-transition]')).toHaveCount(0, { timeout: 2000 });
  await page.locator('#slide-content-textarea').fill('Revised verse');
  await expect(page.locator('.design-live-preview [data-slide-transition]')).toHaveCount(1);
  await expect(page.locator('.design-live-preview [data-part-transition]')).toHaveCount(0);
});

test('gradient designer shows moving pixels on a parts-mode hymn canvas without mutating the deck', async () => {
  test.setTimeout(90000);
  await seed([hymn(), textSlide('end')]);
  await page.getByTestId('gradient-quick-apply').click();
  await page.getByRole('button', { name: 'Editörde gradyan oluştur', exact: true }).click();
  const editor = page.locator('[aria-labelledby="slide-editor-title"]');
  const designer = editor.getByTestId('gradient-designer');
  const motion = designer.getByRole('switch', { name: 'Hareketli', exact: true });
  await motion.check();
  await designer.getByRole('group', { name: 'Animasyon', exact: true }).getByRole('button', { name: 'Aurora', exact: true }).click();
  // The designer applies the settled render to the editor draft by itself.
  await expect(designer.locator('.gradient-status').filter({ hasText: '1 slayta uygulandı' })).toBeVisible({timeout:40000});
  const canvas = editor.locator('canvas.animated-gradient-background'); await expect(canvas).toHaveCount(1);
  const image = await canvas.evaluate(el => el.toDataURL());
  await expect.poll(() => canvas.evaluate(el => el.toDataURL()), { timeout: 5000 }).not.toBe(image);
  expect(await page.evaluate(() => window.__fixStore.getState().presentation.slides[0].styles.generatedBackground)).toBeUndefined();
  await motion.uncheck(); await expect(canvas).toHaveCount(0);
});

test('external image file drops before a target and selects the inserted image; empty-space drops append', async ({}, info) => {
  const fs = require('node:fs');
  const imagePath = info.outputPath('drop.png');
  fs.writeFileSync(imagePath, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1kAAAAASUVORK5CYII=', 'base64'));
  await seed(['a','b','c'].map(textSlide));
  await page.evaluate(() => { const input = document.createElement('input'); input.type = 'file'; input.id = 'regression-image-file'; input.hidden = true; document.body.append(input); });
  await page.locator('#regression-image-file').setInputFiles(imagePath);
  async function drop(selector, after = false) {
    await page.locator(selector).evaluate((el, after) => {
      const dt = new DataTransfer(); dt.items.add(document.querySelector('#regression-image-file').files[0]);
      const rect = el.getBoundingClientRect();
      el.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: after ? rect.right - 10 : rect.left + 10, clientY: rect.top + 30 }));
    }, after);
  }
  await drop('[data-slide-id="b"]');
  await expect.poll(() => page.evaluate(() => window.__fixStore.getState().presentation.slides.map(s => s.type))).toEqual(['text','image','text','text']);
  expect(await page.evaluate(() => { const s = window.__fixStore.getState(); return s.selectedSlideId === s.presentation.slides[1].id; })).toBe(true);
  await page.keyboard.press('Control+z');
  await expect.poll(() => page.evaluate(() => window.__fixStore.getState().presentation.slides.map(s => s.id))).toEqual(['a','b','c']);
  await drop('[data-slide-end-drop]');
  await expect.poll(() => page.evaluate(() => window.__fixStore.getState().presentation.slides.map(s => s.type))).toEqual(['text','text','text','image']);
  await page.keyboard.press('Control+z');
  await drop('[data-slide-id="b"]', true);
  await expect.poll(() => page.evaluate(() => window.__fixStore.getState().presentation.slides.map(s => s.type))).toEqual(['text','text','image','text']);
  await page.keyboard.press('Control+z');
  await page.locator('[data-slide-id="b"]').evaluate(el=>{
    const dt=new DataTransfer();dt.items.add(document.querySelector('#regression-image-file').files[0]);
    const rect=el.getBoundingClientRect();el.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:dt,clientX:rect.left+10,clientY:rect.top+30}));
  });
  await page.evaluate(()=>{const s=window.__fixStore.getState();s.dispatchUndo({type:'RESET',payload:{...s.presentation,id:'another-deck'}});});
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await drop('[data-slide-id="b"]');
  expect(await page.evaluate(()=>window.__fixStore.getState().presentation.slides.map(s=>s.type))).toEqual(['text','text','text']);
  await page.locator('.design-slide-grid > [data-guide-scroll]').evaluate(el=>{
    const dt=new DataTransfer();dt.items.add(document.querySelector('#regression-image-file').files[0]);
    el.dispatchEvent(new DragEvent('dragleave',{bubbles:true,dataTransfer:dt,relatedTarget:document.body}));
  });
  await drop('[data-slide-id="b"]');
  await expect.poll(()=>page.evaluate(()=>window.__fixStore.getState().presentation.slides.map(s=>s.type))).toEqual(['text','image','text','text']);
  await page.evaluate(()=>{const s=window.__fixStore.getState();s.dispatchUndo({type:'RESET',payload:{id:'empty-deck',name:'Empty',slides:[],sections:[]}});});
  await expect(page.locator('[data-slide-end-drop]')).toBeVisible();
  await drop('[data-slide-end-drop]');
  await expect.poll(()=>page.evaluate(()=>window.__fixStore.getState().presentation.slides.map(s=>s.type))).toEqual(['image']);
  await page.evaluate(()=>{const s=window.__fixStore.getState();s.setServiceSectionsEnabled(true);s.dispatchUndo({type:'RESET',payload:{id:'empty-section-deck',name:'Empty sections',slides:[],sections:[]}});});
  await expect(page.locator('[data-slide-id]')).toHaveCount(0);
  await drop('.design-slide-grid > [data-guide-scroll]');
  await expect.poll(()=>page.evaluate(()=>window.__fixStore.getState().presentation.slides.map(s=>s.type))).toEqual(['image']);



});

test('part transitions preserve the live background media instance, including no-effect navigation', async () => {
  const slide = hymn(); slide.styles.backgroundVideo = 'file:///nonexistent-background-for-identity-check.mp4';
  await seed([slide, textSlide('end')]);
  const video = page.locator('.design-live-preview video'); await expect(video).toHaveCount(1);
  await video.evaluate(el => el.dataset.identityCheck = 'persistent');
  for (const type of ['fade', 'slideLeft', 'none']) {
    await page.getByRole('combobox', { name: 'Geçiş Türü', exact: true }).click();
    await page.locator(`[role="option"][data-value="${type}"]`).click();
    await page.locator('[data-hymn-part="1"]').click();
    await expect(video).toHaveCount(1); await expect(video).toHaveAttribute('data-identity-check','persistent');
    if (type !== 'none') await expect(page.locator('.design-live-preview [data-part-transition="incoming"]')).toHaveCSS('animation-duration','0.8s');
    await page.locator('[data-hymn-part="2"]').click();
    await expect(video).toHaveAttribute('data-identity-check','persistent');
    await page.locator('[data-hymn-part="0"]').click();
    await expect(video).toHaveAttribute('data-identity-check','persistent');
  }
});

test('dragging a selection survives scrolling outside the virtual range in both layouts', async () => {
  for (const sections of [false, true]) {
    await page.evaluate(sections => window.__fixStore.getState().setServiceSectionsEnabled(sections), sections);
    await seed(Array.from({ length: 100 }, (_, i) => textSlide('s' + i)), 's0', ['s0','s2']);
    const scroll = page.locator('.design-slide-grid > [data-guide-scroll]');
    await scroll.evaluate(el => { el.scrollTop = 0; el.dispatchEvent(new Event('scroll')); });
    const source = page.locator('[data-slide-id="s0"]'); await expect(source).toBeInViewport();
    const box = await source.boundingBox();
    await page.mouse.move(box.x + 10, box.y + 40); await page.mouse.down();
    await page.mouse.move(box.x + 30, box.y + 50, { steps: 5 });
    await expect.poll(() => source.evaluate(el => Number(getComputedStyle(el).opacity))).toBe(0.5);
    await scroll.evaluate(el => {
      const first = el.querySelector('[data-slide-id]'); const rect = first.getBoundingClientRect();
      const columns = [...el.querySelectorAll('[data-slide-id]')].filter(e => Math.abs(e.getBoundingClientRect().top - rect.top) < 2).length;
      el.scrollTop = Math.floor(60 / columns) * (rect.height + 12); el.dispatchEvent(new Event('scroll'));
    });
    await expect(source).toBeAttached(); await expect(source).not.toBeInViewport();
    const target = page.locator('[data-slide-id="s60"]'); await expect(target).toBeInViewport();
    const targetBox = await target.boundingBox();
    await page.mouse.move(targetBox.x + 10, targetBox.y + 40, { steps: 5 });
    await page.mouse.move(targetBox.x + 12, targetBox.y + 42); await page.mouse.up();
    await expect.poll(() => page.evaluate(() => { const slides = window.__fixStore.getState().presentation.slides; const i = slides.findIndex(s => s.id === 's60'); return slides.slice(i - 2, i + 1).map(s => s.id); })).toEqual(['s0','s2','s60']);
  }
});

test('the legacy named hymn adds as four editable parts through the library UI', async () => {
  await seed([textSlide('intro')]);
  await page.evaluate(() => {
    const lines = ["De Haleluya İsa'ya", 'Bir', 'İki', 'Üç', 'Seni seviyorum, Rabbim', 'Dört', 'Beş', 'Altı',
      "İsa gökte yerde Rab'dir", 'Yedi', 'Sekiz', 'Dokuz', 'Rab İsa tekrar gelecek', 'On', 'On bir', 'On iki'];
    localStorage.setItem('hymnsCache:v3:__online__', JSON.stringify([{id:'legacy-hymn', title:"De Haleluya İsa'ya", lyrics:lines.join('\n')}]));
    localStorage.setItem('hymnsPartsModeEnabled','1');
    window.__fixStore.getState().setActiveTab('hymns');
  });
  await page.locator('[data-hymn-id="legacy-hymn"] [data-hymn-action="add"]').click();
  await expect.poll(() => page.evaluate(() => window.__fixStore.getState().presentation.slides.at(-1).parts?.length)).toBe(4);
  await expect(page.locator('[data-hymn-part]')).toHaveCount(4);
});


test('logical gaps allow adjacent moves both ways without no-op history and preserve live identity', async () => {
  for (const sections of [false, true]) {
    await page.evaluate(sections => { const s=window.__fixStore.getState();s.setServiceSectionsEnabled(sections);s.setSlideColumns(3); }, sections);
    await seed(['a','b','c','d'].map(textSlide));
    await page.evaluate(()=>window.__fixStore.getState().setLiveIndex(1));
    const before=await page.evaluate(()=>window.__fixStore.getState().undoState.past.length);
    const a=page.locator('[data-slide-id="a"]'), b=page.locator('[data-slide-id="b"]');
    await a.dragTo(b,{targetPosition:{x:10,y:40}});
    expect(await page.evaluate(()=>window.__fixStore.getState().undoState.past.length)).toBe(before);
    const box=await b.boundingBox();
    await a.dragTo(b,{targetPosition:{x:box.width-10,y:40}});
    await expect.poll(()=>page.evaluate(()=>window.__fixStore.getState().presentation.slides.map(s=>s.id))).toEqual(['b','a','c','d']);
    expect(await page.evaluate(()=>window.__fixStore.getState().liveSlideId)).toBe('b');
    expect(await page.evaluate(()=>window.__fixStore.getState().selectedSlideId)).toBe('a');
    expect(await page.evaluate(()=>window.__fixStore.getState().undoState.past.length)).toBe(before+1);
    await page.keyboard.press('Control+z');
    await expect.poll(()=>page.evaluate(()=>window.__fixStore.getState().presentation.slides.map(s=>s.id))).toEqual(['a','b','c','d']);
    await b.dragTo(a,{targetPosition:{x:10,y:40}});
    await expect.poll(()=>page.evaluate(()=>window.__fixStore.getState().presentation.slides.map(s=>s.id))).toEqual(['b','a','c','d']);
  }
});

test('one-column drops use vertical halves and empty sections accept a moving slide', async () => {
  await page.evaluate(()=>{const s=window.__fixStore.getState();s.setIsRightPanelOpen(false);s.setSlideColumns(1);});
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(800,900));
  await seed(['a','b'].map(textSlide));
  const b=page.locator('[data-slide-id="b"]');await b.scrollIntoViewIfNeeded();
  // Synthetic native events supply actual hit coordinates without a browser-created scroll gesture.
  await page.evaluate(()=>{
    const a=document.querySelector('[data-slide-id="a"]'),b=document.querySelector('[data-slide-id="b"]');
    const dt=new DataTransfer();a.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:dt}));
    const rect=b.getBoundingClientRect();
    b.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dt,clientX:rect.left+20,clientY:Math.min(rect.bottom-12,innerHeight-12)}));
  });
  await expect.poll(()=>page.evaluate(()=>window.__fixStore.getState().presentation.slides.map(s=>s.id))).toEqual(['b','a']);
  await page.evaluate(()=>{
    const s=window.__fixStore.getState();s.setSlideColumns(3);s.setServiceSectionsEnabled(true);
    s.dispatchUndo({type:'RESET',payload:{id:'empty-section-test',name:'Sections',sections:[{id:'one',title:'One'},{id:'empty',title:'Empty'}],slides:[{id:'a',type:'text',content:'a',sectionId:'one'}]}});
    s.selectSlides({activeId:'a',ids:new Set(['a']),anchorIndex:0});
  });
  const empty=page.locator('[data-section-id="empty"] [data-slide-drop-area]');await empty.scrollIntoViewIfNeeded();
  await page.locator('[data-slide-id="a"]').dragTo(empty);
  await expect.poll(()=>page.evaluate(()=>window.__fixStore.getState().presentation.slides[0].sectionId)).toBe('empty');
});

test('edge autoscroll stops on Escape without a reorder and clears the indicator', async () => {
  await seed(Array.from({length:150},(_,i)=>textSlide('edge-'+i)));
  const scroll=page.locator('.design-slide-grid > [data-guide-scroll]');
  await expect(page.locator('[data-slide-id="edge-0"]')).toBeInViewport();
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await page.evaluate(()=>{
    window.__dragTransfer=new DataTransfer();
    document.querySelector('[data-slide-id="edge-0"]').dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:window.__dragTransfer}));
    const scroll=document.querySelector('.design-slide-grid > [data-guide-scroll]'),rect=scroll.getBoundingClientRect();
    scroll.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:window.__dragTransfer,clientX:rect.left+100,clientY:Math.min(innerHeight,rect.bottom)-2}));
  });
  await expect.poll(()=>scroll.evaluate(el=>el.scrollTop)).toBeGreaterThan(60);
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-slide-insertion-indicator]')).toHaveCount(0);
  const stopped=await scroll.evaluate(el=>el.scrollTop);
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  expect(await scroll.evaluate(el=>el.scrollTop)).toBe(stopped);
  expect(await page.evaluate(()=>window.__fixStore.getState().undoState.past.length)).toBe(0);
});


test('insertion line uses viewport coordinates and stays stable around the midpoint without editing the deck', async ({}, info) => {
  await page.evaluate(()=>window.__fixStore.getState().setSlideColumns(3));
  await seed(['a','b','c'].map(textSlide));
  await expect(page.locator('[data-slide-id="c"]')).toBeVisible();
  await page.evaluate(()=>{
    window.__gapTransfer=new DataTransfer();
    document.querySelector('[data-slide-id="a"]').dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:window.__gapTransfer}));
  });
  async function over(fraction){
    return page.locator('[data-slide-id="c"]').evaluate((el,fraction)=>{
      const rect=el.getBoundingClientRect();el.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:window.__gapTransfer,clientX:rect.left+rect.width*fraction,clientY:rect.top+40}));
      return rect.toJSON();
    },fraction);
  }
  const rect=await over(.4);
  const line=page.locator('[data-slide-insertion-indicator]');await expect(line).toBeVisible();
  expect(await line.evaluate(el=>getComputedStyle(el,'::before').width)).toBe('7px');
  expect(await line.evaluate(el=>getComputedStyle(el).pointerEvents)).toBe('none');
  await expect(line).toHaveAttribute('data-horizontal','false');
  await page.screenshot({path:info.outputPath('insertion-marker.png')});
  await expect.poll(async()=>Math.round((await line.boundingBox()).x)).toBe(Math.round(rect.left-7));
  expect(Math.round((await line.boundingBox()).y)).toBe(Math.round(rect.top));
  await over(.51);
  expect(Math.round((await line.boundingBox()).x)).toBe(Math.round(rect.left-7));
  await over(.7);
  await expect.poll(async()=>Math.round((await line.boundingBox()).x)).toBe(Math.round(rect.right+5));
  expect(await page.evaluate(()=>window.__fixStore.getState().presentation.slides.map(s=>s.id))).toEqual(['a','b','c']);
  await page.keyboard.press('Escape');await expect(line).toHaveCount(0);
  expect(await page.evaluate(()=>window.__fixStore.getState().undoState.past.length)).toBe(0);
});

test('background image and video selections replace old backgrounds and load through the media protocol',async({},info)=>{
  const fs=require('node:fs'),path=require('node:path');
  const image=info.outputPath('background image.png'),video=info.outputPath('background video.webm');
  const {createCanvas}=require('@napi-rs/canvas');const canvas=createCanvas(64,36);const ctx=canvas.getContext('2d');ctx.fillStyle='#19aa55';ctx.fillRect(0,0,64,36);fs.writeFileSync(image,canvas.toBuffer('image/png'));
  fs.copyFileSync(path.resolve('tests/fixtures/background.webm'),video);
  await app.evaluate(({dialog},files)=>{let i=0;dialog.showOpenDialog=async()=>({canceled:false,filePaths:[files[i++]]});},[image,video]);
  await seed([{...textSlide('background'),styles:{...textSlide('background').styles,backgroundGradient:{type:'linear',stops:[{color:'#000',position:0},{color:'#000',position:100}]}}},textSlide('other')]);
  const background=page.locator('.design-background');await background.getByRole('button',{name:'Resim',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>window.__fixStore.getState().presentation.slides[0].styles.backgroundImage)).toContain('background');
  expect(await page.evaluate(()=>window.__fixStore.getState().presentation.slides[0].styles.backgroundGradient??null)).toBe(null);
  await expect.poll(()=>page.locator('[data-slide-id="background"]').evaluate(async el=>{const nodes=[el,...el.querySelectorAll('*')];const node=nodes.find(n=>getComputedStyle(n).backgroundImage.includes('local-resource://thumbs/'));if(!node)return false;const url=getComputedStyle(node).backgroundImage.match(/url\("?(.*?)"?\)/)[1];return new Promise(resolve=>{const i=new Image();i.onload=()=>resolve(i.naturalWidth===64);i.onerror=()=>resolve(false);i.src=url;});})).toBe(true);
  await background.getByRole('button',{name:'Video',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>window.__fixStore.getState().presentation.slides[0].styles.backgroundVideo)).toContain('background');
  await page.locator('[data-slide-id="background"] video').evaluate(v=>v.play());
  await expect.poll(()=>page.locator('[data-slide-id="background"] video').evaluateAll(v=>v.map(e=>({ready:e.readyState,width:e.videoWidth,error:e.error?.message,src:e.currentSrc})))).toEqual([expect.objectContaining({width:64})]);
  await expect.poll(()=>page.locator('.design-live-preview video').evaluateAll(v=>v.some(e=>e.readyState>=2 && e.videoWidth===64))).toBe(true);
  const styles=await page.evaluate(()=>window.__fixStore.getState().presentation.slides[0].styles);expect(styles.backgroundImage).toBeUndefined();expect(styles.backgroundGradient).toBeUndefined();
  await page.keyboard.press('Control+z');await expect.poll(()=>page.evaluate(()=>window.__fixStore.getState().presentation.slides[0].styles.backgroundVideo??null)).toBe(null);
  expect(await page.evaluate(()=>window.__fixStore.getState().presentation.slides[1].styles.backgroundImage??null)).toBe(null);
});
