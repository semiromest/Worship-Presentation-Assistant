import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OutputClock } from './outputClock';

test('repeats the last frame on static slides', () => {
  const clock = new OutputClock<string>();
  assert.equal(clock.tick(), null, 'nothing to send before the first paint');
  clock.push('a');
  for (let i = 0; i < 5; i++) { assert.equal(clock.tick(), 'a'); clock.done(true); }
  assert.equal(clock.sent, 5);
  assert.equal(clock.repeated, 4);
});

test('a busy sender drops ticks instead of queueing them', () => {
  const clock = new OutputClock<string>();
  clock.push('a');
  assert.equal(clock.tick(), 'a');
  clock.push('b');
  clock.push('c');
  assert.equal(clock.tick(), null);
  assert.equal(clock.tick(), null);
  assert.equal(clock.dropped, 2);
  clock.done(true);
  assert.equal(clock.tick(), 'c', 'only the newest frame survives');
  clock.done(false);
  assert.equal(clock.sent, 1, 'failed sends are not counted');
});

test('clear stops output until the next paint', () => {
  const clock = new OutputClock<string>();
  clock.push('a');
  clock.clear();
  assert.equal(clock.tick(), null);
});

test('frame delay releases frames once they are old enough, newest first-due wins', async () => {
  const { FrameDelay } = await import('./outputClock');
  const delay = new FrameDelay<string>(33);
  delay.push('a', 0);
  delay.push('b', 10);
  assert.equal(delay.release(20), null);
  assert.equal(delay.release(40), 'a');
  assert.equal(delay.release(50), 'b');
  assert.equal(delay.release(100), null, 'nothing new: the clock keeps repeating the last frame');
  delay.push('c', 100); delay.push('d', 101);
  assert.equal(delay.release(200), 'd', 'a late tick skips straight to the newest due frame');
});
