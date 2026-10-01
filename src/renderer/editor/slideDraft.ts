import type { Presentation, Slide, SlideItem, TextStyle } from '../types';
import {
  clamp,
  convertSlideToItems,
  makeItemId,
  normalizeItem,
  normalizeItems,
  normalizeSlideStyles,
} from './editorUtils';

/**
 * Pure helpers for the multi-slide slide editor.
 *
 * Everything here is dependency-free and side-effect-free so that the risky
 * parts of multi-slide editing (clipboard fidelity, bulk scope, deck assembly)
 * can be unit-tested without a DOM or a store.
 */

/** Per-slide editing draft held while the editor is open. */
export interface SlideDraft {
  items: SlideItem[];
  styles: Record<string, unknown>;
  gridEnabled: boolean;
  gridSize: number;
  gridColor: string;
  snapEnabled: boolean;
}

/** Offset applied when pasting onto the same slide the element came from. */
export const PASTE_OFFSET = 2;

export const DEFAULT_GRID_COLOR = 'rgba(255,255,255,0.06)';

// ─── Draft lifecycle ──────────────────────────────────────────────────────────

export function createDraft(slide: Slide): SlideDraft {
  return {
    items: convertSlideToItems(slide),
    styles: normalizeSlideStyles(slide.styles as Record<string, unknown>),
    gridEnabled: slide.gridEnabled ?? false,
    gridSize: slide.gridSize ?? 10,
    gridColor: slide.gridColor ?? DEFAULT_GRID_COLOR,
    snapEnabled: slide.snapEnabled ?? false,
  };
}

/** Drafts are immutable; cloning shallow-copies the two mutable containers. */
export function cloneDraft(draft: SlideDraft): SlideDraft {
  return { ...draft, items: draft.items.slice(), styles: { ...draft.styles } };
}

/**
 * Slides the editor can meaningfully edit with items.
 *
 * `partsMode` slides are excluded on purpose: converting them to the items
 * model would drop the verse/part navigation their type depends on.
 */
export function isItemEditableSlide(slide: Slide): boolean {
  if (slide.partsMode) return false;
  return slide.type === 'text' || slide.type === 'image' || slide.type === 'video';
}

/**
 * Folds a draft back into its slide. Mirrors the historical single-slide save
 * path, including the text-slide sync between the primary text item and the
 * legacy `content`/`styles` fields so older readers keep working.
 */
export function draftToSlide(slide: Slide, draft: SlideDraft): Slide {
  const items = normalizeItems(draft.items);
  const next: Slide = {
    ...slide,
    items,
    styles: draft.styles as Slide['styles'],
    gridEnabled: draft.gridEnabled,
    gridSize: draft.gridSize,
    gridColor: draft.gridColor,
    snapEnabled: draft.snapEnabled,
  };

  if (slide.type !== 'text') return next;

  const primaryText = items.find((item) => item.type === 'text');
  if (!primaryText) return next;

  const ts: Partial<TextStyle> = primaryText.textStyles ?? {};
  const baseStyles = draft.styles as Record<string, unknown>;
  // Undefined values are skipped so a missing style never clobbers an existing
  // slide-level value.
  const sync: Record<string, unknown> = {};
  const assign = (key: string, value: unknown) => {
    if (value !== undefined) sync[key] = value;
  };
  assign('fontSize', ts.fontSize);
  assign('textColor', ts.textColor);
  assign('fontFamily', ts.fontFamily);
  assign('fontWeight', ts.fontWeight);
  assign('fontStyle', ts.fontStyle);
  assign('lineHeight', ts.lineHeight);
  if (ts.letterSpacing != null) sync.letterSpacing = ts.letterSpacing;
  assign('textDecoration', ts.textDecoration);
  assign('textAlign', ts.textAlign);
  assign('verticalAlign', ts.verticalAlign);

  return {
    ...next,
    content: primaryText.content ?? slide.content,
    styles: { ...(baseStyles as Slide['styles']), ...sync } as Slide['styles'],
  };
}

/**
 * Writes every draft back into the deck.
 * Untouched slides pass through by reference so the undo diff stays quiet and
 * nothing about them can change as a side effect of an edit elsewhere.
 * Returns null when no draft matched a live slide (nothing to commit).
 */
export function applyDraftsToDeck(
  deck: Presentation,
  drafts: Map<string, SlideDraft>,
): Presentation | null {
  if (drafts.size === 0) return null;
  let changed = false;
  const slides = deck.slides.map((slide) => {
    const draft = drafts.get(slide.id);
    if (!draft) return slide;
    changed = true;
    return draftToSlide(slide, draft);
  });
  return changed ? { ...deck, slides } : null;
}

