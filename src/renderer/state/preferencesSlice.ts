// UndoAction is used in setPresentationName to keep rename in undo history
import { isSfxEnabled, readSfxMuteDuringLive, setSfxEnabled, setSfxMuteDuringLive } from '../sfx';
import { readUiMotionEnabled, writeUiMotionEnabled } from '../uiMotion';

import type { AppSet, AppState } from './storeTypes';

export function createPreferencesSlice(
  set: AppSet
): Pick<
  AppState,
  | 'liveSaveEnabled'
  | 'setLiveSaveEnabled'
  | 'liveSaveRetentionMs'
  | 'setLiveSaveRetentionMs'
  | 'liveSaveLastSaved'
  | 'setLiveSaveLastSaved'
  | 'liveSaveStatus'
  | 'setLiveSaveStatus'
  | 'uiSfxMuteDuringLive'
  | 'setUiSfxMuteDuringLive'
  | 'uiSfxEnabled'
  | 'setUiSfxEnabled'
  | 'sessionSaveStatus'
  | 'setSessionSaveStatus'
  | 'operatorNotesEnabled'
  | 'setOperatorNotesEnabled'
  | 'sectionFilterId'
  | 'setSectionFilterId'
  | 'serviceSectionsEnabled'
  | 'setServiceSectionsEnabled'
  | 'uiMotionEnabled'
  | 'setUiMotionEnabled'
> {
  return {
    liveSaveEnabled: (() => {
      try {
        const v = localStorage.getItem('liveSaveEnabled');
        return v === null ? true : v === '1';
      } catch {
        return true;
      }
    })(),
    setLiveSaveEnabled: (enabled) => {
      try {
        localStorage.setItem('liveSaveEnabled', enabled ? '1' : '0');
      } catch {
        console.warn('canlı kayıt tercihi saklanamadı');
      }
      set({ liveSaveEnabled: enabled });
    },
    liveSaveRetentionMs: (() => {
      try {
        const raw = Number(localStorage.getItem('liveSaveRetentionMs'));
        if (!Number.isFinite(raw) || raw < 0) return 7 * 24 * 60 * 60 * 1000;
        return raw;
      } catch {
        return 7 * 24 * 60 * 60 * 1000;
      }
    })(),
    setLiveSaveRetentionMs: (ms) => {
      const safeMs = Number.isFinite(ms) ? Math.max(0, ms) : 0;
      try {
        localStorage.setItem('liveSaveRetentionMs', String(safeMs));
      } catch {
        console.warn('canlı kayıt saklama süresi kaydedilemedi');
      }
      set({ liveSaveRetentionMs: safeMs });
    },
    liveSaveLastSaved: null,
    setLiveSaveLastSaved: (ts) => set({ liveSaveLastSaved: ts }),
    liveSaveStatus: 'idle',
    setLiveSaveStatus: (status) => set({ liveSaveStatus: status }),
    uiSfxMuteDuringLive: readSfxMuteDuringLive(),
    setUiSfxMuteDuringLive: (enabled) => {
      setSfxMuteDuringLive(enabled);
      set({ uiSfxMuteDuringLive: enabled });
    },
    uiSfxEnabled: isSfxEnabled(),
    setUiSfxEnabled: (enabled) => {
      setSfxEnabled(enabled);
      set({ uiSfxEnabled: enabled });
    },
    sessionSaveStatus: 'idle',
    setSessionSaveStatus: (sessionSaveStatus) => set({ sessionSaveStatus }),
    operatorNotesEnabled: (() => {
      try {
        return localStorage.getItem('operatorNotesEnabled') === '1';
      } catch {
        return false;
      }
    })(),
    setOperatorNotesEnabled: (enabled) => {
      try {
        localStorage.setItem('operatorNotesEnabled', enabled ? '1' : '0');
      } catch {
        /* storage unavailable */
      }
      set({ operatorNotesEnabled: enabled });
    },
    sectionFilterId: '',
    setSectionFilterId: (sectionFilterId) => set({ sectionFilterId }),
    serviceSectionsEnabled: (() => {
      try {
        return localStorage.getItem('serviceSectionsEnabled') === '1';
      } catch {
        return false;
      }
    })(),
    setServiceSectionsEnabled: (enabled) => {
      try {
        localStorage.setItem('serviceSectionsEnabled', enabled ? '1' : '0');
      } catch {
        /* unavailable */
      }
      set({ serviceSectionsEnabled: enabled });
    },
    uiMotionEnabled: readUiMotionEnabled(),
    setUiMotionEnabled: (enabled) => {
      writeUiMotionEnabled(enabled);
      set({ uiMotionEnabled: enabled });
    },
  };
}
