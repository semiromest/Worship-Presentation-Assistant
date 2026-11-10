import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_UI_FONT, UI_FONTS, resolveUiFont } from './uiFont';

test('UI font resolves query, then stored value, then default', () => {
  assert.equal(resolveUiFont('', null), DEFAULT_UI_FONT);
  assert.equal(resolveUiFont('', 'manrope'), 'manrope');
  assert.equal(resolveUiFont('?uiFont=Figtree', 'manrope'), 'figtree');
  assert.equal(resolveUiFont('?uiFont=comic-sans', 'bogus'), DEFAULT_UI_FONT);
  assert.equal(resolveUiFont('?mode=projector&uiFont=system', null), 'system');
});

test('every UI font option has a CSS variant and bundled font files', () => {
  const root = path.resolve(__dirname, '../..');
  const css = fs.readFileSync(path.join(__dirname, 'index.css'), 'utf8');
  for (const font of UI_FONTS.filter(value => value !== DEFAULT_UI_FONT)) {
    assert.ok(css.includes(`:root[data-ui-font="${font}"]`), `missing CSS variant for ${font}`);
  }
  const urls = [...css.matchAll(/url\('(\.\.\/\.\.\/resources\/fonts\/[^']+)'\)/g)].map(match => match[1]);
  assert.ok(urls.length >= 4);
  for (const url of urls) assert.ok(fs.existsSync(path.resolve(__dirname, url)), `missing ${url}`);
  // The projector default must stay independent from the UI font.
  assert.match(css, /\.slide-surface\s*\{[^}]*font-family:\s*var\(--font-slide\)/);
  assert.ok(fs.existsSync(path.join(root, 'resources/fonts/manifest.json')));
});
