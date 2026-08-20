import { create } from 'zustand';
import type { SttErrorCode, SttSessionConfig, SttSessionStatus, SttStatus, SttToken } from '../../shared/stt';
import { isAutoSttLanguage, languageName, STT_LANGUAGES } from '../../shared/stt';
import { getSttSettings, updateSttSettings } from '../sttSettings';

export interface SttUtterance {
  id: string;
  original: string;
  translation: string;
  at: number;
}

export interface SttErrorInfo {
  code: SttErrorCode;
  message: string;
}

export interface SttInputDevice {
  id: string;
  label: string;
}

interface SttState {
  // Session / config
  status: SttSessionStatus;
  sessionId: string | null;
  hasKey: boolean;
  keyHint: string | null;
  micActive: boolean;
  /** Spoken-language picker: an ISO code or 'auto' (auto-detect). */
  sttLanguage: string;
  sttLanguageName: string;
  /** One-way translation target language (ISO code). */
  targetLanguage: string;
  targetLanguageName: string;
  /** Whether one-way translation is enabled for the (next) session. */
  translationEnabled: boolean;
  /** Last spoken language detected from the stream (ISO code or null). */
  detectedLanguage: string | null;
  /** Selected audio input device id ('' = system default). */
  inputDeviceId: string;
  /** Discovered audio input devices (mic, headset, …). */
  inputDevices: SttInputDevice[];

  // Live text — current utterance (final tokens since last endpoint)
  currentOriginal: string;
  currentTranslation: string;
  // Live text — provisional (non-final) tokens, replaced on every result
  partialOriginal: string;
  partialTranslation: string;

  // Committed utterance history
  utterances: SttUtterance[];

  // Last finalized utterance, kept on the captions slide after the live
  // fields clear so a delayed translation can still be read.
  lastOriginal: string;
  lastTranslation: string;
  lastAt: number;

  error: SttErrorInfo | null;

  // Actions
  setStatus: (status: SttSessionStatus) => void;
  setSessionId: (id: string | null) => void;
  setKeyStatus: (hasKey: boolean, keyHint: string | null) => void;
  setStatusSnapshot: (snapshot: SttStatus) => void;
  setMicActive: (active: boolean) => void;
  setSttLanguage: (code: string) => void;
  setTargetLanguage: (code: string) => void;
  setTranslationEnabled: (enabled: boolean) => void;
  /** Applies the config of the running session (broadcast) — not persisted. */
  applySessionConfig: (config: SttSessionConfig | null) => void;
  setDetectedLanguage: (code: string | null) => void;
  setInputDeviceId: (id: string) => void;
  setInputDevices: (devices: SttInputDevice[]) => void;
  applyResult: (tokens: SttToken[]) => void;
  sealCurrent: () => void;
  appendLateTranslation: (text: string) => void;
  setError: (error: SttErrorInfo | null) => void;
  clearAll: () => void;
}

function createId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Display name for the STT language picker value ('auto' has no name). */
function sttLanguageDisplayName(code: string): string {
  return isAutoSttLanguage(code) ? '' : languageName(code);
}

/** Keep only language codes Soniox actually recognizes. */
function validLanguage(code: string | null | undefined): string | null {
  if (!code) return null;
  return STT_LANGUAGES.some((l) => l.code === code) ? code : null;
}

