// ─── Multi-target-language STT store tests ──────────────────────────────────
// Soniox needs one realtime session per translation target, all fed the same
// audio. These tests pin the store-side behaviour that keeps two parallel
// streams from duplicating the transcript (the bug reported as "translations
// printed several times on screen").

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useSttStore } from './useSttStore';
import type { SttToken } from '../../shared/stt';

const store = () => useSttStore.getState();

function original(text: string, isFinal = true): SttToken {
  return {
    text,
    isFinal,
    translationStatus: 'original',
    language: 'tr',
    sourceLanguage: null,
    targetLanguage: null,
  };
}

function translated(text: string, targetLanguage: string, isFinal = true): SttToken {
  return {
    text,
    isFinal,
    translationStatus: 'translation',
    language: targetLanguage,
    sourceLanguage: 'tr',
    targetLanguage,
  };
}

/** Fresh session state: translation into English (primary) + Chinese (secondary). */
function startTwoTargets(): void {
  store().clearAll();
  store().setTargetLanguages(['en', 'zh']);
  store().setStatus('connected');
}

test('yalnızca birincil oturum konuşma metnini (original) yazar', () => {
  startTwoTargets();

  // Primary session (en) — owns the spoken timeline.
  store().applyResult([original('Merhaba'), translated('Hello', 'en')], 'en');
  assert.equal(store().currentOriginal, 'Merhaba');

  // Translation-only session (zh) re-delivers the same spoken tokens; they must
  // not be appended a second time.
  store().applyResult([original('Merhaba'), translated('你好', 'zh')], 'zh');
  assert.equal(store().currentOriginal, 'Merhaba');
  assert.equal(store().currentTranslation, 'Hello');
  assert.equal(store().currentTranslations.zh, '你好');
});

test('çeviri kapalıyken (tek oturum) original akışı normal çalışır', () => {
  store().clearAll();
  store().applyResult([original('Selam'), original('dünya')], undefined);
  assert.equal(store().currentOriginal, 'Selamdünya');
});

test('yarı-final metin her dil için ayrı tutulur (birbirini silmez)', () => {
  startTwoTargets();

  store().applyResult([original('Bugün', false), translated('To', 'en', false)], 'en');
  assert.equal(store().partialOriginal, 'Bugün');
  assert.equal(store().partialTranslations.en, 'To');
  assert.equal(store().partialTranslation, 'To');

  // Chinese session event arrives in between: English live text must survive.
  store().applyResult([translated('今', 'zh', false)], 'zh');
  assert.equal(store().partialOriginal, 'Bugün');
  assert.equal(store().partialTranslations.en, 'To');
  assert.equal(store().partialTranslations.zh, '今');
  assert.equal(store().partialTranslation, 'To', 'birincil dil canlı metni korunmalı');
});

test('final token bir dilin yarı-final metnini kapatır, diğerini bırakmaz', () => {
  startTwoTargets();

  store().applyResult([translated('Hel', 'en', false)], 'en');
  assert.equal(store().partialTranslations.en, 'Hel');

  // Soniox finalizes 'Hel' and starts a new provisional word in one message.
  store().applyResult([translated('Hel', 'en', true), translated('lo', 'en', false)], 'en');
  assert.equal(store().currentTranslations.en, 'Hel');
  assert.equal(store().partialTranslations.en, 'lo', 'final gelince yarı-final yerini yeni kelimeye bırakmalı');
});

test('seal sonrası geç gelen ikincil çeviri birincil çeviriye karışmaz', () => {
  startTwoTargets();

  store().applyResult([original('Ben ısrar ettim'), translated('I insisted', 'en')], 'en');
  store().sealCurrent();
  assert.equal(store().utterances.length, 1);

  // Late final token of the secondary language (grace window already expired).
  store().appendLateTranslation('我坚持', 'zh');
  store().appendLateTranslation(' more', 'en');

  const last = store().utterances[0];
  assert.equal(last.translation, 'I insisted more');
  assert.equal(last.translations?.zh, '我坚持');
  assert.equal(store().lastTranslation, 'I insisted more');
  assert.equal(store().lastTranslations?.zh, '我坚持');
  assert.equal(last.original, 'Ben ısrar ettim');
});

test('tek seferlik endpoint → tek geçmiş kaydı (duplicate seal yok)', () => {
  startTwoTargets();

  store().applyResult([original('Birinci cümle'), translated('First sentence', 'en')], 'en');
  store().applyResult([translated('第一句', 'zh')], 'zh');
  store().sealCurrent();

  // Next utterance must start from an empty slate rather than re-sealing the
  // previous text (the reported "growing, repeated entries").
  store().applyResult([original('İkinci cümle'), translated('Second sentence', 'en')], 'en');
  store().sealCurrent();

  assert.equal(store().utterances.length, 2);
  assert.equal(store().utterances[0].original, 'Birinci cümle');
  assert.equal(store().utterances[1].original, 'İkinci cümle');
  assert.equal(store().utterances[0].translations?.zh, '第一句');
  assert.equal(store().utterances[1].translations?.zh, undefined);
});

test('normalize edilmiş altyazı anlık görüntüsü kesin ve geçici metni ayrı korur', () => {
  startTwoTargets();
  store().setCaptions({
    original: 'Mer',
    partialOriginal: 'haba',
    translations: { en: 'Hel', zh: '' },
    partialTranslations: { en: 'lo', zh: '你' },
    lastOriginal: '',
    lastTranslations: {},
    history: [],
    detectedLanguage: 'tr',
  });

  assert.equal(store().currentOriginal, 'Mer');
  assert.equal(store().partialOriginal, 'haba');
  assert.equal(store().currentTranslation, 'Hel');
  assert.equal(store().partialTranslation, 'lo');
  assert.equal(store().partialTranslations.zh, '你');
});
