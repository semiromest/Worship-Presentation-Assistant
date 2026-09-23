import assert from 'node:assert/strict';
import test from 'node:test';
import { bibleRepository } from './bibleRepository';
import { resolveQuickVerse } from './quickVerse';

test('phone references resolve against the current Bible and reject incomplete ranges', () => {
  assert.deepEqual(resolveQuickVerse('Yarat 2:13'), { ok: false, error: 'no-bible' });
  const data = {
    name: 'Current translation', format: 'getbible' as const,
    books: [{ name: 'Yaratılış', number: '1', chapters: [{ number: '2',
      verses: [13, 14, 15].map(number => ({ number: String(number), text: `Current text ${number}` })) }] }],
  };
  bibleRepository.remember(data, { type: 'getbible', id: 'current' });
  const result = resolveQuickVerse('Yarat 2:13-15');
  assert.equal(result.ok, true);
  if (result.ok) assert.match(result.result.slides.join('\n'), /Current text 15/);
  for (const reference of ['Yarat 2:', 'Yarat 2:13-', 'Yarat 2:15-13', 'Yarat 2:13-99']) {
    assert.equal(resolveQuickVerse(reference).ok, false, reference);
  }
  bibleRepository.remember({ ...data, books: [] }, { type: 'local', id: 'other' });
  assert.equal(resolveQuickVerse('Yarat 2:13').ok, false);
});
