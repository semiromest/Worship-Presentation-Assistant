import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { createMediaLibrary, rewriteGpresMedia } from '../main/mediaLibrary';
import { buildGpresZip } from '../shared/mediaTree';
import { exportPresentationToPptx } from '../main/pptxExportService';
import { encodeGradient } from '../main/gradientRender';
import { GRADIENT_PALETTES, type GeneratedBackground } from '../shared/generatedBackground';
import { applyGeneratedBackground } from './gradientBackground';
import type { Presentation } from './types';
test('JPEG deduplication, gpres round trip and PPTX embedding preserve bytes and recipes', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gradient-media-'));
  try {
    const recipe: GeneratedBackground = {
      engineVersion: 1,
      seed: 1,
      colors: [...GRADIENT_PALETTES.ocean],
      palette: 'ocean',
      style: 'soft',
      darkness: 25,
      width: 1920,
      height: 1080,
      motion: { enabled: true, type: 'aurora', speed: 31, amount: 76 },
    };
    const bytes = encodeGradient(recipe).bytes,
      lib = createMediaLibrary(path.join(dir, 'media'));
    const ref = (await lib.storeBytes(bytes, 'jpg'))!;
    assert.equal(await lib.storeBytes(bytes, 'jpg'), ref);
    const base: Presentation = {
      id: 'd',
      name: 'Test',
      zoom: 1,
      slides: ['a', 'b'].map((id) => ({
        id,
        type: 'text',
        content: 'Mezmur 23',
        styles: { fontSize: 70, backgroundColor: '#000', textColor: '#fff' },
      })),
    };
    const deck = applyGeneratedBackground(base, ['a', 'b'], ref, recipe, true);
    const { zip, embeddedCount } = await buildGpresZip(structuredClone(deck), { mediaDir: lib.dir });
    assert.equal(embeddedCount, 1);
    const restored = JSON.parse(zip.readAsText('presentation.json'));
    await rewriteGpresMedia(zip, restored, lib);
    assert.deepEqual(restored.slides[0].styles.generatedBackground, recipe);
    assert.deepEqual(await fs.readFile(lib.urlToPath(restored.slides[0].styles.backgroundImage)), bytes);
    assert.equal(restored.slides[0].styles.backgroundImage, restored.slides[1].styles.backgroundImage);
    assert.equal((await fs.readdir(lib.dir)).length, 1);
    const target = path.join(dir, 'gradient.pptx');
    const exported = await exportPresentationToPptx(deck, target, undefined, lib.dir);
    assert.equal(exported.success, true);
    const pptx = new AdmZip(await fs.readFile(target));
    assert.ok(pptx.getEntries().some((e) => e.entryName.startsWith('ppt/media/') && pptx.readFile(e)?.equals(bytes)));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
