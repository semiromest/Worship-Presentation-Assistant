import { useSyncExternalStore } from 'react';
import { useStore } from './state/useStore';
import { documentSignature, sameDocument, type DocumentSignature } from './documentFingerprint';
export { documentSignature, sameDocument } from './documentFingerprint';

export interface DocumentSessionSnapshot {
  dirty: boolean;
  path: string | null;
  generation: number;
  canDrag: boolean;
}

const DEBOUNCE_MS = 150;
// documentSignature already caches immutable presentation objects in a WeakMap.
const currentSignature = () => documentSignature(useStore.getState().presentation);
let baseline: DocumentSignature | undefined = currentSignature();
let snapshot: DocumentSessionSnapshot = { dirty: false, path: null, generation: 0, canDrag: false };
const listeners = new Set<() => void>();
const emit = () => { for (const listener of listeners) listener(); };

function commit(next: DocumentSessionSnapshot) {
  if (next.dirty === snapshot.dirty && next.path === snapshot.path
    && next.generation === snapshot.generation && next.canDrag === snapshot.canDrag) return;
  snapshot = next;
  emit();
}

const isDirtyNow = () => baseline === undefined || !sameDocument(baseline, currentSignature());
let timer: ReturnType<typeof setTimeout> | undefined;
function update() {
  clearTimeout(timer);
  timer = undefined;
  const dirty = isDirtyNow();
  if (dirty !== snapshot.dirty) commit({ ...snapshot, dirty });
}
useStore.subscribe((state, previous) => {
  if (state.presentation === previous.presentation && state.editorSessionVersion === previous.editorSessionVersion) return;
  if (state.presentation.id !== previous.presentation.id || state.editorSessionVersion !== previous.editorSessionVersion) {
    commit({ ...snapshot, generation: snapshot.generation + 1, path: null, canDrag: false });
  }
  clearTimeout(timer);
  timer = setTimeout(update, DEBOUNCE_MS);
});
export const documentSession = {
  current: () => snapshot,
  unsaved() {
    baseline = undefined;
    commit({ dirty: true, path: null, generation: snapshot.generation + 1, canDrag: false });
  },
  isDirty() { update(); return snapshot.dirty; },
  opened(file: string | null, signature: DocumentSignature = currentSignature(), generation = snapshot.generation) {
    if (generation !== snapshot.generation) return;
    baseline = signature;
    commit({ dirty: isDirtyNow(), path: file, generation: snapshot.generation + 1, canDrag: false });
  },
  saved(file: string, signature: DocumentSignature, generation: number) {
    if (generation !== snapshot.generation) return;
    baseline = signature;
    commit({ ...snapshot, path: file, canDrag: true, dirty: isDirtyNow() });
  },
};
const subscribe = (callback: () => void) => {
  listeners.add(callback);
  return () => { listeners.delete(callback); };
};
const getSnapshot = () => snapshot;

export function useDocumentSession() {
  return useSyncExternalStore(subscribe, getSnapshot);
}
