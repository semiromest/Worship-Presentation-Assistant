import { captionText, type CaptionDisplayState } from './captionDisplay';

/** Which live-caption text the subtitle overlay shows on top of live slides. */
export type CaptionOverlaySource = 'auto' | 'original' | 'translation' | 'both';
export type CaptionOverlayPosition = 'bottom' | 'top';
/** box: tight box behind each line (film subtitles); band: full-width bar; none: outlined text only. */
export type CaptionOverlayBackground = 'box' | 'band' | 'none';

export interface CaptionOverlayConfig {
  enabled: boolean;
  source: CaptionOverlaySource;
  position: CaptionOverlayPosition;
  /** Font size in px on the 1920×1080 reference canvas. */
  fontSize: number;
  fontFamily: string;
  bold: boolean;
  textColor: string;
  backgroundStyle: CaptionOverlayBackground;
  backgroundColor: string;
  /** 0–100 */
  backgroundOpacity: number;
  /** Visible lines per text block; older words scroll off the top. */
  maxLines: number;
  /** Distance from the slide edge, in % of the slide height. */
  margin: number;
  /** Hide the overlay after this many seconds without new speech (0 = never). */
  hideAfterSeconds: number;
}

export const CAPTION_OVERLAY_STORAGE_KEY = 'presenter_caption_overlay_config';

export const CAPTION_OVERLAY_FONTS = [
  { value: 'sans-serif', label: 'Sans-serif' },
  { value: 'serif', label: 'Serif' },
  { value: 'Arial, sans-serif', label: 'Arial' },
  { value: 'Verdana, sans-serif', label: 'Verdana' },
  { value: '"Trebuchet MS", sans-serif', label: 'Trebuchet MS' },
  { value: 'Georgia, serif', label: 'Georgia' },
  { value: 'monospace', label: 'Monospace' },
] as const;

export const DEFAULT_CAPTION_OVERLAY_CONFIG: CaptionOverlayConfig = {
  enabled: false,
  source: 'auto',
  position: 'bottom',
  fontSize: 44,
  fontFamily: 'sans-serif',
  bold: true,
  textColor: '#ffffff',
  backgroundStyle: 'box',
  backgroundColor: '#000000',
  backgroundOpacity: 65,
  maxLines: 2,
  margin: 6,
  hideAfterSeconds: 6,
};

const SOURCES: CaptionOverlaySource[] = ['auto', 'original', 'translation', 'both'];
const POSITIONS: CaptionOverlayPosition[] = ['bottom', 'top'];
const BACKGROUNDS: CaptionOverlayBackground[] = ['box', 'band', 'none'];
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

const pick = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  typeof value === 'string' && (allowed as readonly string[]).includes(value) ? value as T : fallback;
const clampNumber = (value: unknown, min: number, max: number, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback;
const color = (value: unknown, fallback: string): string =>
  typeof value === 'string' && HEX_COLOR.test(value) ? value : fallback;

export function parseCaptionOverlayConfig(raw: string | null | undefined): CaptionOverlayConfig {
  const d = DEFAULT_CAPTION_OVERLAY_CONFIG;
  if (!raw) return { ...d };
  let p: unknown;
  try { p = JSON.parse(raw); } catch { return { ...d }; }
  if (typeof p !== 'object' || p === null) return { ...d };
  const v = p as Record<string, unknown>;
  return {
    enabled: typeof v.enabled === 'boolean' ? v.enabled : d.enabled,
    source: pick(v.source, SOURCES, d.source),
    position: pick(v.position, POSITIONS, d.position),
    fontSize: clampNumber(v.fontSize, 20, 120, d.fontSize),
    fontFamily: pick(v.fontFamily, CAPTION_OVERLAY_FONTS.map(f => f.value), d.fontFamily),
    bold: typeof v.bold === 'boolean' ? v.bold : d.bold,
    textColor: color(v.textColor, d.textColor),
    backgroundStyle: pick(v.backgroundStyle, BACKGROUNDS, d.backgroundStyle),
    backgroundColor: color(v.backgroundColor, d.backgroundColor),
    backgroundOpacity: clampNumber(v.backgroundOpacity, 0, 100, d.backgroundOpacity),
    maxLines: clampNumber(v.maxLines, 1, 5, d.maxLines),
    margin: clampNumber(v.margin, 0, 30, d.margin),
    hideAfterSeconds: clampNumber(v.hideAfterSeconds, 0, 60, d.hideAfterSeconds),
  };
}

export interface CaptionOverlayBlock {
  text: string;
  /** The smaller, dimmed original shown above a translation in "both" mode. */
  secondary: boolean;
}

/** The text blocks the overlay shows right now, newest words last. Falls back
 * to the last finished utterance so a sentence stays readable after its endpoint. */
export function captionOverlayBlocks(state: CaptionDisplayState, source: CaptionOverlaySource): CaptionOverlayBlock[] {
  const live = captionText(state);
  const original = live.original || state.lastOriginal.trim();
  const code = state.targetLanguage || state.targetLanguages[0] || '';
  const translation = (code && (live.translations[code] || state.lastTranslations[code]?.trim()))
    || (code === state.targetLanguage ? state.lastTranslation.trim() : '');
  const translating = state.translationEnabled && !!code;
  // Without an active translation every mode falls back to the spoken text,
  // so the overlay never goes blank just because translation is switched off.
  const mode = !translating ? 'original' : source === 'auto' ? 'translation' : source;
  const blocks: CaptionOverlayBlock[] = [];
  if (mode === 'original') {
    if (original) blocks.push({ text: original, secondary: false });
  } else if (mode === 'translation') {
    if (translation) blocks.push({ text: translation, secondary: false });
  } else {
    if (original) blocks.push({ text: original, secondary: true });
    if (translation) blocks.push({ text: translation, secondary: false });
  }
  return blocks;
}

export function hexToRgba(hex: string, opacityPercent: number): string {
  const value = HEX_COLOR.test(hex) ? hex : '#000000';
  const r = parseInt(value.slice(1, 3), 16);
  const g = parseInt(value.slice(3, 5), 16);
  const b = parseInt(value.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${Math.min(100, Math.max(0, opacityPercent)) / 100})`;
}
