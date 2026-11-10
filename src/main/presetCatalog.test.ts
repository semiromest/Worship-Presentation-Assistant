import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createPresetStore } from './presetStore';
const presentation = (id = 'p') => ({ id, name: 'Sunday', slides: Array.from({ length: 100 }, (_, i) => ({ id: String(i), type: 'text', content: 'x'.repeat(1000) })) });
async function fixture(run: (root: string) => Promise<void>) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wpa-catalog-test-'));
  try { await run(root); } finally { await fs.rm(root, { recursive: true, force: true }); }
}
test('warm metadata listing and cover retrieval do not read full presentations', async () => fixture(async root => {
  const store = createPresetStore(root);
  for (let i = 0; i < 20; i++) await store.catalog.save({ name: 'Saved ' + i, presentation: presentation(String(i)) });
  const cold = createPresetStore(root), list = await cold.catalog.list();
  assert.equal(list.length, 20); assert.equal(list[0].summary?.slideCount, 100);
  assert.equal(list[0].presentation.slides.length, 0); assert.equal(cold.catalog.diagnostics().payloadReads, 0);
  assert.equal((await cold.catalog.preview(list[0].name, list[0].summary!.version))?.content.length, 1000);
  assert.equal(cold.catalog.diagnostics().payloadReads, 0);
  assert.equal((await cold.catalog.get(list[0].name))?.presentation.slides.length, 100);
  assert.equal(cold.catalog.diagnostics().payloadReads, 1);
  assert.ok(JSON.stringify(list).length < JSON.stringify(await store.readPresets()).length / 100);
}));
test('missing/corrupt index is rebuilt; external payload changes invalidate only that entry and cover', async () => fixture(async root => {
  const store = createPresetStore(root); await store.catalog.save({ name: 'A', presentation: presentation() }); await store.catalog.save({ name: 'B', presentation: presentation('b') });
  await fs.writeFile(path.join(root, 'preset-index.json'), '{bad');
  const rebuilt = createPresetStore(root), list = await rebuilt.catalog.list(); assert.equal(list.length, 2); assert.equal(rebuilt.catalog.diagnostics().payloadReads, 2);
  const old = list.find(x => x.name === 'A')!;
  const file = path.join(root, 'presets', Buffer.from('A').toString('base64url') + '.json');
  await fs.writeFile(file, JSON.stringify({ name: 'A', createdAt: Date.now(), presentation: { ...presentation(), slides: [{ id: 'new', type: 'text', content: 'Changed' }] } }));
  assert.equal(await rebuilt.catalog.preview('A', old.summary!.version), null);
  const next = await rebuilt.catalog.list(); assert.equal(rebuilt.catalog.diagnostics().payloadReads, 3);
  const fresh = next.find(x => x.name === 'A')!; assert.equal(fresh.summary?.slideCount, 1);
  assert.equal((await rebuilt.catalog.preview('A', fresh.summary!.version))?.content, 'Changed');
}));
test('legacy migration, simultaneous catalog/legacy writes, rename and delete preserve payloads', async () => fixture(async root => {
  await fs.writeFile(path.join(root, 'presets.json'), JSON.stringify([{ name: 'Legacy', presentation: presentation(), createdAt: Date.now() }]));
  const store = createPresetStore(root); assert.equal((await store.catalog.list()).length, 1);
  await assert.rejects(fs.stat(path.join(root, 'presets.json')), /ENOENT/);
  await Promise.all([store.catalog.save({ name: 'A', presentation: presentation('a') }), store.savePreset({ name: 'B', presentation: presentation('b') }), store.catalog.save({ name: 'C', presentation: presentation('c') })]);
  assert.deepEqual((await store.catalog.list()).map(x => x.name).sort(), ['A','B','C','Legacy']);
  const renamed = await store.catalog.rename('A', 'Renamed'); assert.equal(renamed.upsert?.name, 'Renamed'); assert.deepEqual(renamed.removed, ['A']);
  await store.catalog.remove('B'); assert.equal((await store.readPresets()).length, 3);
  assert.equal(await store.catalog.get('A'), null); assert.equal((await store.catalog.get('Renamed'))?.presentation.id, 'a');
}));
test('failed payload write never publishes a successful catalog save', async () => fixture(async root => {
  const store = createPresetStore(root); await store.catalog.save({ name: 'A', presentation: presentation() });
  const target = path.join(root, 'presets', Buffer.from('Blocked').toString('base64url') + '.json'); await fs.mkdir(target);
  await assert.rejects(store.catalog.save({ name: 'Blocked', presentation: presentation() }));
  await fs.rmdir(target);
  assert.deepEqual((await store.catalog.list()).map(x => x.name), ['A']);
}));
test('expired autosaves are pruned while regular saves and keep-forever retention survive', async () => fixture(async root => {
  const store = createPresetStore(root), name = '__live_autosave_old__';
  await store.catalog.save({ name, presentation: presentation() });
  await store.catalog.save({ name: 'Regular', presentation: presentation() });
  const file = path.join(root, 'presets', Buffer.from(name).toString('base64url') + '.json');
  const item = JSON.parse(await fs.readFile(file, 'utf8')); item.createdAt = Date.now() - 60000; await fs.writeFile(file, JSON.stringify(item));
  assert.equal((await store.catalog.list(0)).length, 2);
  assert.deepEqual((await store.catalog.list(1000)).map(x => x.name), ['Regular']);
  assert.equal(await store.catalog.get(name), null);
}));
