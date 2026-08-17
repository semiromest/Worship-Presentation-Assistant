import { useCallback, useEffect, useRef } from 'react';
import { useStore } from '../state/useStore';
import { IS_PROJECTOR_MODE } from '../constants';
import type { Presentation } from '../types';

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

/** Current live-save retention in ms (0 = keep forever). */
export const getLiveSaveRetention = (): number =>
  useStore.getState().liveSaveRetentionMs;

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

  // 0 means "keep forever" — never coerce it to the default via `||`.
  const retentionMs = useStore.getState().liveSaveRetentionMs ?? DEFAULT_LIVE_SAVE_RETENTION_MS;

  for (const item of items) {
    if (!isLiveSavePreset(item.name)) {
      regular.push(item);
      continue;
    }

    const age = now - item.createdAt;

    // retentionMs <= 0 means "keep forever" — only age-prune when > 0.
    if (retentionMs > 0 && age > retentionMs) {
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
  if (!state.liveSaveEnabled) {
    return;
  }

  const presentation = state.presentation;

  const name = getLiveSavePresetName(
    presentation.id || presentation.name
  );

  return window.electronAPI?.savePreset?.({
    name,
    // Persist the live slide position too, so a backup can resume
    // exactly where the service left off.
    presentation: { ...presentation, liveIndex: state.liveIndex },
    retentionMs: state.liveSaveRetentionMs,
  });
};

// ─── Crash fallback (localStorage snapshot) ───────────────────────────────
//
// IPC saves are async, so on unload/pagehide the write may not finish before
// the renderer is torn down. A tiny synchronous snapshot in localStorage
// guarantees the latest state survives; it is merged back into the preset
// store on next launch (only if newer than the on-disk backup).

const FALLBACK_KEY = 'liveSaveFallback';

interface FallbackSnapshot {
  savedAt: number;
  presentation: Presentation;
}

function readFallback(): FallbackSnapshot | null {
  try {
    const raw = localStorage.getItem(FALLBACK_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<FallbackSnapshot>;
    if (!parsed.presentation || typeof parsed.savedAt !== 'number') return null;
    return { savedAt: parsed.savedAt, presentation: parsed.presentation };
  } catch {
    return null;
  }
}

function writeFallback(): void {
  const state = useStore.getState();
  if (!state.liveSaveEnabled) return;
  try {
    const snapshot: FallbackSnapshot = {
      savedAt: Date.now(),
      presentation: { ...state.presentation, liveIndex: state.liveIndex },
    };
    localStorage.setItem(FALLBACK_KEY, JSON.stringify(snapshot));
  } catch {
    // Storage may be unavailable (private mode / quota) — the IPC save still runs.
    console.debug('live save: fallback snapshot write failed');
  }
}

function clearFallback(): void {
  try {
    localStorage.removeItem(FALLBACK_KEY);
  } catch {
    // Best-effort cleanup; a stale snapshot is ignored on read anyway.
    console.debug('live save: fallback snapshot clear failed');
  }
}

/**
 * Merges a crash snapshot back into the preset store on startup — but only
 * when it is newer than the matching on-disk live-save record.
 */
async function recoverFallback(): Promise<void> {
  const state = useStore.getState();
  if (!state.liveSaveEnabled) {
    clearFallback();
    return;
  }

  const snapshot = readFallback();
  if (!snapshot) return;

  try {
    const list = await window.electronAPI?.loadPresets?.(
      state.liveSaveRetentionMs
    );
    if (!Array.isArray(list)) {
      clearFallback();
      return;
    }

    const name = getLiveSavePresetName(
      snapshot.presentation.id || snapshot.presentation.name
    );
    const key = getLiveSavePresetKey(name);
    const existing = list.find(
      (p) => isLiveSavePreset(p.name) && getLiveSavePresetKey(p.name) === key
    );

    // The on-disk backup is at least as fresh — nothing to recover.
    if (existing && existing.createdAt >= snapshot.savedAt) {
      clearFallback();
      return;
    }

    const updated = await window.electronAPI?.savePreset?.({
      name,
      presentation: snapshot.presentation,
      retentionMs: state.liveSaveRetentionMs,
    });
    if (Array.isArray(updated)) {
      useStore.getState().setPresets(updated);
      clearFallback();
    }
    // If the IPC call failed (updated === undefined) the snapshot is kept
    // so recovery can be retried on the next launch.
  } catch {
    // Keep the snapshot for a future launch.
  }
}

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
      // Feature is off — don't keep stale crash snapshots around.
      clearFallback();
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

    // Merge any crash snapshot from a previous session (if newer than disk).
    void recoverFallback();

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
        // Synchronous safety net for the async IPC save.
        writeFallback();
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
      if (
        state.presentation !== prev.presentation ||
        state.liveIndex !== prev.liveIndex
      ) {
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