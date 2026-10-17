/* eslint-disable @typescript-eslint/no-require-imports -- Electron Playwright fixtures use CommonJS. */
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

let app, page, profile;
test.beforeEach(async () => {
  profile = await fs.mkdtemp(path.join(os.tmpdir(), 'wpa-preparation-'));
  const env = { ...process.env, WPA_TEST_PROFILE: profile, VITE_DEV_SERVER_URL: 'http://127.0.0.1:5199/' };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ args: [path.resolve('tests/tour/electron-bootstrap.cjs')], env });
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => ({ response: 1 });
  });
  page = await app.firstWindow();
  await page.waitForFunction(() => !!window.__tourTest);
  await page.evaluate(async () => {
    await window.__tourTest.language('en');
    window.__preparationApp = (await import('/src/renderer/state/useStore.ts')).useStore;
    window.__preparationReport = (await import('/src/renderer/state/usePreparationStore.ts')).usePreparationStore;
    window.__preparationApp.getState().setActiveTab('slides');
  });
});

// eslint-disable-next-line no-empty-pattern -- Playwright requires a destructured fixtures argument.
test.afterEach(async ({}, info) => {
  if (page && !page.isClosed() && info.status !== info.expectedStatus) {
    await page.screenshot({ path: info.outputPath('preparation-failure.png') }).catch(() => {});
  }
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
    path.basename(profile).startsWith('wpa-preparation-')
  ) {
    await fs.rm(profile, { recursive: true, force: true, maxRetries: 4 });
  }
});

async function load(slides, id = 'preparation-test') {
  await page.evaluate(
    ({ slides, id }) => {
      const state = window.__preparationApp.getState();
      state.dispatchUndo({
        type: 'RESET',
        payload: {
          id,
          name: id,
          sections: [],
          slides: slides.map((slide) => ({
            type: 'text',
            content: 'Hello',
            styles: { fontSize: 48, fontFamily: 'Arial', textColor: '#ffffff', backgroundColor: '#000000' },
            ...slide,
          })),
        },
      });
      state.setSelectedSlideId(slides[0]?.id ?? null);
    },
    { slides, id }
  );
}
const toolbar = () => page.getByRole('button', { name: 'Preparation Check', exact: true });
async function complete() {
  await expect(page.locator('button[data-preparation-status]')).toHaveAttribute('data-preparation-status', 'complete', {
    timeout: 20000,
  });
}
async function remote(action) {
  await app.evaluate(({ BrowserWindow }, action) => {
    const control = BrowserWindow.getAllWindows().find((win) => !win.webContents.getURL().includes('mode=projector'));
    control.webContents.send('remote-action', { action });
  }, action);
}
async function expectProjection() {
  await expect
    .poll(() => app.windows().filter((window) => window.url().includes('mode=projector')).length)
    .toBeGreaterThan(0);
  await expect(page.getByRole('dialog', { name: 'Preparation Check' })).toHaveCount(0);
}

test('background report, toolbar count and slide badges agree; badges open the matching report', async () => {
  await load([
    { id: 'empty-image', type: 'image', content: '' },
    { id: 'overflow', content: 'word '.repeat(500) },
    { id: 'fine', content: 'Fine' },
  ]);
  await complete();
  await expect(toolbar()).toContainText('2');
  await expect(page.locator('[data-preparation-badge]')).toHaveCount(2);
  await page.locator('[data-preparation-badge="overflow"]').click();
  const dialog = page.getByRole('dialog', { name: 'Preparation Check' });
  await expect(dialog.locator('[data-preparation-slide]')).toHaveCount(2);
  await expect(dialog.locator('[data-preparation-slide="overflow"]')).toHaveClass(/border-blue-400/);
  await expect(dialog.getByText('Text exceeds its display area.', { exact: false })).toBeVisible();
  await expect(dialog.getByText('Estimated risk:', { exact: false })).toHaveCount(0);
  await expect(dialog.getByText('Presentation output is closed.', { exact: false })).toBeVisible();
  await dialog.getByRole('button', { name: 'Retry', exact: true }).click();
  await complete();
  await expect(dialog.locator('[data-preparation-slide]')).toHaveCount(2);
  await page.screenshot({ path: test.info().outputPath('shared-preparation-report.png') });
});

