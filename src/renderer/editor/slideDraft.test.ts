import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Presentation, Slide, SlideItem } from '../types';
import {
  applyDraftsToDeck,
  applyItemStyle,
  applyItemsToSlides,
  applyStyleToDraft,
  applyStyleToSlides,
  cloneItemWithNewId,
  counterpartItems,
  createDraft,
  draftToSlide,
  isItemEditableSlide,
  isSameSlidePaste,
  pasteItems,
  pruneDrafts,
} from './slideDraft';
import { DEFAULT_IMAGE_STYLE, DEFAULT_TEXT_STYLE } from './editorUtils';

const textItem = (overrides: Partial<SlideItem> = {}): SlideItem => ({
  id: 't1',
  type: 'text',
  content: 'Merhaba',
  x: 10,
  y: 20,
  width: 30,
  height: 12,
  zIndex: 0,
  visible: true,
  locked: false,
  textStyles: { ...DEFAULT_TEXT_STYLE, fontSize: 42, textColor: '#123456', fontFamily: 'Lora' },
  styles: {},
  ...overrides,
});

const imageItem = (overrides: Partial<SlideItem> = {}): SlideItem => ({
  id: 'i1',
  type: 'image',
  mediaUrl: 'file:///logo.png',
  x: 70,
  y: 4,
  width: 20,
  height: 12,
  zIndex: 1,
  visible: true,
  locked: false,
  imageStyles: { ...DEFAULT_IMAGE_STYLE, objectFit: 'contain' },
  animation: { type: 'fade', duration: 400, delay: 100 },
  styles: {},
  ...overrides,
});

const slide = (overrides: Partial<Slide> = {}): Slide => ({
  id: 's1',
  type: 'text',
  content: 'Merhaba',
  styles: {
    fontSize: 42,
    backgroundColor: '#000000',
    textColor: '#123456',
  },
  ...overrides,
});

const deck = (slides: Slide[]): Presentation => ({ id: 'deck', name: 'Deck', slides });

// ─── Clipboard fidelity ───────────────────────────────────────────────────────

test('pasting into another slide keeps position, size, style, font and animation', () => {
  const source = [textItem(), imageItem()];
  const { items, pastedIds } = pasteItems([], source, { offset: false });

  assert.equal(items.length, 2);
  assert.deepEqual(pastedIds, items.map((item) => item.id));

  const pastedText = items[0];
  assert.equal(pastedText.x, 10);
  assert.equal(pastedText.y, 20);
  assert.equal(pastedText.width, 30);
  assert.equal(pastedText.height, 12);
  assert.equal(pastedText.textStyles?.fontSize, 42);
  assert.equal(pastedText.textStyles?.textColor, '#123456');
  assert.equal(pastedText.textStyles?.fontFamily, 'Lora');

  const pastedImage = items[1];
  assert.equal(pastedImage.mediaUrl, 'file:///logo.png');
  assert.deepEqual(pastedImage.animation, { type: 'fade', duration: 400, delay: 100 });
  assert.equal(pastedImage.imageStyles?.objectFit, 'contain');
});

test('pasting is a transfer, not a duplicate: ids are regenerated and the source is untouched', () => {
  const source = [textItem({ id: 'original' })];
  const before = JSON.stringify(source);
  const { items } = pasteItems([], source, { offset: false });

  assert.notEqual(items[0].id, 'original');
  assert.equal(JSON.stringify(source), before, 'source items must never be mutated');

  const again = pasteItems([], source, { offset: false });
  assert.notEqual(again.items[0].id, items[0].id, 'each paste gets unique ids');
});

test('pasting onto the slide the element came from offsets it slightly', () => {
  const { items } = pasteItems([], [textItem({ x: 10, y: 20 })], { offset: true });
  assert.equal(items[0].x, 12);
  assert.equal(items[0].y, 22);
});

test('offset pasting is clamped so the copy stays inside the canvas', () => {
  const { items } = pasteItems([], [textItem({ x: 70, y: 88, width: 30, height: 12 })], { offset: true });
  assert.equal(items[0].x, 70, 'clamped to 100 - width');
  assert.equal(items[0].y, 88, 'clamped to 100 - height');
});

