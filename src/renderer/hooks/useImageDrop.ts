import type { SlideInsertion } from '../../shared/slideInsertion';
import { useCallback } from 'react';
import { insertDroppedImages } from '../imageDrop';
import { useStore } from '../state/useStore';
import { playSfx } from '../sfx';

export function useImageDrop() {
  return useCallback(async (files: File[], targetId?: string | SlideInsertion) => {
    const presentationId = useStore.getState().presentation.id;
    const sessionVersion = useStore.getState().editorSessionVersion;
    try {
      const paths = (await Promise.all(files.map(file => window.electronAPI.getDroppedImagePath(file))))
        .filter((path): path is string => !!path);
      const state = useStore.getState();
      // Resolve against the current deck so edits made during the bridge call survive.
      if (state.presentation.id !== presentationId || state.editorSessionVersion !== sessionVersion) return;
      const next = insertDroppedImages(state.presentation, targetId, paths);
      if (next === state.presentation) return;
      const existing = new Set(state.presentation.slides.map(slide => slide.id));
      const index = next.slides.findIndex(slide => !existing.has(slide.id));
      if (index < 0) return;
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
