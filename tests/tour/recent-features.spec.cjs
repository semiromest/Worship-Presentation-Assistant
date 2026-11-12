/* eslint-disable @typescript-eslint/no-require-imports -- Electron Playwright fixtures use CommonJS. */
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
let app, page, profile;
test.beforeEach(async () => {
  profile = await fs.mkdtemp(path.join(os.tmpdir(), 'wpa-recent-ux-'));
  const env = { ...process.env, WPA_TEST_PROFILE: profile, VITE_DEV_SERVER_URL: 'http://127.0.0.1:5199/' };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ args: [path.resolve('tests/tour/electron-bootstrap.cjs')], env });
  await app.evaluate(({ ipcMain, dialog }) => {
    dialog.showMessageBox = async () => ({ response: 1 });
    ipcMain.removeHandler('youtube-music:prepare');
    ipcMain.handle('youtube-music:prepare', () => ({ ok: true }));
  });
  page = await app.firstWindow();
  await page.waitForFunction(() => !!window.__tourTest);
  await page.evaluate(async () => {
    await window.__tourTest.language('en');
    window.__recentStore = (await import('/src/renderer/state/useStore.ts')).useStore;
    window.__recentStore.getState().setActiveTab('slides');
  });
});
// eslint-disable-next-line no-empty-pattern -- Playwright requires fixture destructuring.
test.afterEach(async ({}, info) => {
  if (page && !page.isClosed() && info.status !== info.expectedStatus)
    await page.screenshot({ path: info.outputPath('failure.png') }).catch(() => {});
  if (app) {
    await app
      .evaluate(({ app }) => {
        setTimeout(() => app.exit(0), 0);
      })
      .catch(() => {});
    await app.close();
  }
  app = page = undefined;
  if (
    profile &&
    path.dirname(path.resolve(profile)) === path.resolve(os.tmpdir()) &&
    path.basename(profile).startsWith('wpa-recent-ux-')
  ) {
    await fs.rm(profile, { recursive: true, force: true, maxRetries: 4 });
  }
});

test('appearance preview mounts only in its category; watermark upload and ARIA labels work in five languages', async () => {
  const en = JSON.parse(await fs.readFile('src/renderer/locales/en/translation.json', 'utf8'));
  await page.evaluate(() => window.__recentStore.getState().setActiveTab('settings'));
  // The Settings chunk is lazy-loaded; a cold Vite compile can outlast the 5s assertion default.
  await expect(page.locator('.settings-workspace')).toBeVisible({ timeout: 25000 });
  await expect(page.locator('#settings-item-appearance-preview')).toHaveCount(0);
  await page
    .locator('.settings-category-sidebar')
    .getByRole('button', { name: en.settings.navigation.categories.appearance.title, exact: true })
    .click();
  await expect(page.locator('#settings-item-appearance-preview')).toBeVisible();
  const watermark = page.locator('#settings-item-watermark');
  const file = watermark.locator('input[type="file"]');
  for (const language of ['en', 'tr', 'de', 'es', 'ko']) {
    const strings = JSON.parse(await fs.readFile(`src/renderer/locales/${language}/translation.json`, 'utf8'));
    await page.evaluate((language) => window.__tourTest.language(language), language);
    await expect(watermark.getByRole('button', { name: strings.watermark.collapse, exact: true })).toBeVisible();
    await file.setInputFiles({ name: 'invalid.txt', mimeType: 'text/plain', buffer: Buffer.from('invalid') });
    await expect(watermark.getByRole('alert')).toHaveText(strings.watermark.unsupportedFormat);
    await file.setInputFiles({ name: 'large.png', mimeType: 'image/png', buffer: Buffer.alloc(2 * 1024 * 1024 + 1) });
    await expect(watermark.getByRole('alert')).toHaveText(strings.watermark.fileTooLarge);
    await file.setInputFiles({
      name: 'logo.svg',
      mimeType: 'image/svg+xml',
      buffer: Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="blue"/></svg>'
      ),
    });
    await expect(watermark.getByRole('status')).toHaveText(strings.watermark.uploadSuccess);
    await expect(watermark.getByRole('status')).toHaveClass(/text-emerald-300/);
    await expect(
      watermark.getByRole('button', { name: strings.common.hymnsAuthorPosTopLeft, exact: true })
    ).toBeVisible();
  }
  await page.evaluate(() => window.__tourTest.language('en'));
  await expect(watermark.getByRole('status')).toHaveText(en.watermark.uploadSuccess);
  await page
    .locator('.settings-category-sidebar')
    .getByRole('button', { name: en.settings.navigation.categories.general.title, exact: true })
    .click();
  await expect(page.locator('#settings-item-appearance-preview')).toHaveCount(0);
  await page.locator('.settings-search input').fill('logo');
  await page.getByRole('button').filter({ hasText: en.watermark.title }).click();
  await expect(page.locator('#settings-item-appearance-preview')).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => !!document.activeElement?.closest('#settings-item-watermark')))
    .toBe(true);
  await page.screenshot({ path: test.info().outputPath('appearance-and-logo.png') });
});