test('pasted items land on top of the existing stack', () => {
  const existing = [textItem({ id: 'a', zIndex: 3 }), imageItem({ id: 'b', zIndex: 7 })];
  const { items } = pasteItems(existing, [textItem({ id: 'c' })], { offset: false });
  const pasted = items.find((item) => item.id !== 'a' && item.id !== 'b');
  assert.ok(pasted);
  assert.equal(pasted.zIndex, items.length - 1);
});

test('group children are re-identified too, so copies never share child ids', () => {
  const group: SlideItem = {
    id: 'g1',
    type: 'group',
    x: 0,
    y: 0,
    width: 40,
    height: 20,
    zIndex: 0,
    groupItems: [textItem({ id: 'child-1' }), imageItem({ id: 'child-2' })],
    styles: {},
  };
  const clone = cloneItemWithNewId(group);
  assert.notEqual(clone.id, 'g1');
  assert.deepEqual(
    clone.groupItems?.map((child) => child.id),
    [clone.groupItems?.[0].id, clone.groupItems?.[1].id],
  );
  assert.ok(clone.groupItems?.every((child) => child.id !== 'child-1' && child.id !== 'child-2'));
});

test('isSameSlidePaste only treats a known, identical source as the same slide', () => {
  assert.equal(isSameSlidePaste('s1', 's1'), true);
  assert.equal(isSameSlidePaste('s1', 's2'), false);
  assert.equal(isSameSlidePaste(null, 's1'), false);
});

// ─── Style-only transfer ──────────────────────────────────────────────────────

test('style-only paste copies the look but not geometry, content or media', () => {
  const source = textItem({
    content: 'Kaynak',
    x: 5,
    y: 5,
    width: 10,
    height: 10,
    rotation: 15,
    textStyles: { ...DEFAULT_TEXT_STYLE, fontSize: 99, textColor: '#abcdef' },
    animation: { type: 'zoom', duration: 300 },
  });
  const target = textItem({
    id: 'target',
    content: 'Hedef',
    x: 60,
    y: 70,
    width: 25,
    height: 15,
    rotation: 0,
    textStyles: { ...DEFAULT_TEXT_STYLE, fontSize: 12, textColor: '#ffffff' },
  });

  const styled = applyItemStyle(source, target);

  assert.equal(styled.id, 'target');
  assert.equal(styled.content, 'Hedef');
  assert.equal(styled.x, 60);
  assert.equal(styled.y, 70);
  assert.equal(styled.width, 25);
  assert.equal(styled.height, 15);
  assert.equal(styled.rotation, 0, 'rotation is geometry, not style');
  assert.equal(styled.textStyles?.fontSize, 99);
  assert.equal(styled.textStyles?.textColor, '#abcdef');
  assert.deepEqual(styled.animation, { type: 'zoom', duration: 300 });
});

test('bulk style matching pairs items by type and ordinal', () => {
  const sourceItems = [textItem({ id: 'a' }), textItem({ id: 'b' }), imageItem({ id: 'c' })];
  const targetItems = [imageItem({ id: 't-img' }), textItem({ id: 't-first' }), textItem({ id: 't-second' })];

  assert.deepEqual(
    counterpartItems(sourceItems, 'b', targetItems).map((item) => item.id),
    ['t-second'],
  );
  assert.deepEqual(
    counterpartItems(sourceItems, 'c', targetItems).map((item) => item.id),
    ['t-img'],
  );
  // A target without a second text item cannot echo the source's second text.
  assert.deepEqual(counterpartItems(sourceItems, 'b', [textItem({ id: 'only' })]), []);
});

test('applying a style to a draft only touches counterparts', () => {
  const draft = {
    ...createDraft(slide({ items: [textItem({ id: 'x' }), imageItem({ id: 'y' })] })),
  };
  const sourceItems = [textItem({ id: 'src', textStyles: { ...DEFAULT_TEXT_STYLE, fontSize: 80 } })];
  const { draft: next, matched } = applyStyleToDraft(sourceItems, new Set(['src']), {
    ...draft,
    items: draft.items.map((item) => (item.id === 'x' ? item : item)),
  });

  assert.equal(matched, 1);
  assert.equal(next.items.find((item) => item.id === 'x')?.textStyles?.fontSize, 80);
  assert.equal(next.items.find((item) => item.id === 'y')?.imageStyles?.objectFit, 'contain');
});

