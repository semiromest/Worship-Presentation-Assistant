import type { Presentation, Slide } from '../types';

// ─── Types ────────────────────────────────────────────────────────────────────

export type SlidePatch = {
  id: string;
  prevSlide?: Slide;
  nextSlide?: Slide;
};

export type PresentationPatch = {
  slidesPatch: SlidePatch[];
  prevOrder: string[];
  nextOrder: string[];
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
    patch.prevOrder.length !== patch.nextOrder.length ||
    patch.prevOrder.some((id, i) => id !== patch.nextOrder[i]);
  return (
    patch.slidesPatch.length === 0 &&
    !patch.prevName &&
    !patch.prevZoom &&
    !patch.prevTransition &&
    !orderChanged
  );
}

function slideHasChanged(a: Slide, b: Slide): boolean {
  if (a.type !== b.type) return true;
  if (a.content !== b.content) return true;
  if (a.mediaUrl !== b.mediaUrl) return true;
  if (a.thumbnailUrl !== b.thumbnailUrl) return true;
  if (!shallowEqual(a.styles, b.styles)) return true;
  if (!shallowEqual(a.group, b.group)) return true;
  if (!shallowEqual(a.items ?? [], b.items ?? [])) return true;
  if (!shallowEqual(a.loopItems ?? [], b.loopItems ?? [])) return true;
  if (!shallowEqual(a.loopTransition, b.loopTransition)) return true;
  if (a.gridEnabled !== b.gridEnabled) return true;
  if (a.gridSize !== b.gridSize) return true;
  if (a.snapEnabled !== b.snapEnabled) return true;
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
    name: patch.nextName ?? current.name,
    slides: reordered,
    zoom: patch.nextZoom ?? current.zoom,
    transition: patch.nextTransition ?? current.transition,
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
    name: patch.nextName ?? current.name,
    slides: reordered,
    zoom: patch.nextZoom ?? current.zoom,
    transition: patch.nextTransition ?? current.transition,
  };
}

export function applyInversePatch(current: Presentation, patch: PresentationPatch): Presentation {

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
    name: patch.prevName ?? current.name,
    slides: reordered,
    zoom: patch.prevZoom ?? current.zoom,
    transition: patch.prevTransition ?? current.transition,
  };
}

// ─── Reducer ──────────────────────────────────────────────────────────────────

export function undoReducer(state: UndoState, action: UndoAction): UndoState {
  switch (action.type) {
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
