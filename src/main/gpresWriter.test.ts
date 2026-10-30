import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import AdmZip from 'adm-zip';
import { createHash } from 'node:crypto';
import { writeGpresFile } from './gpresWriter';
import { readGpres } from './gpresReader';
import { writeAtomicGeneratedDocument } from './atomicFile';
import { validateProject } from '../shared/gpresFormat';

async function fixture(run: (root: string) => Promise<void>) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gpres-stream-'));
  try {
    await run(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}
const deck = (url?: string) => ({
  id: 'deck',
  name: 'Project',
  custom: { retained: true },
  slides: [
    {
      id: 's',
      type: url ? 'image' : 'text',
      content: 'Hello',
      ...(url ? { mediaUrl: url } : {}),
      operatorNotes: 'notes',
    },
  ],
});
test('streaming package round trip preserves original bytes and deduplicates identical content at different paths', () =>
  fixture(async (root) => {
    const bytes = Buffer.alloc(2 * 1024 * 1024, 42),
      a = path.join(root, 'a.png'),
      b = path.join(root, 'b.bin');
    await fs.writeFile(a, bytes);
    await fs.writeFile(b, bytes);
    const data = deck(pathToFileURL(a).href);
    Object.assign(data.slides[0], { thumbnailUrl: pathToFileURL(b).href });
    const original = JSON.stringify(data),
      file = path.join(root, 'project.gpres'),
      lib = path.join(root, 'lib');
    const result = await writeGpresFile(original, file, lib);
    assert.equal(result.embeddedCount, 1);
    assert.equal(JSON.stringify(data), original);
    const zip = new AdmZip(file),
      manifest = JSON.parse(zip.readAsText('manifest.json'));
    assert.equal(manifest.files.length, 2);
    assert.equal(manifest.containerVersion, 1);
    const before = await fs.readdir(root);
    await readGpres(file, lib, undefined, { validateOnly: true });
    assert.deepEqual(await fs.readdir(root), before);
    const opened = await readGpres(file, lib);
    assert.equal(opened.data.custom.retained, true);
    assert.equal(opened.data.slides[0].operatorNotes, 'notes');
    assert.equal(opened.data.slides[0].mediaUrl, opened.data.slides[0].thumbnailUrl);
    const name = opened.data.slides[0].mediaUrl.split('/').pop();
    assert.deepEqual(await fs.readFile(path.join(lib, name)), bytes);
    assert.ok(name.startsWith(createHash('sha256').update(bytes).digest('hex')));
  }));
test('inline images are validated, content-deduplicated and restored on open', () =>
  fixture(async (root) => {
    const bytes = Buffer.from('small inline image'),
      image = `data:image/png;base64,${bytes.toString('base64')}`,
      data = deck(image);
    Object.assign(data.slides[0], { thumbnailUrl: image });
    const file = path.join(root, 'inline.gpres'),
      lib = path.join(root, 'lib');
    const result = await writeGpresFile(JSON.stringify(data), file, lib);
    assert.equal(result.embeddedCount, 1);
    const opened = await readGpres(file, lib);
    assert.equal(opened.mediaCount, 1);
    assert.equal(opened.data.slides[0].mediaUrl, opened.data.slides[0].thumbnailUrl);
    const name = opened.data.slides[0].mediaUrl.split('/').pop();
    assert.deepEqual(await fs.readFile(path.join(lib, name)), bytes);
  }));
test('malformed inline image base64 is rejected before creating the output', () =>
  fixture(async (root) => {
    for (const [index, payload] of ['A', 'YQ='].entries()) {
      const file = path.join(root, `invalid-inline-${index}.gpres`);
      const content = JSON.stringify(deck(`data:image/png;base64,${payload}`));
      await assert.rejects(writeGpresFile(content, file, root), /Invalid embedded image/);
      await assert.rejects(fs.access(file));
    }
    assert.deepEqual(await fs.readdir(root), []);
  }));
test('manifest catches tampering even when ZIP CRC is recomputed; never promotes partial media', () =>
  fixture(async (root) => {
    const image = path.join(root, 'media.png');
    await fs.writeFile(image, 'original bytes');
    const file = path.join(root, 'valid.gpres');
    await writeGpresFile(JSON.stringify(deck(pathToFileURL(image).href)), file, root);
    const zip = new AdmZip(file),
      media = zip.getEntries().find((e) => e.entryName.startsWith('media/'))!;
    zip.updateFile(media.entryName, Buffer.from('modified bytes'));
    await assert.rejects(readGpres(zip.toBuffer(), path.join(root, 'failed')), /manifest|hash/);
    assert.deepEqual(await fs.readdir(path.join(root, 'failed')), []);
  }));
test('strict inventory, unsupported versions and missing media references fail safely', () =>
  fixture(async (root) => {
    const file = path.join(root, 'valid.gpres');
    await writeGpresFile(JSON.stringify(deck()), file, root);
    for (const mutate of [
      (z: AdmZip) => z.addFile('extra.txt', Buffer.from('x')),
      (z: AdmZip) => {
        const m = JSON.parse(z.readAsText('manifest.json'));
        m.containerVersion = 999;
        z.updateFile('manifest.json', Buffer.from(JSON.stringify(m)));
      },
      (z: AdmZip) => z.deleteFile('presentation.json'),
    ]) {
      const z = new AdmZip(file);
      mutate(z);
      await assert.rejects(readGpres(z.toBuffer(), root), /inventory|version|missing/);
    }
  }));
test('unreachable media aborts before creating output and leaves source model unchanged', () =>
  fixture(async (root) => {
    const file = path.join(root, 'output.gpres'),
      data = deck(pathToFileURL(path.join(root, 'missing.png')).href),
      content = JSON.stringify(data);
    await assert.rejects(writeGpresFile(content, file, root), /GPRES_MISSING_MEDIA/);
    await assert.rejects(fs.access(file));
    assert.equal(JSON.stringify(data), content);
  }));
test('legacy JSON and ZIP still open; unsupported new schema does not silently drop fields', () =>
  fixture(async (root) => {
    const data = deck();
    assert.deepEqual((await readGpres(Buffer.from(JSON.stringify(data)), root)).data, data);
    const zip = new AdmZip();
    zip.addFile('presentation.json', Buffer.from(JSON.stringify(data)));
    assert.deepEqual((await readGpres(zip.toBuffer(), root)).data, data);
    assert.throws(() => validateProject({ ...data, slides: [data.slides[0], data.slides[0]] }), /identity/);
    assert.throws(
      () => validateProject({ ...data, slides: [{ ...data.slides[0], type: 'future-slide' }] }),
      /identity/
    );
  }));
test('atomic project commits retain one verified previous revision; failures preserve both files', () =>
  fixture(async (root) => {
    const target = path.join(root, 'project.gpres'),
      journal = path.join(root, 'journal');
    const write = (text: string) =>
      writeAtomicGeneratedDocument(
        target,
        journal,
        async (partial) => {
          await writeGpresFile(JSON.stringify({ ...deck(), name: text }), partial, root);
        },
        {
          validatePrevious: async (file) => {
            await readGpres(file, root, undefined, { validateOnly: true });
          },
        }
      );
    await write('one');
    await write('two');
    assert.equal((await readGpres(target + '.bak', root)).data.name, 'one');
    await write('three');
    assert.equal((await readGpres(target + '.bak', root)).data.name, 'two');
    const current = await fs.readFile(target),
      backup = await fs.readFile(target + '.bak');
    await assert.rejects(
      writeAtomicGeneratedDocument(target, journal, async (partial) => {
        await fs.writeFile(partial, 'broken');
        throw Error('injected crash');
      })
    );
    assert.deepEqual(await fs.readFile(target), current);
    assert.deepEqual(await fs.readFile(target + '.bak'), backup);
    assert.deepEqual(await fs.readdir(journal), []);
    await fs.writeFile(target, 'corrupt');
    await assert.rejects(write('four'));
    assert.equal(await fs.readFile(target, 'utf8'), 'corrupt');
    assert.deepEqual(await fs.readFile(target + '.bak'), backup);
  }));
test('same-target concurrent saves serialize backup generations', () =>
  fixture(async (root) => {
    const target = path.join(root, 'concurrent.gpres'),
      journal = path.join(root, 'journal');
    const save = (name: string) =>
      writeAtomicGeneratedDocument(
        target,
        journal,
        async (partial) => {
          await writeGpresFile(JSON.stringify({ ...deck(), name }), partial, root);
        },
        {
          validatePrevious: async (file) => {
            await readGpres(file, root, undefined, { validateOnly: true });
          },
        }
      );
    await Promise.all([save('first'), save('second'), save('third')]);
    assert.equal((await readGpres(target, root)).data.name, 'third');
    assert.equal((await readGpres(target + '.bak', root)).data.name, 'second');
  }));
test('known malformed style and overlay fields are rejected before activation', () => {
  const data = deck();
  assert.throws(
    () => validateProject({ ...data, slides: [{ ...data.slides[0], styles: { fontFamily: 42 } }] }),
    /fontFamily/
  );
  assert.throws(
    () =>
      validateProject({
        ...data,
        slides: [
          {
            ...data.slides[0],
            videoOverlays: [
              {
                id: 'overlay',
                type: 'text',
                content: 'x',
                x: 0,
                y: 0,
                width: 20,
                height: 20,
                zIndex: 0,
                textStyles: { fontFamily: 42 },
              },
            ],
          },
        ],
      }),
    /fontFamily/
  );
});
test('project validation preserves limits and nested item checks', () => {
  const data = deck();
  assert.throws(() => validateProject({ ...data, sections: 'invalid' }), /sections/);
  assert.throws(
    () => validateProject({ ...data, slides: [{ ...data.slides[0], loopItems: [{ id: 'loop', type: 'image', duration: -1, mediaUrl: 'x' }] }] }),
    /loop media/
  );
  const item = (id: string, groupItems?: unknown) => ({
    id,
    type: groupItems ? 'group' : 'shape',
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    zIndex: 0,
    ...(groupItems === undefined ? {} : { groupItems }),
  });
  assert.throws(
    () =>
      validateProject({
        ...data,
        slides: [{ ...data.slides[0], items: [item('parent', [item('child', 'invalid')])] }],
      }),
    /slide items/
  );
  assert.throws(
    () =>
      validateProject({
        ...data,
        slides: [{ ...data.slides[0], items: [item('parent'), { ...item('parent'), type: 'shape' }] }],
      }),
    /identity/
  );
});
test('generated group image dependencies are portable even without a slide background', () =>
  fixture(async (root) => {
    const image = path.join(root, 'gradient.png');
    await fs.writeFile(image, 'gradient-image');
    const recipe = {
      engineVersion: 1,
      seed: 123,
      colors: ['#000000', '#ffffff'],
      palette: 'custom',
      style: 'linear',
      darkness: 0,
      width: 1920,
      height: 1080,
    };
    const data = deck();
    Object.assign(data.slides[0], {
      styles: { generatedGroupBackground: { image: pathToFileURL(image).href, recipe } },
    });
    const file = path.join(root, 'gradient.gpres');
    await writeGpresFile(JSON.stringify(data), file, root);
    const lib = path.join(root, 'fresh-library'),
      opened = await readGpres(file, lib),
      ref = opened.data.slides[0].styles.generatedGroupBackground.image;
    assert.ok(ref.startsWith('local-resource://media/'));
    assert.equal(await fs.readFile(path.join(lib, ref.split('/').pop()), 'utf8'), 'gradient-image');
  }));
test('bundled legacy project converts without losing slides or media', () => fixture(async root => {
  const lib = path.join(root, 'library');
  const imported = await readGpres(path.resolve('Default-Project.gpres'), lib);
  const file = path.join(root, 'converted.gpres');
  await writeGpresFile(JSON.stringify(imported.data), file, lib);
  const reopened = await readGpres(file, path.join(root, 'second-library'));
  assert.equal(reopened.data.slides.length, imported.data.slides.length);
  assert.equal(reopened.data.name, imported.data.name);
  assert.equal(reopened.mediaCount, imported.mediaCount);
}));
