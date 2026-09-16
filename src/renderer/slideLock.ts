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

/** Returns the index of the single locked slide, or -1 when none is locked. */
export function findLockedSlideIndex(slides: Slide[]): number {
  for (let i = 0; i < slides.length; i++) {
    if (slides[i]?.locked) return i;
  }
  return -1;
}

/**
 * Central rule: where should the live output point?
 * - With an active lock, always the locked slide (its position may shift as
 *   the deck is reordered; the lock follows the slide identity).
 * - Without a lock, the requested index unchanged.
 */
export function resolveLiveIndexForLock(requested: number, slides: Slide[]): number {
  const lockedIdx = findLockedSlideIndex(slides);
  return lockedIdx >= 0 ? lockedIdx : requested;
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
