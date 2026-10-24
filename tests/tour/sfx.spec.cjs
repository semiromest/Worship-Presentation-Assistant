/* eslint-disable @typescript-eslint/no-require-imports -- Electron fixtures use CommonJS. */
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
let app, page, profile;

test.beforeEach(async () => {
  profile = await fs.mkdtemp(path.join(os.tmpdir(), 'wpa-sfx-'));
  const env = { ...process.env, WPA_TEST_PROFILE: profile, VITE_DEV_SERVER_URL: 'http://127.0.0.1:5199/' };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ args: [path.resolve('tests/tour/electron-bootstrap.cjs')], env });
  page = await app.firstWindow();
  await page.waitForFunction(() => !!window.__tourTest);
  await page.evaluate(async () => {
    await window.__tourTest.language('en');
    window.__sfxStore = (await import('/src/renderer/state/useStore.ts')).useStore;
    window.__sfx = await import('/src/renderer/sfx.ts');
    window.__sfxStarts = [];
    // Use real Web Audio and synthesis while routing test audio away from the
    // hardware output. Count actual starts, not calls to a mock playSfx.
    const sinks = new WeakMap();
    const connect = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function (destination, ...args) {
      if (destination === this.context.destination) {
        if (!sinks.has(this.context)) sinks.set(this.context, this.context.createMediaStreamDestination());
        destination = sinks.get(this.context);
      }
      return connect.call(this, destination, ...args);
    };
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...args) {
      window.__sfxStarts.push({ duration: this.buffer?.duration, audible: this.buffer?.getChannelData(0).some(x => x !== 0) });
      return start.apply(this, args);
    };
    const state = window.__sfxStore.getState();
    state.setActiveTab('slides');
    state.setUiSfxEnabled(true);
    state.setLiveSaveEnabled(false);
    state.dispatchUndo({ type: 'RESET', payload: {
      id: 'sfx-deck', name: 'Sound test', sections: [],
      slides: ['one', 'two', 'three'].map(id => ({ id, type: 'text', content: id,
        styles: { fontSize: 48, textColor: '#fff', backgroundColor: '#000' } })),
    } });
    state.setSelectedSlideId('one');
    state.setSelectedSlideIds(new Set(['one']));
  });
  // Unlock audio using a genuine trusted event without changing app state.
  await page.locator('[data-guide-anchor="nav-slides"]').click();
  await page.waitForTimeout(50);
  await page.evaluate(() => { window.__sfxStarts.length = 0; });
});

// eslint-disable-next-line no-empty-pattern -- Playwright fixtures require destructuring.
test.afterEach(async ({}, info) => {
  if (page && !page.isClosed() && info.status !== info.expectedStatus)
    await page.screenshot({ path: info.outputPath('failure.png') }).catch(() => {});
  if (app) {
    await app.evaluate(({ app }) => { setTimeout(() => app.exit(0), 0); }).catch(() => {});
    await app.close();
  }
  app = page = undefined;
  if (profile && path.dirname(path.resolve(profile)) === path.resolve(os.tmpdir()) && path.basename(profile).startsWith('wpa-sfx-'))
    await fs.rm(profile, { recursive: true, force: true, maxRetries: 4 });
});

async function soundsFor(action, expected) {
  await page.evaluate(() => { window.__sfxStarts.length = 0; });
  await action();
  await page.waitForTimeout(160);
  const sounds = await page.evaluate(() => window.__sfxStarts);
  expect(sounds).toHaveLength(expected);
  for (const sound of sounds) {
    expect(sound.audible).toBe(true);
    expect(sound.duration).toBeLessThan(3);
  }
}

test('tabs, panels, slide selection, double click, duplicate and undo play once; no-ops stay silent', async () => {
  await soundsFor(() => page.locator('[data-guide-anchor="nav-settings"]').click(), 1);
  await soundsFor(() => page.locator('[data-guide-anchor="nav-settings"]').click(), 0);
  await soundsFor(() => page.locator('[data-guide-anchor="nav-slides"]').click(), 1);
  await soundsFor(() => page.locator('[data-slide-id="two"]').click(), 1);
  await soundsFor(() => page.locator('[data-slide-id="two"]').click(), 0);
  await soundsFor(() => page.locator('[data-slide-id="two"]').click({ modifiers: ['Control'] }), 0);
  await soundsFor(() => page.locator('[data-slide-id="three"]').dblclick(), 1);
  await soundsFor(() => page.keyboard.press('Control+d'), 1);
  await soundsFor(() => page.keyboard.press('Control+z'), 1);
  await soundsFor(() => page.keyboard.press('?'), 1);
  await soundsFor(() => page.keyboard.press('Escape'), 1);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await soundsFor(() => page.keyboard.press('Alt+9'), 1);
  await soundsFor(() => page.keyboard.press('Alt+9'), 0);
});

