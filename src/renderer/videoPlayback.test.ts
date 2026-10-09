import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attachVideoPlayback, videoRange, videoAudio } from './videoPlayback';

class FakeVideo extends EventTarget {
  duration = 100; readyState = 1; currentTime = 0; paused = true; seeking = false;
  loop = true; muted = false; volume = 1; plays = 0; cancelled = 0;
  play() { this.paused = false; this.plays++; this.dispatchEvent(new Event('play')); return Promise.resolve(); }
  pause() { this.paused = true; }
  requestVideoFrameCallback() { return 1; }
  cancelVideoFrameCallback() { this.cancelled++; }
  tick(time: number) { this.currentTime = time; this.dispatchEvent(new Event('timeupdate')); }
}
const options = { active: true, autoplay: false, muted: false, volume: 1 };
const element = (video: FakeVideo) => video as unknown as HTMLVideoElement;

test('legacy defaults and malformed ranges are safe', () => {
  assert.deepEqual(videoRange(undefined, 100), { start: 0, end: 100, loop: true, muted: false });
  assert.deepEqual(videoRange({ startSeconds: NaN, endSeconds: Infinity }, 100), videoRange(undefined, 100));
  const range = videoRange({ startSeconds: 300, endSeconds: 1 }, 100);
  assert.ok(range.start < range.end); assert.equal(range.end, 100);
  assert.equal(videoRange(undefined, Infinity).end, 0);
});

test('manual preview seeks to start without autoplay and stops inside the end boundary', () => {
  const video = new FakeVideo();
  const off = attachVideoPlayback(element(video), { startSeconds: 10, endSeconds: 20, loop: false }, options);
  assert.equal(video.currentTime, 10); assert.equal(video.plays, 0);
  video.play(); video.tick(20);
  assert.equal(video.paused, true); assert.ok(video.currentTime < 20 && video.currentTime > 19);
  video.play(); assert.equal(video.currentTime, 10);
  off(); assert.equal(video.cancelled, 1);
  video.tick(50); assert.equal(video.currentTime, 50);
});

test('range loops back to its start, not the file start; global and slide mute combine', () => {
  const video = new FakeVideo();
  const off = attachVideoPlayback(element(video), { startSeconds: 7, endSeconds: 12, loop: true, muted: true }, { ...options, autoplay: true });
  assert.equal(video.loop, false); assert.equal(video.muted, true);
  video.tick(12); assert.equal(video.currentTime, 7); assert.equal(video.paused, false);
  off();
  const cleanup = attachVideoPlayback(element(video), { muted: false }, { ...options, muted: true });
  assert.equal(video.muted, true); cleanup();
});

test('inactive media cannot start and stale metadata cannot seek after disposal', () => {
  const video = new FakeVideo();
  const off = attachVideoPlayback(element(video), { startSeconds: 10 }, { ...options, active: false, autoplay: true });
  video.dispatchEvent(new Event('loadedmetadata')); assert.equal(video.plays, 0); assert.equal(video.currentTime, 0);
  video.play(); assert.equal(video.paused, true);
  off(); video.dispatchEvent(new Event('loadedmetadata')); assert.equal(video.currentTime, 0);
});

test('scrubbing a paused manual preview to its boundary never starts playback', () => {
  const video = new FakeVideo();
  const off = attachVideoPlayback(element(video), { startSeconds: 10, endSeconds: 20, loop: true }, options);
  video.tick(20);
  assert.equal(video.plays, 0);
  assert.equal(video.paused, true);
  assert.equal(video.currentTime, 10);
  off();
});

test('editor can inspect outside the trim while paused; play returns to the selected range', () => {
  const video = new FakeVideo();
  const off = attachVideoPlayback(element(video), { startSeconds: 10, endSeconds: 20, loop: false }, { ...options, allowOutsideRangeWhilePaused: true });
  video.tick(5); assert.equal(video.currentTime, 5);
  video.play(); assert.equal(video.currentTime, 10);
  video.tick(20); assert.equal(video.paused, true); assert.ok(video.currentTime < 20);
  video.tick(70); assert.equal(video.currentTime, 70);
  video.play(); assert.equal(video.currentTime, 10);
  off();
});

test('speed and per-slide volume combine safely with global volume', () => {
  assert.deepEqual(videoAudio(undefined), { playbackRate: 1, volume: 1 });
  assert.deepEqual(videoAudio({ playbackRate: Infinity, volume: NaN }), videoAudio(undefined));
  assert.deepEqual(videoAudio({ playbackRate: 10, volume: 0.5 }, 0.4), { playbackRate: 4, volume: 0.2 });
  const video = new FakeVideo();
  const off = attachVideoPlayback(element(video), { playbackRate: 0.5, volume: 0.5 }, { ...options, volume: 0.4 });
  assert.equal((element(video)).playbackRate, 0.5); assert.equal(video.volume, 0.2); off();
});