// ─── Draft ↔ slide round trip ─────────────────────────────────────────────────

test('draftToSlide keeps the legacy text fields in sync for older readers', () => {
  const base = slide({ content: 'eski', styles: { fontSize: 10, backgroundColor: '#000', textColor: '#fff' } });
  const draft = createDraft(base);
  draft.items = [
    textItem({
      id: 'primary',
      content: 'yeni içerik',
      textStyles: { ...DEFAULT_TEXT_STYLE, fontSize: 64, textColor: '#ff0000', fontFamily: 'Inter' },
    }),
  ];

  const next = draftToSlide(base, draft);

  assert.equal(next.content, 'yeni içerik');
  assert.equal(next.styles?.fontSize, 64);
  assert.equal(next.styles?.textColor, '#ff0000');
  assert.equal(next.styles?.fontFamily, 'Inter');
  assert.equal(next.styles?.backgroundColor, '#000', 'untouched style fields survive');
  assert.equal(next.items?.length, 1);
});

test('draftToSlide never writes undefined over an existing slide style', () => {
  const base = slide({ styles: { fontSize: 30, backgroundColor: '#111', textColor: '#eee' } });
  const draft = createDraft(base);
  draft.items = [
    {
      id: 'primary',
      type: 'text',
      content: 'x',
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      zIndex: 0,
      textStyles: { textDecoration: '' },
      styles: {},
    },
  ];

  const next = draftToSlide(base, draft);
  assert.equal(next.styles?.fontSize, 30);
  assert.equal(next.styles?.textColor, '#eee');
});

test('draftToSlide preserves slide fields the editor does not touch', () => {
  const base = slide({
    sectionId: 'sec-1',
    locked: true,
    operatorNotes: 'not',
    group: { id: 'g', title: 'İlahi', part: 1, parts: 3 },
    loopItems: [{ id: 'l1', type: 'image', mediaUrl: 'file:///a.png', duration: 3000 }],
  });
  const draft = createDraft(base);
  const next = draftToSlide(base, draft);

  assert.equal(next.sectionId, 'sec-1');
  assert.equal(next.locked, true);
  assert.equal(next.operatorNotes, 'not');
  assert.deepEqual(next.group, { id: 'g', title: 'İlahi', part: 1, parts: 3 });
  assert.equal(next.loopItems?.length, 1);
});

test('applyDraftsToDeck passes untouched slides through by reference', () => {
  const slides = [slide({ id: 'a' }), slide({ id: 'b' }), slide({ id: 'c' })];
  const base = deck(slides);
  const drafts = new Map([['b', { ...createDraft(slides[1]), gridEnabled: true }]]);

  const next = applyDraftsToDeck(base, drafts);
  assert.ok(next);
  assert.equal(next!.slides[0], slides[0], 'slide a must be the same object');
  assert.equal(next!.slides[2], slides[2], 'slide c must be the same object');
  assert.notEqual(next!.slides[1], slides[1]);
  assert.equal(next!.slides[1].gridEnabled, true);
  assert.equal(next!.id, base.id);
  assert.equal(next!.name, base.name);
});

test('applyDraftsToDeck reports nothing to commit when no draft matches a slide', () => {
  assert.equal(applyDraftsToDeck(deck([slide({ id: 'a' })]), new Map()), null);
  assert.equal(
    applyDraftsToDeck(deck([slide({ id: 'a' })]), new Map([['ghost', createDraft(slide({ id: 'ghost' }))]])),
    null,
  );
});

test('pruneDrafts drops drafts whose slide no longer exists', () => {
  const drafts = new Map([
    ['a', createDraft(slide({ id: 'a' }))],
    ['gone', createDraft(slide({ id: 'gone' }))],
  ]);
  const pruned = pruneDrafts(drafts, deck([slide({ id: 'a' })]));
  assert.deepEqual([...pruned.keys()], ['a']);
  const unchanged = pruneDrafts(new Map([['a', drafts.get('a')!]]), deck([slide({ id: 'a' })]));
  assert.equal(unchanged.size, 1);
});

