import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  normalizeAuthorPosition,
  normalizeAuthorSize,
  readHymnAuthorPosition,
  readHymnAuthorSize,
} from './hymnAuthorSettings';

test('author settings preserve defaults and validate persisted values', () => {
  assert.equal(normalizeAuthorPosition('top-right'), 'top-right');
  assert.equal(normalizeAuthorPosition('invalid'), 'bottom-center');
  assert.equal(normalizeAuthorSize(null), 28);
  assert.equal(normalizeAuthorSize(''), 28);
  assert.equal(normalizeAuthorSize('NaN'), 28);
  assert.equal(normalizeAuthorSize('32'), 32);
  assert.equal(normalizeAuthorSize('-10'), 10);
  assert.equal(normalizeAuthorSize('1000'), 60);
});

test('unavailable localStorage falls back consistently for preview and thumbnails', () => {
  assert.equal(readHymnAuthorPosition(), 'bottom-center');
  assert.equal(readHymnAuthorSize(), 28);
});

test('credit size uses only appearance settings and scales with the output', async () => {
  const { hymnCreditFontSize } = await import('./hymnAuthorSettings');
  const reference = hymnCreditFontSize(28);
  assert.equal(hymnCreditFontSize(28, 0.5), reference / 2);
  assert.equal(hymnCreditFontSize(56), reference * 2);
});
