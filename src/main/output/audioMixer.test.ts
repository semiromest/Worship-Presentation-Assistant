import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AudioClock, AudioMixer } from './audioMixer';

const block = (frames: number, l: number, r = l) => { const b = new Float32Array(frames * 2); b.fill(l, 0, frames); b.fill(r, frames); return b; };
const FRAMES_20MS = 960;

test('a source is silent until its jitter buffer reaches the target, then mixes', () => {
  const mixer = new AudioMixer({ targetMs: 40 });
  mixer.push('music', block(FRAMES_20MS, 0.25), 0);
  assert.equal(mixer.pull(480, 0)[0], 0, '20 ms buffered < 40 ms target');
  mixer.push('music', block(FRAMES_20MS, 0.25), 20);
  const out = mixer.pull(480, 20);
  assert.ok(Math.abs(out[0] - 0.25) < 1e-6);
  assert.ok(Math.abs(out[480] - 0.25) < 1e-6, 'right channel');
});

test('sources are summed and clipped', () => {
  const mixer = new AudioMixer({ targetMs: 20 });
  mixer.push('video', block(FRAMES_20MS, 0.7, -0.7), 0);
  mixer.push('music', block(FRAMES_20MS, 0.6, -0.1), 0);
  const out = mixer.pull(480, 0);
  assert.equal(out[0], 1);
  assert.ok(Math.abs(out[480] - -0.8) < 1e-6);
});

test('underrun plays silence and refills to the target before resuming', () => {
  const mixer = new AudioMixer({ targetMs: 20 });
  mixer.push('video', block(FRAMES_20MS, 0.5), 0);
  mixer.pull(FRAMES_20MS + 100, 0); // asks for more than buffered
  assert.equal(mixer.stats().video.underruns, 1);
  mixer.push('video', block(480, 0.5), 30);
  assert.equal(mixer.pull(100, 30)[0], 0, 'not primed again yet');
  mixer.push('video', block(FRAMES_20MS, 0.5), 40);
  assert.ok(mixer.pull(100, 40)[0] > 0.4);
});

test('a fast source clock is absorbed with at most 0.1 % rate correction', () => {
  const mixer = new AudioMixer({ targetMs: 40, toleranceMs: 20 });
  // Source produces 0.05 % faster than the output pulls, for 10 minutes of audio.
  let produced = 0, pulled = 0, maxLevel = 0;
  for (let ms = 0; ms < 600_000; ms += 20) {
    const want = Math.round(((ms + 20) / 1000) * 48_000 * 1.0005) - produced;
    mixer.push('music', block(want, 0.1), ms);
    produced += want;
    mixer.pull(FRAMES_20MS, ms);
    pulled += FRAMES_20MS;
    maxLevel = Math.max(maxLevel, mixer.stats().music.levelMs);
  }
  const s = mixer.stats().music;
  assert.equal(s.underruns, 0);
  assert.ok(maxLevel <= 62, `buffer stayed bounded (max ${maxLevel} ms)`);
  assert.ok(s.corrections > 0);
  assert.ok(pulled > 0 && produced > pulled);
});

test('a burst far above the buffer limit is dropped back to the target', () => {
  const mixer = new AudioMixer({ targetMs: 40, maxMs: 200 });
  mixer.push('video', block(48_000, 0.1), 0); // 1 s at once
  assert.ok(mixer.stats().video.levelMs <= 41);
});

test('idle sources are forgotten and restart cleanly', () => {
  const mixer = new AudioMixer({ targetMs: 20, idleMs: 500 });
  mixer.push('music', block(FRAMES_20MS, 0.3), 0);
  mixer.pull(FRAMES_20MS - 10, 0);
  mixer.pull(FRAMES_20MS, 2000);
  assert.equal(mixer.stats().music, undefined);
});

test('audio clock pays out wall-clock samples and skips stalls instead of bursting', () => {
  const clock = new AudioClock(48_000, 100);
  assert.equal(clock.due(33.3), 1598);
  assert.equal(clock.due(66.6), 1598);
  assert.equal(clock.due(2066.6), 4800, 'a 2 s stall sends at most 100 ms');
  assert.equal(clock.due(2100), 1604);
});

test('after a burst the smoothed level returns to the band within seconds, without cutting audio', () => {
  const mixer = new AudioMixer();
  let ms = 0;
  const step = (extra = 0) => { mixer.push('music', block(FRAMES_20MS + extra, 0.1), ms); mixer.pull(FRAMES_20MS, ms); ms += 20; };
  for (let i = 0; i < 100; i++) step();
  step(FRAMES_20MS * 2); // 40 ms arrive late in one go
  const high = mixer.stats().music.levelMs;
  for (let i = 0; i < 500; i++) step(); // 10 s
  const s = mixer.stats().music;
  assert.ok(high >= 115, `burst raised the level (${high} ms)`);
  assert.ok(s.levelMs <= 95, `back in the band around the 100 ms target, read after a 20 ms pull (${s.levelMs} ms)`);
  assert.equal(s.underruns, 0);
});

test('a 70 ms delivery pause does not run the buffer dry', () => {
  const mixer = new AudioMixer();
  let ms = 0;
  for (let i = 0; i < 50; i++) { mixer.push('video', block(FRAMES_20MS, 0.1), ms); mixer.pull(FRAMES_20MS, ms); ms += 20; }
  // Main pauses 70 ms (no blocks arrive) while the sender keeps pulling, then blocks catch up.
  for (let i = 0; i < 3; i++) { ms += 23; mixer.pull(1120, ms); }
  for (let i = 0; i < 4; i++) mixer.push('video', block(FRAMES_20MS, 0.1), ms);
  mixer.pull(1600, ms + 10);
  assert.equal(mixer.stats().video.underruns, 0);
});
