import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { UI_WEB_FONT_CSS, UI_WEB_FONT_FILES, uiWebFontFile } from './uiWebFont';

const fontsRoot = path.resolve(__dirname, '../../resources/fonts');

test('served-page fonts are bundled, vendored files', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(fontsRoot, 'manifest.json'), 'utf8')) as { families: { faces: { file: string }[] }[] };
  const vendored = new Set(manifest.families.flatMap(family => family.faces.map(face => face.file)));
  for (const [route, file] of Object.entries(UI_WEB_FONT_FILES)) {
    assert.ok(vendored.has(file), `${file} is not in the integrity-checked manifest`);
    assert.ok(UI_WEB_FONT_CSS.includes(`url('${route}')`), `${route} is not referenced by the CSS`);
  }
});

test('only whitelisted font routes resolve', () => {
  assert.equal(uiWebFontFile('/fonts/ui.ttf'), UI_WEB_FONT_FILES['/fonts/ui.ttf']);
  for (const pathname of ['/fonts/../manifest.json', '/fonts/', '/fonts/toString', '/fonts/constructor', '/fonts/ui.ttf/x']) {
    assert.equal(uiWebFontFile(pathname), null, pathname);
  }
});

test('served pages use the bundled UI font and no font CDN', () => {
  for (const page of ['remote-html.ts', 'share-html.ts', 'screen-share-html.ts']) {
    const source = fs.readFileSync(path.join(__dirname, page), 'utf8');
    assert.ok(source.includes('${UI_WEB_FONT_CSS}'), `${page} misses the @font-face rules`);
    assert.doesNotMatch(source, /fonts\.(googleapis|gstatic)\.com|Barlow/, page);
  }
});
