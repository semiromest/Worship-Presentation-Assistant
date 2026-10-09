import type { Presentation, Slide } from '../types';

export function findEditorConflicts(deck: Presentation, bases: Map<string, Slide>, touched: Set<string>): string[] {
  return deck.slides
    .filter((slide) => touched.has(slide.id) && JSON.stringify(bases.get(slide.id)) !== JSON.stringify(slide))
    .map((slide) => slide.id);
}

/** Current order and metadata win; missing slides are never resurrected. */
export function mergeEditorCommit(deck: Presentation, edited: Slide[]): Presentation {
  const byId = new Map(edited.map((slide) => [slide.id, slide]));
  return { ...deck, slides: deck.slides.map((slide) => byId.get(slide.id) ?? slide) };
}
