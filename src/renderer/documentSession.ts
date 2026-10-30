import { useSyncExternalStore } from 'react';
import { useStore } from './state/useStore';
import type { Presentation } from './types';

export function documentSignature(presentation: Presentation): string {
  const document = { ...presentation };
  delete document.liveIndex; delete document.liveSlideId; delete document.zoom;
  return JSON.stringify({ ...document, slides: presentation.slides.map(slide => {
    const rest = { ...slide }; delete rest.activePart;
    return slide.partsMode && slide.parts?.length ? { ...rest, content: slide.parts.join('\n') } : rest;
  }) });
}
let baseline = documentSignature(useStore.getState().presentation);
let snapshot = { dirty: false, path: null as string | null, generation: 0, canDrag: false };
const listeners = new Set<() => void>();
const emit = () => { for (const listener of listeners) listener(); };
let timer: ReturnType<typeof setTimeout> | undefined;
function update() {
  const dirty = documentSignature(useStore.getState().presentation) !== baseline;
  if (dirty !== snapshot.dirty) { snapshot = { ...snapshot, dirty }; emit(); }
}
useStore.subscribe(s => ({ presentation: s.presentation, version: s.editorSessionVersion }), (current, previous) => {
  if (current.presentation.id !== previous.presentation.id || current.version !== previous.version) { snapshot = { ...snapshot, generation: snapshot.generation + 1, path: null, canDrag: false }; emit(); }
  clearTimeout(timer); timer = setTimeout(update, 150);
}, { equalityFn: (a, b) => a.presentation === b.presentation && a.version === b.version });
export const documentSession = {
  current: () => snapshot,
  unsaved() {
    baseline = '';
    snapshot = { dirty: true, path: null, generation: snapshot.generation + 1, canDrag: false };
    emit();
  },
  isDirty() { update(); return snapshot.dirty; },
  opened(file: string | null, signature = documentSignature(useStore.getState().presentation), generation = snapshot.generation) {
    if (generation !== snapshot.generation) return;
    baseline = signature;
    snapshot = { dirty: documentSignature(useStore.getState().presentation) !== baseline, path: file, generation: snapshot.generation + 1, canDrag: false }; emit();
  },
  saved(file: string, signature: string, generation: number) {
    if (generation !== snapshot.generation) return;
    baseline = signature;
    snapshot = { ...snapshot, path: file, canDrag: true, dirty: documentSignature(useStore.getState().presentation) !== baseline }; emit();
  },
};
export function useDocumentSession() {
  return useSyncExternalStore(callback => { listeners.add(callback); return () => { listeners.delete(callback); }; }, () => snapshot);
}
