import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import type { Slide } from '../types';
import { useSttStore } from '../state/useSttStore';
import { languageName } from '../../shared/stt';

interface CaptionsRendererProps {
  slide: Slide;
  width: number;
  height: number;
  scale: number;
}

/** The subset of Slide['styles'] this component actually reads. */
interface CaptionStyles {
  textColor?: string;
  backgroundColor?: string;
  fontSize?: number;
  fontFamily?: string;
}

const DEFAULT_CAPTIONS_CONFIG = { showOriginal: true, showTranslation: true, layout: 'centered' as const } as const;

/**
 * Mixes `pct` percent of `color` with transparent — replaces the old
 * "`${color}88`" hex-suffix trick. That trick only produced valid CSS when
 * `color` happened to be a bare 6-digit hex string; for rgb()/hsl()/named
 * colors, an 8-digit hex, or an empty string (which `?? '#ffffff'` doesn't
 * catch, since '' is not nullish) it silently emitted invalid CSS and the
 * browser dropped the color entirely. `color-mix()` accepts any valid CSS
 * color as input, so it works regardless of how `textColor` is authored.
 * Requires Chromium 111+ (Electron 25+, mid-2023) — safe to assume here.
 */
function alpha(color: string, pct: number): string {
  return `color-mix(in srgb, ${color} ${pct}%, transparent)`;
}

