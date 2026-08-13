import { useCallback, useEffect, useRef } from 'react';
import { useStore } from '../state/useStore';
import { IS_PROJECTOR_MODE } from '../constants';

export const LIVE_SAVE_PRESET_PREFIX = '__live_autosave_';
export const LIVE_SAVE_PRESET_SUFFIX = '__';
export const DEFAULT_LIVE_SAVE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
export const LIVE_SAVE_RETENTION_OPTIONS = [0, 24 * 60 * 60 * 1000, 7 * 24 * 60 * 60 * 1000, 30 * 24 * 60 * 60 * 1000];

const DEBOUNCE_MS = 400;
const INTERVAL_MS = 30_000;

const getLegacyLiveSavePresetKey = (): string => '__legacy__';

export const isLiveSavePreset = (name: string): boolean => {
  return (
    name === '__live_autosave__' ||
    (
      name.startsWith(LIVE_SAVE_PRESET_PREFIX) &&
      name.endsWith(LIVE_SAVE_PRESET_SUFFIX)
    )
  );
};

export const getLiveSavePresetKey = (presetName: string): string => {
  // Backward compatibility with the old single live-save record.
  if (presetName === '__live_autosave__') {
    return getLegacyLiveSavePresetKey();
  }

  if (!isLiveSavePreset(presetName)) {
    return presetName;
  }

  const withoutPrefix = presetName.slice(LIVE_SAVE_PRESET_PREFIX.length);

  return withoutPrefix.slice(
    0,
    -LIVE_SAVE_PRESET_SUFFIX.length
  );
};

export const getLiveSavePresetName = (
  presentationIdOrName: string
): string => {
  return `${LIVE_SAVE_PRESET_PREFIX}${presentationIdOrName}${LIVE_SAVE_PRESET_SUFFIX}`;
};

export function normalizeVisiblePresets<T extends { name: string }>(
  items: T[]
): T[] {
  return items.filter((item) => !isLiveSavePreset(item.name));
}

export function pruneLiveSaveEntries<
  T extends { name: string; createdAt: number }
>(
  items: T[],
  now = Date.now()
): T[] {
  const regular: T[] = [];
  const latestByKey = new Map<string, T>();

  const retentionMs = Math.max(0, useStore.getState().liveSaveRetentionMs || DEFAULT_LIVE_SAVE_RETENTION_MS);

  for (const item of items) {
    if (!isLiveSavePreset(item.name)) {
      regular.push(item);
      continue;
    }

    const age = now - item.createdAt;

    // Remove live-save records older than the retention period.
    if (retentionMs <= 0 || age > retentionMs) {
      continue;
    }

    const key = getLiveSavePresetKey(item.name);
    const current = latestByKey.get(key);

    // Keep only the newest autosave for each presentation.
    if (!current || item.createdAt > current.createdAt) {
      latestByKey.set(key, item);
    }
  }

  return [
    ...regular,
    ...Array.from(latestByKey.values()),
  ].sort((a, b) => b.createdAt - a.createdAt);
}

const performSave = () => {
  const state = useStore.getState();
  if (!state.liveSaveEnabled || state.liveSaveRetentionMs <= 0) {
    return;
  }

  const presentation = state.presentation;

  const name = getLiveSavePresetName(
    presentation.id || presentation.name
  );

  return window.electronAPI?.savePreset?.({
    name,
    presentation,
    retentionMs: state.liveSaveRetentionMs,
  });
};

/**
 * Automatically saves the current presentation:
 *
 * - 400ms debounce after presentation changes
 * - Every 30 seconds while dirty
 * - Flushes when the document becomes hidden
 * - Attempts a final flush during unload/unmount
 * - Prevents concurrent saves
 * - Preserves changes that happen while a save is in progress
 * - Retries failed saves with the normal debounce delay
 *
 * Live-save records are stored separately from normal presets and
 * can be used for project recovery.
 */
export function useLiveSave(): null {
  const dirtyRef = useRef(false);
  const savingRef = useRef(false);
  const timerRef = useRef<number | null>(null);

  const persist = useCallback(async () => {
    // Live Save is disabled.
    //
    // Do not clear dirtyRef here. If the feature is enabled again,
    // the next interval/change can still trigger a save.
    if (!useStore.getState().liveSaveEnabled) {
      return;
    }

    // A save is already in progress.
    //
    // Keep the dirty flag set so the latest presentation state
    // will be saved again after the current operation completes.
    if (savingRef.current) {
      dirtyRef.current = true;
      return;
    }

    savingRef.current = true;
    dirtyRef.current = false;

    let savedSuccessfully = false;

    try {
      const updated = await performSave();

      if (Array.isArray(updated)) {
        useStore.getState().setPresets(updated);
      }

      useStore.getState().setLiveSaveLastSaved(Date.now());

      savedSuccessfully = true;
    } catch {
      // The presentation has not been safely persisted.
      dirtyRef.current = true;
    } finally {
      savingRef.current = false;

      if (dirtyRef.current) {
        /*
         * If another change happened while saving, immediately
         * save the newest state.
         *
         * If the save itself failed, do NOT immediately recurse.
         * Schedule a retry instead to prevent an infinite retry loop
         * when the filesystem/IPC is unavailable.
         */
        if (savedSuccessfully) {
          void persist();
        } else if (timerRef.current === null) {
          timerRef.current = window.setTimeout(() => {
            timerRef.current = null;

            if (dirtyRef.current) {
              void persist();
            }
          }, DEBOUNCE_MS);
        }
      }
    }
  }, []);

  useEffect(() => {
    if (IS_PROJECTOR_MODE) {
      return;
    }

    const scheduleSave = () => {
      dirtyRef.current = true;

      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }

      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;

        if (dirtyRef.current) {
          void persist();
        }
      }, DEBOUNCE_MS);
    };

    const flush = () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }

      if (dirtyRef.current) {
        void persist();
      }
    };

    /*
     * Safety-net save.
     *
     * The debounce normally handles changes quickly, but this
     * guarantees that a dirty presentation is periodically saved
     * even if something prevents the debounce callback from firing.
     */
    const interval = window.setInterval(() => {
      if (dirtyRef.current && !savingRef.current) {
        void persist();
      }
    }, INTERVAL_MS);

    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        flush();
      }
    };

    const unsubscribe = useStore.subscribe((state, prev) => {
      if (state.presentation !== prev.presentation) {
        scheduleSave();
      }
    });

    /*
     * Best-effort final save before the renderer is unloaded.
     *
     * Important: beforeunload cannot await an async IPC call, so this
     * is a best-effort flush rather than a hard guarantee.
     */
    const onBeforeUnload = () => {
      flush();
    };

    /*
     * pagehide is useful in addition to beforeunload because some
     * environments do not reliably fire beforeunload.
     */
    const onPageHide = () => {
      flush();
    };

    window.addEventListener('beforeunload', onBeforeUnload);
    window.addEventListener('pagehide', onPageHide);
    document.addEventListener(
      'visibilitychange',
      onVisibilityChange
    );

    return () => {
      /*
       * Try to flush the latest state before removing the subscription.
       */
      flush();

      unsubscribe();

      window.clearInterval(interval);

      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }

      window.removeEventListener('beforeunload', onBeforeUnload);
      window.removeEventListener('pagehide', onPageHide);

      document.removeEventListener(
        'visibilitychange',
        onVisibilityChange
      );
    };
  }, [persist]);

  return null;
}