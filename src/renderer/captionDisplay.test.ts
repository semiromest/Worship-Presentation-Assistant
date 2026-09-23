import { test } from 'node:test';
import assert from 'node:assert/strict';
import { captionText, layoutCaptions, type CaptionDisplayState } from './captionDisplay';
const state: CaptionDisplayState = {
  currentOriginal: 'Merhaba', partialOriginal: '', currentTranslation: 'Hello', partialTranslation: ' all',
  currentTranslations: { en: 'Hello', de: 'Hallo' }, partialTranslations: { en: ' all', de: ' zusammen' },
  lastOriginal: '', lastTranslation: '', lastTranslations: {}, targetLanguage: 'en', targetLanguages: ['en', 'de'], translationEnabled: true,
};
const slide = { id: 's', type: 'captions' as const, content: '' };
const measure = (text: string, size: number) => Array.from(text).length * size * .6;
test('every translation includes provisional text', () => {
  assert.deepEqual(captionText(state).translations, { en: 'Hello all', de: 'Hallo zusammen' });
});
test('hiding translation with multiple languages still displays original', () => {
  assert.deepEqual(layoutCaptions({ ...slide, captions: { showTranslation: false } }, state, measure).rows.map(r => r.text), ['Merhaba']);
});
test('long text fits all three layouts and retains the most recent words', () => {
  for (const layout of ['centered', 'top', 'lowerThird'] as const) {
    const long = { ...state, currentOriginal: 'word '.repeat(5000) + 'THE END', translationEnabled: false };
    const result = layoutCaptions({ ...slide, captions: { layout } }, long, measure);
    assert.ok(result.rows.every(r => r.y > 0 && r.y < 1080));
    assert.ok(result.rows.at(-1)?.text.endsWith('THE END'));
    assert.equal(long.currentOriginal.length, 25007);
  }
});
test('secondary translation alone stays visible while primary is empty', () => {
  const result = layoutCaptions(slide, { ...state, currentOriginal: '', currentTranslations: { de: 'Hallo' }, partialTranslations: {}, currentTranslation: '', partialTranslation: '' }, measure);
  assert.ok(result.rows.some(r => r.text.includes('Hallo')));
});
test('many selected languages remain within the available area', () => {
  const targets = Array.from({ length: 40 }, (_, i) => 'lang' + i);
  const result = layoutCaptions({ ...slide, captions: { layout: 'lowerThird' } }, { ...state, targetLanguages: targets, currentTranslations: Object.fromEntries(targets.map(code => [code, 'Text'])) }, measure);
  assert.ok(result.rows.every(row => row.y > 0 && row.y < 1080));
});
