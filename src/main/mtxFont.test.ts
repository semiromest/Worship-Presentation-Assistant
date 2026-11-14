import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildSfnt, decodeEmbeddedFont, sfntExtension } from './mtxFont';
import { fontFamilyNames } from './pptxFontFiles';
import os from 'node:os';

// Google Slides export of Oswald Regular (SIL OFL, see Oswald-OFL.txt): EOT 2.2, MTX compressed.
const FIXTURE = path.resolve(__dirname, '../../tests/fixtures/fonts/Oswald-regular.fntdata');

function table(font: Buffer, tag: string): Buffer {
  const n = font.readUInt16BE(4);
  for (let i = 0; i < n; i++) {
    const e = 12 + i * 16;
    if (font.toString('latin1', e, e + 4) === tag) return font.subarray(font.readUInt32BE(e + 8), font.readUInt32BE(e + 8) + font.readUInt32BE(e + 12));
  }
  throw new Error(`missing ${tag}`);
}

function checksum(data: Buffer): number {
  let sum = 0;
  for (let i = 0; i < data.length; i += 4) sum = (sum + ((data[i] << 24) | ((data[i + 1] ?? 0) << 16) | ((data[i + 2] ?? 0) << 8) | (data[i + 3] ?? 0))) >>> 0;
  return sum;
}

/** Minimal EOT 2.0 wrapper (names empty) around `payload`. */
function eot(payload: Buffer, flags: number): Buffer {
  const header = Buffer.alloc(82 + 2 * 4 + 2 * 4); // fixed header + four (padding, size) name slots
  const out = Buffer.concat([header, payload]);
  out.writeUInt32LE(out.length, 0);
  out.writeUInt32LE(payload.length, 4);
  out.writeUInt32LE(0x00020000, 8);
  out.writeUInt32LE(flags, 12);
  out.writeUInt16LE(0x504c, 34);
  return out;
}

test('MTX-compressed EOT decodes to a valid TrueType font with matching names and glyphs', async () => {
  const font = decodeEmbeddedFont(fs.readFileSync(FIXTURE));
  assert.equal(font.readUInt32BE(0), 0x00010000);
  assert.equal(sfntExtension(font), 'ttf');
  // Whole-file checksum must equal the magic once checkSumAdjustment is written.
  assert.equal(checksum(font), 0xb1b0afba);
  const maxp = table(font, 'maxp');
  const head = table(font, 'head');
  const numGlyphs = maxp.readUInt16BE(4);
  assert.equal(numGlyphs, 867);
  const loca = table(font, 'loca');
  const long = head.readInt16BE(50) === 1;
  assert.equal(loca.length, (numGlyphs + 1) * (long ? 4 : 2));
  const glyf = table(font, 'glyf');
  const last = long ? loca.readUInt32BE(numGlyphs * 4) : loca.readUInt16BE(numGlyphs * 2) * 2;
  assert.equal(last, glyf.length);
  // The renderer matches fonts by family name: it must survive the round trip.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mtx-test-'));
  try {
    const file = path.join(dir, 'f.ttf');
    fs.writeFileSync(file, font);
    assert.ok((await fontFamilyNames(file)).includes('Oswald'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('uncompressed, XOR-obfuscated and bare SFNT payloads are accepted', () => {
  const sfnt = buildSfnt([{ tag: 'head', data: new Uint8Array(54) }, { tag: 'name', data: new Uint8Array([0, 0, 0, 0, 0, 6]) }]);
  assert.deepEqual(decodeEmbeddedFont(sfnt), sfnt);
  assert.deepEqual(decodeEmbeddedFont(eot(sfnt, 0)), sfnt);
  assert.deepEqual(decodeEmbeddedFont(eot(Buffer.from(sfnt.map(b => b ^ 0x50)), 0x10000000)), sfnt);
});

test('corrupt, truncated and foreign data are rejected without hanging', () => {
  assert.throws(() => decodeEmbeddedFont(Buffer.alloc(20)), /not an EOT/);
  assert.throws(() => decodeEmbeddedFont(eot(Buffer.from('not a font at all'), 0)), /not a TrueType/);
  const good = fs.readFileSync(FIXTURE);
  // Truncate the compressed payload (header sizes stay as declared).
  assert.throws(() => decodeEmbeddedFont(good.subarray(0, good.length - 5000)));
  // Bit flips inside the compressed stream must either throw or still yield an SFNT, never hang.
  for (let i = 0; i < 40; i++) {
    const bad = Buffer.from(good);
    const at = 400 + ((i * 7919) % (bad.length - 400));
    bad[at] ^= 1 << (i % 8);
    try {
      assert.equal(decodeEmbeddedFont(bad).readUInt32BE(0), 0x00010000);
    } catch (error) {
      assert.ok(error instanceof Error);
    }
  }
});
