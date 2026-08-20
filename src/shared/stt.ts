// ─── Soniox real-time STT + translation: shared types ───────────────────────
// Used by the main process (sonioxService) and the renderer (store + UI).
// The API key itself is NEVER part of these types.

export type SttTranslationStatus = 'none' | 'original' | 'translation';

/** A single token from the Soniox real-time stream. */
export interface SttToken {
  text: string;
  isFinal: boolean;
  translationStatus: SttTranslationStatus;
  /** Detected spoken language (original tokens) or target language (translation tokens). */
  language: string | null;
  /** Source language for translated tokens. */
  sourceLanguage: string | null;
}

export type SttSessionStatus = 'idle' | 'connecting' | 'connected';

export type SttErrorCode =
  | 'NO_API_KEY'
  | 'INVALID_API_KEY'
  | 'MIC_DENIED'
  | 'MIC_NOT_FOUND'
  | 'MIC_BUSY'
  | 'CONNECTION_FAILED'
  | 'QUOTA_EXCEEDED'
  | 'SESSION_ACTIVE'
  | 'UNKNOWN';

/** The language/translation configuration a session was started with. */
export interface SttSessionConfig {
  sttLanguage: string;
  targetLanguage: string;
  translationEnabled: boolean;
}

export type SttEvent =
  | { type: 'status'; sessionId: string | null; status: SttSessionStatus; config?: SttSessionConfig | null }
  | { type: 'result'; sessionId: string; tokens: SttToken[] }
  | { type: 'endpoint'; sessionId: string }
  | { type: 'finished'; sessionId: string }
  | { type: 'error'; code: SttErrorCode; message: string; sessionId: string | null };

export interface SttConfig {
  /** One-way translation target language (ISO code). */
  targetLanguage: string;
  /** Expected spoken language for recognition (ISO code), or 'auto' to auto-detect. */
  sttLanguage: string;
  /** Whether one-way translation is enabled for this session. */
  translationEnabled: boolean;
}

/** Sentinal value for the STT language picker: detect the spoken language automatically. */
export const AUTO_STT_LANGUAGE = 'auto';

export function isAutoSttLanguage(code: string): boolean {
  return code === AUTO_STT_LANGUAGE;
}

export interface SttStatus {
  hasKey: boolean;
  keyHint: string | null;
  sessionStatus: SttSessionStatus;
  /** Active session id (null when idle) — lets a reloaded window match results. */
  sessionId: string | null;
  /** Language/translation config of the active session (null when idle). */
  config: SttSessionConfig | null;
}

export interface SttLanguage {
  code: string;
  name: string;
}

/**
 * Official Soniox supported-language set (speech-to-text, 60+ languages).
 * Source: https://soniox.com/docs/stt/concepts/supported-languages
 */
export const STT_LANGUAGES: SttLanguage[] = [
  { code: 'af', name: 'Afrikaans' },
  { code: 'sq', name: 'Albanian' },
  { code: 'ar', name: 'Arabic' },
  { code: 'az', name: 'Azerbaijani' },
  { code: 'eu', name: 'Basque' },
  { code: 'be', name: 'Belarusian' },
  { code: 'bn', name: 'Bengali' },
  { code: 'bs', name: 'Bosnian' },
  { code: 'bg', name: 'Bulgarian' },
  { code: 'ca', name: 'Catalan' },
  { code: 'zh', name: 'Chinese' },
  { code: 'hr', name: 'Croatian' },
  { code: 'cs', name: 'Czech' },
  { code: 'da', name: 'Danish' },
  { code: 'nl', name: 'Dutch' },
  { code: 'en', name: 'English' },
  { code: 'et', name: 'Estonian' },
  { code: 'fi', name: 'Finnish' },
  { code: 'fr', name: 'French' },
  { code: 'gl', name: 'Galician' },
  { code: 'de', name: 'German' },
  { code: 'el', name: 'Greek' },
  { code: 'gu', name: 'Gujarati' },
  { code: 'he', name: 'Hebrew' },
  { code: 'hi', name: 'Hindi' },
  { code: 'hu', name: 'Hungarian' },
  { code: 'id', name: 'Indonesian' },
  { code: 'it', name: 'Italian' },
  { code: 'ja', name: 'Japanese' },
  { code: 'kn', name: 'Kannada' },
  { code: 'kk', name: 'Kazakh' },
  { code: 'ko', name: 'Korean' },
  { code: 'lv', name: 'Latvian' },
  { code: 'lt', name: 'Lithuanian' },
  { code: 'mk', name: 'Macedonian' },
  { code: 'ms', name: 'Malay' },
  { code: 'ml', name: 'Malayalam' },
  { code: 'mr', name: 'Marathi' },
  { code: 'no', name: 'Norwegian' },
  { code: 'fa', name: 'Persian' },
  { code: 'pl', name: 'Polish' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'pa', name: 'Punjabi' },
  { code: 'ro', name: 'Romanian' },
  { code: 'ru', name: 'Russian' },
  { code: 'sr', name: 'Serbian' },
  { code: 'sk', name: 'Slovak' },
  { code: 'sl', name: 'Slovenian' },
  { code: 'es', name: 'Spanish' },
  { code: 'sw', name: 'Swahili' },
  { code: 'sv', name: 'Swedish' },
  { code: 'tl', name: 'Tagalog' },
  { code: 'ta', name: 'Tamil' },
  { code: 'te', name: 'Telugu' },
  { code: 'th', name: 'Thai' },
  { code: 'tr', name: 'Turkish' },
  { code: 'uk', name: 'Ukrainian' },
  { code: 'ur', name: 'Urdu' },
  { code: 'vi', name: 'Vietnamese' },
  { code: 'cy', name: 'Welsh' },
];

export function languageName(code: string): string {
  return STT_LANGUAGES.find((l) => l.code === code)?.name ?? code;
}
