import { memo, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { Slide } from '../types';
import { useSttStore } from '../state/useSttStore';
import { layoutCaptions, measureCaptionText, type CaptionDisplayState } from '../captionDisplay';

// Only the fields the caption layout reads: status, device lists, error and the growing
// utterance history no longer re-render (and re-measure) the on-screen captions.
const selectCaptionState = (s: CaptionDisplayState): CaptionDisplayState => ({
  currentOriginal: s.currentOriginal, partialOriginal: s.partialOriginal,
  currentTranslation: s.currentTranslation, partialTranslation: s.partialTranslation,
  currentTranslations: s.currentTranslations, partialTranslations: s.partialTranslations,
  lastOriginal: s.lastOriginal, lastTranslation: s.lastTranslation, lastTranslations: s.lastTranslations,
  targetLanguage: s.targetLanguage, targetLanguages: s.targetLanguages, translationEnabled: s.translationEnabled,
});

function CaptionsRenderer({ slide, width, height }: { slide: Slide; width: number; height: number; scale: number }) {
  const state = useSttStore(useShallow(selectCaptionState));
  const layout = useMemo(() => layoutCaptions(slide, state, measureCaptionText), [slide, state]);
  return <svg width={width} height={height} viewBox="0 0 1920 1080" role="img"
    aria-label={layout.rows.map(row => row.text).join('\n')} style={{ display: 'block', background: layout.background }}>
    {layout.band && <rect x={76} y={layout.band.y} width={1768} height={layout.band.height} fill="rgba(0,0,0,.55)" />}
    {layout.rows.map((row, i) => <text key={i} x={960} y={row.y} textAnchor="middle" direction={row.rtl ? 'rtl' : 'ltr'}
      fill={layout.color} opacity={row.opacity} fontSize={row.size} fontFamily={layout.family} fontWeight={row.bold ? 700 : 400}
      style={{ whiteSpace: 'pre' }}>{row.text}</text>)}
  </svg>;
}
export default memo(CaptionsRenderer);
