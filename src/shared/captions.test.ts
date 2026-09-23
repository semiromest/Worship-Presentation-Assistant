import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CaptionTimeline } from './captions';
import type { SttToken } from './stt';
const original = (text: string, isFinal = true): SttToken => ({ text, isFinal, translationStatus: 'original', language: 'tr', sourceLanguage: null });
const translated = (text: string, isFinal = true): SttToken => ({ text, isFinal, translationStatus: 'translation', language: 'en', sourceLanguage: 'tr' });

test('independent language boundaries cannot merge late translation into new primary speech', () => {
  const timeline = new CaptionTimeline('s', 'en');
  timeline.result('en', [original('Bir'), translated('One')]);
  timeline.result('de', [original('Bir'), translated('Ei', false)]);
  timeline.endpoint('en');
  timeline.result('en', [original('İki'), translated('Two', false)]);
  timeline.result('de', [translated('Eins')]);
  timeline.endpoint('de');
  const state = timeline.snapshot();
  assert.equal(state.original, 'İki');
  assert.equal(state.translations.en, 'Two');
  assert.equal(state.history.find(h => h.original === 'Bir')?.translations.en, 'One');
  assert.equal(state.history.find(h => h.translations.de)?.original, '');
  assert.equal(state.history.find(h => h.translations.de)?.translations.de, 'Eins');
});
test('partial replacement per stream and final drain keep final words exactly once', () => {
  const timeline = new CaptionTimeline('s', 'en');
  timeline.result('en', [original('Mer'), translated('Hel', false)]);
  timeline.result('de', [translated('Hal', false)]);
  timeline.result('en', [original('haba'), translated('Hello')]);
  assert.equal(timeline.snapshot().translations.de, 'Hal');
  assert.equal(timeline.snapshot().translations.en, 'Hello');
  timeline.result('de', [translated('Hallo')]);
  timeline.finish(); timeline.finish();
  assert.equal(timeline.snapshot().history.length, 2);
  assert.equal(timeline.snapshot().lastOriginal, 'Merhaba');
  assert.equal(timeline.snapshot().lastTranslations.de, 'Hallo');
});
test('extra endpoints do not shift or duplicate other language segments', () => {
  const timeline = new CaptionTimeline('s', 'en');
  timeline.result('de', [translated('Guten')]); timeline.endpoint('de'); timeline.endpoint('de');
  timeline.result('de', [translated(' Tag')]); timeline.endpoint('de');
  timeline.result('en', [original('İyi günler'), translated('Good day')]); timeline.finish();
  assert.equal(timeline.snapshot().history.length, 3);
  assert.equal(timeline.snapshot().history.filter(h => h.original).length, 1);
});
test('history bounded to 50 unique ids; new sessions never reuse ids', () => {
  const a = new CaptionTimeline('a', 'en');
  for (let i = 0; i < 70; i++) { a.result('en', [original(String(i))]); a.endpoint('en'); }
  assert.equal(a.snapshot().history.length, 50);
  assert.equal(new Set(a.snapshot().history.map(h => h.id)).size, 50);
  const b = new CaptionTimeline('b', 'en'); b.result('en', [original('new')]); b.finish();
  assert.ok(!a.snapshot().history.some(h => h.id === b.snapshot().history[0].id));
});
