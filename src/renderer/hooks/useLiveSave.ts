import { useCallback, useEffect, useRef } from 'react';
import { useStore } from '../state/useStore';
import { IS_PROJECTOR_MODE } from '../constants';

export const LIVE_SAVE_PRESET_NAME = '__live_autosave__';

const DEBOUNCE_MS = 400;
const INTERVAL_MS = 30_000;

const performSave = () => {
  if (!useStore.getState().liveSaveEnabled) return;
  const presentation = useStore.getState().presentation;
  return window.electronAPI?.savePreset?.({ name: LIVE_SAVE_PRESET_NAME, presentation });
};

/**
 * Saves to `__live_autosave__` on every change (400ms debounce) and at a 30s interval,
 * flushing immediately on close. Lets the project be recovered from the Live Save record.
 */
export function useLiveSave(): null {
  const dirtyRef = useRef(false);
  const timerRef = useRef<number | null>(null);

  const persist = useCallback(async () => {
    if (!useStore.getState().liveSaveEnabled) return;
    dirtyRef.current = false;
    try {
      const updated = await performSave();
      if (Array.isArray(updated)) useStore.getState().setPresets(updated);
      useStore.getState().setLiveSaveLastSaved(Date.now());
    } catch {
      dirtyRef.current = true;
    }
  }, []);

  useEffect(() => {
    if (IS_PROJECTOR_MODE) return;

    const onPresentationChange = () => {
      dirtyRef.current = true;
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        void persist();
      }, DEBOUNCE_MS);
    };

    const flush = () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      if (dirtyRef.current) void persist();
    };

    const interval = window.setInterval(() => {
      if (dirtyRef.current) void persist();
    }, INTERVAL_MS);

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush();
    };

    const unsubscribe = useStore.subscribe((state, prev) => {
      if (state.presentation !== prev.presentation) onPresentationChange();
    });

    const onBeforeUnload = () => {
      if (dirtyRef.current) void persist();
    };

    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      unsubscribe();
      window.clearInterval(interval);
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [persist]);

  return null;
}