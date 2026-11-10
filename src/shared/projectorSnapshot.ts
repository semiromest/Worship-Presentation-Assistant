import type { Presentation, Slide } from '../renderer/types';
import type { ProjectorPatch } from '../renderer/state/undoReducer';
export function applyProjectorPatch(current: Presentation, patch: ProjectorPatch): Presentation {
  const byId = new Map(current.slides.map((s) => [s.id, s] as const));

  for (const sp of patch.slidesPatch) {
    if (sp.nextSlide) byId.set(sp.id, sp.nextSlide);
    else byId.delete(sp.id); // removed — id-only entry
  }

  const order = patch.nextOrder ?? current.slides.map((s) => s.id);
  const orderSet = new Set(order);
  const reordered: Slide[] = [];
  for (const id of order) {
    const s = byId.get(id);
    if (s) reordered.push(s);
  }
  for (const s of byId.values()) {
    if (!orderSet.has(s.id)) reordered.push(s);
  }

  return {
    id: current.id,
    ...current,
    sections: patch.nextSections ?? current.sections,
    name: patch.nextName ?? current.name,
    slides: reordered,
    zoom: patch.nextZoom ?? current.zoom,
    transition: patch.nextTransition ?? current.transition,
  };
}

/** Main keeps one reconstructable snapshot per output, so reload does not depend on control readiness. */
export function mergeProjectorSnapshot(previous: Record<string, any> | undefined, update: Record<string, any>): Record<string, any> | undefined {
  const full = update.fullPresentation ?? (previous?.fullPresentation && update.patch
    ? applyProjectorPatch(previous.fullPresentation, update.patch) : previous?.fullPresentation);
  if (!full) return undefined;
  const frame: Record<string, any> = { ...previous, ...update, fullPresentation: full };
  delete frame.patch;
  return frame;
}
