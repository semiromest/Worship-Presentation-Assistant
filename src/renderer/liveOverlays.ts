/**
 * Live overlays drawn above whatever slide is on air: an announcement /
 * emergency ticker and a speaker lower-third. The operator window owns the
 * state; projector and NDI windows follow it through localStorage events.
 */
export type TickerPosition = 'top' | 'bottom';

export interface TickerOverlay {
  text: string;
  position: TickerPosition;
  onAir: boolean;
}

export interface SpeakerOverlay {
  name: string;
  title: string;
  onAir: boolean;
}

export interface LiveOverlayState {
  ticker: TickerOverlay;
  speaker: SpeakerOverlay;
}

export const LIVE_OVERLAY_STORAGE_KEY = 'presenter_live_overlays';
export const TICKER_MAX_LENGTH = 280;
export const SPEAKER_NAME_MAX_LENGTH = 80;
export const SPEAKER_TITLE_MAX_LENGTH = 120;

export const DEFAULT_LIVE_OVERLAYS: LiveOverlayState = {
  ticker: { text: '', position: 'top', onAir: false },
  speaker: { name: '', title: '', onAir: false },
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

export function parseLiveOverlays(raw: string | null): LiveOverlayState {
  if (!raw) return structuredClone(DEFAULT_LIVE_OVERLAYS);
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return structuredClone(DEFAULT_LIVE_OVERLAYS); }
  const root = record(parsed), ticker = record(root.ticker), speaker = record(root.speaker);
  const tickerText = text(ticker.text, TICKER_MAX_LENGTH);
  const name = text(speaker.name, SPEAKER_NAME_MAX_LENGTH);
  const title = text(speaker.title, SPEAKER_TITLE_MAX_LENGTH);
  return {
    ticker: {
      text: tickerText,
      position: ticker.position === 'bottom' ? 'bottom' : 'top',
      // Nothing to show means nothing is on air, whatever the stored flag says.
      onAir: ticker.onAir === true && !!tickerText.trim(),
    },
    speaker: { name, title, onAir: speaker.onAir === true && !!name.trim() },
  };
}

/** Whether a ticker / lower-third should currently be drawn on the output. */
export function tickerVisible(ticker: TickerOverlay): boolean {
  return ticker.onAir && !!ticker.text.trim();
}

export function speakerVisible(speaker: SpeakerOverlay): boolean {
  return speaker.onAir && !!speaker.name.trim();
}

/** Ticker text collapsed to one line (line breaks would break the marquee). */
export function tickerLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/**
 * How many copies of a segment one marquee half needs so that, scrolled by
 * exactly one half, the band never shows an empty gap.
 */
export function tickerRepeatCount(segmentWidth: number, bandWidth: number): number {
  if (!(segmentWidth > 0) || !(bandWidth > 0)) return 1;
  return Math.min(50, Math.max(1, Math.ceil(bandWidth / segmentWidth)));
}

/** Seconds for one half of the marquee to pass, at a constant reading speed. */
export function tickerDurationSeconds(halfWidth: number, scale: number, pxPerSecond = 140): number {
  if (!(halfWidth > 0) || !(scale > 0)) return 0;
  return Math.max(4, halfWidth / (pxPerSecond * scale));
}