// ─── Bulk apply ───────────────────────────────────────────────────────────────

test('applying elements to slides skips the active slide, non-item types and reports both', () => {
  const slides = [
    slide({ id: 'active' }),
    slide({ id: 'target' }),
    slide({ id: 'image-slide', type: 'image', mediaUrl: 'file:///a.png' }),
    slide({ id: 'countdown', type: 'countdown', content: '{"minutes":1,"seconds":0}' }),
    slide({ id: 'parts', partsMode: true }),
  ];
  const slideById = new Map(slides.map((s) => [s.id, s] as const));
  const result = applyItemsToSlides(
    new Map(),
    slideById,
    ['active', 'target', 'image-slide', 'countdown', 'parts'],
    [textItem()],
    'active',
  );

  assert.deepEqual(result.appliedSlideIds, ['target', 'image-slide']);
  assert.deepEqual(result.skippedSlideIds, ['countdown', 'parts']);
  assert.ok(result.drafts.has('target'));
  assert.ok(result.drafts.has('image-slide'));
  // "target" is a legacy text slide, so its own text is seeded as an item first
  // and the applied element is added next to it.
  const targetItems = result.drafts.get('target')?.items ?? [];
  assert.equal(targetItems.length, 2);
  const applied = targetItems[targetItems.length - 1];
  assert.equal(applied.x, 10, 'bulk apply keeps the exact copied position');
  assert.equal(targetItems[0].content, 'Merhaba', "the target's own content is preserved");
});

test('bulk apply adds a copy to slides that already have items', () => {
  const slides = [slide({ id: 'src' }), slide({ id: 'dst', items: [textItem({ id: 'existing' })] })];
  const slideById = new Map(slides.map((s) => [s.id, s] as const));
  const result = applyItemsToSlides(new Map(), slideById, ['dst'], [imageItem()], 'src');
  const draft = result.drafts.get('dst');
  assert.equal(draft?.items.length, 2);
  assert.ok(draft?.items.some((item) => item.mediaUrl === 'file:///logo.png'));
  assert.ok(draft?.items.some((item) => item.id === 'existing'));
});

test('bulk style apply reports slides without a counterpart instead of inventing items', () => {
  const slides = [
    slide({ id: 'active', items: [textItem({ id: 'a' })] }),
    slide({ id: 'match', items: [textItem({ id: 'm' })] }),
    // An image slide has no text item to restyle, so it must be reported, not patched.
    slide({ id: 'no-match', type: 'image', content: '', items: [imageItem({ id: 'n' })] }),
  ];
  const slideById = new Map(slides.map((s) => [s.id, s] as const));
  const result = applyStyleToSlides(
    new Map(),
    slideById,
    ['match', 'no-match'],
    [textItem({ id: 'a', textStyles: { ...DEFAULT_TEXT_STYLE, fontSize: 77 } })],
    new Set(['a']),
  );

  assert.deepEqual(result.appliedSlideIds, ['match']);
  assert.deepEqual(result.unmatchedSlideIds, ['no-match']);
  assert.equal(result.drafts.get('match')?.items[0].textStyles?.fontSize, 77);
  assert.equal(result.drafts.has('no-match'), false, 'an unmatched slide is left completely alone');
});

test('isItemEditableSlide describes exactly what the editor can hold', () => {
  assert.equal(isItemEditableSlide(slide()), true);
  assert.equal(isItemEditableSlide(slide({ type: 'image' })), true);
  assert.equal(isItemEditableSlide(slide({ type: 'video' })), true);
  assert.equal(isItemEditableSlide(slide({ type: 'countdown' })), false);
  assert.equal(isItemEditableSlide(slide({ type: 'screen' })), false);
  assert.equal(isItemEditableSlide(slide({ type: 'loop' })), false);
  assert.equal(isItemEditableSlide(slide({ type: 'captions' })), false);
  assert.equal(isItemEditableSlide(slide({ partsMode: true })), false);
});