export const useSttStore = create<SttState>((set) => {
  const settings = getSttSettings();
  return {
    status: 'idle',
    sessionId: null,
    hasKey: false,
    keyHint: null,
    micActive: false,
    sttLanguage: settings.defaultSttLanguage,
    sttLanguageName: sttLanguageDisplayName(settings.defaultSttLanguage),
    targetLanguage: settings.defaultTargetLanguage,
    targetLanguageName: languageName(settings.defaultTargetLanguage),
    translationEnabled: settings.translationEnabled,
    detectedLanguage: null,
    inputDeviceId: settings.defaultInputDeviceId,
    inputDevices: [],

    currentOriginal: '',
    currentTranslation: '',
    partialOriginal: '',
    partialTranslation: '',

    utterances: [],
    lastOriginal: '',
    lastTranslation: '',
    lastAt: 0,

    error: null,

    setStatus: (status) => set({ status }),
    setSessionId: (sessionId) => set({ sessionId }),
    setKeyStatus: (hasKey, keyHint) => set({ hasKey, keyHint }),
    setStatusSnapshot: (snapshot) =>
      set({
        hasKey: snapshot.hasKey,
        keyHint: snapshot.keyHint,
        status: snapshot.sessionStatus,
        sessionId: snapshot.sessionId,
        ...(snapshot.config
          ? {
              sttLanguage: snapshot.config.sttLanguage,
              sttLanguageName: sttLanguageDisplayName(snapshot.config.sttLanguage),
              targetLanguage: snapshot.config.targetLanguage,
              targetLanguageName: languageName(snapshot.config.targetLanguage),
              translationEnabled: snapshot.config.translationEnabled,
            }
          : {}),
      }),

    setMicActive: (micActive) => set({ micActive }),

    // Language/translation settings persist so they survive restarts. They are
    // applied when the next session starts (Soniox fixes them at session
    // creation), which is why they are locked while a session is active.
    setSttLanguage: (sttLanguage) =>
      set((state) => {
        updateSttSettings({ defaultSttLanguage: sttLanguage });
        return { sttLanguage, sttLanguageName: sttLanguageDisplayName(sttLanguage) };
      }),
    setTargetLanguage: (targetLanguage) =>
      set((state) => {
        updateSttSettings({ defaultTargetLanguage: targetLanguage });
        return { targetLanguage, targetLanguageName: languageName(targetLanguage) };
      }),
    setTranslationEnabled: (translationEnabled) =>
      set((state) => {
        updateSttSettings({ translationEnabled });
        return { translationEnabled };
      }),

    applySessionConfig: (config) =>
      config
        ? set({
            sttLanguage: config.sttLanguage,
            sttLanguageName: sttLanguageDisplayName(config.sttLanguage),
            targetLanguage: config.targetLanguage,
            targetLanguageName: languageName(config.targetLanguage),
            translationEnabled: config.translationEnabled,
          })
        : set({}),

    setDetectedLanguage: (detectedLanguage) => set({ detectedLanguage }),

    setInputDeviceId: (inputDeviceId) => {
      updateSttSettings({ defaultInputDeviceId: inputDeviceId });
      set({ inputDeviceId });
    },
    setInputDevices: (inputDevices) => set({ inputDevices }),

    applyResult: (tokens) =>
      set((state) => {
        let currentOriginal = state.currentOriginal;
        let currentTranslation = state.currentTranslation;
        let partialOriginal = '';
        let partialTranslation = '';
        let detectedLanguage = state.detectedLanguage;

        for (const t of tokens) {
          if (!t.text) continue;
          // Remember the spoken language seen in this stream (original tokens
          // carry it; translation tokens carry the source language instead).
          const spoken = validLanguage(t.translationStatus === 'translation' ? t.sourceLanguage : t.language);
          if (spoken) detectedLanguage = spoken;

          if (t.translationStatus === 'translation') {
            if (t.isFinal) currentTranslation += t.text;
            else partialTranslation += t.text;
          } else {
            // 'original' or 'none' — spoken text
            if (t.isFinal) currentOriginal += t.text;
            else partialOriginal += t.text;
          }
        }

        return { currentOriginal, currentTranslation, partialOriginal, partialTranslation, detectedLanguage };
      }),

    // Seal the current utterance into history. Unlike a plain "commit", this
    // mirrors the sealed text into lastOriginal/lastTranslation so the captions
    // slide keeps showing it after the live fields are cleared (the slide
    // falls back to these fields while the delayed translation is in flight).
    sealCurrent: () =>
      set((state) => {
        const original = state.currentOriginal.trim();
        const translation = state.currentTranslation.trim();
        const hasText = original.length > 0 || translation.length > 0;
        if (!hasText) {
          return {
            currentOriginal: '',
            currentTranslation: '',
            partialOriginal: '',
            partialTranslation: '',
          };
        }
        const at = Date.now();
        return {
          currentOriginal: '',
          currentTranslation: '',
          partialOriginal: '',
          partialTranslation: '',
          lastOriginal: original,
          lastTranslation: translation,
          lastAt: at,
          utterances: [
            ...state.utterances.slice(-49),
            { id: createId(), original, translation, at },
          ],
        };
      }),

    // Final translation tokens that arrive after the utterance was already
    // sealed are appended to the most recent utterance instead of being
    // dropped or mixed into the next utterance.
    appendLateTranslation: (text) =>
      set((state) => {
        if (state.utterances.length === 0) {
          // Nothing sealed yet — treat it as the current live translation.
          return { currentTranslation: state.currentTranslation + text };
        }
        const last = state.utterances[state.utterances.length - 1];
        const translation = last.translation + text;
        const updated = { ...last, translation };
        return {
          utterances: [...state.utterances.slice(0, -1), updated],
          lastTranslation: translation,
        };
      }),

    setError: (error) => set({ error }),
    clearAll: () =>
      set({
        currentOriginal: '',
        currentTranslation: '',
        partialOriginal: '',
        partialTranslation: '',
        utterances: [],
        lastOriginal: '',
        lastTranslation: '',
        lastAt: 0,
        detectedLanguage: null,
        error: null,
      }),
  };
});

/** Re-syncs the store with the main process (key configured? session active?). */
export async function refreshSttStatus(): Promise<void> {
  try {
    const snapshot = await window.electronAPI?.sttGetStatus?.();
    if (snapshot) {
      useSttStore.getState().setStatusSnapshot(snapshot);
    }
  } catch {
    // Electron API unavailable (e.g. plain web preview) — keep current state.
  }
}
