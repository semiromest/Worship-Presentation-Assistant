// ─── Phone captions/translation share: shared types ──────────────────────────
// The renderer normalizes the STT state (useSttStore) into a compact snapshot
// and the main process broadcasts it to phone browsers over the LAN. Phones
// never talk to Soniox; they only ever receive these normalized strings.

export type ShareSessionStatus = 'idle' | 'connecting' | 'connected';

export interface ShareHistoryItem {
  id: string;
  original: string;
  translation: string;
  translations?: Record<string, string>;
}

/** The complete view a phone needs to render captions + translation. */
export interface ShareSnapshot {
  sessionId?: string | null;
  uiMotionEnabled?: boolean;
  sessionStatus: ShareSessionStatus;
  translationEnabled: boolean;
  detectedLanguage: string | null;
  targetLanguages?: string[];
  /** Finalized text in the current live utterance. */
  original: string;
  translation: string;
  translations?: Record<string, string>;
  /** Provisional text is rendered immediately, but with quieter styling. */
  partialOriginal?: string;
  partialTranslation?: string;
  partialTranslations?: Record<string, string>;
  /** Fallback: last finalized utterance kept on screen after sealing. */
  lastOriginal: string;
  lastTranslation: string;
  lastTranslations?: Record<string, string>;
  /** Bounded finalized history, oldest → newest. */
  history: ShareHistoryItem[];
  /**
   * Pictures on the live slide with their translated copies per target language. The renderer
   * sends media refs; the main process swaps them for token-protected `/share/img/…` paths.
   */
  slideImages?: ShareSlideImage[];
}

export interface ShareSlideImage {
  original: string;
  /** Target language → translated picture (missing: no text found or not ready yet). */
  translations: Record<string, string>;
}

export interface ShareStatus {
  active: boolean;
  url: string;
  clientCount: number;
}

/** Live-screen phone broadcast status (see screenShareService). */
export interface ScreenShareStatus {
  active: boolean;
  url: string;
  clientCount: number;
}
