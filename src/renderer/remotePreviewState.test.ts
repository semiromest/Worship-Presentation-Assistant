import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Slide } from './types';
import { RemotePreviewState } from './remotePreviewState';

test('one edit in 1000 slides changes one revision; reordering changes no image revision', () => {
  const state = new RemotePreviewState(() => 'document-token');
  const slides = Array.from({ length: 1000 }, (_, i) => ({ id: String(i), type: 'text', content: String(i) } as Slide));
  const before = state.update('doc', slides, null, () => 0);
  const edited = slides.map((slide, i) => i === 500 ? { ...slide, content: 'new' } : slide);
  const after = state.update('doc', edited, null, () => 0);
  assert.equal(after.slots.filter((slot, i) => slot.version !== before.slots[i].version).length, 1);
  assert.deepEqual(state.update('doc', [...edited].reverse(), null, () => 0).slots, [...after.slots].reverse());
});

test('font invalidation is per dependency; remove/re-add never revives an old job', () => {
  const state = new RemotePreviewState(() => 'token');
  const slides = [{ id: 'a', type: 'text', content: 'a' }, { id: 'b', type: 'text', content: 'b' }] as Slide[];
  const first = state.update('doc', slides, null, () => 0);
  const font = state.update('doc', slides, null, slide => slide.id === 'a' ? 1 : 0);
  assert.notEqual(font.slots[0].version, first.slots[0].version);
  assert.equal(font.slots[1].version, first.slots[1].version);
  state.update('doc', [], null, () => 0);
  const restored = state.update('doc', slides, null, () => 0);
  assert.ok(restored.slots[0].version > font.slots[0].version);
  assert.equal(state.get({ token: first.token, ...first.slots[0] }), undefined);
});
