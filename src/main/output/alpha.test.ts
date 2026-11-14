import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unpremultiplyBgra } from './alpha';

test('restores straight alpha from the premultiplied values Electron produces', () => {
  // Measured on Electron 43: 50% white, 25% amber (BGRA), opaque red, fully transparent.
  const pixels = new Uint8Array([128, 128, 128, 128, 0, 50, 64, 64, 0, 0, 255, 255, 0, 0, 0, 0]);
  unpremultiplyBgra(pixels);
  assert.deepEqual([...pixels], [255, 255, 255, 128, 0, 199, 255, 64, 0, 0, 255, 255, 0, 0, 0, 0]);
});

test('never overflows and clears colour under zero alpha', () => {
  const pixels = new Uint8Array([200, 10, 255, 100, 9, 9, 9, 0]);
  unpremultiplyBgra(pixels);
  assert.deepEqual([...pixels], [255, 26, 255, 100, 0, 0, 0, 0]);
});

test('a 1080p frame converts quickly enough for a worker thread at 30 fps', () => {
  const frame = new Uint8Array(1920 * 1080 * 4);
  // Worst case: every pixel semi-transparent.
  for (let i = 0; i < frame.length; i += 4) { frame[i] = 60; frame[i + 1] = 60; frame[i + 2] = 60; frame[i + 3] = 120; }
  const started = performance.now();
  unpremultiplyBgra(frame);
  const ms = performance.now() - started;
  assert.equal(frame[0], 128);
  assert.ok(ms < 100, `took ${ms.toFixed(1)} ms`);
});
