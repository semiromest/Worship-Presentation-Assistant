import { useSyncExternalStore } from 'react';

const LOCAL_EVENT = 'stage-display-preferences-changed';

function stagePreference(key: string, legacyKeys: string[] = []) {
  let sessionOverride: boolean | undefined;
  const read = () => {
    if (sessionOverride !== undefined) return sessionOverride;
    try {
      const stored = localStorage.getItem(key);
      if (stored !== null) return stored !== '0';
      return !legacyKeys.some((previous) => localStorage.getItem(previous) === '0');
    } catch {
      return true;
    }
  };
  const write = (enabled: boolean) => {
    try {
      localStorage.setItem(key, enabled ? '1' : '0');
      sessionOverride = undefined;
    } catch {
      sessionOverride = enabled;
    }
    window.dispatchEvent(new Event(LOCAL_EVENT));
  };
  const subscribe = (callback: () => void) => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== key && event.key !== null) return;
      sessionOverride = undefined;
      callback();
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener(LOCAL_EVENT, callback);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(LOCAL_EVENT, callback);
    };
  };
  const useEnabled = () => useSyncExternalStore(subscribe, read, () => true);
  return { useEnabled, write };
}

export const { useEnabled: useStageNotesEnabled, write: writeStageNotesEnabled } =
  stagePreference('stageNotesEnabled', ['operatorNotesEnabled', 'stageChordsEnabled']);
export const { useEnabled: useStageNextSlideEnabled, write: writeStageNextSlideEnabled } =
  stagePreference('stageNextSlideEnabled');
