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

export const MAX_HISTORY = 50;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function slideHasChanged(a: Slide, b: Slide): boolean {
  if (a.type !== b.type) return true;
  if (a.content !== b.content) return true;
  if (a.mediaUrl !== b.mediaUrl) return true;
  if (a.thumbnailUrl !== b.thumbnailUrl) return true;
  if (JSON.stringify(a.styles) !== JSON.stringify(b.styles)) return true;
  if (JSON.stringify(a.group) !== JSON.stringify(b.group)) return true;
  if (JSON.stringify(a.items ?? []) !== JSON.stringify(b.items ?? [])) return true;
  if (JSON.stringify(a.loopItems ?? []) !== JSON.stringify(b.loopItems ?? [])) return true;
  if (JSON.stringify(a.loopTransition) !== JSON.stringify(b.loopTransition)) return true;
  if (a.gridEnabled !== b.gridEnabled) return true;
  if (a.gridSize !== b.gridSize) return true;
  if (a.snapEnabled !== b.snapEnabled) return true;
  return false;
}

function computePatch(prev: Presentation, next: Presentation): PresentationPatch {
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

  if (JSON.stringify(prev.transition) !== JSON.stringify(next.transition)) {
    patch.prevTransition = prev.transition;
    patch.nextTransition = next.transition;
  }

  return patch;
}

function applyPatch(current: Presentation, patch: PresentationPatch): Presentation {
  let slides = [...current.slides];

  for (const sp of patch.slidesPatch) {
    if (sp.nextSlide && sp.prevSlide) {
      const idx = slides.findIndex(s => s.id === sp.id);
      if (idx !== -1) slides[idx] = sp.nextSlide;
    } else if (sp.nextSlide && !sp.prevSlide) {
      const pos = patch.nextOrder.indexOf(sp.id);
      if (pos !== -1) {
        slides.splice(pos, 0, sp.nextSlide);
      } else {
        slides.push(sp.nextSlide);
      }
    } else if (sp.prevSlide && !sp.nextSlide) {
      slides = slides.filter(s => s.id !== sp.id);
    }
  }

  const nextSet = new Set(patch.nextOrder);
  const reordered: Slide[] = [];
  for (const id of patch.nextOrder) {
    const s = slides.find(s => s.id === id);
    if (s) reordered.push(s);
  }
  for (const s of slides) {
    if (!nextSet.has(s.id)) reordered.push(s);
  }

  return {
    name: patch.nextName ?? current.name,
    slides: reordered,
    transition: patch.nextTransition ?? current.transition,
  };
}

function applyInversePatch(current: Presentation, patch: PresentationPatch): Presentation {
  let slides = [...current.slides];

  for (const sp of patch.slidesPatch) {
    if (sp.prevSlide && sp.nextSlide) {
      const idx = slides.findIndex(s => s.id === sp.id);
      if (idx !== -1) slides[idx] = sp.prevSlide;
    } else if (sp.prevSlide && !sp.nextSlide) {
      const pos = patch.prevOrder.indexOf(sp.id);
      if (pos !== -1) {
        slides.splice(pos, 0, sp.prevSlide);
      } else {
        slides.push(sp.prevSlide);
      }
    } else if (sp.nextSlide && !sp.prevSlide) {
      slides = slides.filter(s => s.id !== sp.id);
    }
  }

  const prevSet = new Set(patch.prevOrder);
  const reordered: Slide[] = [];
  for (const id of patch.prevOrder) {
    const s = slides.find(s => s.id === id);
    if (s) reordered.push(s);
  }
  for (const s of slides) {
    if (!prevSet.has(s.id)) reordered.push(s);
  }

  return {
    name: patch.prevName ?? current.name,
    slides: reordered,
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

      const orderChanged =
        patch.prevOrder.length !== patch.nextOrder.length ||
        patch.prevOrder.some((id, i) => id !== patch.nextOrder[i]);

      // If nothing changed, skip
      if (
        patch.slidesPatch.length === 0 &&
        !patch.prevName &&
        !patch.prevTransition &&
        !orderChanged
      ) return state;

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
