import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { mediaStorageReport, removeUnusedMedia, updateMediaStorageSettings, type MediaStorageDeps } from './mediaStorage';
import { analyzeMediaStorage, collectMediaNames, MEDIA_STORAGE_GRACE_MS } from '../shared/mediaStorage';

const HOUR = 60 * 60 * 1000;

async function fixture(presets: { name: string; presentation: unknown }[] = []) {
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'wpa-media-storage-'));
  const mediaDir = path.join(userData, 'media');
  await fs.mkdir(mediaDir);
  const write = async (name: string, bytes: number, ageMs: number) => {
    const file = path.join(mediaDir, name);
    await fs.writeFile(file, Buffer.alloc(bytes, 1));
    const time = new Date(Date.now() - ageMs);
    await fs.utimes(file, time, time);
  };
  const deps: MediaStorageDeps = { mediaDir, userData, readPresets: async () => presets };
  return { userData, mediaDir, write, deps, cleanup: () => fs.rm(userData, { recursive: true, force: true }) };
}

const ref = (name: string) => `local-resource://media/${name}`;

test('collectMediaNames finds desktop and web references in nested state, Maps and Sets', () => {
  const cyclic: Record<string, unknown> = { a: ref('aaaa.png') };
  cyclic.self = cyclic;
  const names = collectMediaNames({
    cyclic,
    map: new Map([['k', `url(${ref('bbbb.jpg')})`]]),
    set: new Set(['https://x.test/app/wpa-media/' + 'c'.repeat(64) + '.mp4#Video.mp4']),
    text: 'no media here',
  });
  assert.deepEqual([...names].sort(), ['aaaa.png', 'bbbb.jpg', 'c'.repeat(64) + '.mp4']);
});

test('only unreferenced media older than the grace period counts as unused', () => {
  const now = Date.now();
  const report = analyzeMediaStorage({
    platform: 'desktop',
    media: [
      { name: 'old-unused.png', size: 10, time: now - HOUR },
      { name: 'new-unused.png', size: 20, time: now - MEDIA_STORAGE_GRACE_MS / 2 },
      { name: 'used.png', size: 30, time: now - HOUR },
    ],
    referenced: new Set(['used.png']),
    presets: [{ name: 'Sunday', presentation: { slides: [{ mediaUrl: ref('used.png') }] } }],
    settings: {},
    defaultLimit: 100,
    nearCapacity: false,
    now,
  });
  assert.deepEqual(report.unused, { names: ['old-unused.png'], bytes: 10 });
  assert.equal(report.mediaBytes, 60);
  assert.deepEqual(report.largest, [{ name: 'Sunday', bytes: 30, autosave: false }]);
});

test('desktop report and removal keep everything referenced by presets, gradients and the renderer', async () => {
  const presets = [
    { name: 'Saved', presentation: { slides: [{ styles: { backgroundImage: ref('aaaa1111aaaa1111.jpg') } }] } },
    { name: '__live_autosave_x__', presentation: { name: 'Draft', slides: [{ mediaUrl: ref('bbbb2222bbbb2222.png') }] } },
  ];
  const f = await fixture(presets);
  try {
    await f.write('aaaa1111aaaa1111.jpg', 100, HOUR); // saved presentation
    await f.write('bbbb2222bbbb2222.png', 200, HOUR); // autosave
    await f.write('cccc3333cccc3333.jpg', 300, HOUR); // gradient library
    await f.write('dddd4444dddd4444.png', 400, HOUR); // open in the renderer only
    await f.write('eeee5555eeee5555.png', 500, HOUR); // unused
    await f.write('ffff6666ffff6666.png', 600, 60 * 1000); // unused but just stored
    await f.write('aaaa1111aaaa1111.jpg.123.tmp', 5, HOUR); // temp file: never listed
    await fs.mkdir(path.join(f.mediaDir, '.gpres-import-xyz')); // staging folder: never listed
    await fs.writeFile(path.join(f.userData, 'gradient-library.json'), JSON.stringify([{ id: 'g', image: ref('cccc3333cccc3333.jpg') }]));
    const renderer = ['dddd4444dddd4444.png'];

    const report = await mediaStorageReport(f.deps, renderer);
    assert.equal(report.platform, 'desktop');
    assert.equal(report.mediaCount, 6);
    assert.equal(report.mediaBytes, 2100);
    assert.deepEqual(report.unused.names, ['eeee5555eeee5555.png']);
    assert.equal(report.largest[0].name, 'Draft');
    assert.equal(report.largest[0].autosave, true);

    // Asking to remove referenced or fresh files is ignored; only the unused file goes.
    const removed = await removeUnusedMedia(f.deps, [...report.unused.names, 'aaaa1111aaaa1111.jpg', 'dddd4444dddd4444.png', 'ffff6666ffff6666.png'], renderer);
    assert.deepEqual(removed, { count: 1, bytes: 500 });
    const left = (await fs.readdir(f.mediaDir)).sort();
    assert.deepEqual(left, ['.gpres-import-xyz', 'aaaa1111aaaa1111.jpg', 'aaaa1111aaaa1111.jpg.123.tmp', 'bbbb2222bbbb2222.png', 'cccc3333cccc3333.jpg', 'dddd4444dddd4444.png', 'ffff6666ffff6666.png']);
  } finally {
    await f.cleanup();
  }
});

