import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createGradientLibraryStore } from './gradientLibraryStore';
import { GRADIENT_PALETTES, type GeneratedBackground } from '../shared/generatedBackground';
const recipe: GeneratedBackground = {
  engineVersion: 1,
  width: 1920,
  height: 1080,
  seed: 12,
  colors: [...GRADIENT_PALETTES.ocean],
  palette: 'ocean',
  style: 'flow',
  darkness: 25,
  motion: { enabled: true, speed: 31, amount: 76, type: 'aurora' },
};
test('gradient library serializes concurrent saves, preserves recipes across restart and deletes metadata only', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gradient-library-test-'));
  try {
    await fs.mkdir(path.join(root, 'media'));
    const image = 'local-resource://media/abcd1234.jpg';
    await fs.writeFile(path.join(root, 'media', 'abcd1234.jpg'), 'shared-image');
    const library = createGradientLibraryStore(root);
    await Promise.all(['Ocean', 'Aurora', '../Arbitrary name'].map((name) => library.save({ name, image, recipe })));
    const entries = await createGradientLibraryStore(root).list();
    assert.equal(entries.length, 3);
    assert.equal(new Set(entries.map((e) => e.id)).size, 3);
    assert.deepEqual(entries[0].recipe, recipe);
    await library.remove(entries[0].id);
    assert.equal((await createGradientLibraryStore(root).list()).length, 2);
    assert.equal(await fs.readFile(path.join(root, 'media', 'abcd1234.jpg'), 'utf8'), 'shared-image');
    assert.deepEqual((await fs.readdir(root)).sort(), ['gradient-library.json', 'media']);
    assert.throws(() => library.save({ name: '', image, recipe }));
    assert.throws(() => library.save({ name: 'bad', image: 'file:///private.jpg', recipe }));
    assert.throws(() => library.save({ name: 'bad', image, recipe: { ...recipe, darkness: 999 } }));
    assert.equal((await library.list()).length, 2);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
test('corrupt library reports failure without replacing its contents', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gradient-library-corrupt-'));
  try {
    await fs.writeFile(path.join(root, 'gradient-library.json'), '{broken');
    const library = createGradientLibraryStore(root);
    await assert.rejects(library.list());
    await assert.rejects(library.save({ name: 'New', image: 'local-resource://media/abcd.jpg', recipe }));
    assert.equal(await fs.readFile(path.join(root, 'gradient-library.json'), 'utf8'), '{broken');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
