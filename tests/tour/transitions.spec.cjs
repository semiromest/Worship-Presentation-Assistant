const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

let app, control, output, displayId;
test.beforeEach(async () => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'wpa-live-transition-'));
  const env = { ...process.env, WPA_TEST_PROFILE: profile, VITE_DEV_SERVER_URL: 'http://127.0.0.1:5199/' };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ args: [path.resolve('tests/tour/electron-bootstrap.cjs')], env });
  await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1 }); });
  control = await app.firstWindow();
  await control.waitForFunction(() => !!window.__tourTest);
  await control.evaluate(async () => {
    await window.__tourTest.language('en');
    window.__transitionStore = (await import('/src/renderer/state/useStore.ts')).useStore;
    const image = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080"><rect width="1920" height="1080" fill="blue"/><circle cx="960" cy="540" r="180" fill="gold"/></svg>');
    const deck = { id: 'transition-regression', name: 'Live transition regression', sections: [], transition: { type: 'fade', duration: 800 }, slides: [
      { id: 'red', type: 'text', content: 'RED', styles: { fontSize: 80, textColor: '#ffffff', backgroundColor: '#ff0000' } },
      { id: 'blue', type: 'image', content: '', mediaUrl: image, styles: { fontSize: 80, textColor: '#ffffff', backgroundColor: '#0000ff' } },
      { id: 'green', type: 'text', content: 'GREEN', styles: { fontSize: 80, textColor: '#ffffff', backgroundColor: '#00aa00' } },
    ] };
    const store = window.__transitionStore.getState();
    store.dispatchUndo({ type: 'RESET', payload: deck });
    store.setLiveIndex(0);
    store.setActiveTab('slides');
  });
  displayId = await control.evaluate(async () => {
    const displays = await window.electronAPI.getDisplays();
    const id = String(displays[0].id);
    await window.electronAPI.openProjector(id, { fullPresentation: window.__transitionStore.getState().presentation, liveIndex: 0 });
    return id;
  });
  await expect.poll(() => app.windows().filter(page => page.url().includes('mode=projector')).length).toBe(1);
  output = app.windows().find(page => page.url().includes('mode=projector'));
  await output.waitForFunction(() => !!window.__tourTest && document.body.textContent.includes('RED'));
  await output.evaluate(async () => { window.__transitionStore = (await import('/src/renderer/state/useStore.ts')).useStore; });
  await expect.poll(() => control.evaluate(() => window.__transitionStore.getState().projectorReady)).toBe(true);
  await settled();
});

test.afterEach(async ({}, info) => {
  try {
    if (output && !output.isClosed() && info.status !== info.expectedStatus) {
      await output.screenshot({ path: info.outputPath('projector-failure.png') }).catch(() => {});
    }
    if (control && !control.isClosed()) await control.evaluate(id => window.electronAPI.closeProjector(id), displayId);
  } finally {
    if (app) {
      await app.evaluate(({ app }) => { setTimeout(() => app.exit(0), 0); }).catch(() => {});
      await app.close();
    }
    app = control = output = undefined;
  }
});

async function configure(type, duration = 800) {
  await control.getByRole('combobox', { name: 'Transition Type', exact: true }).click();
  await control.locator(`[role="option"][data-value="${type}"]`).click();
  await control.getByRole('combobox', { name: 'Transition Duration', exact: true }).click();
  await control.locator(`[role="option"][data-value="${duration}"]`).click();
  await output.waitForFunction(({ type, duration }) => {
    const transition = window.__transitionStore.getState().presentation.transition;
    return transition.type === type && transition.duration === duration;
  }, { type, duration });
}

async function go(key = 'ArrowRight') {
  const target = await control.evaluate(key => {
    const state = window.__transitionStore.getState();
    const index = state.liveIndex + (key === 'ArrowLeft' ? -1 : 1);
    return state.presentation.slides[index].id;
  }, key);
  await control.locator(`[data-slide-id="${target}"]`).click();
  await output.waitForFunction(id => window.__transitionStore.getState().liveSlideId === id, target, { timeout: 5000 });
}

