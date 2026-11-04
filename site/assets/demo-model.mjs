export const themes = ['dawn', 'ocean', 'night', 'plain'];
let sequence = 0;
function newSlide(source) {
  return { id: `demo-${Date.now().toString(36)}-${++sequence}`, type: 'text', text: '', title: '', fontSize: 52, align: 'center', theme: 'dawn', activePart: 0, ...source };
}
export function createDeck(initial) {
  let state = { slides: initial.map(source => newSlide(structuredClone(source))), selected: '', live: '', black: false };
  state.selected = state.live = state.slides[0]?.id ?? '';
  const past = [], future = [];
  const clone = () => structuredClone(state);
  const selected = () => state.slides.find(slide => slide.id === state.selected);
  function change(mutate) {
    const before = clone();
    if (mutate() === false) return false;
    past.push(before); if (past.length > 60) past.shift(); future.length = 0; return true;
  }
  function restore(snapshot) {
    // Undo edits without unexpectedly changing the audience's live cue or blackout.
    const live = state.live, black = state.black;
    state = snapshot;
    state.live = state.slides.some(slide => slide.id === live) ? live : state.slides[0]?.id ?? '';
    state.black = black;
  }
  return {
    get state() { return state; }, get canUndo() { return past.length > 0; }, get canRedo() { return future.length > 0; },
    selected,
    select(id) { if (state.slides.some(slide => slide.id === id)) state.selected = id; },
    cue(id = state.selected) { if (state.slides.some(slide => slide.id === id)) { state.live = id; state.black = false; } },
    toggleBlack() { state.black = !state.black; },
    add(source) { return change(() => { const slide = newSlide(structuredClone(source)); const index = state.slides.findIndex(item => item.id === state.selected); state.slides.splice(index + 1, 0, slide); state.selected = slide.id; }); },
    update(patch) { return change(() => {
      const slide = selected(); if (!slide) return false;
      Object.assign(slide, patch);
      if (typeof patch.text === 'string' && slide.parts?.length) slide.parts[slide.activePart] = patch.text;
    }); },
    duplicate() { const slide = selected(); if (!slide) return false; const copy = structuredClone(slide); delete copy.id; return this.add(copy); },
    remove() { return change(() => {
      if (state.slides.length < 2) return false;
      const index = state.slides.findIndex(slide => slide.id === state.selected); if (index < 0) return false;
      const [removed] = state.slides.splice(index, 1);
      state.selected = state.slides[Math.min(index, state.slides.length - 1)].id;
      if (state.live === removed.id) state.live = state.selected;
    }); },
    move(direction) { return change(() => {
      const index = state.slides.findIndex(slide => slide.id === state.selected), next = index + direction;
      if (index < 0 || next < 0 || next >= state.slides.length) return false;
      const [slide] = state.slides.splice(index, 1); state.slides.splice(next, 0, slide);
    }); },
    part(index, id = state.selected) { const slide = state.slides.find(item => item.id === id); if (!slide?.parts?.length) return;
      slide.activePart = Math.max(0, Math.min(slide.parts.length - 1, index)); slide.text = slide.parts[slide.activePart];
    },
    split(offset) { return change(() => {
      const slide = selected(); if (!slide || slide.type !== 'text' || !Number.isInteger(offset)) return false;
      const left = slide.text.slice(0, offset).trimEnd(), right = slide.text.slice(offset).trimStart();
      if (!left.trim() || !right.trim()) return false;
      const parts = slide.parts ?? [slide.text];
      const index = slide.activePart ?? 0; slide.parts = [...parts.slice(0, index), left, right, ...parts.slice(index + 1)];
      slide.activePart = index; slide.text = left;
    }); },
    navigate(direction, live = false) { const key = live ? 'live' : 'selected'; const index = state.slides.findIndex(slide => slide.id === state[key]); state[key] = state.slides[Math.max(0, Math.min(state.slides.length - 1, index + direction))].id; },
    undo() { if (!past.length) return false; future.push(clone()); restore(past.pop()); return true; },
    redo() { if (!future.length) return false; past.push(clone()); restore(future.pop()); return true; },
  };
}
