import { useCallback } from 'react';
import { insertDroppedImages } from '../imageDrop';
import { useStore } from '../state/useStore';
import { playSfx } from '../sfx';

export function useImageDrop() {
  return useCallback(async (files: File[], targetId?: string) => {
    const presentationId = useStore.getState().presentation.id;
    try {
      const paths = (await Promise.all(files.map(file => window.electronAPI.getDroppedImagePath(file))))
        .filter((path): path is string => !!path);
      const state = useStore.getState();
      // Resolve against the current deck so edits made during the bridge call survive.
      if (state.presentation.id !== presentationId) return;
      const next = insertDroppedImages(state.presentation, targetId, paths);
      if (next === state.presentation) return;
      const index = targetId === undefined ? state.presentation.slides.length
        : next.slides.findIndex(slide => slide.id === targetId) + 1;
      const id = next.slides[index].id;
      state.dispatchUndo({ type: 'SET', payload: next });
      state.selectSlides({ activeId: id, ids: new Set([id]), anchorIndex: index });
      playSfx('success');
    } catch (error) {
      console.error('Image drop failed', error);
      playSfx('error');
    }
  }, []);
}
