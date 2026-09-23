import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tabForShortcut } from '../navigation';
import { presentationContentKey } from '../presentationLibrary';
import { replaceFolderItems } from '../mediaFolderItems';
import type { Presentation } from '../types';

test('Alt+9 opens the existing Settings page, not the removed autosaves page', () => {
  assert.equal(tabForShortcut('9'), 'settings');
  assert.equal(tabForShortcut('8'), 'calendar');
  assert.equal(tabForShortcut('0'), undefined);
});

test('saved status survives reopening and live navigation but changes with content', () => {
  const deck: Presentation = { id: 'deck', name: 'Sunday', slides: [{ id: 'a', type: 'text', content: 'Hello' }] };
  const reopened = JSON.parse(JSON.stringify(deck));
  assert.equal(presentationContentKey(deck), presentationContentKey(reopened));
  assert.equal(presentationContentKey(deck), presentationContentKey({ ...deck, liveIndex: 2, liveSlideId: 'b' }));
  assert.notEqual(presentationContentKey(deck), presentationContentKey({ ...deck, name: 'Monday' }));
  assert.notEqual(presentationContentKey(deck), presentationContentKey({ ...deck, slides: [{ ...deck.slides[0], content: 'Changed' }] }));
});

test('folder refresh removes stale filtered files and retains manual imports and stable ids', () => {
  const previous = [
    { id: 'manual', path: 'C:/photo.jpg', origin: 'manual' as const },
    { id: 'stale', path: 'C:/old.mp4', origin: 'folder' as const },
    { id: 'keep', path: 'C:\\same.jpg', origin: 'folder' as const },
  ];
  assert.deepEqual(replaceFolderItems(previous, [
    { id: 'duplicate', path: 'C:/photo.jpg', origin: 'folder' as const },
    { id: 'new-id', path: 'C:/same.jpg', origin: 'folder' as const },
  ]).map((item) => item.id), ['manual', 'keep']);
  assert.deepEqual(replaceFolderItems(previous, []).map((item) => item.id), ['manual']);
});
