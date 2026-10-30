import type { Presentation, Slide } from '../types';
import { withSlideContent } from '../../shared/slideContent';
import { backgroundPatch } from '../gradientBackground';
import { DEFAULT_STYLES } from '../defaultSlideStyles';
import { retainSlideTopology, slideTopology } from './slideTopology';

// ─── Types ────────────────────────────────────────────────────────────────────

export type SlidePatch = {
  id: string;
  prevSlide?: Slide;
  nextSlide?: Slide;
};

export type PresentationPatch = {
  editOnly?: true;
  slidesPatch: SlidePatch[];
  prevOrder: string[];
  nextOrder: string[];
  prevSections?: Presentation['sections'];
  nextSections?: Presentation['sections'];
  prevName?: string;
  nextName?: string;
  prevZoom?: number;
  nextZoom?: number;
  prevTransition?: Presentation['transition'];
  nextTransition?: Presentation['transition'];
};

export type UndoState = {
  past: PresentationPatch[];
  present: Presentation;
  future: PresentationPatch[];
};

export type UndoAction =
  | { type: 'SET'; payload: Presentation }
  | { type: 'EDIT_SLIDES'; ids: string[]; edit:
      | { kind: 'content'; content: string }
      | { kind: 'styles'; styles: Partial<NonNullable<Slide['styles']>> } }
  | { type: 'UNDO' }
  | { type: 'REDO' }
  | { type: 'RESET'; payload: Presentation };

/**
 * Projector-only delta (Phase 4): carries only what the projector needs to
 * advance its state — nextSlide for changed/added slides (no prevSlide, since
 * the projector never undoes), id-only entries for removed slides, and the new
 * order/name/transition only when they actually change.
 */
export type ProjectorPatch = {
  nextSections?: Presentation['sections'];
  slidesPatch: { id: string; nextSlide?: Slide }[];
  nextOrder?: string[];
  nextName?: string;
  nextZoom?: number;
  nextTransition?: Presentation['transition'];
};

export const MAX_HISTORY = 50;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function shallowEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const keysA = Object.keys(a as Record<string, unknown>);
  const keysB = Object.keys(b as Record<string, unknown>);
  if (keysA.length !== keysB.length) return false;
  for (const key of keysA) {
    if ((a as Record<string, unknown>)[key] !== (b as Record<string, unknown>)[key]) return false;
  }
  return true;
}

export function isPatchEmpty(patch: PresentationPatch): boolean {
  const orderChanged =
    patch.prevOrder !== patch.nextOrder && (
      patch.prevOrder.length !== patch.nextOrder.length ||
      patch.prevOrder.some((id, i) => id !== patch.nextOrder[i]));
  return (
    patch.slidesPatch.length === 0 &&
    patch.nextSections === undefined &&
    !patch.prevName &&
    !patch.prevZoom &&
    !patch.prevTransition &&
    !patch.nextTransition &&
    !orderChanged
  );
}

function slideHasChanged(a: Slide, b: Slide): boolean {
  if (a === b) return false;
  if (a.type !== b.type) return true;
  if (a.content !== b.content) return true;
  if (a.mediaUrl !== b.mediaUrl) return true;
    if (!shallowEqual(a.youtubeMusic, b.youtubeMusic)) return true;
    if (!shallowEqual(a.musicSettings, b.musicSettings)) return true;
  if (a.thumbnailUrl !== b.thumbnailUrl) return true;
  if (!shallowEqual(a.videoPlayback, b.videoPlayback)) return true;
  if (!shallowEqual(a.videoOverlays ?? [], b.videoOverlays ?? [])) return true;
  if (!shallowEqual(a.styles, b.styles)) return true;
  if (!shallowEqual(a.group, b.group)) return true;
  if (!shallowEqual(a.items ?? [], b.items ?? [])) return true;
  if (!shallowEqual(a.loopItems ?? [], b.loopItems ?? [])) return true;
  if (!shallowEqual(a.loopTransition, b.loopTransition)) return true;
  if (!shallowEqual(a.captions, b.captions)) return true;
  if (!shallowEqual(a.parts ?? [], b.parts ?? [])) return true;
  if (a.partsMode !== b.partsMode) return true;
  if (a.activePart !== b.activePart) return true;
  if (a.gridEnabled !== b.gridEnabled) return true;
  if (a.gridSize !== b.gridSize) return true;
  if (a.gridColor !== b.gridColor) return true;
  if (a.snapEnabled !== b.snapEnabled) return true;
  if (a.locked !== b.locked) return true;
  if (a.operatorNotes !== b.operatorNotes) return true;
  if (a.sectionId !== b.sectionId) return true;
  if (!shallowEqual(a.section, b.section)) return true;
  return false;
}

