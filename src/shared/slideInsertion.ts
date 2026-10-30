import type { Presentation } from './presentation';
import { moveSlidesToSection } from './sectionModel';

/** A gap in a section, independent of the number of visual columns. */
export interface SlideInsertion {
  sectionId: string;
  beforeId: string | null;
}

export function insertionAtCard(deck: Presentation, id: string, side: 'before' | 'after'): SlideInsertion | null {
  const index = deck.slides.findIndex(slide => slide.id === id);
  const card = deck.slides[index];
  if (!card?.sectionId) return null;
  const next = deck.slides[index + 1];
  return { sectionId: card.sectionId, beforeId: side === 'before' ? id : next?.sectionId === card.sectionId ? next.id : null };
}

/** Resolve selected anchors after removing the moving block. Missing targets cancel. */
export function resolveInsertion(deck: Presentation, ids: ReadonlySet<string>, target: SlideInsertion): SlideInsertion | null {
  if (!deck.sections?.some(section => section.id === target.sectionId)) return null;
  if (target.beforeId === null) return target;
  const index = deck.slides.findIndex(slide => slide.id === target.beforeId && slide.sectionId === target.sectionId);
  if (index < 0) return null;
  const next = deck.slides.slice(index).find(slide => slide.sectionId === target.sectionId && !ids.has(slide.id));
  return { sectionId: target.sectionId, beforeId: next?.id ?? null };
}

export function moveSlidesAtInsertion(deck: Presentation, ids: ReadonlySet<string>, target: SlideInsertion): Presentation {
  const existing = new Set(deck.slides.map(slide => slide.id));
  if (!ids.size || [...ids].some(id => !existing.has(id))) return deck;
  const resolved = resolveInsertion(deck, ids, target);
  if (!resolved) return deck;
  const next = moveSlidesToSection(deck, new Set(ids), resolved.sectionId, resolved.beforeId ? { beforeId: resolved.beforeId } : 'end');
  // Avoid history, autosave and projector work for a drop back into the same gap.
  return next.slides.length === deck.slides.length && next.slides.every((slide, i) =>
    slide.id === deck.slides[i].id && slide.sectionId === deck.slides[i].sectionId) ? deck : next;
}
