const { test } = require('node:test');
const assert = require('node:assert/strict');
const { checkLocales } = require('./check-locales.cjs');
const valid = () => Object.fromEntries(['en', 'tr', 'de', 'es', 'ko'].map(l => [l, JSON.stringify(l === 'ko' || l === 'tr' ? { count: '{{count}} items', label: 'Label {{name}}' } : { count_one: '{{count}} item', count_other: '{{count}} items', label: 'Label {{name}}' })]));
test('locale-specific base counters work without copying English plurals', async () => {
  const data = valid();
  const es = JSON.parse(data.es); es.count_many = '{{count}} items'; data.es = JSON.stringify(es);
  assert.deepEqual(await checkLocales(data), []);
});
test('missing keys, empty values, duplicate keys and changed placeholders are rejected', async () => {
  for (const [text, expected] of [['{"label":"x","label":"y"}', 'duplicate key'], ['{"label":""}', 'empty translation'], ['{"label":"{{wrong}}","count":"{{count}}"}', 'placeholder mismatch'], ['{"count":"{{count}}"}', 'missing translation'], ['broken', 'invalid JSON'], ['{"label":5}', 'expected string']]) {
    const data = valid(); data.de = text;
    assert.ok((await checkLocales(data)).some(e => e.includes(expected)), expected);
  }
});
test('a missing required plural category fails, and extra source families fail', async () => {
  const data = valid(); data.de = JSON.stringify({ count_one: '{{count}} item', label: 'Label {{name}}' });
  assert.ok((await checkLocales(data)).some(e => e.includes('count_other: missing plural')));
  data.de = JSON.stringify({ count: '{{count}}', label: 'Label {{name}}', extra: 'Extra' });
  assert.ok((await checkLocales(data)).some(e => e.includes('missing source family')));
});

test('preparation messages render natural singular and plural forms in the application resources', async () => {
  const engine = require('i18next').createInstance();
  const resources = Object.fromEntries(['en', 'tr', 'de', 'es', 'ko'].map(l => [l, { translation: require(`../src/renderer/locales/${l}/translation.json`) }]));
  await engine.init({ resources, fallbackLng: false, initImmediate: false });
  for (const [language, singular, plural] of [['en', '1 slide may', '2 slides may'], ['de', '1 Folie braucht', '2 Folien brauchen'], ['es', '1 diapositiva puede', '2 diapositivas pueden']]) {
    assert.ok(engine.t('prepCheck.summary', { lng: language, count: 1 }).startsWith(singular));
    assert.ok(engine.t('prepCheck.summary', { lng: language, count: 2 }).startsWith(plural));
  }
  for (const language of Object.keys(resources)) for (const key of ['summary', 'slideErrors', 'slideWarnings']) for (const count of [0, 1, 2, 1000000]) {
    const result = engine.t('prepCheck.' + key, { lng: language, count });
    assert.ok(result.includes(String(count)));
    assert.ok(!result.includes('{{') && !/\((s|n|en|e)\)/.test(result));
  }
});
