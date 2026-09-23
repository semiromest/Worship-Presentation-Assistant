import type { Presentation } from './types';

/** Content equality excludes the live cursor and survives reopening a saved deck. */
export function presentationContentKey(presentation: Presentation): string {
  return JSON.stringify({
    name: presentation.name,
    slides: presentation.slides,
    zoom: presentation.zoom,
    transition: presentation.transition,
  });
}
