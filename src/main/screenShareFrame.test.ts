import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeFrame } from './screenShareFrame';

test('phone frames are decoded once from the renderer data URL into raw image bytes', () => {
  const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
  const decoded = decodeFrame(`data:image/jpeg;base64,${bytes.toString('base64')}`);
  assert.ok(decoded);
  assert.deepEqual([...decoded], [...bytes]);
  assert.ok(decodeFrame(`data:image/png;base64,${bytes.toString('base64')}`));
  assert.ok(decodeFrame(`data:image/webp;base64,${bytes.toString('base64')}`));
});

test('anything that is not an image data URL is dropped instead of broadcast', () => {
  for (const frame of [null, undefined, 42, '', 'data:image/jpeg;base64,', 'data:text/html;base64,PGgxPg==',
    'data:image/svg+xml;base64,PHN2Zy8+', 'https://example.com/frame.jpg', `data:image/jpeg;base64,${'A'.repeat(8 * 1024 * 1024 + 1)}`]) {
    assert.equal(decodeFrame(frame), null, String(frame).slice(0, 40));
  }
});
