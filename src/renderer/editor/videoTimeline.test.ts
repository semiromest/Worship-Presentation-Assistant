import { test } from 'node:test';
import assert from 'node:assert/strict';
import { timelineTime, trimBoundary, videoTimecode } from './videoTimeline';

test('timeline maps coordinates and clamps outside pointers', () => {
  assert.equal(timelineTime(150, 100, 100, 20), 10);
  assert.equal(timelineTime(90, 100, 100, 20), 0);
  assert.equal(timelineTime(250, 100, 100, 20), 20);
  assert.equal(timelineTime(150, 100, 0, 20), 0);
});
test('trim handles never cross or escape the source duration', () => {
  assert.equal(trimBoundary('start', 25, 5, 20, 30), 19.99);
  assert.equal(trimBoundary('start', -5, 5, 20, 30), 0);
  assert.equal(trimBoundary('end', 2, 5, 20, 30), 5.01);
  assert.equal(trimBoundary('end', 100, 5, 20, 30), 30);
  assert.ok(trimBoundary('start', 1, 0, 0.002, 0.002) < 0.002);
});
test('timecode carries rounded centiseconds across minute boundaries', () => {
  assert.equal(videoTimecode(59.999), '01:00.00');
  assert.equal(videoTimecode(3600.125), '60:00.13');
  assert.equal(videoTimecode(NaN), '00:00.00');
});
