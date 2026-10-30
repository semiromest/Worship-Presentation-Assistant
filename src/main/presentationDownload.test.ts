import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { streamPresentationDownload } from './presentationDownload';
test('download bounds actual bytes across chunks and preserves an existing target', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wpa-download-'));
  const file = path.join(root, 'download.gpres');
  try {
    await streamPresentationDownload(Readable.from([Buffer.from('P'), Buffer.from('K123456789')]), file, { archive: 16, json: 4 });
    assert.equal(await fs.readFile(file, 'utf8'), 'PK123456789');
    await assert.rejects(streamPresentationDownload(Readable.from([Buffer.from('other')]), file), /EEXIST/);
    assert.equal(await fs.readFile(file, 'utf8'), 'PK123456789');
    await fs.unlink(file);
    await assert.rejects(streamPresentationDownload(Readable.from([Buffer.from('{123'), Buffer.from('45678')]), file, { archive: 16, json: 8 }), /size limit/);
    await assert.rejects(fs.access(file));
    await assert.rejects(streamPresentationDownload(Readable.from([Buffer.from('PK123456789')]), file, { archive: 8, json: 4 }), /size limit/);
    await assert.rejects(fs.access(file));
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
