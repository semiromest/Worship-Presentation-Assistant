import type { CaptionSnapshot } from '../../shared/captions';
import { create } from 'zustand';
import type { SttErrorCode, SttSessionConfig, SttSessionStatus, SttStatus, SttToken } from '../../shared/stt';
import { isAutoSttLanguage, languageName, STT_LANGUAGES } from '../../shared/stt';
import { getSttSettings, updateSttSettings } from '../sttSettings';

export interface SttUtterance {
  id: string;
  original: string;
  translation: string;
  translations?: Record<string, string>;
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
  /** One-way translation target languages (ISO codes). */
  targetLanguages: string[];
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
  currentTranslations: Record<string, string>;
  // Live text — provisional (non-final) tokens, replaced on every result
  partialOriginal: string;
  partialTranslation: string;
  partialTranslations: Record<string, string>;

  // Committed utterance history
  utterances: SttUtterance[];

  // Last finalized utterance, kept on the captions slide after the live
  // fields clear so a delayed translation can still be read.
  lastOriginal: string;
  lastTranslation: string;
  lastTranslations: Record<string, string>;
  lastAt: number;

  error: SttErrorInfo | null;

  setCaptions: (snapshot: CaptionSnapshot) => void;

  // Actions
  setStatus: (status: SttSessionStatus) => void;
  setSessionId: (id: string | null) => void;
  setKeyStatus: (hasKey: boolean, keyHint: string | null) => void;
  setStatusSnapshot: (snapshot: SttStatus) => void;
  setMicActive: (active: boolean) => void;
  setSttLanguage: (code: string) => void;
  setTargetLanguage: (code: string) => void;
  setTargetLanguages: (codes: string[]) => void;
  setTranslationEnabled: (enabled: boolean) => void;
  /** Applies the config of the running session (broadcast) — not persisted. */
  applySessionConfig: (config: SttSessionConfig | null) => void;
  setDetectedLanguage: (code: string | null) => void;
  setInputDeviceId: (id: string) => void;
  setInputDevices: (devices: SttInputDevice[]) => void;
  applyResult: (tokens: SttToken[], targetLanguage?: string) => void;
  sealCurrent: () => void;
  appendLateTranslation: (text: string, targetLanguage?: string) => void;
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
    targetLanguages: settings.defaultTargetLanguages,
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
    currentTranslations: {},
    partialTranslations: {},

    utterances: [],
    lastOriginal: '',
    lastTranslation: '',
    lastTranslations: {},
    lastAt: 0,

    error: null,

    setCaptions: (snapshot) => set(state => ({
      currentOriginal: snapshot.original,
      partialOriginal: '', partialTranslation: '', partialTranslations: {},
      currentTranslations: snapshot.translations,
      currentTranslation: snapshot.translations[state.targetLanguage] ?? '',
      lastOriginal: snapshot.lastOriginal,
      lastTranslations: snapshot.lastTranslations,
      lastTranslation: snapshot.lastTranslations[state.targetLanguage] ?? '',
      utterances: snapshot.history,
      lastAt: snapshot.history.at(-1)?.at ?? 0,
      detectedLanguage: snapshot.detectedLanguage,
    })),
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
              targetLanguages: snapshot.config.targetLanguages?.length ? snapshot.config.targetLanguages : [snapshot.config.targetLanguage],
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
      set(() => {
        updateSttSettings({ defaultSttLanguage: sttLanguage });
        return { sttLanguage, sttLanguageName: sttLanguageDisplayName(sttLanguage) };
      }),
    setTargetLanguage: (targetLanguage) =>
      set(() => {
        const targetLanguages = [targetLanguage];
        updateSttSettings({ defaultTargetLanguage: targetLanguage, defaultTargetLanguages: targetLanguages });
        return { targetLanguage, targetLanguages, targetLanguageName: languageName(targetLanguage) };
      }),
    setTargetLanguages: (targetLanguages) =>
      set(() => {
        const normalized = [...new Set(targetLanguages)].filter(Boolean);
        const first = normalized[0] ?? settings.defaultTargetLanguage;
        updateSttSettings({ defaultTargetLanguages: normalized, defaultTargetLanguage: first });
        return { targetLanguages: normalized, targetLanguage: first, targetLanguageName: languageName(first) };
      }),

    setTranslationEnabled: (translationEnabled) =>
      set(() => {
        updateSttSettings({ translationEnabled });
        return { translationEnabled };
      }),

