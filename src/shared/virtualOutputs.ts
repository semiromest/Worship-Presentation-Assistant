/**
 * Virtual outputs render the live presentation without a physical display (offscreen) and hand the
 * frames to a network sender such as NDI. They join the same output model as physical displays:
 * main keeps a per-output snapshot, the control renderer addresses them by these ids.
 */
/** Full audience picture, opaque. */
export const NDI_PROGRAM_OUTPUT_ID = 'virtual:program';
/** Song/text lines only on a transparent background (BGRA with alpha), for keying over cameras. */
export const NDI_LYRICS_OUTPUT_ID = 'virtual:lyrics';

export const VIRTUAL_OUTPUT_IDS: readonly string[] = [NDI_PROGRAM_OUTPUT_ID, NDI_LYRICS_OUTPUT_ID];

/** Network source name per output; receivers list it as "COMPUTER (name)". */
export const NDI_SOURCE_NAMES: Readonly<Record<string, string>> = {
  [NDI_PROGRAM_OUTPUT_ID]: 'WPA Program',
  [NDI_LYRICS_OUTPUT_ID]: 'WPA Lyrics',
};

/** Status of every NDI output, keyed by output id. Missing ids are idle. */
export type NdiStatusMap = Record<string, NdiStatus>;

export function isVirtualOutputId(id: unknown): id is string {
  return typeof id === 'string' && VIRTUAL_OUTPUT_IDS.includes(id);
}

export const NDI_OUTPUT_WIDTH = 1920;
export const NDI_OUTPUT_HEIGHT = 1080;
export const NDI_OUTPUT_FPS = 30;

export interface NdiStatus {
  /** False once the NDI library failed to load on this machine; true until proven otherwise. */
  available: boolean;
  /** Program sender is running. */
  active: boolean;
  /** Network source name as receivers list it, e.g. "PC (WPA Program)". */
  sourceName: string | null;
  /** Receivers currently connected. */
  connections: number;
  /** A receiver (vMix, OBS, ATEM via converter...) has this source on program/preview. */
  onProgram: boolean;
  onPreview: boolean;
  /** Frames sent / dropped since the sender started. */
  sent: number;
  dropped: number;
  error: string | null;
  /** Program audio per source: jitter buffer level, rate corrections and underruns so far. */
  audio?: Record<string, { levelMs: number; primed: boolean; corrections: number; underruns: number }>;
}

export const IDLE_NDI_STATUS: NdiStatus = {
  available: true, active: false, sourceName: null, connections: 0, onProgram: false, onPreview: false, sent: 0, dropped: 0, error: null,
};