test('a file the renderer starts using between report and removal is kept', async () => {
  const f = await fixture();
  try {
    await f.write('aaaa1111aaaa1111.png', 10, HOUR);
    const report = await mediaStorageReport(f.deps, []);
    assert.deepEqual(report.unused.names, ['aaaa1111aaaa1111.png']);
    const removed = await removeUnusedMedia(f.deps, report.unused.names, ['aaaa1111aaaa1111.png']);
    assert.deepEqual(removed, { count: 0, bytes: 0 });
    assert.deepEqual(await fs.readdir(f.mediaDir), ['aaaa1111aaaa1111.png']);
  } finally {
    await f.cleanup();
  }
});

test('removal rejects names that could escape the media folder', async () => {
  const f = await fixture();
  try {
    await assert.rejects(removeUnusedMedia(f.deps, ['../secret.json'], []), /Invalid media names/);
    await assert.rejects(removeUnusedMedia(f.deps, ['a/b.png'], []), /Invalid media names/);
    await assert.rejects(mediaStorageReport(f.deps, 'not-a-list'), /Invalid media references/);
  } finally {
    await f.cleanup();
  }
});

test('reopening a .gpres marks media already in the library as just used (cleanup grace period)', async () => {
  const f = await fixture();
  try {
    const { writeGpresFile } = await import('./gpresWriter');
    const { readGpres } = await import('./gpresReader');
    const source = path.join(f.userData, 'photo.png');
    await fs.writeFile(source, Buffer.from('89504e470d0a1a0a', 'hex'));
    const archive = path.join(f.userData, 'deck.gpres');
    await writeGpresFile(JSON.stringify({ id: 'd', name: 'Deck', slides: [{ id: 's', type: 'image', content: '', mediaUrl: source }] }), archive, f.mediaDir);
    await readGpres(archive, f.mediaDir);
    const [name] = await fs.readdir(f.mediaDir);
    const old = new Date(Date.now() - HOUR);
    await fs.utimes(path.join(f.mediaDir, name), old, old);
    assert.deepEqual((await mediaStorageReport(f.deps, [])).unused.names, [name]);

    await readGpres(archive, f.mediaDir); // the file exists already: it is reused, not rewritten
    assert.deepEqual((await mediaStorageReport(f.deps, [])).unused.names, []);
  } finally {
    await f.cleanup();
  }
});

test('limit and snooze settings persist; changing the limit clears the snooze', async () => {
  const f = await fixture();
  try {
    let report = await mediaStorageReport(f.deps, []);
    assert.equal(report.limitIsDefault, true);
    await updateMediaStorageSettings(f.deps, { snoozeUntilBytes: 1234 });
    report = await mediaStorageReport(f.deps, []);
    assert.equal(report.snoozeUntilBytes, 1234);
    await updateMediaStorageSettings(f.deps, { limitBytes: 1024 ** 3 });
    report = await mediaStorageReport(f.deps, []);
    assert.equal(report.limitBytes, 1024 ** 3);
    assert.equal(report.limitIsDefault, false);
    assert.equal(report.snoozeUntilBytes, null);
    assert.ok(report.limitOptions.includes(1024 ** 3));
  } finally {
    await f.cleanup();
  }
});