/** Coerces a possibly-corrupt persisted font size into a sane positive number. */
function safeFontSize(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Renders the live captions/translation slide. The text comes from the shared
 * STT store, which is fed by main-process events in BOTH windows, so the same
 * content appears live on the control preview and the projection screen.
 *
 * STT and translation are independent: when translation is disabled globally
 * (or hidden on this slide), only the spoken text is shown — as the primary,
 * large text. When enabled, the spoken text stays secondary and the
 * translation is the primary text.
 */
function CaptionsRenderer({ slide, width, height, scale }: CaptionsRendererProps) {
  const { t } = useTranslation();
  const status = useSttStore((s) => s.status);
  const translationEnabled = useSttStore((s) => s.translationEnabled);
  const detectedLanguage = useSttStore((s) => s.detectedLanguage);
  const currentTranslation = useSttStore((s) => s.currentTranslation);
  const partialTranslation = useSttStore((s) => s.partialTranslation);
  const currentOriginal = useSttStore((s) => s.currentOriginal);
  const partialOriginal = useSttStore((s) => s.partialOriginal);
  const lastOriginal = useSttStore((s) => s.lastOriginal);
  const lastTranslation = useSttStore((s) => s.lastTranslation);
  const targetLanguageName = useSttStore((s) => s.targetLanguageName);
  const targetLanguages = useSttStore((s) => s.targetLanguages);
  const currentTranslations = useSttStore((s) => s.currentTranslations);
  const lastTranslations = useSttStore((s) => s.lastTranslations);

  const cfg = slide.captions ?? DEFAULT_CAPTIONS_CONFIG;
  const styles = (slide.styles ?? {}) as CaptionStyles;

  const active = status !== 'idle';
  const translationOn = cfg.showTranslation !== false && translationEnabled;
  const showOriginal = cfg.showOriginal !== false;

  // Fall back to the last finalized utterance only while the live utterance is
  // empty, so a delayed translation stays readable after the live fields are
  // cleared without showing a stale translation next to a new utterance.
  const liveTranslation = (currentTranslation + partialTranslation).trim();
  const liveOriginal = (currentOriginal + partialOriginal).trim();
  const hasLiveText = liveTranslation.length > 0 || liveOriginal.length > 0;
  const translation = hasLiveText ? liveTranslation : lastTranslation;
  const translations = targetLanguages.map((code) => ({
    code,
    text: ((hasLiveText ? currentTranslations[code] : lastTranslations[code]) ??
      (code === useSttStore.getState().targetLanguage ? translation : '')).trim(),
  })).filter((item) => item.text);
  const original = hasLiveText ? liveOriginal : lastOriginal;
  // The primary (large) text is the translation when it is on, otherwise the
  // spoken text itself.
  const primary = translationOn ? (translations[0]?.text ?? translation) : original;
  const detectedName = detectedLanguage ? languageName(detectedLanguage) : null;

  // `||` (not `??`) is deliberate for every style fallback below: these
  // values come from persisted/user-editable config of uncertain shape, and
  // an empty string is a realistic corrupt/cleared-field value that `??`
  // would let straight through.
  const textColor = styles.textColor || '#ffffff';
  const backgroundColor = styles.backgroundColor || '#000000';
  const fontFamily = styles.fontFamily || 'inherit';
  const baseFont = Math.max(16, safeFontSize(styles.fontSize, 48) * scale);
  const originalFont = Math.max(12, baseFont * 0.55);

  const layout = cfg.layout ?? 'centered';
  const banded = layout !== 'centered';
  const justifyContent = layout === 'top' ? 'justify-start' : layout === 'lowerThird' ? 'justify-end' : 'justify-center';
  const languageLabel = translationOn
    ? `${detectedName ? `${detectedName} → ` : ''}${targetLanguageName}`
    : detectedName || t('common.sttLive');

  return (
    <div
      className={`relative flex flex-col items-center overflow-hidden px-[4%] ${justifyContent}`}
      style={{ width, height, backgroundColor }}
    >
      <div
        className={`flex flex-col items-center text-center w-full ${banded ? 'max-w-[92%] rounded-2xl px-6 py-4' : ''}`}
        style={
          banded
            ? {
                backgroundColor: 'rgba(0,0,0,0.55)',
                ...(layout === 'lowerThird'
                  ? { marginBottom: Math.max(12, 40 * scale) }
                  : { marginTop: Math.max(12, 40 * scale) }),
              }
            : undefined
        }
      >
        {!active && !translation && !original && (
          <p className="text-center" style={{ color: alpha(textColor, 53), fontSize: originalFont, fontFamily }}>
            {t('common.sttCaptionsIdle')}
          </p>
        )}

        {/* Spoken text as secondary (small, above) only when translation is on */}
        {translationOn && showOriginal && (original || active) && (
          <p
            className="whitespace-pre-wrap break-words text-center leading-snug w-full"
            style={{
              color: alpha(textColor, 67),
              fontSize: originalFont,
              fontFamily,
              marginBottom: Math.max(6, 14 * scale),
              minHeight: original ? undefined : originalFont,
            }}
          >
            {original || '\u00A0'}
          </p>
        )}

        {/* Primary text — translation when on, otherwise the spoken text.
            aria-live lets an operator monitoring this view with a screen
            reader hear updates without needing focus (this component also
            renders in the control-window preview, per the note above). */}
        {translationOn && translations.length > 1 ? translations.map((item) => (
          <p key={item.code} className="whitespace-pre-wrap break-words text-center leading-snug w-full font-bold" style={{ color: textColor, fontSize: baseFont, fontFamily }}>
            {item.text}
          </p>
        )) : null}

        {(primary || active) && translations.length <= 1 && (
          <p
            aria-live="polite"
            aria-atomic="true"
            className="whitespace-pre-wrap break-words text-center leading-snug w-full font-bold"
            style={{ color: textColor, fontSize: baseFont, fontFamily }}
          >
            {primary || '\u00A0'}
          </p>
        )}

        {active && banded && (
          <p
            className="text-center"
            style={{
              marginTop: Math.max(4, 10 * scale),
              fontSize: Math.max(10, 14 * scale),
              color: alpha(textColor, 55),
            }}
          >
            {languageLabel}
          </p>
        )}
      </div>

      {active && !banded && (
        <div
          className="absolute left-0 right-0 text-center"
          style={{
            bottom: Math.max(8, 14 * scale),
            fontSize: Math.max(10, 15 * scale),
            color: alpha(textColor, 40),
          }}
        >
          {languageLabel}
        </div>
      )}
    </div>
  );
}

// Memoized: this is a leaf/presentational component that may be instantiated
// several times (e.g. a slide thumbnail rail) alongside the live projection
// instance. Its own store subscriptions still re-render it on every token
// update regardless, so memo only helps skip needless re-renders triggered
// by unrelated parent state — never hurts.
export default memo(CaptionsRenderer);