import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { readGpres, parsePresentation, GPRES_LIMITS } from './gpresReader';

async function fixture(run: (dir: string) => Promise<void>) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gpres-reader-'));
  try { await run(dir); } finally { await fs.rm(dir, { recursive: true, force: true }); }
}
function archive(extra?: (zip: AdmZip) => void) {
  const zip = new AdmZip();
  zip.addFile('presentation.json', Buffer.from(JSON.stringify({ slides: [{ id: '1', mediaUrl: 'media/test.txt' }] })));
  zip.addFile('media/test.txt', Buffer.from('media bytes'));
  extra?.(zip);
  return zip.toBuffer();
}
test('disk and Buffer inputs validate CRC and produce identical content-addressed media', () => fixture(async dir => {
  const bytes = archive(), file = path.join(dir, 'file.gpres');
  await fs.writeFile(file, bytes);
  const a = await readGpres(bytes, path.join(dir, 'a'));
  const b = await readGpres(file, path.join(dir, 'b'));
  assert.deepEqual(a, b);
  const name = a.data.slides[0].mediaUrl.split('/').pop();
  assert.equal(await fs.readFile(path.join(dir, 'a', name), 'utf8'), 'media bytes');
  assert.equal(a.mediaCount, 1);
}));
test('legacy JSON rejects null slides, excessive depth and unsafe keys', () => {
  assert.throws(() => parsePresentation(Buffer.from('{"slides":[null]}')), /invalid slide/);
  assert.throws(() => parsePresentation(Buffer.from('{"slides":[],"__proto__":{}}')), /unsafe JSON/);
  assert.throws(() => parsePresentation(Buffer.from(JSON.stringify({ slides: [], nested: { a: { b: {} } } })), { ...GPRES_LIMITS, depth: 2 }), /depth/);
});
test('rejects archive, entry, count, JSON and aggregate limits', () => fixture(async dir => {
  for (const limits of [{ archive: 1 }, { entry: 1 }, { entries: 1 }, { json: 1 }, { total: 1 }]) {
    await assert.rejects(readGpres(archive(), dir, { ...GPRES_LIMITS, ...limits }), /limit/);
  }
}));
test('rejects unsafe paths even though names are not used as destinations', () => fixture(async dir => {
  const bytes = archive(zip => zip.addFile('media/ab.txt', Buffer.from('x')));
  // Keep local/central names the same while injecting a traversal segment.
  const bad = Buffer.from(bytes);
  for (let i = 0; i < bad.length - 12; i++) if (bad.subarray(i, i + 12).toString() === 'media/ab.txt') bad.write('../xx/ab.txt', i, 'utf8');
  // Also exercise an absolute entry without relying on adm-zip path sanitization.
  const absolute = Buffer.from(bytes);
  let at = absolute.indexOf(Buffer.from('media/ab.txt'));
  while (at >= 0) { absolute[at] = 47; at = absolute.indexOf(Buffer.from('media/ab.txt'), at + 1); }
  await assert.rejects(readGpres(absolute, dir), /unsafe/);
  await assert.rejects(readGpres(bad, dir), /unsafe/);
}));
test('CRC mismatch and truncation never promote media', () => fixture(async dir => {
  const bytes = archive();
  const bad = Buffer.from(bytes), central = bad.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  bad.writeUInt32LE(123, central + 16);
  await assert.rejects(readGpres(bad, dir), /inconsistent|CRC/);
  await assert.rejects(readGpres(bytes.subarray(0, bytes.length - 5), dir), /directory|truncated/);
  assert.deepEqual(await fs.readdir(dir), []);
}));
test('duplicates, nested archives and symlinks are rejected', () => fixture(async dir => {
  await assert.rejects(readGpres(archive(zip => zip.addFile('MEDIA/test.txt', Buffer.from('x'))), dir), /duplicate/);
  await assert.rejects(readGpres(archive(zip => zip.addFile('media/inner.bin', Buffer.from('PK\x03\x04'))), dir), /nested/);
  const bytes = archive(), start = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  bytes.writeUInt32LE((0xa1ff << 16) >>> 0, start + 38);
  await assert.rejects(readGpres(bytes, dir), /symbolic/);
}));
test('a lying uncompressed size is rejected using actual inflated bytes', () => fixture(async dir => {
  const bytes = archive();
  const central = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  const local = bytes.readUInt32LE(central + 42);
  bytes.writeUInt32LE(1, central + 24); bytes.writeUInt32LE(1, local + 22);
  await assert.rejects(readGpres(bytes, dir), /expanded size/);
  assert.deepEqual(await fs.readdir(dir), []);
  const file = path.join(dir, 'malformed.gpres'), media = path.join(dir, 'media');
  await fs.writeFile(file, bytes);
  await assert.rejects(readGpres(file, media), /expanded size/);
  assert.deepEqual(await fs.readdir(media), []);
}));
