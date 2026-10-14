import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createProgressStore, parseProgress } from './practiceProgress';
test('single writer revisions, result completion and resume survive reopening', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wpa-progress-test-'));
  try {
    const writer = createProgressStore(dir);
    await Promise.all([writer.setStatus('presentations', 'inProgress'), writer.setStatus('slides', 'skipped')]);
    await assert.rejects(writer.setStatus('slides', 'completed' as 'inProgress'));
    await assert.rejects(writer.recordResult({ task: 'slides', operation: 'preset-saved', resourceId: 'x' }));
    await writer.recordResult({ task: 'presentations', operation: 'preset-saved', resourceId: 'verified-id' });
    const result = await createProgressStore(dir).read();
    assert.equal(result.ok, true);
    if (result.ok) { assert.equal(result.progress.revision, 3); assert.equal(result.progress.tasks.presentations, 'completed');
      assert.equal(result.progress.tasks.slides, 'skipped'); }
    assert.deepEqual((await fs.readdir(dir)).filter(name => name.endsWith('.tmp')), []);
    await writer.setStatus('presentations', 'inProgress');
    await Promise.all([writer.setStatus('presentations', 'skipped'),
      writer.recordResult({ task: 'presentations', operation: 'preset-saved', resourceId: 'late-result' })]);
    const skipped = await writer.read();
    if (skipped.ok) assert.equal(skipped.progress.tasks.presentations, 'completed');
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
test('corrupt progress stays unchanged, unknown schema fails and normal read creates nothing', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wpa-progress-test-'));
  try {
    await createProgressStore(dir).read();
    assert.deepEqual(await fs.readdir(dir), []);
    const file = path.join(dir, 'practice-progress.json');
    await fs.writeFile(file, '{broken');
    const store = createProgressStore(dir);
    assert.equal((await store.read()).ok, false);
    await assert.rejects(store.setStatus('slides', 'inProgress'));
    assert.equal(await fs.readFile(file, 'utf8'), '{broken');
    assert.throws(() => parseProgress('{"schemaVersion":3,"revision":1,"tasks":{}}'));
    assert.throws(() => parseProgress('{"schemaVersion":1,"revision":1,"tasks":{"slides":["completed"]}}'));
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
