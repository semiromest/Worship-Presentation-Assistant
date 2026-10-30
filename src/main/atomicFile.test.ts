import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { writeAtomicDocument, recoverAtomicWrites, ensureDiskSpace } from './atomicFile';
test('atomic replace leaves no partial or journal; recovery only deletes recorded partials', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wpa-atomic-'));
  try {
    const journal = path.join(root, 'journal'), target = path.join(root, 'presentation.gpres');
    await fs.writeFile(target, 'old');
    await writeAtomicDocument(target, Buffer.from('new'), journal);
    assert.equal(await fs.readFile(target, 'utf8'), 'new');
    await assert.rejects(ensureDiskSpace(root, Number.MAX_SAFE_INTEGER), /disk space/);
    const directoryTarget = path.join(root, 'existing-directory'); await fs.mkdir(directoryTarget);
    await assert.rejects(writeAtomicDocument(directoryTarget, Buffer.from('bytes'), journal));
    assert.equal((await fs.stat(directoryTarget)).isDirectory(), true);
    assert.deepEqual(await fs.readdir(journal), []);
    assert.deepEqual(await fs.readdir(journal), []);
    const id = randomUUID(), partial = path.join(root, `.wpa-save-${id}.gpres.partial`);
    await fs.writeFile(partial, 'partial');
    await fs.writeFile(path.join(journal, id + '.json'), JSON.stringify({ partial, target }));
    await recoverAtomicWrites(journal);
    await assert.rejects(fs.access(partial));
    assert.equal(await fs.readFile(target, 'utf8'), 'new');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
