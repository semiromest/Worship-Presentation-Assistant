const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const i18next = require('i18next');

const languages = ['en', 'tr', 'de', 'es', 'ko'];
// This category intentionally has a heading without a subtitle in every locale.
const allowedEmpty = new Set(['settings.navigation.categories.learning.description']);
const pluralSuffix = /_(zero|one|two|few|many|other)$/;
const tokens = value => [...value.matchAll(/{{([\s\S]*?)}}/g)].map(m => m[1].trim()).sort();

function inspect(text, language) {
  const errors = [], flat = {};
  const ast = ts.parseJsonText(language + '.json', text);
  function duplicates(node, prefix = '') {
    if (!ts.isObjectLiteralExpression(node)) return;
    const seen = new Set();
    for (const property of node.properties) {
      const key = property.name?.text;
      const full = prefix ? prefix + '.' + key : key;
      if (seen.has(key)) errors.push(`${language}:${full}: duplicate key`);
      seen.add(key);
      if (property.initializer) duplicates(property.initializer, full);
    }
  }
  let data;
  try { data = JSON.parse(text.replace(/^\uFEFF/, '')); }
  catch (error) { return { errors: [`${language}: invalid JSON: ${error.message}`], flat, data: null }; }
  duplicates(ast.statements[0]?.expression);
  function flatten(value, prefix = '') {
    if (!value || Array.isArray(value) || typeof value !== 'object') {
      errors.push(`${language}:${prefix}: expected object`); return;
    }
    for (const [key, child] of Object.entries(value)) {
      const full = prefix ? prefix + '.' + key : key;
      if (child && !Array.isArray(child) && typeof child === 'object') flatten(child, full);
      else {
        flat[full] = child;
        if (typeof child !== 'string') errors.push(`${language}:${full}: expected string`);
        else if (!child.trim() && !allowedEmpty.has(full)) errors.push(`${language}:${full}: empty translation`);
      }
    }
  }
  flatten(data);
  return { errors, flat, data };
}

async function checkLocales(texts) {
  const parsed = Object.fromEntries(languages.map(l => [l, inspect(texts[l] ?? '', l)]));
  const errors = Object.values(parsed).flatMap(p => p.errors);
  if (errors.length) return errors;
  const engine = i18next.createInstance();
  await engine.init({ resources: Object.fromEntries(languages.map(l => [l, { translation: parsed[l].data }])), fallbackLng: false, initImmediate: false });
  // Group plural variants, but keep context keys distinct. Dynamic source usage
  // and untranslated prose still require review; this is a resource integrity gate.
  const families = new Set(Object.values(parsed).flatMap(p => Object.keys(p.flat).map(k => k.replace(pluralSuffix, ''))));
  for (const family of families) {
    const source = parsed.en.flat[family] ?? Object.entries(parsed.en.flat).find(([k]) => k.replace(pluralSuffix, '') === family)?.[1];
    if (source === undefined) { errors.push(`en:${family}: missing source family`); continue; }
    const plural = Object.values(parsed).some(p => Object.keys(p.flat).some(k => k !== family && k.replace(pluralSuffix, '') === family));
    for (const language of languages) {
      if (plural) {
        const categories = new Intl.PluralRules(language).resolvedOptions().pluralCategories;
        for (const category of categories) {
          if (!(family in parsed[language].flat) && !(`${family}_${category}` in parsed[language].flat)) errors.push(`${language}:${family}_${category}: missing plural translation`);
        }
      } else if (!(family in parsed[language].flat)) errors.push(`${language}:${family}: missing translation`);
      const variants = Object.entries(parsed[language].flat).filter(([k]) => k.replace(pluralSuffix, '') === family);
      for (const [key, value] of variants) {
        if (JSON.stringify(tokens(value)) !== JSON.stringify(tokens(source))) errors.push(`${language}:${key}: placeholder mismatch`);
      }
      for (const count of plural ? [0, 1, 2, 5, 100, 1000000] : [undefined]) {
        const result = engine.t(family, { lng: language, ...(count === undefined ? {} : { count }), skipInterpolation: true });
        if (result === family) errors.push(`${language}:${family}: unresolved${count === undefined ? '' : ' count=' + count}`);
      }
    }
  }
  return [...new Set(errors)];
}

if (require.main === module) {
  const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
  Promise.resolve().then(async () => {
    const texts = Object.fromEntries(languages.map(l => [l, fs.readFileSync(path.join(root, 'src/renderer/locales', l, 'translation.json'), 'utf8')]));
    const errors = await checkLocales(texts);
    if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
    else console.log('Locale integrity passed for en, tr, de, es, ko (fallback disabled).');
  }).catch(error => { console.error(error.message); process.exitCode = 2; });
}
module.exports = { checkLocales };
