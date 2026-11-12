import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CaptionDisplayState } from './captionDisplay';
import { captionOverlayBlocks, DEFAULT_CAPTION_OVERLAY_CONFIG, hexToRgba, parseCaptionOverlayConfig } from './captionOverlay';

const state: CaptionDisplayState = {
  currentOriginal: 'Merhaba', partialOriginal: ' herkese', currentTranslation: 'Hello', partialTranslation: ' everyone',
  currentTranslations: { en: 'Hello' }, partialTranslations: { en: ' everyone' },
  lastOriginal: '', lastTranslation: '', lastTranslations: {}, targetLanguage: 'en', targetLanguages: ['en'], translationEnabled: true,
};
const texts = (s: CaptionDisplayState, source: Parameters<typeof captionOverlayBlocks>[1]) =>
  captionOverlayBlocks(s, source).map(b => `${b.secondary ? '~' : ''}${b.text}`);

test('auto shows the translation when translating, otherwise the spoken text', () => {
  assert.deepEqual(texts(state, 'auto'), ['Hello everyone']);
  assert.deepEqual(texts({ ...state, translationEnabled: false }, 'auto'), ['Merhaba herkese']);
});

test('every mode falls back to the spoken text when translation is off', () => {
  for (const source of ['translation', 'both'] as const) {
    assert.deepEqual(texts({ ...state, translationEnabled: false }, source), ['Merhaba herkese']);
  }
});

test('both mode puts the dimmed original above the translation', () => {
  assert.deepEqual(texts(state, 'both'), ['~Merhaba herkese', 'Hello everyone']);
});

test('the last finished utterance stays visible after an endpoint', () => {
  const sealed = { ...state, currentOriginal: '', partialOriginal: '', currentTranslation: '', partialTranslation: '',
    currentTranslations: {}, partialTranslations: {}, lastOriginal: 'Amin', lastTranslations: { en: 'Amen' }, lastTranslation: 'Amen' };
  assert.deepEqual(texts(sealed, 'original'), ['Amin']);
  assert.deepEqual(texts(sealed, 'translation'), ['Amen']);
});

test('nothing is shown before anyone speaks', () => {
  const empty = { ...state, currentOriginal: '', partialOriginal: '', currentTranslation: '', partialTranslation: '', currentTranslations: {}, partialTranslations: {} };
  assert.deepEqual(captionOverlayBlocks(empty, 'both'), []);
});

test('stored config is validated and clamped', () => {
  assert.deepEqual(parseCaptionOverlayConfig(null), DEFAULT_CAPTION_OVERLAY_CONFIG);
  assert.deepEqual(parseCaptionOverlayConfig('not json'), DEFAULT_CAPTION_OVERLAY_CONFIG);
  const parsed = parseCaptionOverlayConfig(JSON.stringify({
    enabled: true, source: 'nope', fontSize: 999, maxLines: 0, textColor: 'red', backgroundStyle: 'band', fontFamily: 'Comic Sans',
  }));
  assert.equal(parsed.enabled, true);
  assert.equal(parsed.source, 'auto');
  assert.equal(parsed.fontSize, 120);
  assert.equal(parsed.maxLines, 1);
  assert.equal(parsed.textColor, '#ffffff');
  assert.equal(parsed.backgroundStyle, 'band');
  assert.equal(parsed.fontFamily, 'sans-serif');
});

test('hex colors convert to rgba with opacity', () => {
  assert.equal(hexToRgba('#ff8000', 50), 'rgba(255, 128, 0, 0.5)');
  assert.equal(hexToRgba('bad', 100), 'rgba(0, 0, 0, 1)');
});
