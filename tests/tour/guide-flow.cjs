/* eslint-disable @typescript-eslint/no-require-imports -- Shared Electron UI flow. */
const { expect, test } = require('@playwright/test');
exports.seeResult = async function(page, id) {
  await expect(page.locator('[data-guide-step]')).toHaveAttribute('data-guide-step', id);
  await expect(page.getByTestId('guide-result')).toBeVisible();
  await expect(page.getByTestId('guide-result-slide').first()).toBeVisible();
  const value = await page.evaluate(() => window.electronAPI.readPracticeWorkspace(null));
  const result = value.guide.result;
  expect(result).toBeTruthy();
  expect(await page.getByTestId('guide-result-slide').evaluateAll(nodes => nodes.map(node => node.dataset.resultSlideId))).toEqual(result.slides.map(slide => slide.id));
  for (const slide of result.slides.filter(slide => slide.type === 'text')) await expect(page.getByTestId('guide-result')).toContainText(slide.content);
  for (const slide of result.slides.filter(slide => slide.type === 'image')) {
    const image=page.locator('[data-result-slide-id="'+slide.id+'"] img').first();
    await expect.poll(()=>image.evaluate(element=>element.complete && element.naturalWidth>0 && element.naturalHeight>0)).toBe(true);
  }
  expect((await page.evaluate(() => window.electronAPI.getPracticeProgress())).progress.exercises[result.exercise]).toBe('completed');
  if(id === 'save-result') {
    const records = await page.evaluate(() => window.electronAPI.loadPresets());
    expect(records.some(record => record.name === result.savedName && record.createdAt === result.savedAt && record.presentation.id === result.deckId)).toBe(true);
  }
  await expect(page.getByTestId('guide-skip')).toHaveCount(0);
  await expect.poll(() => page.locator('[data-guide-card]').evaluate(el => {const r=el.getBoundingClientRect();return r.x>=0 && r.y>=0 && r.right<=innerWidth && r.bottom<=innerHeight;})).toBe(true);
  if(id==='media-result')await page.screenshot({path:test.info().outputPath('media-result.png')});
  await page.getByTestId('guide-next').click();
};
exports.finishRemaining = async function(page, checkResume = false) {
  const step = id => expect(page.locator('[data-guide-step]')).toHaveAttribute('data-guide-step', id);
  const anchor = id => page.locator('[data-guide-anchor="' + id + '"]').filter({ visible: true });
  const navigate = async (name, intro) => { await anchor('nav-' + name).click(); await step(intro); await page.getByTestId('guide-next').click(); };
  await step('nav-bible'); await navigate('bible', 'bible-intro'); await step('bible-source');
  await anchor('bible-source').click();
  await expect.poll(() => page.locator('[data-guide-step]').getAttribute('data-guide-step')).toMatch(/^bible-(book|import)$/);
  if (await page.locator('[data-guide-step]').getAttribute('data-guide-step') === 'bible-import') await anchor('bible-import').click();
  await step('bible-book'); await anchor('bible-book').click(); await step('bible-chapter');
  await anchor('bible-chapter').click(); await step('bible-verse'); await anchor('bible-verse').click(); await step('bible-add');
  await anchor('bible-add').click(); await exports.seeResult(page, 'bible-result'); await step('nav-media');
  await navigate('media','media-intro'); await step('media-menu'); await anchor('media-menu').click(); await step('media-import');
  await anchor('media-import').click(); await step('media-add');
  const sampleImage=page.getByAltText('practice-image.svg');
  await expect.poll(()=>sampleImage.evaluate(element=>element.complete && element.naturalWidth>0)).toBe(true);
  if (checkResume) {
    await page.keyboard.press('Escape'); await page.reload(); await expect(page.getByTestId('guide-resume')).toBeVisible();
    await expect(anchor('media-add')).toBeVisible(); await page.getByTestId('guide-resume').click(); await step('media-add');
  }
  await anchor('media-add').click(); await step('media-result');
  const mediaWorkspace=await page.evaluate(()=>window.electronAPI.readPracticeWorkspace(null));
  const addedImage=page.locator('[data-slide-id="'+mediaWorkspace.guide.result.resourceId+'"] img').first();
  await expect.poll(()=>addedImage.evaluate(element=>element.complete && element.naturalWidth>0)).toBe(true);
  if(checkResume) {
    await page.keyboard.press('Escape');await page.reload();await page.getByTestId('guide-resume').click();await step('media-result');
  }
  await exports.seeResult(page, 'media-result'); await step('image-select');
  const imageTask=await page.evaluate(()=>window.electronAPI.readPracticeWorkspace(null));
  await page.locator('[data-slide-id="'+imageTask.active.target+'"]').click(); await step('image-fit');
  await anchor('image-fit').click(); await step('image-grayscale');
  await anchor('image-grayscale').focus();await page.keyboard.press('End');await exports.seeResult(page,'image-edit-result');await step('nav-hymns');
  await navigate('hymns','hymns-intro'); await step('hymns-add'); await anchor('hymns-add').click(); await exports.seeResult(page,'hymns-result'); await step('hymns-parts'); await page.getByTestId('guide-next').click(); await step('nav-countdown'); await navigate('countdown','countdown-intro'); await step('countdown-duration');
  await anchor('countdown-duration').focus(); await page.keyboard.press('Control+a'); await page.keyboard.type('2'); await step('countdown-add');
  if (checkResume) {
    await page.keyboard.press('Escape'); await page.reload(); await expect(page.getByTestId('guide-resume')).toBeVisible();
    await expect(anchor('countdown-duration')).toHaveValue('2'); await page.getByTestId('guide-resume').click(); await step('countdown-add');
  }
  await anchor('countdown-add').click(); await exports.seeResult(page, 'countdown-result'); await step('nav-screen');
  for (const name of ['screen','calendar','editor','settings']) {
    await anchor('nav-' + name).click(); await step(name + '-intro');
    await expect(page.locator('[data-guide-card]')).toContainText('only introducing');
    await page.getByTestId('guide-next').click();
  }
  await step('nav-save'); await anchor('nav-presentations').click(); await step('save'); await anchor('save').click(); await exports.seeResult(page, 'save-result'); await step('done');
  const progress = await page.evaluate(() => window.electronAPI.getPracticeProgress());
  expect(progress.ok).toBe(true);
  for (const task of ['bible','media','image-edit','hymns','countdown','presentations']) expect(progress.progress.exercises[task], task).toBe('completed');
};
