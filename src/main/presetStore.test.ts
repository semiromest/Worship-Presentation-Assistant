import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createPresetStore, type PresetItem } from './presetStore';

async function makeUserData(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'preset-store-test-'));
}

const mk = (name: string, createdAt = Date.now()): PresetItem => ({
  name,
  presentation: { id: 'p', name, slides: [{ id: 's1', type: 'text', content: 'hi' }], zoom: 1 },
  createdAt,
});

test('migrates legacy presets.json once and removes it', async () => {
  const dir = await makeUserData();
  try {
    const legacy = [mk('pazar'), mk('pazar2')];
    await fs.writeFile(path.join(dir, 'presets.json'), JSON.stringify(legacy));

    const store = createPresetStore(dir);
    const list = await store.readPresets();

    assert.equal(list.length, 2);
    assert.equal(list.some((p) => p.name === 'pazar'), true);
    // Legacy file is the commit point: gone after full migration.
    await assert.rejects(() => fs.stat(path.join(dir, 'presets.json')), /ENOENT/);
    // Per-preset files exist.
    const files = await fs.readdir(path.join(dir, 'presets'));
    assert.equal(files.length, 2);

    // Second load reads from per-preset files (legacy already gone).
    const store2 = createPresetStore(dir);
    const list2 = await store2.readPresets();
    assert.equal(list2.length, 2);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('recovers an interrupted migration without data loss', async () => {
  const dir = await makeUserData();
  try {
    const legacy = [mk('a'), mk('b'), mk('c')];
    await fs.writeFile(path.join(dir, 'presets.json'), JSON.stringify(legacy));
    // Simulate a crash after only one file was written.
    const partial = createPresetStore(dir);
    await partial.savePreset({ name: 'a', presentation: legacy[0].presentation });

    const store = createPresetStore(dir);
    const list = await store.readPresets();
    assert.equal(list.length, 3);
    assert.deepEqual(list.map((p) => p.name).sort(), ['a', 'b', 'c']);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('savePreset upserts a regular preset in place (no duplicates)', async () => {
  const dir = await makeUserData();
  try {
    const store = createPresetStore(dir);
    await store.savePreset({ name: 'kayit', presentation: mk('kayit').presentation });
    const list1 = await store.readPresets();
    assert.equal(list1.length, 1);

    await store.savePreset({ name: 'kayit', presentation: mk('kayit').presentation });
    const list2 = await store.readPresets();
    assert.equal(list2.length, 1);
    const files = await fs.readdir(path.join(dir, 'presets'));
    assert.equal(files.length, 1);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('live-save autosave replaces older backups of the same presentation', async () => {
  const dir = await makeUserData();
  try {
    const store = createPresetStore(dir);
    const name = (key: string) => `__live_autosave_${key}__`;

    await store.savePreset({ name: name('sunum-1'), presentation: mk('x').presentation });
    await store.savePreset({ name: name('sunum-2'), presentation: mk('y').presentation });
    // Newer autosave for the same deck.
    await store.savePreset({ name: name('sunum-1'), presentation: mk('x2').presentation });

    const list = await store.readPresets();
    assert.equal(list.length, 2); // sunum-1 (newest) + sunum-2
    assert.equal(list.filter((p) => p.name === name('sunum-1')).length, 1);
    const files = await fs.readdir(path.join(dir, 'presets'));
    assert.equal(files.length, 2); // stale file GC'd
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('deletePreset removes the entry and its file', async () => {
  const dir = await makeUserData();
  try {
    const store = createPresetStore(dir);
    await store.savePreset({ name: 'silinecek', presentation: mk('x').presentation });
    await store.savePreset({ name: 'kalacak', presentation: mk('y').presentation });

    const list = await store.deletePreset('silinecek');
    assert.equal(list.length, 1);
    assert.equal(list[0].name, 'kalacak');
    const files = await fs.readdir(path.join(dir, 'presets'));
    assert.equal(files.length, 1);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('renamePreset moves the entry and file', async () => {
  const dir = await makeUserData();
  try {
    const store = createPresetStore(dir);
    await store.savePreset({ name: 'eski-ad', presentation: mk('x').presentation });

    const list = await store.renamePreset('eski-ad', 'yeni-ad');
    assert.equal(list.length, 1);
    assert.equal(list[0].name, 'yeni-ad');
    const files = await fs.readdir(path.join(dir, 'presets'));
    assert.equal(files.length, 1);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('retention prunes expired live-saves and GCs their files', async () => {
  const dir = await makeUserData();
  try {
    const store = createPresetStore(dir);
    const name = (key: string) => `__live_autosave_${key}__`;
    const now = Date.now();
    await store.savePreset({ name: name('fresh'), presentation: mk('x').presentation, retentionMs: 60_000 });
    // Old entry: inject directly into the dir via the store file layout.
    await fs.writeFile(
      path.join(dir, 'presets', `${Buffer.from(name('stale'), 'utf-8').toString('base64url')}.json`),
      JSON.stringify(mk(name('stale'), now - 10 * 60_000)),
    );

    // Fresh instance (cold cache) — GC runs on first load, like app start.
    const cold = createPresetStore(dir);
    const list = await cold.readPresets(60_000);
    assert.equal(list.length, 1);
    assert.equal(list[0].name, name('fresh'));
    const files = await fs.readdir(path.join(dir, 'presets'));
    assert.equal(files.length, 1); // stale file GC'd on load
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('unicode and path-hostile names round-trip through base64url filenames', async () => {
  const dir = await makeUserData();
  try {
    const store = createPresetStore(dir);
    const weird = 'İlahi: 1. Bölüm / 测试\\name?';
    await store.savePreset({ name: weird, presentation: mk('x').presentation });

    const list = await store.readPresets();
    assert.equal(list.length, 1);
    assert.equal(list[0].name, weird);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('corrupt single preset file is skipped without losing others', async () => {
  const dir = await makeUserData();
  try {
    const store = createPresetStore(dir);
    await store.savePreset({ name: 'saglam', presentation: mk('x').presentation });
    await fs.writeFile(
      path.join(dir, 'presets', `${Buffer.from('bozuk', 'utf-8').toString('base64url')}.json`),
      '{ not valid json !!!',
    );

    const store2 = createPresetStore(dir);
    const list = await store2.readPresets();
    assert.equal(list.length, 1);
    assert.equal(list[0].name, 'saglam');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