    applySessionConfig: (config) =>
      config
        ? set({
            sttLanguage: config.sttLanguage,
            sttLanguageName: sttLanguageDisplayName(config.sttLanguage),
            targetLanguages: config.targetLanguages?.length ? config.targetLanguages : [config.targetLanguage],
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

    applyResult: (tokens, eventTargetLanguage) =>
      set((state) => {
        // Soniox needs one session per translation target, and all of them are
        // fed the same audio. Every result event therefore belongs to exactly
        // ONE session: the original-only session (translation off) or the
        // session of a single target language. Consequences handled here:
        //   • only the session that owns the spoken timeline may append to the
        //     original buffers, otherwise every sentence is duplicated once per
        //     extra target language;
        //   • the provisional (non-final) text is replaced per session, since
        //     the two streams interleave — replacing the whole map on every
        //     event would blank the live text of the other language.
        const primaryTarget = state.targetLanguages[0] ?? state.targetLanguage;
        const scopeTarget = eventTargetLanguage ?? null;
        const ownsOriginal = scopeTarget === null || scopeTarget === primaryTarget;

        let currentOriginal = state.currentOriginal;
        let currentTranslation = state.currentTranslation;
        const currentTranslations = { ...state.currentTranslations };
        let partialOriginal = ownsOriginal ? '' : state.partialOriginal;
        const partialTranslations: Record<string, string> = { ...state.partialTranslations };
        if (scopeTarget) partialTranslations[scopeTarget] = '';
        let detectedLanguage = state.detectedLanguage;

        for (const t of tokens) {
          if (!t.text) continue;
          // Remember the spoken language seen in this stream (original tokens
          // carry it; translation tokens carry the source language instead).
          const spoken = validLanguage(t.translationStatus === 'translation' ? t.sourceLanguage : t.language);
          if (spoken) detectedLanguage = spoken;

          if (t.translationStatus === 'translation') {
            const target = t.targetLanguage ?? eventTargetLanguage ?? state.targetLanguage;
            if (t.isFinal) {
              currentTranslations[target] = (currentTranslations[target] ?? '') + t.text;
              if (target === state.targetLanguage) currentTranslation += t.text;
            } else {
              partialTranslations[target] = (partialTranslations[target] ?? '') + t.text;
            }
          } else if (ownsOriginal) {
            // 'original' or 'none' — spoken text of the owning session only.
            if (t.isFinal) currentOriginal += t.text;
            else partialOriginal += t.text;
          }
        }

        return {
          currentOriginal,
          currentTranslation,
          currentTranslations,
          partialOriginal,
          // Mirrors the primary target's provisional text, which may come from
          // an earlier event while another language streamed in between.
          partialTranslation: partialTranslations[state.targetLanguage] ?? '',
          partialTranslations,
          detectedLanguage,
        };
      }),

    // Seal the current utterance into history. Unlike a plain "commit", this
    // mirrors the sealed text into lastOriginal/lastTranslation so the captions
    // slide keeps showing it after the live fields are cleared (the slide
    // falls back to these fields while the delayed translation is in flight).
    sealCurrent: () =>
      set((state) => {
        const original = state.currentOriginal.trim();
        const translation = state.currentTranslation.trim();
        const translations = { ...state.currentTranslations };
        const hasText = original.length > 0 || translation.length > 0;
        if (!hasText) {
          return {
            currentOriginal: '',
            currentTranslation: '',
            currentTranslations: {},
            partialOriginal: '',
            partialTranslation: '',
            partialTranslations: {},
          };
        }
        const at = Date.now();
        return {
          currentOriginal: '',
          currentTranslation: '',
          // Reset the per-language maps as well. They used to survive the seal,
          // so every following utterance (and every phone history entry) kept
          // the translations of all previous utterances, growing endlessly —
          // with several target languages the feed printed the same text again
          // and again.
          currentTranslations: {},
          partialOriginal: '',
          partialTranslation: '',
          partialTranslations: {},
          lastOriginal: original,
          lastTranslation: translation,
          lastTranslations: translations,
          lastAt: at,
          utterances: [
            ...state.utterances.slice(-49),
            { id: createId(), original, translation, translations, at },
          ],
        };
      }),

    // Final translation tokens that arrive after the utterance was already
    // sealed are appended to the most recent utterance instead of being
    // dropped or mixed into the next utterance. The target language decides
    // where the text lands: a late token of a SECONDARY target must never be
    // appended to the primary translation (that mixed Chinese into the English
    // history entry), it belongs in that utterance's per-language map.
    appendLateTranslation: (text, targetLanguage) =>
      set((state) => {
        const target = targetLanguage ?? state.targetLanguage;
        const isPrimary = target === state.targetLanguage;
        if (state.utterances.length === 0) {
          return isPrimary
            ? { currentTranslation: state.currentTranslation + text }
            : {
                currentTranslations: {
                  ...state.currentTranslations,
                  [target]: (state.currentTranslations[target] ?? '') + text,
                },
              };
        }
        const last = state.utterances[state.utterances.length - 1];
        const translations = { ...(last.translations ?? {}) };
        translations[target] = (translations[target] ?? '') + text;
        const translation = isPrimary ? last.translation + text : last.translation;
        const updated: SttUtterance = { ...last, translation, translations };
        return {
          utterances: [...state.utterances.slice(0, -1), updated],
          // Keep the captions' "last utterance" fallback in sync per language.
          lastTranslations: { ...state.lastTranslations, [target]: translations[target] },
          ...(isPrimary ? { lastTranslation: translation } : {}),
        };
      }),

    setError: (error) => set({ error }),
    clearAll: () =>
      set({
        currentOriginal: '',
        currentTranslation: '',
        // The per-language maps must be reset too, otherwise the next session
        // starts with the previous one's translations still in the live text
        // (and inside the first sealed history entry).
        currentTranslations: {},
        partialOriginal: '',
        partialTranslation: '',
        partialTranslations: {},
        utterances: [],
        lastOriginal: '',
        lastTranslation: '',
        lastTranslations: {},
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
      if (snapshot.captions) useSttStore.getState().setCaptions(snapshot.captions);
    }
  } catch {
    // Electron API unavailable (e.g. plain web preview) — keep current state.
  }
}
