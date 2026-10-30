const { test, expect } = require('@playwright/test');
const { launchWorkspace, closeWorkspace } = require('./workspace-test-utils.cjs');
const en = require('../../src/renderer/locales/en/translation.json');
const styles = { fontSize: 60, textColor: '#ffffff', backgroundColor: '#000000' };
const image = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="blue"/><circle cx="150" cy="90" r="50" fill="gold"/></svg>');
let app, page, errors;
test.beforeEach(async ({}, info) => {
  ({ app, page } = await launchWorkspace(info, 30000));
  errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.unmaximize(); w.setContentSize(1600, 1000); });
  await page.evaluate(async () => {
    await window.__tourTest.language('en');
    window.__releaseStore = (await import('/src/renderer/state/useStore.ts')).useStore;
    const s = window.__releaseStore.getState();
    s.setLiveSaveEnabled(false); s.setServiceSectionsEnabled(false); s.setActiveTab('slides'); s.setIsRightPanelOpen(true);
  });
});
test.afterEach(async ({}, info) => {
  try {
    if (page && !page.isClosed() && info.status !== info.expectedStatus) await page.screenshot({ path: info.outputPath('failure.png') });
    expect(errors, 'uncaught renderer errors').toEqual([]);
  } finally { await closeWorkspace(app); app = page = undefined; }
});
async function seed(slide) {
  await page.evaluate(slide => {
    const s = window.__releaseStore.getState();
    s.dispatchUndo({ type: 'RESET', payload: { id: 'release', name: 'Release checks', transition: { type: 'none', duration: 0 }, slides: [slide, { id: 'untouched', type: 'text', content: 'Untouched', styles: { fontSize: 32, textColor: '#ffffff', backgroundColor: '#000000' } }] } });
    s.selectSlides({ activeId: slide.id, ids: new Set([slide.id]), anchorIndex: 0 }); s.setLiveIndex(0);
  }, { id: 'subject', content: 'Release text', styles: { ...styles }, ...slide });
}
const panel = () => page.getByTestId('right-panel');
const button = key => panel().getByRole('button', { name: en.common[key] ?? en.slidesWorkspace[key], exact: true });
const current = () => page.evaluate(() => window.__releaseStore.getState().presentation.slides[0]);
async function checkStyle(field, value) { await expect.poll(async () => (await current()).styles[field]).toEqual(value); }

for (const kind of ['text', 'hymn', 'scripture']) {
  test(`right panel ${kind}: content, font, every alignment and case preserve unrelated slides`, async () => {
    await seed({ type: 'text', ...(kind === 'hymn' ? { partsMode: true, parts: ['Release text', 'Second verse'], activePart: 0, group: { id: 'h', title: 'Hymn', part: 1, parts: 2 } } : kind === 'scripture' ? { content: 'In the beginning\nGenesis 1:1' } : {}) });
    const untouched = await page.evaluate(() => window.__releaseStore.getState().presentation.slides[1]);
    await panel().locator('#slide-content-textarea').fill('Updated text\nSecond line');
    await expect.poll(async () => (await current()).content).toBe('Updated text\nSecond line');
    await panel().locator('#slide-font-size').fill('72'); await checkStyle('fontSize', 72);
    for (const [field, choices] of [
      ['textAlign', [['editorAlignLeft', 'left'], ['editorAlignRight', 'right'], ['editorAlignCenterH', 'center']]],
      ['verticalAlign', [['editorAlignTop', 'top'], ['editorAlignBottom', 'bottom'], ['editorAlignMiddle', 'center']]],
      ['textTransform', [['textCaseUppercase', 'uppercase'], ['textCaseLowercase', 'lowercase'], ['textCaseOriginal', 'none']]],
    ]) for (const [key, value] of choices) {
      await button(key).click(); await checkStyle(field, value); await expect(button(key)).toHaveAttribute('aria-pressed', 'true');
    }
    await panel().locator('#slide-font-family').click();
    await page.getByRole('option', { name: 'Arial', exact: true }).click(); await checkStyle('fontFamily', 'Arial, sans-serif');
    await expect(page.locator('.design-live-preview')).toContainText('Updated text');
    if (kind === 'hymn') {
      await panel().locator('[data-hymn-part="1"]').click(); await expect(panel().locator('textarea').first()).toHaveValue('Second verse');
      await panel().locator('[data-hymn-part="0"]').click(); await expect(panel().locator('textarea').first()).toHaveValue('Updated text\nSecond line');
    }
    expect(await page.evaluate(() => window.__releaseStore.getState().presentation.slides[1])).toEqual(untouched);
  });
}

