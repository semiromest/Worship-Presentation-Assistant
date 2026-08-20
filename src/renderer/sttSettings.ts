// ─── Renderer STT preferences (localStorage) ────────────────────────────────
// Only non-sensitive settings live here. The Soniox API key is stored
// encrypted in the main process (sonioxKeyStore) and never reaches this file.

import { AUTO_STT_LANGUAGE } from '../shared/stt';

const STORAGE_KEY = 'sttSettings';
const DEFAULT_TARGET_LANGUAGE = 'tr';
// Translation defaults to ON so existing behavior is preserved.
const DEFAULT_TRANSLATION_ENABLED = true;

export interface SttSettings {
  /** Spoken-language picker: an ISO code or AUTO_STT_LANGUAGE ('auto'). */
  defaultSttLanguage: string;
  /** One-way translation target language (ISO code). */
  defaultTargetLanguage: string;
  /** Whether translation is enabled by default for new sessions. */
  translationEnabled: boolean;
  /** Audio input device id (empty string = system default). */
  defaultInputDeviceId: string;
}

export function getSttSettings(): SttSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<SttSettings>;
      return {
        defaultSttLanguage:
          typeof parsed.defaultSttLanguage === 'string' && parsed.defaultSttLanguage
            ? parsed.defaultSttLanguage
            : AUTO_STT_LANGUAGE,
        defaultTargetLanguage:
          typeof parsed.defaultTargetLanguage === 'string' && parsed.defaultTargetLanguage
            ? parsed.defaultTargetLanguage
            : DEFAULT_TARGET_LANGUAGE,
        translationEnabled:
          typeof parsed.translationEnabled === 'boolean'
            ? parsed.translationEnabled
            : DEFAULT_TRANSLATION_ENABLED,
        defaultInputDeviceId:
          typeof parsed.defaultInputDeviceId === 'string' ? parsed.defaultInputDeviceId : '',
      };
    }
  } catch {
    // Corrupt storage — fall through to defaults.
  }
  return {
    defaultSttLanguage: AUTO_STT_LANGUAGE,
    defaultTargetLanguage: DEFAULT_TARGET_LANGUAGE,
    translationEnabled: DEFAULT_TRANSLATION_ENABLED,
    defaultInputDeviceId: '',
  };
}

/** Merges a patch into the stored settings and returns the full new value. */
export function updateSttSettings(patch: Partial<SttSettings>): SttSettings {
  const next = { ...getSttSettings(), ...patch };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable — the in-memory value still applies this session.
  }
  return next;
}
