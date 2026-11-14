import { test } from 'node:test';
import assert from 'node:assert/strict';
import { languageLabel, languageOptions, searchLanguages, suggestedLanguageCodes } from './sttLanguageOptions';
import { STT_LANGUAGES } from '../shared/stt';

test('languageOptions localizes names and keeps every catalogue language', () => {
  const tr = languageOptions('tr');
  assert.equal(tr.length, STT_LANGUAGES.length);
  assert.equal(languageLabel('de', 'tr'), 'Almanca');
  assert.equal(languageLabel('de', 'en'), 'German');
  assert.equal(tr.find(option => option.code === 'de')?.native, 'Deutsch');
});

test('searchLanguages finds by localized, English and native name, accent-insensitive', () => {
  const tr = languageOptions('tr');
  assert.equal(searchLanguages(tr, 'ingil')[0]?.code, 'en');
  assert.equal(searchLanguages(tr, 'english')[0]?.code, 'en');
  assert.equal(searchLanguages(tr, 'deutsch')[0]?.code, 'de');
  assert.equal(searchLanguages(tr, 'turkce')[0]?.code, 'tr');
  assert.equal(searchLanguages(tr, 'ko')[0]?.code, 'ko');
  assert.deepEqual(searchLanguages(tr, 'zzzz'), []);
  assert.equal(searchLanguages(tr, '  ').length, tr.length);
});

test('suggestedLanguageCodes puts the UI language first and skips excluded codes', () => {
  assert.equal(suggestedLanguageCodes('ko-KR')[0], 'ko');
  assert.ok(!suggestedLanguageCodes('en', ['en']).includes('en'));
  assert.ok(suggestedLanguageCodes('en').length <= 6);
});
