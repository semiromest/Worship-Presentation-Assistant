import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canCacheScene, resumedVideoTime, sceneKey, type ScreenFrameScene } from './screenFrameScene';
const scene = (): ScreenFrameScene => ({ documentId: 'a', slide: { id: '1', type: 'text', content: 'Hello' },
  blackout: false, width: 1280, height: 720, quality: .75,
  context: { watermark: {} as ScreenFrameScene['context']['watermark'], authorPosition: 'bottom-center', authorSize: 28 },
  environment: { language: 'tr', theme: 'dark', fontRevision: 0 } });
test('scene identity includes all data, including future fields and resolved context', () => {
  const original = scene(), key = sceneKey(original);
  assert.equal(key, sceneKey(structuredClone(original)));
  const alternatives = [
    { ...original, blackout: true }, { ...original, width: 1920 },
    { ...original, environment: { ...original.environment, language: 'en' } },
    { ...original, environment: { ...original.environment, fontRevision: 1 } },
    { ...original, slide: { ...original.slide, futureVisualSetting: 5 } },
    { ...original, context: { ...original.context, authorSize: 30 } },
  ];
  for (const changed of alternatives) assert.notEqual(sceneKey(changed), key);
  assert.equal(sceneKey({ b: 1, a: { z: 2, x: 0 } }), sceneKey({ a: { x: 0, z: 2 }, b: 1 }));
});
test('file pixels, image items and dynamic sources bypass the frame cache', () => {
  assert.equal(canCacheScene(scene()), true);
  for (const source of ['relative-background.avif', 'C:\\images\\same.png', 'file:///tmp/a.jpg', 'local-resource://media/a', 'https://example.com/a', 'data:image/png;base64,AAA']) {
    const value = scene(); value.slide.styles = { fontSize: 48, backgroundColor: '#000', textColor: '#fff', backgroundImage: source }; assert.equal(canCacheScene(value), false);
  }
  for (const type of ['video', 'loop', 'countdown', 'captions', 'image'] as const) assert.equal(canCacheScene({ ...scene(), slide: { id: '1', type, content: '' } }), false);
});
test('resuming loops accounts for elapsed time, trims and playback rate', () => {
  assert.equal(resumedVideoTime(3, 45, 20, 2, 6, 2, true), 5);
  assert.equal(resumedVideoTime(2, 4, 20, 2, 6, 1, true), 2);
  assert.equal(resumedVideoTime(3, 45, 20, 2, 6, 2, false), 6);
  assert.equal(resumedVideoTime(0, 10, NaN), 0);
});