test('first effect selection and undo/redo sync default transitions to the projector', async () => {
  await control.evaluate(()=>{const s=window.__transitionStore.getState();s.dispatchUndo({type:'RESET',payload:{...s.presentation,transition:undefined}});});
  await output.waitForFunction(()=>{const t=window.__transitionStore.getState().presentation.transition;return t?.type==='fade'&&t.duration===400;});
  await configure('flip',600);
  const history=control.locator('.design-search-history');
  await history.getByRole('button').first().click();
  await history.getByRole('button').first().click();
  await expect.poll(()=>control.evaluate(()=>window.__transitionStore.getState().presentation.transition)).toBe(undefined);
  await output.waitForFunction(()=>{const t=window.__transitionStore.getState().presentation.transition;return t?.type==='fade'&&t.duration===400;});
  await history.getByRole('button').nth(1).click();
  await history.getByRole('button').nth(1).click();
  await output.waitForFunction(()=>{const t=window.__transitionStore.getState().presentation.transition;return t?.type==='flip'&&t.duration===600;});
});

async function runningLayer() {
  await output.waitForFunction(() => [...document.querySelectorAll('[data-slide-transition]')].some(element => element.style.zIndex === '2' && element.style.animation), null, { timeout: 5000 });
  return output.evaluate(() => {
    const layer = [...document.querySelectorAll('[data-slide-transition]')].find(element => element.style.zIndex === '2' && element.style.animation);
    const style = getComputedStyle(layer);
    const animation = layer.getAnimations()[0];
    return { duration: style.animationDuration, name: style.animationName, progress: animation?.effect.getComputedTiming().progress, time: animation?.currentTime, opacity: Number(style.opacity), transform: style.transform, filter: style.filter };
  });
}

async function settled() {
  await output.waitForFunction(() => ![...document.querySelectorAll('[data-slide-transition]')].some(element => element.style.animation));
}

test('real projector honors every selected effect with UI motion off and with OS reduced motion', async ({}, info) => {
  expect(await output.evaluate(() => document.documentElement.dataset.uiMotion)).toBe('off');
  const names = { fade: 'tr-fadeIn', slideLeft: 'tr-slideInL', slideRight: 'tr-slideInR', slideUp: 'tr-slideInU', slideDown: 'tr-slideInD', zoom: 'tr-zoomIn', zoomOut: 'tr-zoomOutIn', blur: 'tr-blurIn', flip: 'tr-flipIn' };
  let next = true;
  for (const [type, name] of Object.entries(names)) {
    console.log('Checking live effect:', type);
    await configure(type);
    await go(next ? 'ArrowRight' : 'ArrowLeft');
    next = !next;
    const layer = await runningLayer();
    expect(layer.duration, type).toBe('0.8s');
    expect(layer.name, type).toBe(name);
    expect(layer.progress, type).not.toBeNull();
    expect(layer.progress, type).toBeLessThan(1);
    await output.waitForTimeout(200);
    const midway = await runningLayer();
    expect(midway.progress, type).toBeGreaterThan(0);
    expect(midway.progress, type).toBeLessThan(1);
    if (type === 'fade') {
      expect(midway.opacity).toBeGreaterThan(0);
      expect(midway.opacity).toBeLessThan(1);
      await output.screenshot({ path: info.outputPath('projector-mid-fade.png') });
    }
    await settled();
  }
  await output.emulateMedia({ reducedMotion: 'reduce' });
  await configure('fade');
  await go('ArrowLeft');
  expect((await runningLayer()).duration).toBe('0.8s');
  await settled();
  await configure('fade', 150);
  await go();
  expect((await runningLayer()).duration).toBe('0.15s');
  await settled();
  await configure('none');
  await go('ArrowLeft');
  await output.waitForFunction(() => window.__transitionStore.getState().liveIndex === 0);
  expect(await output.locator('[data-slide-transition][style*="tr-"]').count()).toBe(0);
});

test('rapid live navigation restarts the effect for the new slide; instant auto tracking stays instant', async () => {
  await configure('fade');
  await go();
  await runningLayer();
  await output.waitForTimeout(240);
  await go();
  await output.waitForFunction(() => window.__transitionStore.getState().liveIndex === 2);
  const newLayer = await runningLayer();
  expect(newLayer.time).toBeLessThan(200);
  expect(newLayer.opacity).toBeLessThan(0.5);
  await settled();
  await control.evaluate(() => window.__transitionStore.getState().autoTrackToSlide(0));
  await output.waitForFunction(() => window.__transitionStore.getState().liveIndex === 0);
  expect(await output.locator('[data-slide-transition][style*="tr-"]').count()).toBe(0);
  await go();
  expect((await runningLayer()).duration).toBe('0.8s');
  await settled();
});

