import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { GRADIENT_PALETTES, renderGradient, validateGradient, type GeneratedBackground } from './generatedBackground';
import { checkGradientContrast } from './gradientContrast';
import { encodeGradient } from '../main/gradientRender';
import {
  applyGeneratedBackground,
  backgroundPatch,
  gradientTargets,
  inheritGeneratedBackgrounds,
} from '../renderer/gradientBackground';
import { undoReducer } from '../renderer/state/undoReducer';
import type { Presentation, Slide } from '../renderer/types';
const recipe: GeneratedBackground = {
  engineVersion: 1,
  seed: 20261014,
  colors: [...GRADIENT_PALETTES.ocean],
  palette: 'ocean',
  style: 'flow',
  darkness: 25,
  width: 1920,
  height: 1080,
};
const slide = (id: string, groupId = 'hymn'): Slide => ({
  id,
  type: 'text',
  content: 'Rab çobanımdır',
  group: { id: groupId, title: 'Hymn', part: 1, parts: 2 },
  styles: { fontSize: 70, backgroundColor: '', textColor: '#fff' },
});
test('v1 pixel and JPEG golden hashes; fixed dimensions and image budget', () => {
  const result = encodeGradient(recipe);
  assert.equal(result.rgbaHash, '143196b787765f3820a237ee1b7fcdf345d5124a3a5e3d79dd1c4314dd67d1ee');
  assert.equal(result.jpegHash, 'a5cc70a233b70a02524ef44ce1d89c0b5d5879fdb4e00c57c1a699656ae236e3');
  assert.ok(result.bytes.length < 500 * 1024);
  assert.equal(createHash('sha256').update(renderGradient(recipe)).digest('hex'), result.rgbaHash);
});
test('all curated palettes stay in budget, seeds/styles change the image', () => {
  const hashes = new Set<string>();
  for (const [palette, colors] of Object.entries(GRADIENT_PALETTES)) {
    const result = encodeGradient({
      ...recipe,
      palette,
      colors: [...colors],
      seed: 0xffffffff,
      style: 'soft',
      darkness: 0,
    });
    assert.ok(result.bytes.length < 500 * 1024, palette);
    hashes.add(result.jpegHash);
  }
  assert.equal(hashes.size, 8);
});
test('rejects unbounded recipes and preserves literal palette colors', () => {
  for (const patch of [
    { width: 3840 },
    { seed: -1 },
    { seed: NaN },
    { darkness: 1.5 },
    { colors: ['red'] },
    { engineVersion: 2 },
  ])
    assert.throws(() => validateGradient({ ...recipe, ...patch }));
  assert.deepEqual(validateGradient(recipe), recipe);
});
test('contrast uses worst decoded pixel, clips regions and handles absent text', () => {
  const pixels = new Uint8Array([0, 0, 0, 255, 255, 255, 255, 255]);
  assert.equal(
    checkGradientContrast(pixels, 2, 1, [{ x: 0, y: 0, width: 1, height: 1, color: [255, 255, 255] }]).minimum,
    21
  );
  assert.equal(
    checkGradientContrast(pixels, 2, 1, [{ x: -1, y: 0, width: 3, height: 1, color: [255, 255, 255] }]).minimum,
    1
  );
  assert.equal(checkGradientContrast(pixels, 2, 1, []).minimum, null);
});
test('group scope, single undo, defaults and explicit overrides remain separate', () => {
  const deck: Presentation = {
    id: 'deck',
    name: 'Test',
    zoom: 1,
    slides: [slide('a'), slide('b'), slide('c', 'other')],
  };
  const ids = gradientTargets(deck.slides, 'a', [], 'group').map((s) => s.id);
  assert.deepEqual(ids, ['a', 'b']);
  const updated = applyGeneratedBackground(deck, ids, 'local-resource://media/g.jpg', recipe, true);
  assert.equal(updated.slides[0].styles?.backgroundImage, updated.slides[1].styles?.backgroundImage);
  assert.equal(updated.slides[2], deck.slides[2]);
  const state = undoReducer({ past: [], present: deck, future: [] }, { type: 'SET', payload: updated });
  assert.equal(state.past.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(undoReducer(state, { type: 'UNDO' }).present)), deck);
  const additions = inheritGeneratedBackgrounds(updated.slides, [
    slide('new'),
    { ...slide('custom'), styles: { ...slide('custom').styles!, backgroundColor: '#123456' } },
    slide('c', 'hymn'),
  ]);
  assert.equal(additions[0].styles?.backgroundImage, 'local-resource://media/g.jpg');
  assert.equal(additions[1].styles?.backgroundImage, undefined);
  assert.equal(additions[2].styles?.backgroundImage, undefined, 'moving known slides never inherits');
  assert.equal(
    backgroundPatch(updated.slides[0].styles!, { backgroundImage: 'new.jpg' }).generatedBackground,
    undefined
  );
  assert.equal(backgroundPatch(updated.slides[0].styles!, { fontSize: 80 }).generatedBackground, recipe);
  const solid = backgroundPatch(updated.slides[0].styles!, { backgroundColor: '#222222' });
  assert.equal(solid.generatedBackground, undefined);
  assert.equal(solid.backgroundImage, undefined, 'a chosen solid color replaces generated pixels');
  const createdDefault = { ...slide('new-default'), styles: { ...slide('new-default').styles!, backgroundColor:'#000000', backgroundExplicit:false } };
  assert.equal(inheritGeneratedBackgrounds(updated.slides,[createdDefault])[0].styles?.backgroundImage,'local-resource://media/g.jpg');
  assert.equal(inheritGeneratedBackgrounds(updated.slides,[{...createdDefault,styles:{...createdDefault.styles,backgroundExplicit:true}}])[0].styles?.backgroundImage,undefined);
});
