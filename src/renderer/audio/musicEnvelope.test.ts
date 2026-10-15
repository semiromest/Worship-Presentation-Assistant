import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MusicEnvelope, MUSIC_FADE_IN_MS, MUSIC_FADE_OUT_MS } from './musicEnvelope';

function fixture() {
  const audio = { volume: 1, muted: false };
  let now = 0;
  let queue: Array<() => void> = [];
  const mixer = new MusicEnvelope(() => audio, {
    now: () => now,
    schedule: callback => { queue.push(callback); return queue.length as unknown as ReturnType<typeof setTimeout>; },
    cancel: () => { queue = []; },
  });
  return { audio, mixer, advance(ms: number) { now += ms; const callbacks = queue; queue = []; callbacks.forEach(callback => callback()); } };
}

test('effective gain multiplies master, slide and actual-start fade; edits do not restart ramp', () => {
  const { audio, mixer, advance } = fixture();
  mixer.update({ master: 0.8, gain: 0.5 }); mixer.reset(0);
  assert.equal(audio.volume, 0);
  mixer.fadeTo(1, MUSIC_FADE_IN_MS);
  advance(250);
  assert.equal(audio.volume, 0.2);
  mixer.update({ gain: 0.25, muted: true });
  assert.equal(audio.volume, 0.1);
  assert.equal(audio.muted, true);
  advance(250);
  assert.equal(audio.volume, 0.2);
  mixer.update({ master: 0, muted: false });
  assert.equal(audio.volume, 0);
  assert.equal(audio.muted, false);
});

test('fade-out completes once at 800 ms; emergency reset invalidates stale completion', () => {
  const { audio, mixer, advance } = fixture();
  let completed = 0;
  mixer.fadeTo(0, MUSIC_FADE_OUT_MS, () => completed++);
  advance(400); assert.equal(audio.volume, 0.5); assert.equal(completed, 0);
  advance(400); assert.equal(audio.volume, 0); assert.equal(completed, 1);
  mixer.reset();
  mixer.fadeTo(0, MUSIC_FADE_OUT_MS, () => completed++);
  advance(100); mixer.reset(0);
  advance(900); assert.equal(completed, 1); assert.equal(audio.volume, 0);
});

test('replacement fade cancels old navigation and clamps invalid gain', () => {
  const { audio, mixer, advance } = fixture();
  let obsolete = false;
  mixer.fadeTo(0, 800, () => { obsolete = true; });
  advance(200); mixer.fadeTo(1, 500);
  advance(500); assert.equal(obsolete, false); assert.equal(audio.volume, 1);
  mixer.update({ gain: -1 }); assert.equal(audio.volume, 0);
  mixer.update({ gain: Number.NaN }); assert.equal(audio.volume, 1);
});
