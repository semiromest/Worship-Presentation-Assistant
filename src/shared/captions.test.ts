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
  assert.equal(state.translations.en, '');
  assert.equal(state.partialTranslations.en, 'Two');
  assert.equal(state.history.find(h => h.original === 'Bir')?.translations.en, 'One');
  assert.equal(state.history.find(h => h.original === 'Bir')?.translations.de, 'Eins');
  assert.equal(state.history.filter(h => h.translations.de).length, 1);
});
test('partial replacement per stream and final drain keep final words exactly once', () => {
  const timeline = new CaptionTimeline('s', 'en');
  timeline.result('en', [original('Mer'), translated('Hel', false)]);
  timeline.result('de', [translated('Hal', false)]);
  timeline.result('en', [original('haba'), translated('Hello')]);
  assert.equal(timeline.snapshot().partialTranslations.de, 'Hal');
  assert.equal(timeline.snapshot().translations.en, 'Hello');
  timeline.result('de', [translated('Hallo')]);
  timeline.finish(); timeline.finish();
  assert.equal(timeline.snapshot().history.length, 1);
  assert.equal(timeline.snapshot().lastOriginal, 'Merhaba');
  assert.equal(timeline.snapshot().lastTranslations.de, 'Hallo');
});
test('extra endpoints do not shift or duplicate other language segments', () => {
  const timeline = new CaptionTimeline('s', 'en');
  timeline.result('de', [translated('Guten')]); timeline.endpoint('de'); timeline.endpoint('de');
  timeline.result('de', [translated(' Tag')]); timeline.endpoint('de');
  timeline.result('en', [original('İyi günler'), translated('Good day')]); timeline.finish();
  assert.equal(timeline.snapshot().history.length, 1);
  assert.equal(timeline.snapshot().history.filter(h => h.original).length, 1);
  assert.equal(timeline.snapshot().history[0].translations.de, 'Guten Tag');
});

test('secondary translation that finalizes first joins the later primary utterance', () => {
  const timeline = new CaptionTimeline('s', 'en');
  timeline.result('ko', [translated('안녕하세요 여러분')]);
  timeline.endpoint('ko');
  assert.equal(timeline.snapshot().history.length, 0, 'secondary text must wait for its primary utterance');

  timeline.result('en', [original('Merhaba arkadaşlar'), translated('Hello friends')]);
  timeline.endpoint('en');
  const history = timeline.snapshot().history;
  assert.equal(history.length, 1);
  assert.equal(history[0].original, 'Merhaba arkadaşlar');
  assert.equal(history[0].translations.en, 'Hello friends');
  assert.equal(history[0].translations.ko, '안녕하세요 여러분');
});

test('secondary translation that finalizes late updates the matching primary block', () => {
  const timeline = new CaptionTimeline('s', 'en');
  timeline.result('en', [original('Uzun konuşma'), translated('Long speech')]);
  timeline.result('ko', [translated('긴 연설')]);
  timeline.endpoint('en');
  timeline.endpoint('ko');

  const history = timeline.snapshot().history;
  assert.equal(history.length, 1);
  assert.deepEqual(history[0].translations, { en: 'Long speech', ko: '긴 연설' });
  assert.equal(timeline.snapshot().lastTranslations.ko, '긴 연설');
});

test('secondary speech that starts after an endpoint waits for the next primary block', () => {
  const timeline = new CaptionTimeline('s', 'en');
  timeline.result('en', [original('Birinci'), translated('First')]);
  timeline.endpoint('en');

  timeline.result('ko', [translated('두 번째')]);
  timeline.endpoint('ko');
  assert.equal(timeline.snapshot().history[0].translations.ko, undefined);

  timeline.result('en', [original('İkinci'), translated('Second')]);
  timeline.endpoint('en');
  const history = timeline.snapshot().history;
  assert.equal(history.length, 2);
  assert.equal(history[0].translations.ko, undefined);
  assert.equal(history[1].translations.ko, '두 번째');
});

test('translation whose owner aged out of bounded history never joins a newer utterance', () => {
  const timeline = new CaptionTimeline('s', 'en');
  timeline.result('ko', [translated('çok gecikmiş')]);
  for (let i = 0; i < 55; i++) {
    timeline.result('en', [original(`Konuşma ${i}`), translated(`Speech ${i}`)]);
    timeline.endpoint('en');
  }
  timeline.endpoint('ko');

  const history = timeline.snapshot().history;
  assert.equal(history.length, 50);
  assert.equal(history.some((entry) => entry.translations.ko), false);
});
test('history bounded to 50 unique ids; new sessions never reuse ids', () => {
  const a = new CaptionTimeline('a', 'en');
  for (let i = 0; i < 70; i++) { a.result('en', [original(String(i))]); a.endpoint('en'); }
  assert.equal(a.snapshot().history.length, 50);
  assert.equal(new Set(a.snapshot().history.map(h => h.id)).size, 50);
  const b = new CaptionTimeline('b', 'en'); b.result('en', [original('new')]); b.finish();
  assert.ok(!a.snapshot().history.some(h => h.id === b.snapshot().history[0].id));
});