test('master switch, five languages, live preference persistence and independent media level', async () => {
  await page.locator('[data-guide-anchor="nav-settings"]').click();
  const card = page.locator('#settings-item-sound');
  await expect(card.getByRole('switch', { name: 'Mute sound effects while live', exact: true })).toBeChecked();
  await soundsFor(() => card.getByRole('switch', { name: 'Sound Effects', exact: true }).click(), 0);
  await soundsFor(() => page.locator('[data-guide-anchor="nav-countdown"]').click(), 0);
  await page.locator('[data-guide-anchor="nav-settings"]').click();
  await soundsFor(() => card.getByRole('switch', { name: 'Sound Effects', exact: true }).click(), 1);
  await soundsFor(() => card.getByRole('switch', { name: 'Mute sound effects while live', exact: true }).click(), 1);
  const level = await page.evaluate(() => window.__sfxStore.getState().mediaVolume);
  for (const language of ['tr', 'en', 'de', 'es', 'ko']) {
    const strings = JSON.parse(await fs.readFile(`src/renderer/locales/${language}/translation.json`, 'utf8'));
    await page.evaluate(language => window.__tourTest.language(language), language);
    await expect(card.getByRole('switch', { name: strings.settings.muteSfxDuringLive, exact: true })).not.toBeChecked();
  }
  await page.reload();
  await page.waitForFunction(() => !!window.__tourTest);
  const persisted = await page.evaluate(async () => {
    const state = (await import('/src/renderer/state/useStore.ts')).useStore.getState();
    return { enabled: state.uiSfxEnabled, mute: state.uiSfxMuteDuringLive, level: state.mediaVolume };
  });
  expect(persisted).toEqual({ enabled: true, mute: false, level });
});

test('stage-only and multiple output snapshots mute every cue and recover after the last close', async () => {
  await page.evaluate(() => {
    const state = window.__sfxStore.getState();
    state.setOutputMode('stage-test', 'stage');
    state.setProjectorOutputStatus([{ displayId: 'stage-test', isOpen: true }]);
  });
  await soundsFor(() => page.locator('[data-guide-anchor="nav-media"]').click(), 0);
  await page.evaluate(() => window.__sfxStore.getState().setProjectorOutputStatus([
    { displayId: 'stage-test', isOpen: true }, { displayId: 'second-test', isOpen: true },
  ]));
  await page.evaluate(() => window.__sfxStore.getState().setProjectorOutputStatus([{ displayId: 'second-test', isOpen: true }]));
  await soundsFor(() => page.locator('[data-guide-anchor="nav-settings"]').click(), 0);
  await page.evaluate(() => window.__sfxStore.getState().setProjectorOutputStatus([]));
  await soundsFor(() => page.locator('[data-guide-anchor="nav-slides"]').click(), 1);
  await page.evaluate(() => {
    const state = window.__sfxStore.getState();
    state.setUiSfxMuteDuringLive(false);
    state.setProjectorOutputStatus([{ displayId: 'stage-test', isOpen: true }]);
  });
  await soundsFor(() => page.locator('[data-guide-anchor="nav-settings"]').click(), 1);
});

test('media bulk add emits one success; automatic navigation and general toasts add no sounds', async () => {
  await page.evaluate(() => {
    const state = window.__sfxStore.getState();
    state.setMediaItems(['a', 'b', 'c'].map(id => ({ id, type: 'image', path: `C:/sfx-test/${id}.png`, name: id, origin: 'manual' })));
    state.setActiveTab('media');
  });
  await expect(page.locator('[data-guide-anchor="nav-media"]')).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.media-card')).toHaveCount(3);
  await soundsFor(() => page.locator('.media-card').nth(0).click(), 1);
  await soundsFor(() => page.locator('.media-card').nth(1).click(), 1);
  await soundsFor(() => page.getByRole('button', { name: require('../../src/renderer/locales/en/translation.json').common.mediaAddSelected.replace('{{count}}', '2'), exact: true }).click(), 1);
  expect(await page.evaluate(() => window.__sfxStore.getState().presentation.slides.length)).toBe(5);
  await expect(page.locator('[data-guide-anchor="nav-slides"]')).toHaveAttribute('aria-current', 'page');
  await soundsFor(() => page.evaluate(() => window.__sfxStore.getState().setToastMessage('A general information message')), 0);
});

test('desktop, Escape and remote output transitions stay silent and output windows never play effects', async () => {
  await soundsFor(() => page.getByRole('button', { name: 'START BROADCAST', exact: true }).click(), 0);
  await expect.poll(() => page.evaluate(() => window.__sfxStore.getState().isProjectorWindowOpen)).toBe(true);
  const output = app.windows().find(window => window.url().includes('mode=projector'));
  expect(output).toBeTruthy();
  const silent = await output.evaluate(async () => {
    const module = await import('/src/renderer/sfx.ts');
    module.setSfxEnabled(true);
    return module.playSfx('select') === null;
  });
  expect(silent).toBe(true);
  await page.bringToFront();
  await soundsFor(() => page.keyboard.press('Escape'), 0);
  await expect.poll(() => page.evaluate(() => window.__sfxStore.getState().isProjectorWindowOpen)).toBe(false);
  await soundsFor(() => page.locator('[data-guide-anchor="nav-settings"]').click(), 1);
  const sendRemote = action => app.evaluate(({ BrowserWindow }, action) => {
    BrowserWindow.getAllWindows().find(window => !window.webContents.getURL().includes('mode=projector'))
      .webContents.send('remote-action', { action });
  }, action);
  await soundsFor(() => sendRemote('openProjector'), 0);
  await expect.poll(() => page.evaluate(() => window.__sfxStore.getState().isProjectorWindowOpen)).toBe(true);
  await soundsFor(() => sendRemote('closeProjector'), 0);
  await expect.poll(() => page.evaluate(() => window.__sfxStore.getState().isProjectorWindowOpen)).toBe(false);
  await soundsFor(() => page.locator('[data-guide-anchor="nav-slides"]').click(), 1);
});
