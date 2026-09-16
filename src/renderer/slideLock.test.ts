import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Slide } from './types';
import {
  findLockedSlideIndex,
  resolveLiveIndexForLock,
  pinSlide,
  unpinSlide,
} from './slideLock';

function slide(id: string, locked?: boolean): Slide {
  return { id, type: 'text', content: id, ...(locked ? { locked: true } : {}) };
}

test('findLockedSlideIndex: no lock → -1', () => {
  assert.equal(findLockedSlideIndex([slide('a'), slide('b')]), -1);
  assert.equal(findLockedSlideIndex([]), -1);
});

test('findLockedSlideIndex: finds the locked slide', () => {
  const slides = [slide('a'), slide('b', true), slide('c')];
  assert.equal(findLockedSlideIndex(slides), 1);
});

test('resolveLiveIndexForLock: without lock returns the requested index', () => {
  const slides = [slide('a'), slide('b')];
  assert.equal(resolveLiveIndexForLock(3, slides), 3);
  assert.equal(resolveLiveIndexForLock(0, slides), 0);
});

test('resolveLiveIndexForLock: with lock always resolves to the locked slide', () => {
  const slides = [slide('a'), slide('b', true), slide('c')];
  assert.equal(resolveLiveIndexForLock(0, slides), 1);
  assert.equal(resolveLiveIndexForLock(2, slides), 1);
  assert.equal(resolveLiveIndexForLock(99, slides), 1);
});

test('pinSlide: locks the target slide and clears any previous lock', () => {
  const slides = [slide('a', true), slide('b'), slide('c')];
  const result = pinSlide(slides, 'c');
  assert.ok(result);
  assert.equal(result.lockedIndex, 2);
  assert.equal(result.slides[0].locked, false);
  assert.equal(result.slides[2].locked, true);
  // Single-lock invariant: exactly one locked slide.
  assert.equal(result.slides.filter((s) => s.locked).length, 1);
  // Original array is untouched (immutable update).
  assert.equal(slides[0].locked, true);
});

test('pinSlide: returns null when already pinned to the same slide', () => {
  const slides = [slide('a'), slide('b', true)];
  assert.equal(pinSlide(slides, 'b'), null);
});

test('pinSlide: returns null for an unknown slide id', () => {
  const slides = [slide('a'), slide('b')];
  assert.equal(pinSlide(slides, 'missing'), null);
});

test('unpinSlide: clears the lock and is a no-op when nothing is locked', () => {
  const slides = [slide('a'), slide('b', true)];
  const unpinned = unpinSlide(slides, 'b');
  assert.equal(unpinned.some((s) => s.locked), false);
  // Unknown id or no lock at all → slides unchanged in content.
  const untouched = unpinSlide([slide('a'), slide('b')], 'c');
  assert.equal(untouched.length, 2);
  assert.equal(untouched.some((s) => s.locked), false);
});

test('lock follows the slide identity through reordering', () => {
  // 'c' is locked; simulate a reorder moving 'c' to index 0.
  const slides = [slide('a'), slide('b'), slide('c', true)];
  const reordered = [slides[2], slides[0], slides[1]];
  assert.equal(findLockedSlideIndex(reordered), 0);
  assert.equal(resolveLiveIndexForLock(2, reordered), 0);
});
