import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import type { Presentation, Slide } from '../shared/presentation';
import { writeGpresFile } from './gpresWriter';
import { readGpres } from './gpresReader';

test('all slide types and rich editor fields survive a portable project save and reopen', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'release-roundtrip-'));
  try {
    const bytes = Buffer.from('deterministic media payload; decoding is covered by Electron tests');
    const asset = path.join(root, 'asset.png');
    await fs.writeFile(asset, bytes);
    const url = pathToFileURL(asset).href;
    const styles = { fontSize: 72, backgroundColor: '#123456', textColor: '#fedcba', lineHeight: 1.8, letterSpacing: 3, textAlign: 'right', verticalAlign: 'bottom', textHighlight: '#ffff00' };
    const item = { id: 'layer', type: 'text' as const, content: 'Layer text', styles: {}, x: 5, y: 10, width: 70, height: 30, rotation: 15, zIndex: 2, locked: true, visible: true, textStyles: { fontSize: 44, textDecoration: 'underline', textShadow: { color: '#000000', blur: 8 }, textStroke: { color: '#ffffff', width: 2 } } };
    // Record forces compile-time coverage when the model gains another slide type.
    const byType: Record<Slide['type'], Slide> = {
      text: { id: 'text', type: 'text', content: 'Text', styles, items: [item], gridEnabled: true, gridSize: 20, snapEnabled: true },
      image: { id: 'image', type: 'image', content: '', mediaUrl: url, styles: { ...styles, objectFit: 'cover', imageBrightness: 1.2, imageContrast: 0.8, imageBlur: 2, imageFlipX: true, opacity: 0.7 } },
      video: { id: 'video', type: 'video', content: '', mediaUrl: url, videoOverlays: [{ ...item, startSeconds: 1, endSeconds: 4 }] },
      countdown: { id: 'countdown', type: 'countdown', content: JSON.stringify({ minutes: 2, seconds: 15, totalSeconds: 135, startTime: 1000, paused: true, pausedRemaining: 90 }), styles },
      screen: { id: 'screen', type: 'screen', content: 'Display source', mediaUrl: 'screen:0:0' },
      loop: { id: 'loop', type: 'loop', content: '', loopItems: [{ id: 'loop-image', type: 'image', mediaUrl: url, duration: 5000 }, { id: 'loop-video', type: 'video', mediaUrl: url, duration: 3000, useVideoDuration: true }], loopTransition: { type: 'flip', duration: 600 } },
      captions: { id: 'captions', type: 'captions', content: '', captions: { showOriginal: false, showTranslation: true, layout: 'lowerThird' }, styles },
    };
    const deck: Presentation = { id: 'release', name: 'All features — İlahiler / 말씀', transition: { type: 'blur', duration: 800 }, zoom: 0.75, slides: [
      ...Object.values(byType),
      { id: 'hymn', type: 'text', content: 'Second verse', partsMode: true, parts: ['First verse', 'Second verse'], activePart: 1, group: { id: 'h', title: 'Hymn', author: 'Author', part: 2, parts: 2, kind: 'hymn' }, styles },
      { id: 'verse', type: 'text', content: 'In the beginning\nGenesis 1:1', styles, operatorNotes: 'Private operator note', locked: true },
      { id: 'music', type: 'text', content: 'Song', youtubeMusic: { id: 'abcdefghijk', title: 'Song', duration: 120 }, musicSettings: { volume: 0.4, autoPlay: false, attachment: true } },
    ] };
    const original = JSON.stringify(deck);
    const target = path.join(root, 'all-features.gpres');
    const result = await writeGpresFile(original, target, root);
    assert.equal(result.embeddedCount, 1);
    const library = path.join(root, 'restored');
    const restored = await readGpres(target, library);
    const expectedUrl = 'local-resource://media/' + createHash('sha256').update(bytes).digest('hex') + '.png';
    const expected = JSON.parse(original.split(url).join(expectedUrl));
    assert.deepEqual(restored.data, expected);
    assert.equal(JSON.stringify(deck), original, 'saving cannot mutate the working presentation');
    assert.deepEqual(await fs.readFile(path.join(library, expectedUrl.split('/').pop()!)), bytes);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