export function computePatch(prev: Presentation, next: Presentation): PresentationPatch {
  const prevSlides = prev.slides;
  const nextSlides = next.slides;

  const prevMap = new Map(prevSlides.map(s => [s.id, s]));
  const nextMap = new Map(nextSlides.map(s => [s.id, s]));

  const slidesPatch: SlidePatch[] = [];

  // Removed slides
  for (const s of prevSlides) {
    if (!nextMap.has(s.id)) {
      slidesPatch.push({ id: s.id, prevSlide: s });
    }
  }

  // Added slides
  for (const s of nextSlides) {
    if (!prevMap.has(s.id)) {
      slidesPatch.push({ id: s.id, nextSlide: s });
    }
  }

  // Changed slides
  for (const s of nextSlides) {
    const prevS = prevMap.get(s.id);
    if (prevS && slideHasChanged(prevS, s)) {
      slidesPatch.push({ id: s.id, prevSlide: prevS, nextSlide: s });
    }
  }

  const patch: PresentationPatch = {
    slidesPatch,
    prevOrder: prevSlides.map(s => s.id),
    nextOrder: nextSlides.map(s => s.id),
  };

  if (prev.sections !== next.sections && JSON.stringify(prev.sections) !== JSON.stringify(next.sections)) {
    patch.prevSections = prev.sections ?? [];
    patch.nextSections = next.sections ?? [];
  }

  if (prev.name !== next.name) {
    patch.prevName = prev.name;
    patch.nextName = next.name;
  }

  if (prev.zoom !== next.zoom) {
    patch.prevZoom = prev.zoom;
    patch.nextZoom = next.zoom;
  }

  if (!shallowEqual(prev.transition, next.transition)) {
    patch.prevTransition = prev.transition;
    patch.nextTransition = next.transition;
  }

  return patch;
}

export function applyPatch(current: Presentation, patch: PresentationPatch): Presentation {
  if (patch.editOnly) return applyEditPatch(current, patch, false);
  // Map-based rebuild: the old findIndex/filter version was O(n²) on reorder
  // patches (measured ~65 ms for a 5000-slide undo/redo, see perf/bench.ts).
  const byId = new Map(current.slides.map(s => [s.id, s] as const));

  for (const sp of patch.slidesPatch) {
    if (sp.nextSlide && sp.prevSlide) {
      byId.set(sp.id, sp.nextSlide);
    } else if (sp.nextSlide && !sp.prevSlide) {
      byId.set(sp.id, sp.nextSlide); // positioned via nextOrder below
    } else if (sp.prevSlide && !sp.nextSlide) {
      byId.delete(sp.id);
    }
  }

  const nextSet = new Set(patch.nextOrder);
  const reordered: Slide[] = [];
  for (const id of patch.nextOrder) {
    const s = byId.get(id);
    if (s) reordered.push(s);
  }
  for (const s of byId.values()) {
    if (!nextSet.has(s.id)) reordered.push(s);
  }

  return {
    id: current.id, // keep deck identity — undo/redo must not change it (live-save keys on presentation.id)
    ...current,
    sections: patch.nextSections ?? current.sections,
    name: patch.nextName ?? current.name,
    slides: reordered,
    zoom: patch.nextZoom ?? current.zoom,
    transition: 'nextTransition' in patch ? patch.nextTransition : current.transition,
  };
}

/**
 * Applies a projector delta to `current` WITHOUT touching undo history.
 * Differs from applyPatch: removed slides are signalled by an id-only entry
 * (no prevSlide needed), and the result preserves `current.id` (applyPatch
 * rebuilds the object without it).
 */
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

