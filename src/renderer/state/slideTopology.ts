import type { Slide } from '../types';

// Content/style edits retain order. Share the index and order across those
// array copies; weak keys let closed decks and discarded history be collected.
type Topology = { index: Map<string, number>; order: string[] };
const topology = new WeakMap<Slide[], Topology>();

export function slideTopology(slides: Slide[]): Topology {
  let found = topology.get(slides);
  if (!found) {
    found = { index: new Map(), order: [] };
    slides.forEach((slide, index) => {
      found!.index.set(slide.id, index);
      found!.order.push(slide.id);
    });
    topology.set(slides, found);
  }
  return found;
}

/** Only call after replacing slides without changing their IDs or positions. */
export function retainSlideTopology(previous: Slide[], next: Slide[]): void {
  topology.set(next, slideTopology(previous));
}
