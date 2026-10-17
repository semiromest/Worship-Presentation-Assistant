import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { createMediaSlice } from './mediaSlice';
import { createPreferencesSlice } from './preferencesSlice';
import { createPresentationSlice } from './presentationSlice';
import type { AppState } from './storeTypes';
import { createUiSlice } from './uiSlice';
export type { SlideSelectionUpdate } from './storeTypes';
// UndoAction is used in setPresentationName to keep rename in undo history
import { setSfxLiveOutput } from '../sfx';

export const useStore = create<AppState>()(
  subscribeWithSelector((rawSet) => {
    // Preserve the root snapshot for no-op partial updates, including functional
    // setters. Returning {} would still notify all subscribers after a merge.
    const set = (update: Partial<AppState> | ((state: AppState) => Partial<AppState>)) =>
      rawSet((state) => {
        const patch = typeof update === 'function' ? update(state) : update;
        return patch === state ||
          Object.keys(patch).every((key) => Object.is(state[key as keyof AppState], patch[key as keyof AppState]))
          ? state
          : patch;
      });
    return {
      ...createPresentationSlice(set),
      ...createPreferencesSlice(set),
      ...createMediaSlice(set),
      ...createUiSlice(set),
    };
  })
);

// Only output openness affects the UI sound gate; unrelated UI updates do not.
useStore.subscribe(
  (state) => state.isProjectorWindowOpen || Object.values(state.outputAssignments).some((output) => output.isOpen),
  setSfxLiveOutput,
  { fireImmediately: true }
);