test('the scripture watermark setting applies to new and previously saved single-verse slides', async () => {
  const { watermark } = require('../../src/renderer/locales/en/translation.json');
  const verseText = 'A single verse for the watermark check.';
  const logo = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="blue"/></svg>');
  await page.waitForSelector('[data-app-shell]');
  await page.evaluate(async ({ verseText, logo }) => {
    const { bibleRepository } = await import('/src/renderer/bibleRepository.ts');
    bibleRepository.remember({ name: 'Test Bible', format: 'zefania', books: [
      { name: 'John', number: '43', chapters: [{ number: '1', verses: [{ number: '1', text: verseText }] }] },
    ] }, { type: 'local', id: 'test-bible', format: 'zefania' });
    const { useWatermarkStore } = await import('/src/renderer/state/useWatermarkStore.ts');
    useWatermarkStore.getState().setWatermarkConfig({ logoDataUrl: logo, enabled: true, applyToScriptures: false });
    window.__recentStore.getState().setActiveTab('bible');
  }, { verseText, logo });

  await page.getByRole('button', { name: 'John', exact: true }).click();
  await page.locator('[data-guide-anchor="bible-chapter"]').click();
  await page.getByRole('button', { name: new RegExp(verseText) }).click();
  await page.locator('[data-guide-anchor="bible-add"]').click();
  const card = page.locator('[data-slide-id]').filter({ hasText: verseText });
  await expect(card).toBeVisible();
  const image = card.locator(`img[src="${logo}"]`);
  await expect(image).toHaveCount(0);
  expect(await page.evaluate(verseText => window.__recentStore.getState().presentation.slides.find(slide => slide.content.includes(verseText))?.scripture, verseText)).toBe(true);

  await page.evaluate(() => window.__recentStore.getState().setActiveTab('settings'));
  await page.locator('.settings-search input').fill(watermark.title);
  await page.getByRole('button').filter({ hasText: watermark.title }).click();
  await page.getByRole('checkbox', { name: watermark.applyToScriptures, exact: true }).check();
  await page.evaluate(() => window.__recentStore.getState().setActiveTab('slides'));
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate(img => img.naturalWidth)).toBeGreaterThan(0);
  await page.evaluate(slideId => {
    const state = window.__recentStore.getState();
    state.setIsRightPanelOpen(true);
    state.selectSlides({ activeId: slideId, liveTargetId: slideId });
  }, await card.getAttribute('data-slide-id'));
  await expect(page.locator(`.design-live-preview img[src="${logo}"]`)).toBeVisible();

  await page.evaluate(verseText => {
    const state = window.__recentStore.getState();
    const slides = state.presentation.slides.map(slide => slide.content.includes(verseText)
      ? { ...slide, id: 'legacy-verse', scripture: undefined }
      : slide);
    state.dispatchUndo({ type: 'SET', payload: { ...state.presentation, slides } });
  }, verseText);
  await expect(page.locator(`[data-slide-id="legacy-verse"] img[src="${logo}"]`)).toBeVisible();
});

