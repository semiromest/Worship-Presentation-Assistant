import { useSyncExternalStore } from 'react';

/**
 * "Show chords on the stage display". Kept in localStorage because the stage
 * display runs in its own window of the same origin; the `storage` event keeps
 * both windows in sync without extra IPC.
 */
const KEY = 'stageChordsEnabled';
const LOCAL_EVENT = 'stage-chords-changed';

export function readStageChordsEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) !== '0';
  } catch {
    return true;
  }
}

export function writeStageChordsEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(KEY, enabled ? '1' : '0');
  } catch {
    /* storage unavailable */
  }
  window.dispatchEvent(new Event(LOCAL_EVENT));
}

function subscribe(callback: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === KEY) callback();
  };
  window.addEventListener('storage', onStorage);
  window.addEventListener(LOCAL_EVENT, callback);
  return () => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener(LOCAL_EVENT, callback);
  };
}

export function useStageChordsEnabled(): boolean {
  return useSyncExternalStore(subscribe, readStageChordsEnabled, () => true);
}