export function applyInversePatch(current: Presentation, patch: PresentationPatch): Presentation {
  if (patch.editOnly) return applyEditPatch(current, patch, true);

  const byId = new Map(current.slides.map(s => [s.id, s] as const));

  for (const sp of patch.slidesPatch) {
    if (sp.prevSlide && sp.nextSlide) {
      byId.set(sp.id, sp.prevSlide);
    } else if (sp.prevSlide && !sp.nextSlide) {
      byId.set(sp.id, sp.prevSlide); // positioned via prevOrder below
    } else if (sp.nextSlide && !sp.prevSlide) {
      byId.delete(sp.id);
    }
  }

  const prevSet = new Set(patch.prevOrder);
  const reordered: Slide[] = [];
  for (const id of patch.prevOrder) {
    const s = byId.get(id);
    if (s) reordered.push(s);
  }
  for (const s of byId.values()) {
    if (!prevSet.has(s.id)) reordered.push(s);
  }

  return {
    id: current.id, // keep deck identity — undo/redo must not change it (live-save keys on presentation.id)
    ...current,
    sections: patch.prevSections ?? current.sections,
    name: patch.prevName ?? current.name,
    slides: reordered,
    zoom: patch.prevZoom ?? current.zoom,
    transition: 'prevTransition' in patch ? patch.prevTransition : current.transition,
  };
}

// ─── Reducer ──────────────────────────────────────────────────────────────────

function applyEditPatch(current: Presentation, patch: PresentationPatch, inverse: boolean): Presentation {
  const { index } = slideTopology(current.slides);
  const slides = current.slides.slice();
  for (const change of patch.slidesPatch) {
    const position = index.get(change.id);
    const slide = inverse ? change.prevSlide : change.nextSlide;
    if (position !== undefined && slide) slides[position] = slide;
  }
  retainSlideTopology(current.slides, slides);
  return { ...current, slides };
}

export function undoReducer(state: UndoState, action: UndoAction): UndoState {
  switch (action.type) {
    case 'EDIT_SLIDES': {
      // This action cannot change section membership, order, IDs or locks, so
      // normalization and full-deck diffing are unnecessary.
      const { index, order } = slideTopology(state.present.slides);
      const slidesPatch: SlidePatch[] = [];
      for (const id of new Set(action.ids)) {
        const position = index.get(id);
        if (position === undefined) continue;
        const prevSlide = state.present.slides[position];
        const nextSlide = action.edit.kind === 'content'
          ? withSlideContent(prevSlide, action.edit.content)
          : { ...prevSlide, styles: backgroundPatch(
              { ...DEFAULT_STYLES, ...prevSlide.styles }, action.edit.styles
            ) as Slide['styles'] };
        if (slideHasChanged(prevSlide, nextSlide)) slidesPatch.push({ id, prevSlide, nextSlide });
      }
      if (!slidesPatch.length) return state;
      const patch: PresentationPatch = { editOnly: true, slidesPatch, prevOrder: order, nextOrder: order };
      const present = applyEditPatch(state.present, patch, false);
      return { past: [...state.past, patch].slice(-MAX_HISTORY), present, future: [] };
    }
    case 'SET': {
      const newPresent = action.payload;
      if (newPresent === state.present) return state;

      const patch = computePatch(state.present, newPresent);

      // If nothing changed, skip
      if (isPatchEmpty(patch)) return state;

      return {
        past: [...state.past, patch].slice(-MAX_HISTORY),
        present: newPresent,
        future: [],
      };
    }
    case 'UNDO': {
      if (state.past.length === 0) return state;
      const patch = state.past[state.past.length - 1];
      const previous = applyInversePatch(state.present, patch);
      return {
        past: state.past.slice(0, -1),
        present: previous,
        future: [patch, ...state.future],
      };
    }
    case 'REDO': {
      if (state.future.length === 0) return state;
      const patch = state.future[0];
      const next = applyPatch(state.present, patch);
      return {
        past: [...state.past, patch],
        present: next,
        future: state.future.slice(1),
      };
    }
    case 'RESET':
      return {
        past: [],
        present: action.payload,
        future: [],
      };
    default:
      return state;
  }
}
