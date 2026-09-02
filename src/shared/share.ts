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
  sessionStatus: ShareSessionStatus;
  translationEnabled: boolean;
  detectedLanguage: string | null;
  targetLanguages?: string[];
  /** Live display text (final + provisional, already assembled by the store). */
  original: string;
  translation: string;
  translations?: Record<string, string>;
  /** Fallback: last finalized utterance kept on screen after sealing. */
  lastOriginal: string;
  lastTranslation: string;
  lastTranslations?: Record<string, string>;
  /** Bounded finalized history, oldest → newest. */
  history: ShareHistoryItem[];
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