/** Draft ids that still exist in the deck (stale ids are dropped on save). */
export function pruneDrafts(
  drafts: Map<string, SlideDraft>,
  deck: Presentation,
): Map<string, SlideDraft> {
  if (drafts.size === 0) return drafts;
  const alive = new Set(deck.slides.map((slide) => slide.id));
  let stale = false;
  for (const id of drafts.keys()) {
    if (!alive.has(id)) { stale = true; break; }
  }
  if (!stale) return drafts;
  const next = new Map<string, SlideDraft>();
  for (const [id, draft] of drafts) if (alive.has(id)) next.set(id, draft);
  return next;
}

// ─── Clipboard ────────────────────────────────────────────────────────────────

/**
 * Deep clone with fresh ids, recursing into groups.
 * Clipboard entries are always cloned before insertion so the same copied
 * element can be applied to many slides without sharing object references or
 * item ids between slides.
 */
export function cloneItemWithNewId(item: SlideItem): SlideItem {
  return {
    ...item,
    id: makeItemId(item.type === 'group' ? 'group' : 'item'),
    ...(item.groupItems
      ? { groupItems: item.groupItems.map(cloneItemWithNewId) }
      : {}),
  };
}

export function cloneItemsWithNewIds(items: SlideItem[]): SlideItem[] {
  return items.map(cloneItemWithNewId);
}

export interface ClipboardContent {
  items: SlideItem[];
  sourceSlideId: string;
  kind: SlideItem['type'];
  labelKey: string;
}

/**
 * Builds an immutable clipboard entry. Items are cloned with fresh ids so the
 * same copy can be applied to many slides without sharing ids or references.
 */
export function makeClipboard(
  items: SlideItem[],
  sourceSlideId: string,
): ClipboardContent | null {
  if (items.length === 0) return null;
  const cloned = cloneItemsWithNewIds(items);
  const kind = cloned[0]?.type ?? 'text';
  return {
    items: cloned,
    sourceSlideId,
    kind,
    labelKey: cloned.length > 1
      ? 'common.editorClipboardItems'
      : kind === 'image'
        ? 'common.editorImage'
        : kind === 'group'
          ? 'common.editorGroup'
          : 'common.editorText',
  };
}

export interface PasteResult {
  items: SlideItem[];
  pastedIds: string[];
}

/**
 * Inserts clipboard items into an item list.
 *
 * Fidelity rule: transferring to a *different* slide keeps position, size,
 * style, font, colour and animation exactly. Pasting back onto the slide the
 * items were copied from offsets them slightly so the copy is visible instead
 * of hiding underneath the original.
 */
export function pasteItems(
  existingItems: SlideItem[],
  clipboard: SlideItem[],
  options: { offset: boolean },
): PasteResult {
  if (clipboard.length === 0) return { items: existingItems, pastedIds: [] };

  const base = normalizeItems(existingItems);
  const maxZ = base.reduce((max, item) => Math.max(max, item.zIndex ?? 0), -1);

  const copies = clipboard.map((source, index) => {
    const copy = cloneItemWithNewId(source);
    return normalizeItem({
      ...copy,
      x: options.offset ? clamp(copy.x + PASTE_OFFSET, 0, 100 - copy.width) : copy.x,
      y: options.offset ? clamp(copy.y + PASTE_OFFSET, 0, 100 - copy.height) : copy.y,
      zIndex: maxZ + 1 + index,
    });
  });

  return {
    items: normalizeItems([...base, ...copies]),
    pastedIds: copies.map((item) => item.id),
  };
}

/** True when pasting into `targetSlideId` would land on the copied-from slide. */
export function isSameSlidePaste(sourceSlideId: string | null, targetSlideId: string): boolean {
  return sourceSlideId !== null && sourceSlideId === targetSlideId;
}

// ─── Style-only transfer ──────────────────────────────────────────────────────

/**
 * Appearance keys copied by "paste style only".
 * Geometry (x/y/width/height/rotation), content and media are deliberately
 * excluded — only the look travels. `animation` is included because it is not
 * geometry.
 */
const STYLE_KEYS = [
  'textStyles',
  'imageStyles',
  'gradient',
  'borderWidth',
  'borderColor',
  'borderRadius',
  'animation',
] as const;

export function applyItemStyle(source: SlideItem, target: SlideItem): SlideItem {
  const patch: Record<string, unknown> = {};
  for (const key of STYLE_KEYS) {
    const value = (source as unknown as Record<string, unknown>)[key];
    if (value !== undefined) patch[key] = value;
  }
  return normalizeItem({
    ...target,
    ...patch,
    // Geometry, identity and content stay with the target.
    id: target.id,
    type: target.type,
    content: target.content,
    mediaUrl: target.mediaUrl,
    x: target.x,
    y: target.y,
    width: target.width,
    height: target.height,
    rotation: target.rotation,
    zIndex: target.zIndex,
    visible: target.visible,
    locked: target.locked,
  });
}

