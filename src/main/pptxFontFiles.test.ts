import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';
import type { UsedFonts } from 'pptx-glimpse';
import { fontFamilyNames, mapLimit, platformFontFallbacks, requiredDeckFonts, selectSystemFontFiles } from './pptxFontFiles';

test('failed parallel work drains active jobs before temporary resource cleanup', async () => {
  let fail!: () => void;
  let release!: () => void;
  const failGate = new Promise<void>(resolve => { fail = resolve; });
  const activeGate = new Promise<void>(resolve => { release = resolve; });
  const started: number[] = [];
  let activeFinished = false;
  let settled = false;
  const error = new Error('Font read failed');
  const pending = mapLimit([0, 1, 2], 2, async item => {
    started.push(item);
    if (item === 0) { await failGate; throw error; }
    await activeGate;
    activeFinished = true;
  });
  void pending.then(() => { settled = true; }, () => { settled = true; });
  fail();
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(settled, false, 'Caller must not clean up while another job is active');
  release();
  await assert.rejects(pending, err => err === error);
  assert.equal(activeFinished, true);
  assert.deepEqual(started, [0, 1], 'No new work may start after failure');
});

function nameOnlySfnt(name: string): Buffer {
  const text = Buffer.from(name, 'utf16le').swap16();
  const table = Buffer.alloc(18 + text.length);
  table.writeUInt16BE(1, 2); table.writeUInt16BE(18, 4);
  table.writeUInt16BE(3, 6); table.writeUInt16BE(1, 8); table.writeUInt16BE(0x409, 10);
  table.writeUInt16BE(1, 12); table.writeUInt16BE(text.length, 14); text.copy(table, 18);
  const result = Buffer.alloc(28 + table.length);
  result.writeUInt32BE(0x00010000, 0); result.writeUInt16BE(1, 4); result.write('name', 12);
  result.writeUInt32BE(28, 20); result.writeUInt32BE(table.length, 24); table.copy(result, 28);
  return result;
}

test('select fonts by SFNT/TTC family metadata without parsing glyphs', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pptx-font-names-'));
  try {
    const sfnt = nameOnlySfnt('Example　Sans');
    const ttc = Buffer.alloc(16 + sfnt.length);
    ttc.write('ttcf'); ttc.writeUInt32BE(0x00010000, 4); ttc.writeUInt32BE(1, 8); ttc.writeUInt32BE(16, 12);
    sfnt.copy(ttc, 16); ttc.writeUInt32BE(44, 36);
    await fs.writeFile(path.join(dir, 'face.ttf'), sfnt);
    await fs.writeFile(path.join(dir, 'collection.ttc'), ttc);
    await fs.writeFile(path.join(dir, 'unrelated.otf'), nameOnlySfnt('Unrelated'));
    assert.deepEqual(await fontFamilyNames(path.join(dir, 'face.ttf')), ['Example　Sans']);
    assert.deepEqual(await fontFamilyNames(path.join(dir, 'collection.ttc')), ['Example　Sans']);
    const selected = await selectSystemFontFiles(['Example Sans'], [dir]);
    assert.deepEqual(selected.map(p => path.basename(p)).sort(), ['collection.ttc', 'face.ttf']);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('malformed font tables are ignored and file handles are closed', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pptx-font-malformed-'));
  try {
    const bad = nameOnlySfnt('Bad'); bad.writeUInt32BE(0xffffffff, 20);
    const file = path.join(dir, 'bad.ttf'); await fs.writeFile(file, bad);
    await assert.rejects(fontFamilyNames(file), /range/);
    assert.deepEqual(await selectSystemFontFiles(['Bad'], [dir]), []);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

const report: UsedFonts = {
  theme: { majorFont: 'Arial', minorFont: 'Arial', majorFontEa: 'MS Gothic', minorFontEa: null, majorFontCs: null, minorFontCs: null },
  fonts: ['Arial', 'MS Gothic', 'Yu Gothic'],
};
function deck(text: string) {
  const zip = new AdmZip();
  zip.addFile('ppt/slides/slide1.xml', Buffer.from(`<a:latin typeface='Arial'/><a:t>${text}</a:t>`));
  zip.addFile('ppt/theme/theme1.xml', Buffer.from(`<a:font typeface='Yu Gothic' script='Jpan'/>`));
  return zip;
}

test('Latin decks omit unused EA themes but preserve explicit layout/chart families', () => {
  const zip = deck('Hello');
  zip.addFile('ppt/slideLayouts/slideLayout1.xml', Buffer.from('<a:latin typeface="Georgia"/><a:t>Layout title</a:t>'));
  zip.addFile('ppt/charts/chart1.xml', Buffer.from('<a:latin typeface="Cambria"/>'));
  assert.deepEqual(requiredDeckFonts(zip, report).sort(), ['Arial', 'Cambria', 'Georgia']);
  zip.addFile('ppt/slideMasters/slideMaster1.xml', Buffer.from("<a:ea typeface='MS Gothic'/>"));
  assert.ok(requiredDeckFonts(zip, report).includes('MS Gothic'));
});

test('numeric Unicode entities and Korean Jamo retain script fonts', () => {
  for (const text of ['&#x65e5;', '&#131072;', '\u1112']) {
    assert.ok(requiredDeckFonts(deck(text), report).includes('Yu Gothic'));
    assert.ok(requiredDeckFonts(deck(text), report).includes('MS Gothic'));
  }
});

test('platform font mapping retains Japanese fallback chains', () => {
  const fallbacks = platformFontFallbacks(['Noto Sans JP']);
  if (process.platform === 'win32') assert.ok(fallbacks.includes('Yu Gothic'));
  else if (process.platform === 'darwin') assert.ok(fallbacks.includes('Hiragino Sans'));
  else assert.deepEqual(fallbacks, []);
});