test('failed resource check can be retried and never gates desktop or remote output', async () => {
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('check-media-resources');
    ipcMain.handle('check-media-resources', async () => {
      throw new Error('Test resource failure');
    });
  });
  await load([{ id: 'media', type: 'image', content: '', mediaUrl: 'file:///missing-preparation-test.png' }]);
  await expect(toolbar()).toHaveAttribute('data-preparation-status', 'failed');
  await page.getByRole('button', { name: 'START BROADCAST', exact: true }).click();
  await expectProjection();
  await remote('closeProjector');
  await expect.poll(() => page.evaluate(() => window.__preparationApp.getState().isProjectorWindowOpen)).toBe(false);
  await remote('openProjector');
  await expectProjection();
  await remote('closeProjector');
  await expect.poll(() => page.evaluate(() => window.__preparationApp.getState().isProjectorWindowOpen)).toBe(false);
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('check-media-resources');
    ipcMain.handle('check-media-resources', async (_event, urls) =>
      Object.fromEntries(urls.map((url) => [url, false]))
    );
  });
  await toolbar().click();
  const dialog = page.getByRole('dialog', { name: 'Preparation Check' });
  await dialog.getByRole('button', { name: 'Retry', exact: true }).click();
  await complete();
  await expect(dialog.getByText('Media file is missing or unreadable.')).toBeVisible();
});

test('pending checks never gate output and late results cannot replace a different deck', async () => {
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('check-media-resources');
    ipcMain.handle(
      'check-media-resources',
      () =>
        new Promise((resolve) => {
          globalThis.releasePreparation = resolve;
        })
    );
  });
  await load([{ id: 'pending', type: 'image', content: '', mediaUrl: 'file:///pending-preparation-test.png' }]);
  await expect(toolbar()).toHaveAttribute('data-preparation-status', 'checking');
  await page.getByRole('button', { name: 'START BROADCAST', exact: true }).click();
  await expectProjection();
  await remote('closeProjector');
  await expect.poll(() => page.evaluate(() => window.__preparationApp.getState().isProjectorWindowOpen)).toBe(false);
  await remote('openProjector');
  await expectProjection();
  await load([{ id: 'replacement', content: 'Ready' }], 'replacement-deck');
  await complete();
  await app.evaluate(() => {
    globalThis.releasePreparation({ 'file:///pending-preparation-test.png': false });
  });
  await toolbar().click();
  await expect(page.getByText('Content check complete', { exact: true })).toBeVisible();
  await expect(page.locator('[data-preparation-badge]')).toHaveCount(0);
});

test('live part changes reuse the report; disconnected open displays are separate warnings', async () => {
  await load([
    { id: 'parts', partsMode: true, parts: ['First part', 'Second part'], activePart: 0, content: 'First part' },
  ]);
  await complete();
  await page.evaluate(() => {
    window.__oldPreparationResults = window.__preparationReport.getState().results;
    const state = window.__preparationApp.getState();
    state.dispatchUndo({
      type: 'SET',
      payload: {
        ...state.presentation,
        slides: [{ ...state.presentation.slides[0], activePart: 1, content: 'Second part' }],
      },
    });
    state.setLiveIndex(0);
  });
  await expect
    .poll(() => page.evaluate(() => window.__oldPreparationResults === window.__preparationReport.getState().results))
    .toBe(true);
  await page.evaluate(() => {
    const state = window.__preparationApp.getState();
    state.setOutputOpen('disconnected-test-output', true);
  });
  await toolbar().click();
  const dialog = page.getByRole('dialog', { name: 'Preparation Check' });
  await expect(dialog.getByText('A configured open display is disconnected.', { exact: false })).toBeVisible();
  await expect(dialog.getByText('Content check complete', { exact: true })).toBeVisible();
  await expect(dialog.locator('[data-preparation-slide]')).toHaveCount(0);
  // A display snapshot prunes output assignments before the subsequent close event.
  await page.evaluate(() => {
    const state = window.__preparationApp.getState();
    state.setDisplays([...state.displays]);
    state.setOutputOpen('disconnected-test-output', false);
  });
  await expect(dialog.getByText('A configured open display is disconnected.', { exact: false })).toBeVisible();
});

test('large decks yield to animation frames and edits do not leave obsolete badges', async () => {
  await page.evaluate(() => {
    window.__checkingFrames = 0;
    window.__observePreparationFrames = true;
    const frame = () => {
      if (!window.__observePreparationFrames) return;
      if (window.__preparationReport.getState().status === 'checking') window.__checkingFrames++;
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
  await load(
    Array.from({ length: 1200 }, (_, index) => ({ id: `large-${index}`, content: `Slide ${index}` })),
    'large-deck'
  );
  await complete();
  await expect.poll(() => page.evaluate(() => window.__checkingFrames)).toBeGreaterThan(0);
  await page.evaluate(() => {
    window.__observePreparationFrames = false;
  });
  // Replace and reorder before the debounced check starts: only the final deck may publish.
  await load(
    [
      { id: 'removed', type: 'image', content: '' },
      { id: 'kept', content: 'Fine' },
    ],
    'rapid-deck'
  );
  await page.evaluate(() => {
    const state = window.__preparationApp.getState();
    state.dispatchUndo({ type: 'SET', payload: { ...state.presentation, slides: [state.presentation.slides[1]] } });
  });
  await complete();
  await expect(page.locator('[data-preparation-badge]')).toHaveCount(0);
  await toolbar().click();
  await expect(page.getByText('Content check complete', { exact: true })).toBeVisible();
});
