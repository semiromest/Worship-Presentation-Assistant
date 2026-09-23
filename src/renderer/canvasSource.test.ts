// ─── Canvas-safe media source resolution ────────────────────────────────────
// Phone/remote slide previews are exported from a <canvas>. Any image fetched
// without CORS approval taints that canvas, toDataURL() then throws and the
// phone grid stays on "LOADING" — exactly what happened to image slides that
// reference `local-resource://media/<hash>` (decks restored from Drive/a saved
// presentation) instead of a plain file path.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveCanvasSource, toOsPath } from './canvasSource';

test('medya kütüphanesi ref’leri CORS modunda istenir', () => {
  const r = resolveCanvasSource('local-resource://media/abc123.png', true, true);
  assert.equal(r.url, 'local-resource://media/abc123.png');
  assert.equal(r.cors, true, 'CORS olmadan canvas taint olur ve telefon önizlemesi çıkmaz');
});

test('file:// yolu medya protokolüne çevrilir (CORS destekli)', () => {
  const r = resolveCanvasSource('file:///C:/My%20Drive/pic.jpg', true, true);
  assert.equal(r.url, 'local-resource://mediafile/C%3A%2FMy%20Drive%2Fpic.jpg');
  assert.equal(r.cors, true);
});

test('çıplak Windows yolu da medya protokolüne çevrilir', () => {
  const r = resolveCanvasSource('G:\\My Drive\\resim.png', true, true);
  assert.equal(r.url, 'local-resource://mediafile/G%3A%2FMy%20Drive%2Fresim.png');
  assert.equal(r.cors, true);
});

test('Electron yoksa file:// olduğu gibi bırakılır', () => {
  const r = resolveCanvasSource('file:///C:/tmp/pic.jpg', true, false);
  assert.equal(r.url, 'file:///C:/tmp/pic.jpg');
  assert.equal(r.cors, false);
});

test('http(s) kaynaklar CORS modunda, applyCors=false ile değil', () => {
  assert.deepEqual(resolveCanvasSource('https://example.com/a.png', true, true), {
    url: 'https://example.com/a.png',
    cors: true,
  });
  assert.deepEqual(resolveCanvasSource('https://example.com/a.png', false, true), {
    url: 'https://example.com/a.png',
    cors: false,
  });
});

test('data: ve blob: kaynaklarda CORS modu gerekmez', () => {
  assert.deepEqual(resolveCanvasSource('data:image/png;base64,AAAA', true, true), {
    url: 'data:image/png;base64,AAAA',
    cors: false,
  });
  assert.deepEqual(resolveCanvasSource('blob:http://localhost/abc', true, true), {
    url: 'blob:http://localhost/abc',
    cors: false,
  });
});

test('toOsPath yol biçimlerini doğru çözer', () => {
  assert.equal(toOsPath('file:///C:/a/b.jpg'), 'C:/a/b.jpg');
  assert.equal(toOsPath('C:\\a\\b.jpg'), 'C:\\a\\b.jpg');
  assert.equal(toOsPath('/home/user/b.jpg'), '/home/user/b.jpg');
  assert.equal(toOsPath('https://example.com/a.png'), null);
  assert.equal(toOsPath('local-resource://media/x.png'), null);
});