test('image quick editor: all filters, fit modes and flips affect the decoded preview and undo', async () => {
  await seed({ type: 'image', mediaUrl: image, content: '' });
  const preview = panel().locator('.design-selected-editor img').first();
  await expect.poll(() => preview.evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
  await panel().locator('summary').click();
  for (const [key, value] of [['editorFitCover', 'cover'], ['editorFitFill', 'fill'], ['editorFitContain', 'contain']]) {
    await button(key).click(); await checkStyle('objectFit', value); await expect(preview).toHaveCSS('object-fit', value);
  }
  for (const [key, field, value, css] of [
    ['editorOpacity', 'opacity', 0.05, null], ['editorBrightness', 'imageBrightness', 0.05, 'brightness(0.05)'],
    ['editorContrast', 'imageContrast', 0.05, 'contrast(0.05)'], ['editorBlur', 'imageBlur', 0.5, 'blur(0.5px)'],
    ['editorGrayscale', 'imageGrayscale', 0.05, 'grayscale(0.05)'], ['editorSepia', 'imageSepia', 0.05, 'sepia(0.05)'],
  ]) {
    const slider = panel().getByRole('slider', { name: en.common[key], exact: true });
    await slider.focus(); await page.keyboard.press('Home'); await page.keyboard.press('ArrowRight');
    await checkStyle(field, value);
    if (css) await expect(preview).toHaveCSS('filter', new RegExp(css.replace(/[()]/g, '\\$&')));
    else await expect(preview).toHaveCSS('opacity', String(value));
  }
  for (const [key, field] of [['editorFlipX', 'imageFlipX'], ['editorFlipY', 'imageFlipY']]) { await button(key).click(); await checkStyle(field, true); }
  await expect(preview).toHaveCSS('transform', 'matrix(-1, 0, 0, -1, 0, 0)');
  await page.locator('.design-search-history').getByRole('button').first().click(); await checkStyle('imageFlipY', false);
  await expect(preview).toHaveCSS('transform', 'matrix(-1, 0, 0, 1, 0, 0)');
});

test('captions: original, translation, all layouts and size are editable without affecting another slide', async () => {
  await seed({ type: 'captions', content: '', captions: { showOriginal: true, showTranslation: true, layout: 'centered' } });
  for (const [key, field] of [['captionsShowOriginal', 'showOriginal'], ['captionsShowTranslation', 'showTranslation']]) {
    const checkbox = panel().getByRole('checkbox', { name: en.common[key], exact: true });
    await checkbox.uncheck(); await expect.poll(async () => (await current()).captions[field]).toBe(false);
    await checkbox.check(); await expect.poll(async () => (await current()).captions[field]).toBe(true);
  }
  for (const [key, value] of [['captionsLayoutLowerThird', 'lowerThird'], ['captionsLayoutTop', 'top'], ['captionsLayoutCentered', 'centered']]) {
    await button(key).click(); await expect.poll(async () => (await current()).captions.layout).toBe(value); await expect(button(key)).toHaveAttribute('aria-pressed', 'true');
  }
  await panel().getByRole('spinbutton').fill('90'); await checkStyle('fontSize', 90);
  expect(await page.evaluate(() => window.__releaseStore.getState().presentation.slides[1].content)).toBe('Untouched');
});

test('countdown: apply, pause, resume and reset preserve the selected duration', async () => {
  await seed({ type: 'countdown', content: JSON.stringify({ minutes: 5, seconds: 0, totalSeconds: 300, startTime: Date.now(), paused: true, pausedRemaining: 300 }) });
  const numbers = panel().getByRole('spinbutton');
  await numbers.nth(0).fill('2'); await numbers.nth(1).fill('15'); await button('cdApply').click();
  const data = async () => JSON.parse((await current()).content);
  await expect.poll(async () => (await data()).totalSeconds).toBe(135);
  await button('cdPause').click(); await expect.poll(async () => (await data()).paused).toBe(true);
  const paused = (await data()).pausedRemaining; expect(paused).toBeGreaterThan(125); expect(paused).toBeLessThanOrEqual(135);
  await button('cdResume').click(); await expect.poll(async () => !!(await data()).paused).toBe(false);
  await button('cdReset').click(); await expect.poll(async () => (await data()).totalSeconds).toBe(135);
  await expect(panel()).toContainText('02:15');
});

test('item editor: typography, line spacing, shadow, draft isolation and save survive reopening', async () => {
  await seed({ type: 'text', styles: { ...styles, fontWeight: 'normal', fontStyle: 'normal', textDecoration: '' } });
  await panel().locator('[data-guide-anchor="image-tools"]').click();
  const editor = page.locator('.editor-workspace');
  await expect(editor).toBeVisible();
  await editor.locator('#editor-tab-layers').click();
  await editor.locator('#editor-inspector-panel').getByText(/Release text/).click();
  await editor.locator('#editor-tab-item').click();
  await editor.locator('#editor-inspector-panel textarea').fill('Editor saved text');
  for (const [key, value] of [['editorFontSize', '76'], ['editorLineHeight', '1.8'], ['editorLetterSpacing', '3']]) {
    await editor.getByLabel(en.common[key], { exact: true }).fill(value);
  }
  for (const key of ['editorBold', 'editorItalic', 'editorUnderline']) await editor.getByRole('button', { name: en.common[key], exact: true }).click();
  await editor.getByPlaceholder(en.common.editorShadowBlur, { exact: true }).fill('8');
  expect((await current()).items).toBeUndefined();
  expect((await current()).content).toBe('Release text');
  await editor.locator('[data-guide-anchor="editor-save"]').click();
  await expect.poll(async () => (await current()).items?.[0]?.content).toBe('Editor saved text');
  const saved = await current();
  expect(saved.items[0].textStyles).toMatchObject({ fontSize: 76, lineHeight: 1.8, letterSpacing: 3, fontWeight: 'bold', fontStyle: 'italic', textDecoration: 'underline', textShadow: { blur: 8 } });
  await editor.getByRole('button', { name: en.nav.slides, exact: true }).click();
  await panel().locator('[data-guide-anchor="image-tools"]').click();
  await expect(editor).toBeVisible();
  await editor.locator('#editor-tab-layers').click();
  await editor.locator('#editor-inspector-panel').getByText(/Editor saved text/).click();
  await editor.locator('#editor-tab-item').click();
  await expect(editor.locator('#editor-inspector-panel textarea')).toHaveValue('Editor saved text');
  for (const [key, value] of [['editorFontSize', '76'], ['editorLineHeight', '1.8'], ['editorLetterSpacing', '3']]) {
    await expect(editor.getByLabel(en.common[key], { exact: true })).toHaveValue(value);
  }
  await expect(editor.getByPlaceholder(en.common.editorShadowBlur, { exact: true })).toHaveValue('8');
  expect(await current()).toEqual(saved);
});

test('loop: reorder, duration, every effect, deletion and undo preserve media identities', async () => {
  const items = ['first', 'second'].map(id => ({ id, type: 'image', mediaUrl: image, fileName: id + '.svg', duration: 5000 }));
  await seed({ type: 'loop', content: '', loopItems: items });
  const row = name => panel().locator('.group').filter({ has: page.locator('.inspector-item-name', { hasText: name }) });
  await row('second.svg').getByRole('button', { name: en.common.moveUp, exact: true }).click();
  await expect.poll(async () => (await current()).loopItems.map(item => item.id)).toEqual(['second', 'first']);
  await row('second.svg').getByRole('spinbutton').fill('8');
  await expect.poll(async () => (await current()).loopItems[0].duration).toBe(8000);
  for (const effect of ['none', 'fade', 'slideLeft', 'slideRight', 'slideUp', 'slideDown', 'zoom', 'zoomOut', 'blur', 'flip']) {
    await panel().getByRole('combobox', { name: en.transition.type, exact: true }).selectOption(effect);
    await expect.poll(async () => (await current()).loopTransition.type).toBe(effect);
  }
  await row('second.svg').getByRole('button', { name: en.common.delete, exact: true }).click();
  await expect.poll(async () => (await current()).loopItems.map(item => item.id)).toEqual(['first']);
  await page.locator('.design-search-history').getByRole('button').first().click();
  await expect.poll(async () => (await current()).loopItems.map(item => item.id)).toEqual(['second', 'first']);
  await expect.poll(() => panel().locator('.design-live-preview img').first().evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
});

test('video: local file decodes, plays and opens its dedicated editor without losing media', async () => {
  const path = require('node:path');
  const mediaUrl = 'local-resource://mediafile/' + encodeURIComponent(path.resolve('tests/fixtures/background.webm'));
  await seed({ type: 'video', content: 'Local video', mediaUrl });
  const video = panel().locator('.design-live-preview video').first();
  await expect.poll(() => video.evaluate(v => v.readyState >= 2 && v.videoWidth > 0)).toBe(true);
  const before = await video.evaluate(v => v.currentTime);
  await expect.poll(() => video.evaluate(v => v.currentTime)).not.toBe(before);
  await panel().locator('[data-guide-anchor="image-tools"]').click();
  const editor = page.locator('.editor-workspace');
  await expect(editor.getByRole('slider', { name: en.common.videoVolume, exact: true })).toBeVisible();
  expect((await current()).mediaUrl).toBe(mediaUrl);
});

test('screen: a synthetic capture renders frames and releases tracks when live leaves the slide', async () => {
  // Exercise the real MediaStream/video lifecycle without capturing the user's desktop.
  await page.evaluate(() => {
    window.__captureTracks = [];
    navigator.mediaDevices.getUserMedia = async () => {
      const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 180;
      const ctx = canvas.getContext('2d');
      const draw = () => { ctx.fillStyle = '#12ab34'; ctx.fillRect(0, 0, 320, 180); };
      draw();
      const stream = canvas.captureStream(10);
      const timer = setInterval(draw, 50);
      for (const track of stream.getTracks()) {
        const stop = track.stop.bind(track);
        track.stop = () => { clearInterval(timer); stop(); };
        window.__captureTracks.push(track);
      }
      return stream;
    };
  });
  await seed({ type: 'screen', content: 'Synthetic screen', mediaUrl: 'screen:release-stream' });
  const video = panel().locator('.design-live-preview video').first();
  await expect.poll(() => video.evaluate(v => v.readyState >= 2 && v.videoWidth === 320)).toBe(true);
  const pixel = await video.evaluate(v => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d'); ctx.drawImage(v, 0, 0, 1, 1);
    return [...ctx.getImageData(0, 0, 1, 1).data];
  });
  // Chromium can round RGB channels during the MediaStream color conversion.
  for (const [index, expected] of [18, 171, 52, 255].entries()) expect(Math.abs(pixel[index] - expected)).toBeLessThanOrEqual(2);
  await page.locator('[data-slide-id="untouched"]').dblclick();
  await expect.poll(() => page.evaluate(() => window.__releaseStore.getState().liveSlideId)).toBe('untouched');
  await expect.poll(() => page.evaluate(() => window.__captureTracks.length > 0 && window.__captureTracks.every(t => t.readyState === 'ended'))).toBe(true);
});

test('screen: denied capture gives a visible recoverable error and switching slides stays usable', async () => {
  await page.evaluate(() => { navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Test capture denied', 'NotAllowedError'); }; });
  await seed({ type: 'screen', content: 'Test capture source', mediaUrl: 'screen:release-test' });
  await expect(panel()).toContainText('Test capture source');
  await expect(panel()).toContainText('Test capture denied');
  await page.locator('[data-slide-id="untouched"]').click();
  await expect(panel().locator('#slide-content-textarea')).toHaveValue('Untouched');
  await panel().locator('#slide-content-textarea').fill('Recovered after capture failure');
  await expect.poll(() => page.evaluate(() => window.__releaseStore.getState().presentation.slides[1].content)).toBe('Recovered after capture failure');
});

test('scripture: real local XML import, verse selection and insertion preserve the existing deck', async ({}, info) => {
  const fs = require('node:fs/promises');
  const file = info.outputPath('release-bible.xml');
  await fs.writeFile(file, '<?xml version="1.0"?><XMLBIBLE biblename="Release Bible"><INFORMATION><title>Release Bible</title><language>eng</language></INFORMATION><BIBLEBOOK bnumber="1" bname="Genesis" bsname="Gen"><CHAPTER cnumber="1"><VERS vnumber="1">Release scripture first verse.</VERS><VERS vnumber="2">Release scripture second verse.</VERS></CHAPTER></BIBLEBOOK></XMLBIBLE>');
  await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, file);
  await seed({ type: 'text' });
  await page.getByRole('button', { name: en.nav.bible, exact: true }).click();
  const anchor = name => page.locator(`[data-guide-anchor="bible-${name}"]`).filter({ visible: true });
  await anchor('source').click();
  if (await anchor('import').count()) await anchor('import').click();
  await anchor('book').click(); await anchor('chapter').click(); await anchor('verse').click();
  await anchor('add').click();
  await expect.poll(() => page.evaluate(() => window.__releaseStore.getState().presentation.slides.length)).toBe(3);
  const deck = await page.evaluate(() => window.__releaseStore.getState().presentation.slides);
  expect(deck.slice(0, 2).map(s => s.id)).toEqual(['subject', 'untouched']);
  expect(deck[2].type).toBe('text'); expect(deck[2].content).toContain('Release scripture first verse.');
  expect(deck[2].content).not.toContain('Release scripture second verse.');
  await page.getByRole('button', { name: en.nav.slides, exact: true }).click();
  await expect(page.locator(`[data-slide-id="${deck[2].id}"]`)).toContainText('Release scripture first verse.');
});