test('Google Slides cancels and signs out independently of Drive, then imports a presentation', async () => {
  await app.evaluate(({ ipcMain }) => {
    for (const channel of ['google-slides-status', 'google-slides-connect', 'google-slides-list', 'google-slides-import',
      'google-slides-sign-out', 'google-slides-cancel', 'drive-sign-out', 'drive-sign-in-cancel']) {
      ipcMain.removeHandler(channel);
    }
    let signedIn = false;
    let finishCancelledAttempt;
    let firstAttempt = true;
    const status = () => ({ signedIn, email: signedIn ? 'presenter@example.com' : null });
    ipcMain.handle('google-slides-status', status);
    ipcMain.handle('google-slides-connect', () => {
      if (firstAttempt) {
        firstAttempt = false;
        return new Promise(resolve => { finishCancelledAttempt = resolve; });
      }
      signedIn = true;
      return status();
    });
    ipcMain.handle('google-slides-cancel', () => finishCancelledAttempt(status()));
    ipcMain.handle('google-slides-sign-out', () => { signedIn = false; });
    ipcMain.handle('drive-sign-in-cancel', () => { throw new Error('Slides must not cancel Drive'); });
    ipcMain.handle('drive-sign-out', () => { throw new Error('Slides must not sign out of Drive'); });
    ipcMain.handle('google-slides-list', (_event, query) => ({
      files: [{ id: 'welcome', name: 'Welcome deck' }, { id: 'service', name: 'Service deck' }]
        .filter(file => file.name.toLowerCase().includes(query.toLowerCase())),
    }));
    ipcMain.handle('google-slides-import', (_event, id) => {
      if (id !== 'service') throw new Error('Wrong Google presentation');
      return { success: true, slides: [{ slideNumber: 1, width: 1920, height: 1080, format: 'png',
        imageData: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=' }] };
    });
  });
  await page.waitForSelector('[data-app-shell]');
  const before = await page.evaluate(() => {
    const state = window.__recentStore.getState();
    state.setActiveTab('presentations');
    state.setDriveSignedIn(true, 'backup@example.com');
    state.setDriveFiles([{ id: 'backup', name: 'Backup.gpres', modifiedTime: '' }]);
    state.setDriveFilesLoaded(true);
    return state.presentation.slides.map(slide => slide.id);
  });
  await page.getByRole('button', { name: 'Google Slides', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Google Slides' });
  const { common, drive, googleSlides } = require('../../src/renderer/locales/en/translation.json');
  const signIn = dialog.getByRole('button', { name: drive.signIn, exact: true });
  await signIn.click();
  await dialog.getByRole('button', { name: common.cancel, exact: true }).click();
  await expect(signIn).toBeEnabled();
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  await signIn.click();
  await expect(dialog.getByText('presenter@example.com')).toBeVisible();
  await dialog.getByRole('button', { name: drive.signOut, exact: true }).click();
  await expect(signIn).toBeEnabled();
  await expect(dialog.getByText('presenter@example.com')).toHaveCount(0);
  expect(await page.evaluate(() => {
    const { driveSignedIn, driveEmail, driveFiles, driveFilesLoaded } = window.__recentStore.getState();
    return { driveSignedIn, driveEmail, files: driveFiles.map(file => file.id), driveFilesLoaded };
  })).toEqual({ driveSignedIn: true, driveEmail: 'backup@example.com', files: ['backup'], driveFilesLoaded: true });
  await signIn.click();
  await expect(dialog.getByText('Welcome deck')).toBeVisible();
  await dialog.getByRole('searchbox').fill('service');
  await expect(dialog.getByText('Welcome deck')).toHaveCount(0);
  await dialog.getByRole('button', { name: googleSlides.add, exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const after = await page.evaluate(() => window.__recentStore.getState().presentation.slides.map(slide => slide.id));
  expect(after).toHaveLength(before.length + 1);
  expect(after.slice(0, -1)).toEqual(before);
});

test('Canva library searches and appends slides through the PowerPoint import flow', async () => {
  await app.evaluate(({ ipcMain }) => {
    for (const channel of ['canva-available', 'canva-status', 'canva-connect', 'canva-list', 'canva-import']) {
      ipcMain.removeHandler(channel);
    }
    ipcMain.handle('canva-available', () => true);
    ipcMain.handle('canva-status', () => ({ signedIn: false, email: null }));
    ipcMain.handle('canva-connect', () => ({ signedIn: true, email: null }));
    ipcMain.handle('canva-list', (_event, query) => ({ files: query === 'Sunday' ? [{ id: 'DAExample', name: 'Sunday slides' }] : [] }));
    ipcMain.handle('canva-import', (_event, id) => {
      if (id !== 'DAExample') throw new Error('Unexpected Canva design');
      return { success: true, slides: [{ slideNumber: 1, width: 1920, height: 1080, format: 'png',
        imageData: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=' }] };
    });
  });
  await page.waitForSelector('[data-app-shell]');
  const before = await page.evaluate(() => {
    const state = window.__recentStore.getState();
    state.setActiveTab('presentations');
    return state.presentation.slides.length;
  });
  await page.getByRole('button', { name: 'Canva', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Canva' });
  const { drive, googleSlides } = require('../../src/renderer/locales/en/translation.json');
  await dialog.getByRole('button', { name: drive.signIn, exact: true }).click();
  await dialog.getByRole('searchbox').fill('Sunday');
  await expect(dialog.getByText('Sunday slides')).toBeVisible();
  await dialog.getByRole('button', { name: googleSlides.add, exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(() => window.__recentStore.getState().presentation.slides.length)).toBe(before + 1);
});

test('YouTube appends results, preserves them on errors, expires cursors and ignores old responses', async () => {
  await app.evaluate(({ ipcMain }) => {
    globalThis.__moreCalls = 0;
    ipcMain.removeHandler('youtube-music:search');
    ipcMain.handle('youtube-music:search', async (_event, query, cursor) => {
      const videos = (start, count) =>
        Array.from({ length: count }, (_, i) => ({
          id: String(start + i).padStart(11, '0'),
          title: `${query} ${start + i}`,
          duration: 60,
        }));
      if (query === 'old')
        return new Promise((resolve) => {
          globalThis.__resolveOldSearch = resolve;
        });
      if (query === 'new') return { ok: true, results: videos(50, 1) };
      if (!cursor) return { ok: true, results: videos(0, 12), nextCursor: 'more' };
      if (cursor === 'expired') return { ok: false, error: 'search-expired' };
      if (++globalThis.__moreCalls === 1) return { ok: false, error: 'search-failed' };
      return { ok: true, results: videos(11, 13), nextCursor: 'expired' };
    });
  });
  await page.getByTestId('background-music-toggle').click();
  await page.getByTestId('music-source-youtube').click();
  const query = page.getByTestId('youtube-music-query');
  const results = page.locator('[data-testid^="youtube-result-"]');
  await query.fill('music');
  await query.press('Enter');
  await expect(results).toHaveCount(12);
  await page.getByTestId('youtube-load-more').click();
  await expect(page.getByRole('alert')).toHaveText('YouTube search failed.');
  await expect(results).toHaveCount(12);
  await page.getByTestId('youtube-load-more').click();
  await expect(results).toHaveCount(24);
  await page.getByTestId('youtube-load-more').click();
  await expect(page.getByRole('alert')).toHaveText('These search results have expired. Search again to continue.');
  await expect(results).toHaveCount(24);
  await expect(page.getByTestId('youtube-load-more')).toHaveCount(0);
  await query.fill('old');
  await query.press('Enter');
  await expect.poll(() => app.evaluate(() => typeof globalThis.__resolveOldSearch)).toBe('function');
  await query.fill('new');
  await query.press('Enter');
  await expect(results).toHaveCount(1);
  await expect(results.first()).toContainText('new 50');
  await app.evaluate(() =>
    globalThis.__resolveOldSearch({
      ok: true,
      results: [{ id: '00000000999', title: 'Old result', duration: 0 }],
      nextCursor: 'obsolete',
    })
  );
  await expect(results.first()).toContainText('new 50');
  await expect(page.getByTestId('youtube-load-more')).toHaveCount(0);
});

test('music has one volume and dim control, normal styles remain available and edits support undo', async () => {
  await page.evaluate(() => {
    const state = window.__recentStore.getState();
    const styles = {
      fontSize: 48,
      textColor: '#fff',
      backgroundColor: '#000',
      backgroundImage:
        'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"/>'),
      backgroundDim: 0.45,
    };
    state.dispatchUndo({
      type: 'RESET',
      payload: {
        name: 'Music controls',
        slides: [
          {
            id: 'music',
            type: 'text',
            content: 'Music title',
            styles,
            youtubeMusic: { id: 'KI33ItOO_M4', title: 'Test music', duration: 60 },
            musicSettings: { volume: 0.7 },
          },
          { id: 'normal', type: 'text', content: 'Normal title', styles },
        ],
      },
    });
    state.setSelectedSlideId('music');
    state.setSelectedSlideIds(new Set(['music']));
    state.setPanels({ ...state.panels, styles: true });
  });
  await expect(page.getByTestId('music-slide-editor')).toBeVisible();
  await expect(page.locator('#music-slide-volume')).toHaveCount(1);
  await expect(page.getByTestId('music-background-dim')).toHaveCount(1);
  await expect(page.locator('#background-dim')).toHaveCount(0);
  await expect(page.locator('#slide-content-textarea')).toBeVisible();
  await page.getByTestId('music-slide-volume').focus();
  await page.keyboard.press('Home');
  await expect
    .poll(() => page.evaluate(() => window.__recentStore.getState().presentation.slides[0].musicSettings.volume))
    .toBe(0);
  await page.evaluate(() => window.__recentStore.getState().dispatchUndo({ type: 'UNDO' }));
  await expect(page.getByTestId('music-slide-volume')).toHaveValue('70');
  await page.evaluate(() => window.__recentStore.getState().setSelectedSlideId('normal'));
  await expect(page.getByTestId('music-slide-editor')).toHaveCount(0);
  await expect(page.locator('#background-dim')).toHaveCount(0);
  await expect(page.locator('#slide-content-textarea')).toHaveValue('Normal title');
});
