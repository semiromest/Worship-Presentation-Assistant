/**
 * Broadcast slide lock — central helpers.
 *
 * Exactly one slide may be locked at a time. While a lock is active, the live
 * (on-screen) output is pinned to the locked slide: every live-index mutation
 * resolves through `resolveLiveIndexForLock` so callers cannot bypass the pin
 * even by accident.
 *
 * Editing a different slide stays fully allowed — selection, right-panel edits
 * and the slide editor are unaffected. Only navigation of the LIVE output is
 * restricted.
 */

import type { Slide } from './types';

export interface LiveSlidePosition {
  slideId: string | null;
  index: number;
}

/** Returns the index of the single locked slide, or -1 when none is locked. */
export function findLockedSlideIndex(slides: Slide[]): number {
  for (let i = 0; i < slides.length; i++) {
    if (slides[i]?.locked) return i;
  }
  return -1;
}

/**
 * Resolves the live output by slide identity, with the broadcast lock taking
 * precedence. The numeric index is derived only for legacy consumers.
 */
export function resolveLiveSlidePosition(
  requestedSlideId: string | null | undefined,
  fallbackIndex: number,
  slides: Slide[],
): LiveSlidePosition {
  if (slides.length === 0) return { slideId: null, index: 0 };

  const lockedIndex = findLockedSlideIndex(slides);
  if (lockedIndex >= 0) {
    return { slideId: slides[lockedIndex].id, index: lockedIndex };
  }

  const requestedIndex = requestedSlideId
    ? slides.findIndex((slide) => slide.id === requestedSlideId)
    : -1;
  if (requestedIndex >= 0) {
    return { slideId: slides[requestedIndex].id, index: requestedIndex };
  }

  const safeFallback = Number.isFinite(fallbackIndex) ? Math.floor(fallbackIndex) : 0;
  const index = Math.min(Math.max(0, safeFallback), slides.length - 1);
  return { slideId: slides[index].id, index };
}

/**
 * Legacy index-only wrapper. New code should use resolveLiveSlidePosition so a
 * live slide stays stable when the deck is reordered.
 */
export function resolveLiveIndexForLock(requested: number, slides: Slide[]): number {
  const lockedIndex = findLockedSlideIndex(slides);
  return lockedIndex >= 0 ? lockedIndex : requested;
}

/**
 * Pin one slide (single-lock invariant: any previous lock is cleared) and
 * return the new slides array plus the index to use as the live index.
 * Returns null when nothing changes (already pinned).
 */
export function pinSlide(
  slides: Slide[],
  slideId: string,
): { slides: Slide[]; lockedIndex: number } | null {
  const idx = slides.findIndex((s) => s.id === slideId);
  if (idx === -1) return null;

  let changed = false;
  const next = slides.map((s, i) => {
    if (i === idx) {
      if (!s.locked) changed = true;
      return { ...s, locked: true };
    }
    if (s.locked) {
      changed = true;
      return { ...s, locked: false };
    }
    return s;
  });

  if (!changed) return null;
  return { slides: next, lockedIndex: idx };
}

/** Removes the lock from the slide with the given id (no-op if not locked). */
export function unpinSlide(slides: Slide[], slideId: string): Slide[] {
  return slides.map((s) => (s.locked || s.id === slideId ? { ...s, locked: false } : s));
}
