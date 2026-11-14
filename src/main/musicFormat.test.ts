import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chooseCompactAudioFormat } from './musicFormat';

const opus = (itag: number, bitrate: number, extra = {}) => ({ itag, bitrate, mimeType: 'audio/webm; codecs="opus"', ...extra });

test('offline download picks the best Opus format under the size cap', () => {
  const formats = [opus(251, 140_000), opus(250, 70_000), opus(249, 52_000), { itag: 140, bitrate: 130_000, mimeType: 'audio/mp4; codecs="mp4a.40.2"' }];
  assert.equal(chooseCompactAudioFormat(formats)?.itag, 250);
});

test('falls back to the smallest format when every format exceeds the cap', () => {
  assert.equal(chooseCompactAudioFormat([opus(251, 160_000), opus(250, 120_000)])?.itag, 250);
});

test('prefers original, non-DRC tracks and ignores video formats', () => {
  const formats = [
    opus(250, 70_000, { isDrc: true }), opus(251, 140_000), opus(249, 50_000, { isAutoDubbed: true }),
    { itag: 278, bitrate: 60_000, mimeType: 'video/webm; codecs="vp9"' },
  ];
  assert.equal(chooseCompactAudioFormat(formats)?.itag, 251);
  assert.equal(chooseCompactAudioFormat([{ itag: 278, bitrate: 1, mimeType: 'video/webm' }]), undefined);
});