/**
 * The items on a target slide that correspond to `source`.
 * Matching is by type + ordinal among same-typed items, so decks built from the
 * same template line up. When the target has no counterpart the result is empty
 * and the bulk edit silently skips that slide instead of inventing an item.
 */
export function counterpartItems(
  sourceItems: SlideItem[],
  sourceId: string,
  targetItems: SlideItem[],
): SlideItem[] {
  const source = sourceItems.find((item) => item.id === sourceId);
  if (!source) return [];
  const ordinal = sourceItems
    .filter((item) => item.type === source.type)
    .findIndex((item) => item.id === sourceId);
  if (ordinal < 0) return [];
  const match = targetItems.filter((item) => item.type === source.type)[ordinal];
  return match ? [match] : [];
}

export interface StyleApplyResult {
  draft: SlideDraft;
  /** How many items on this slide received the style. */
  matched: number;
}

/** Applies the style of the selected items onto the counterparts of a draft. */
export function applyStyleToDraft(
  sourceItems: SlideItem[],
  sourceSelectedIds: Set<string>,
  targetDraft: SlideDraft,
): StyleApplyResult {
  const selected = sourceItems.filter((item) => sourceSelectedIds.has(item.id));
  if (selected.length === 0) return { draft: targetDraft, matched: 0 };

  const sourceForTargetId = new Map<string, SlideItem>();
  for (const source of selected) {
    for (const match of counterpartItems(sourceItems, source.id, targetDraft.items)) {
      sourceForTargetId.set(match.id, source);
    }
  }
  if (sourceForTargetId.size === 0) return { draft: targetDraft, matched: 0 };

  let matched = 0;
  const items = targetDraft.items.map((item) => {
    const source = sourceForTargetId.get(item.id);
    if (!source) return item;
    matched += 1;
    return applyItemStyle(source, item);
  });

  return { draft: { ...targetDraft, items }, matched };
}

// ─── Bulk element transfer ────────────────────────────────────────────────────

export interface BulkPasteResult {
  drafts: Map<string, SlideDraft>;
  /** Slides that received the items. */
  appliedSlideIds: string[];
  /** Slides skipped because their type cannot host items. */
  skippedSlideIds: string[];
}

/**
 * Applies clipboard items to several slides at the exact copied position.
 * Selecting nothing is a no-op; locked slides are included (slide lock is a
 * broadcast pin, not an edit guard) and only non-item slide types are skipped.
 */
export function applyItemsToSlides(
  targetDrafts: Map<string, SlideDraft>,
  slideById: Map<string, Slide>,
  targetSlideIds: Iterable<string>,
  clipboard: SlideItem[],
  activeSlideId: string,
): BulkPasteResult {
  const drafts = new Map(targetDrafts);
  const appliedSlideIds: string[] = [];
  const skippedSlideIds: string[] = [];
  if (clipboard.length === 0) return { drafts, appliedSlideIds, skippedSlideIds };

  for (const slideId of targetSlideIds) {
    const slide = slideById.get(slideId);
    if (!slide) continue;
    if (!isItemEditableSlide(slide)) {
      skippedSlideIds.push(slideId);
      continue;
    }
    const draft = drafts.get(slideId) ?? createDraft(slide);
    // The active slide already holds the pasted copy; re-applying would stack a
    // duplicate on top of the user's visible paste.
    if (slideId === activeSlideId) continue;
    const { items } = pasteItems(draft.items, clipboard, { offset: false });
    drafts.set(slideId, { ...draft, items });
    appliedSlideIds.push(slideId);
  }

  return { drafts, appliedSlideIds, skippedSlideIds };
}

export interface BulkStyleResult {
  drafts: Map<string, SlideDraft>;
  appliedSlideIds: string[];
  /** Slides where no counterpart item existed, so nothing was copied. */
  unmatchedSlideIds: string[];
}

/** Applies the selected items' style to the selected slides' counterparts. */
export function applyStyleToSlides(
  targetDrafts: Map<string, SlideDraft>,
  slideById: Map<string, Slide>,
  targetSlideIds: Iterable<string>,
  sourceItems: SlideItem[],
  sourceSelectedIds: Set<string>,
): BulkStyleResult {
  const drafts = new Map(targetDrafts);
  const appliedSlideIds: string[] = [];
  const unmatchedSlideIds: string[] = [];

  for (const slideId of targetSlideIds) {
    const slide = slideById.get(slideId);
    if (!slide) continue;
    const draft = drafts.get(slideId) ?? createDraft(slide);
    const { draft: next, matched } = applyStyleToDraft(sourceItems, sourceSelectedIds, draft);
    if (matched === 0) {
      unmatchedSlideIds.push(slideId);
      continue;
    }
    drafts.set(slideId, next);
    appliedSlideIds.push(slideId);
  }

  return { drafts, appliedSlideIds, unmatchedSlideIds };
}
