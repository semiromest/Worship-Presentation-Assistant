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
    await source.dragTo(target, { sourcePosition: { x: 10, y: 40 }, targetPosition: { x: 10, y: 40 } });
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
  await page.getByRole('button', { name: 'Editörde gradient oluştur', exact: true }).click();
  const editor = page.locator('[aria-labelledby="slide-editor-title"]');
  const designer = editor.getByTestId('gradient-designer');
  await designer.getByRole('button', { name: 'Yeniden üret', exact: true }).click();
  await expect(designer.getByRole('button', { name: 'Taslağa uygula · 1 slayt', exact: true })).toBeEnabled({timeout:40000});
  await designer.getByLabel('Canlı hareket', { exact: true }).check();
  const canvas = editor.locator('canvas.animated-gradient-background'); await expect(canvas).toHaveCount(1);
  const image = await canvas.evaluate(el => el.toDataURL());
  await expect.poll(() => canvas.evaluate(el => el.toDataURL()), { timeout: 5000 }).not.toBe(image);
  expect(await page.evaluate(() => window.__fixStore.getState().presentation.slides[0].styles.generatedBackground)).toBeUndefined();
  await designer.getByLabel('Canlı hareket', { exact: true }).uncheck(); await expect(canvas).toHaveCount(0);
});

test('external image file drops before a target and selects the inserted image; empty-space drops append', async ({}, info) => {
  const fs = require('node:fs');
  const imagePath = info.outputPath('drop.png');
  fs.writeFileSync(imagePath, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1kAAAAASUVORK5CYII=', 'base64'));
  await seed(['a','b','c'].map(textSlide));
  await page.evaluate(() => { const input = document.createElement('input'); input.type = 'file'; input.id = 'regression-image-file'; input.hidden = true; document.body.append(input); });
  await page.locator('#regression-image-file').setInputFiles(imagePath);
  async function drop(selector) {
    await page.locator(selector).evaluate(el => {
      const dt = new DataTransfer(); dt.items.add(document.querySelector('#regression-image-file').files[0]);
      el.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    });
  }
  await drop('[data-slide-id="b"]');
  await expect.poll(() => page.evaluate(() => window.__fixStore.getState().presentation.slides.map(s => s.type))).toEqual(['text','image','text','text']);
  expect(await page.evaluate(() => { const s = window.__fixStore.getState(); return s.selectedSlideId === s.presentation.slides[1].id; })).toBe(true);
  await page.keyboard.press('Control+z');
  await expect.poll(() => page.evaluate(() => window.__fixStore.getState().presentation.slides.map(s => s.id))).toEqual(['a','b','c']);
  await drop('.design-slide-grid > [data-guide-scroll]');
  await expect.poll(() => page.evaluate(() => window.__fixStore.getState().presentation.slides.map(s => s.type))).toEqual(['text','text','text','image']);
});

test('part transitions preserve the live background media instance, including no-effect navigation', async () => {
  const slide = hymn(); slide.styles.backgroundVideo = 'file:///nonexistent-background-for-identity-check.mp4';
  await seed([slide, textSlide('end')]);
  const video = page.locator('.design-live-preview video'); await expect(video).toHaveCount(1);
  await video.evaluate(el => el.dataset.identityCheck = 'persistent');
  for (const type of ['fade', 'slideLeft', 'none']) {
    await page.getByRole('combobox', { name: 'Geçiş Türü', exact: true }).selectOption(type);
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
