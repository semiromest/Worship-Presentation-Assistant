import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeProjectorSnapshot } from './projectorSnapshot';
test('output can reconstruct its last full state after control is unavailable', () => {
  const full = { id: 'p', name: 'Test', slides: [{ id: 'a', type: 'text', content: 'old' }] };
  const initial = mergeProjectorSnapshot(undefined, { fullPresentation: full, liveIndex: 0 });
  const next = mergeProjectorSnapshot(initial, { patch: { slidesPatch: [{ id: 'a', nextSlide: { id: 'a', type: 'text', content: 'new' } }] }, isBlackout: true });
  assert.equal(next?.fullPresentation.slides[0].content, 'new'); assert.equal(next?.isBlackout, true);
  assert.equal(next?.patch, undefined); assert.equal(full.slides[0].content, 'old');
  assert.equal(mergeProjectorSnapshot(undefined, { liveIndex: 3 }), undefined);
});
