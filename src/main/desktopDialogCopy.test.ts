import { test } from 'node:test';
import assert from 'node:assert/strict';
import { replacementDialogCopy, systemMessageCopy } from './desktopDialogCopy';

test('replacement choices follow all supported languages and regional variants', () => {
  for (const [locale, title] of Object.entries({ en: 'Save your changes?', tr: 'Değişiklikler kaydedilsin mi?', de: 'Änderungen speichern?', es: '¿Guardar los cambios?', ko: '변경 사항을 저장할까요?' })) {
    assert.equal(replacementDialogCopy(locale).title, title);
    assert.deepEqual(replacementDialogCopy(locale + '-XX'), replacementDialogCopy(locale));
    assert.equal(new Set(Object.values(replacementDialogCopy(locale))).size, 5);
  }
  assert.deepEqual(replacementDialogCopy('fr'), replacementDialogCopy('en'));
});

test('system messages resolve supported regional locales with an English fallback', () => {
  const labels = { en: 'Open backup', tr: 'Yedeği aç', de: 'Sicherung öffnen', es: 'Abrir copia de seguridad', ko: '백업 열기' };
  for (const [locale, label] of Object.entries(labels)) {
    const copy = systemMessageCopy(locale);
    assert.equal(copy.openBackup, label);
    assert.equal(Object.keys(copy).length, 10);
    assert.ok(Object.values(copy).every(value => value.trim().length > 0));
    assert.deepEqual(systemMessageCopy(locale.toUpperCase() + '_XX'), copy);
  }
  assert.deepEqual(systemMessageCopy('fr'), systemMessageCopy('en'));
});
