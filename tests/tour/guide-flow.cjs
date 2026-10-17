/* eslint-disable @typescript-eslint/no-require-imports -- Shared Electron UI flow. */
const { expect, test } = require('@playwright/test');
exports.waitForPractice = async function(page, step = /^[a-z]/) {
  // A BrowserWindow/load event precedes lazy UI loading and workspace recovery.
  await expect(page.locator('[data-guide-step]')).toHaveAttribute('data-guide-step',step,{timeout:15000});
};
exports.openLearning = async function(page) {
  const selector=page.locator('#settings-category');
  if(await selector.isVisible()) await selector.selectOption('learning');
  else await page.locator('button[aria-controls="settings-panel-learning"]').click();
  await expect(page.locator('#settings-panel-learning')).toBeVisible();
};
exports.finishReorder = async function(page) {
  await expect(page.locator('[data-guide-step]')).toHaveAttribute('data-guide-step','reorder');
  const before=await page.evaluate(()=>window.electronAPI.readPracticeWorkspace(null));
  await page.locator('[data-slide-id="'+before.active.target+'"]').dragTo(page.locator('[data-slide-id="'+before.active.peer+'"]'));
  await expect(page.locator('[data-guide-step]')).toHaveAttribute('data-guide-step','select');
  const after=await page.evaluate(()=>window.electronAPI.readPracticeWorkspace(null));
  expect(after.deck.slides.map(slide=>slide.id)).not.toEqual(before.deck.slides.map(slide=>slide.id));
  expect([...after.deck.slides.map(slide=>slide.id)].sort()).toEqual([...before.deck.slides.map(slide=>slide.id)].sort());
  expect((await page.evaluate(()=>window.electronAPI.getPracticeProgress())).progress.exercises['slide-reorder']).toBe('completed');
};
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
    await page.keyboard.press('Escape'); await page.reload(); await exports.waitForPractice(page,'media-add'); await expect(page.getByTestId('guide-resume')).toBeVisible();
    await expect(anchor('media-add')).toBeVisible(); await page.getByTestId('guide-resume').click(); await step('media-add');
  }
  await anchor('media-add').click(); await step('media-result');
  const mediaWorkspace=await page.evaluate(()=>window.electronAPI.readPracticeWorkspace(null));
  const addedImage=page.locator('[data-slide-id="'+mediaWorkspace.guide.result.resourceId+'"] img').first();
  await expect.poll(()=>addedImage.evaluate(element=>element.complete && element.naturalWidth>0)).toBe(true);
  if(checkResume) {
    await page.keyboard.press('Escape');await page.reload();await exports.waitForPractice(page,'media-result');await page.getByTestId('guide-resume').click();await step('media-result');
  }
  await exports.seeResult(page, 'media-result'); await step('image-select');
  const imageTask=await page.evaluate(()=>window.electronAPI.readPracticeWorkspace(null));
  await page.locator('[data-slide-id="'+imageTask.active.target+'"]').click(); await step('image-tools');
  await page.getByTestId('guide-next').click(); await step('image-fit');
  await anchor('image-fit').click(); await step('image-grayscale');
  await anchor('image-grayscale').focus();await page.keyboard.press('End');await exports.seeResult(page,'image-edit-result');await step('nav-hymns');
  await navigate('hymns','hymns-intro');
  for(const id of ['hymns-online','hymns-author','hymns-mode']) { await step(id); await page.getByTestId('guide-next').click(); }
  await step('hymns-add'); await anchor('hymns-add').click(); await exports.seeResult(page,'hymns-result');
  for(const id of ['hymns-parts','hymns-font']) { await step(id); await page.getByTestId('guide-next').click(); }
  await step('nav-countdown'); await navigate('countdown','countdown-intro'); await step('countdown-duration');
  await anchor('countdown-duration').focus(); await page.keyboard.press('Control+a'); await page.keyboard.type('2'); await step('countdown-add');
  if (checkResume) {
    await page.keyboard.press('Escape'); await page.reload(); await exports.waitForPractice(page,'countdown-add'); await expect(page.getByTestId('guide-resume')).toBeVisible();
    await expect(anchor('countdown-duration')).toHaveValue('2'); await page.getByTestId('guide-resume').click(); await step('countdown-add');
  }
  await anchor('countdown-add').click(); await exports.seeResult(page, 'countdown-result'); await step('nav-screen');
  for (const name of ['screen','calendar','editor','settings']) {
    await anchor('nav-' + name).click(); await step(name + '-intro');
    if(name!=='editor') await expect(page.locator('[data-guide-card]')).toContainText('only introducing');
    await page.getByTestId('guide-next').click();
    if(name==='editor') {
      await step('editor-select');
      const workspace=await page.evaluate(()=>window.electronAPI.readPracticeWorkspace(null));
      await page.locator('[data-editor-item-id="'+workspace.active.peer+'"]').click();
      await step('editor-rotate');
      await expect.poll(()=>anchor('editor-rotate').evaluate(el=>!el.closest('[inert]'))).toBe(true);
      await anchor('editor-rotate').focus(); await expect(anchor('editor-rotate')).toBeFocused();
      await page.keyboard.press('Control+a'); await page.keyboard.type('15');
      await expect(anchor('editor-rotate')).toHaveValue('15');
      await step('editor-save'); await anchor('editor-save').click();
      await exports.seeResult(page,'editor-result'); await step('nav-settings');
    }
  }
  await step('phone-controls'); await page.getByTestId('guide-next').click();
  await step('nav-save'); await anchor('nav-presentations').click(); await step('save'); await anchor('save').click(); await exports.seeResult(page, 'save-result'); await step('done');
  const progress = await page.evaluate(() => window.electronAPI.getPracticeProgress());
  expect(progress.ok).toBe(true);
  for (const task of ['slide-add','slide-reorder','slide-delete','bible','media','image-edit','canvas-edit','hymns','countdown','presentations']) expect(progress.progress.exercises[task], task).toBe('completed');
};
