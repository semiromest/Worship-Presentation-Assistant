import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyPreviewUpdates } from './previewUpdates';

test('preview deltas reject malformed and out-of-range indices without growing the snapshot', () => {
  const previews = ['a', '', 'c'];
  const indices = [Infinity, -Infinity, NaN, -1, 0.5, 3, Number.MAX_SAFE_INTEGER, '1'];
  assert.deepEqual(
    applyPreviewUpdates(
      previews,
      indices.map((i) => ({ i, url: 'bad' }))
    ),
    []
  );
  assert.deepEqual(applyPreviewUpdates(previews, [null, {}, { i: 1, url: null }]), []);
  assert.deepEqual(applyPreviewUpdates(previews, null), []);
  assert.deepEqual(previews, ['a', '', 'c']);
  assert.deepEqual(applyPreviewUpdates([], [{ i: 0, url: 'bad' }]), []);
});

test('valid deltas preserve placeholders, skip no-ops, and keep wire order', () => {
  const previews = ['a', '', 'c'];
  const updates = [
    { i: 1, url: 'b' },
    { i: 0, url: 'a' },
    { i: 2, url: '' },
    { i: 1, url: 'new' },
  ];
  assert.deepEqual(applyPreviewUpdates(previews, updates), [updates[0], updates[2], updates[3]]);
  assert.deepEqual(previews, ['a', 'new', '']);
});