test('loop image transitions retain their duration and a single image never fades to itself', async () => {
  await control.evaluate(() => {
    const store = window.__transitionStore.getState();
    const mediaUrl = store.presentation.slides[1].mediaUrl;
    const single = { id: 'single-loop', type: 'loop', content: '', styles: {}, loopTransition: { type: 'fade', duration: 400 }, loopItems: [
      { id: 'only-image', type: 'image', mediaUrl, duration: 180 },
    ] };
    const multiple = { ...single, id: 'multiple-loop', loopItems: [
      { id: 'first-image', type: 'image', mediaUrl, duration: 900 },
      { id: 'second-image', type: 'image', mediaUrl, duration: 900 },
    ] };
    store.dispatchUndo({ type: 'RESET', payload: { ...store.presentation, transition: { type: 'none', duration: 400 }, slides: [single, multiple] } });
    store.setLiveIndex(0);
  });
  await output.waitForFunction(() => window.__transitionStore.getState().presentation.slides[0].id === 'single-loop');
  const singleFrames = await output.evaluate(() => new Promise(resolve => {
    const frames = [];
    const start = performance.now();
    const sample = () => {
      const layers = [...document.querySelectorAll('[data-slide-transition]')];
      frames.push(layers.some(layer => !!layer.style.animation));
      if (performance.now() - start < 750) requestAnimationFrame(sample);
      else resolve(frames);
    };
    requestAnimationFrame(sample);
  }));
  expect(singleFrames.length).toBeGreaterThan(5);
  expect(singleFrames.every(animated => !animated)).toBe(true);
  await go();
  await output.waitForFunction(() => !!document.querySelector('[data-slide-transition][style*="tr-fadeIn"]'));
  const duration = await output.locator('[data-slide-transition][style*="tr-fadeIn"]').evaluate(layer => getComputedStyle(layer).animationDuration);
  expect(duration).toBe('0.4s');
});

test('hymn part changes use the selected projector effect while text edits stay instant', async () => {
  await control.evaluate(() => {
    const s = window.__transitionStore.getState();
    s.dispatchUndo({ type: 'SET', payload: { ...s.presentation, slides: [
      { ...s.presentation.slides[0], id: 'red', partsMode: true, parts: ['First verse', 'Second verse', 'Third verse'], activePart: 0, content: 'First verse' },
      ...s.presentation.slides.slice(1),
    ] } });
    s.setIsRightPanelOpen(true);
    s.selectSlides({ activeId: 'red', ids: new Set(['red']), anchorIndex: 0 });
  });
  await output.waitForFunction(() => document.body.textContent.includes('First verse'));
  await settled();
  for (const [type, name] of [['fade','tr-fadeIn'], ['slideLeft','tr-slideInL'], ['zoom','tr-zoomIn'], ['none','none']]) {
    await configure(type);
    await control.locator('[data-hymn-part="1"]').click();
    if (type === 'none') {
      await output.waitForFunction(() => document.body.textContent.includes('Second verse'));
      await expect(output.locator('[data-part-transition]')).toHaveCount(0);
    } else {
      await expect(output.locator('[data-part-transition="incoming"]')).toHaveCSS('animation-name', name);
      await expect(output.locator('[data-part-transition="incoming"]')).toHaveCSS('animation-duration', '0.8s');
      await expect(output.locator('[data-part-transition]')).toHaveCount(0, { timeout: 2000 });
    }
    await control.locator('[data-hymn-part="0"]').click();
    await expect(output.locator('[data-part-transition]')).toHaveCount(0, { timeout: 2000 });
  }
  await control.locator('#slide-content-textarea').fill('Edited first verse');
  await output.waitForFunction(() => document.body.textContent.includes('Edited first verse'));
  await expect(output.locator('[data-part-transition]')).toHaveCount(0);
});
