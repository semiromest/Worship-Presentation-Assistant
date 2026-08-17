import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';
import {
  createMediaLibrary,
  externalizeDataUrlTo,
  storeBytesTo,
  rewriteGpresMedia,
} from './mediaLibrary';
import { buildGpresZip, mediaRefToName, MEDIA_REF_PREFIX } from '../shared/mediaTree';

async function makeTmp(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'media-lib-test-'));
}

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

test('mediaRefToName validates and rejects traversal', () => {
  assert.equal(mediaRefToName(`${MEDIA_REF_PREFIX}abc123.png`), 'abc123.png');
  assert.equal(mediaRefToName(`${MEDIA_REF_PREFIX}..`), null);
  assert.equal(mediaRefToName(`${MEDIA_REF_PREFIX}a..b.png`), null);
  assert.equal(mediaRefToName(`${MEDIA_REF_PREFIX}../x.png`), null);
  assert.equal(mediaRefToName(`${MEDIA_REF_PREFIX}dir/x.png`), null);
  assert.equal(mediaRefToName('local-resource:///C:/x.png'), null); // legacy form
  assert.equal(mediaRefToName('http://example.com/x.png'), null);
});

test('storeBytes writes content-addressed files and dedupes', async () => {
  const dir = await makeTmp();
  try {
    const ref1 = await storeBytesTo(dir, PNG, 'png');
    assert.ok(ref1?.startsWith(MEDIA_REF_PREFIX));
    const name1 = mediaRefToName(ref1!);
    assert.ok(name1?.endsWith('.png'));

    // Same bytes → same ref, no duplicate file.
    const ref2 = await storeBytesTo(dir, PNG, 'png');
    assert.equal(ref2, ref1);

    // Different bytes → different file.
    const ref3 = await storeBytesTo(dir, Buffer.from([1, 2, 3]), 'png');
    assert.notEqual(ref3, ref1);

    const files = await fs.readdir(dir);
    assert.equal(files.length, 2);
    // File contents round-trip.
    assert.deepEqual(await fs.readFile(path.join(dir, name1!)), PNG);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('storeBytes returns null on empty input', async () => {
  const dir = await makeTmp();
  try {
    assert.equal(await storeBytesTo(dir, Buffer.alloc(0), 'png'), null);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('externalizeDataUrl converts image data URIs, rejects others', async () => {
  const dir = await makeTmp();
  try {
    const b64 = PNG.toString('base64');
    const ref = await externalizeDataUrlTo(dir, `data:image/png;base64,${b64}`);
    assert.ok(ref?.startsWith(MEDIA_REF_PREFIX));
    assert.ok(ref?.endsWith('.png'));

    // jpeg extension normalization
    const ref2 = await externalizeDataUrlTo(dir, `data:image/jpeg;base64,${b64}`);
    assert.ok(ref2?.endsWith('.jpg'));

    // Non-image data URIs are left alone.
    assert.equal(await externalizeDataUrlTo(dir, `data:application/pdf;base64,${b64}`), null);
    // Malformed base64 → null (no crash).
    assert.equal(await externalizeDataUrlTo(dir, 'data:image/png;base64,%%%'), null);
    assert.equal(await externalizeDataUrlTo(dir, 'not a data uri'), null);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('.gpres round-trip: build → extract externalizes to the library', async () => {
  const dir = await makeTmp();
  try {
    const mediaDir = path.join(dir, 'media-lib');
    const lib = createMediaLibrary(mediaDir);

    // Store one image and reference it from a deck (as the app would after open).
    const ref = await lib.storeBytes(PNG, 'png');
    assert.ok(ref);
    const deck = {
      id: 'd',
      name: 'test',
      zoom: 1,
      slides: [{ id: 's1', type: 'image', mediaUrl: ref, thumbnailUrl: ref }],
    };

    // Save: embed into a .gpres ZIP.
    const { zip, embeddedCount } = await buildGpresZip(deck, { mediaDir });
    assert.equal(embeddedCount, 1);
    const zipEntries = zip.getEntries().map((e) => e.entryName);
    assert.ok(zipEntries.includes('media/' + mediaRefToName(ref!)));
    const saved = zip.toBuffer();

    // Simulate a fresh install: empty library, reopen the ZIP.
    const lib2Dir = path.join(dir, 'media-lib2');
    const lib2 = createMediaLibrary(lib2Dir);
    const reopened = new AdmZip(saved);
    const json = JSON.parse(reopened.readAsText(reopened.getEntry('presentation.json')!));
    assert.ok(json.slides[0].mediaUrl.startsWith('media/'));

    const count = await rewriteGpresMedia(reopened, json, lib2);
    assert.equal(count, 1);
    // Tree now references the persistent library; bytes exist on disk.
    const newRef = json.slides[0].mediaUrl as string;
    assert.ok(newRef.startsWith(MEDIA_REF_PREFIX));
    const name = mediaRefToName(newRef)!;
    assert.deepEqual(await fs.readFile(path.join(lib2Dir, name)), PNG);
    assert.equal(json.slides[0].thumbnailUrl, newRef); // dedupe → same ref

    // No temp dirs created anywhere.
    const all = await fs.readdir(dir);
    assert.ok(!all.some((f) => f.startsWith('presenter-')));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('rewriteGpresMedia externalizes legacy inline base64 too', async () => {
  const dir = await makeTmp();
  try {
    const lib = createMediaLibrary(path.join(dir, 'lib'));
    const b64 = PNG.toString('base64');
    const deck = {
      slides: [{ id: 's1', type: 'image', mediaUrl: `data:image/png;base64,${b64}` }],
    };
    const zip = new AdmZip();
    zip.addFile('presentation.json', Buffer.from(JSON.stringify(deck), 'utf-8'));
    const buf = zip.toBuffer();

    const reopened = new AdmZip(buf);
    const json = JSON.parse(reopened.readAsText(reopened.getEntry('presentation.json')!));
    const count = await rewriteGpresMedia(reopened, json, lib);
    assert.equal(count, 1);
    assert.ok(json.slides[0].mediaUrl.startsWith(MEDIA_REF_PREFIX));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('rewriteGpresMedia skips missing zip entries and invalid data URIs', async () => {
  const dir = await makeTmp();
  try {
    const lib = createMediaLibrary(path.join(dir, 'lib'));
    const deck = {
      slides: [
        { id: 's1', type: 'image', mediaUrl: 'media/missing.png' },
        { id: 's2', type: 'image', mediaUrl: 'data:image/png;base64,not-base64-%%' },
      ],
    };
    const zip = new AdmZip();
    zip.addFile('presentation.json', Buffer.from(JSON.stringify(deck), 'utf-8'));
    const reopened = new AdmZip(zip.toBuffer());
    const json = JSON.parse(reopened.readAsText(reopened.getEntry('presentation.json')!));
    const count = await rewriteGpresMedia(reopened, json, lib);
    assert.equal(count, 0); // nothing rewritable → refs stay inline, no loss
    assert.equal(json.slides[0].mediaUrl, 'media/missing.png');
    assert.equal(json.slides[1].mediaUrl, 'data:image/png;base64,not-base64-%%');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('createMediaLibrary.urlToPath resolves library refs and legacy refs', async () => {
  const dir = await makeTmp();
  try {
    const lib = createMediaLibrary(dir);
    const ref = await lib.storeBytes(PNG, 'png');
    const name = mediaRefToName(ref!)!;
    assert.equal(lib.urlToPath(ref!), path.join(dir, name));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
