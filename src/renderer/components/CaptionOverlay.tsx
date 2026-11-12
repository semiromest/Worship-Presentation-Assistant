import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { Slide } from '../types';
import type { CaptionDisplayState } from '../captionDisplay';
import { captionOverlayBlocks, hexToRgba, type CaptionOverlayBlock, type CaptionOverlayConfig } from '../captionOverlay';
import { useSttStore } from '../state/useSttStore';
import { useCaptionOverlayStore } from '../state/useCaptionOverlayStore';

const LINE_HEIGHT = 1.3;

const selectCaptionState = (s: CaptionDisplayState): CaptionDisplayState => ({
  currentOriginal: s.currentOriginal, partialOriginal: s.partialOriginal,
  currentTranslation: s.currentTranslation, partialTranslation: s.partialTranslation,
  currentTranslations: s.currentTranslations, partialTranslations: s.partialTranslations,
  lastOriginal: s.lastOriginal, lastTranslation: s.lastTranslation, lastTranslations: s.lastTranslations,
  targetLanguage: s.targetLanguage, targetLanguages: s.targetLanguages, translationEnabled: s.translationEnabled,
});

/** Tracks the 16:9 slide box inside a letterboxed parent, like LivePreview does. */
function useSlideBox() {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (!w || !h) return;
      const width = w / h > 16 / 9 ? h * 16 / 9 : w;
      setBox(prev => prev.width === width ? prev : { width, height: width * 9 / 16 });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, box] as const;
}

interface CaptionOverlayViewProps {
  blocks: CaptionOverlayBlock[];
  config: CaptionOverlayConfig;
  visible: boolean;
}

/** Pure presentation: film-style subtitles drawn over a 16:9 slide area. */
export function CaptionOverlayView({ blocks, config, visible }: CaptionOverlayViewProps) {
  const [ref, box] = useSlideBox();
  const scale = box.width / 1920;
  const size = config.fontSize * scale;
  const background = hexToRgba(config.backgroundColor, config.backgroundOpacity);
  const outline = config.backgroundStyle === 'none'
    ? `0 0 ${Math.max(1, 6 * scale)}px rgba(0,0,0,.95), 0 ${Math.max(1, 2 * scale)}px ${Math.max(1, 3 * scale)}px rgba(0,0,0,.9)`
    : undefined;
  const edge = `${config.margin}%`;
  const containerStyle: CSSProperties = {
    position: 'absolute', left: config.backgroundStyle === 'band' ? 0 : '6%', right: config.backgroundStyle === 'band' ? 0 : '6%',
    ...(config.position === 'top' ? { top: edge } : { bottom: edge }),
    textAlign: 'center',
    fontFamily: config.fontFamily,
    color: config.textColor,
    textShadow: outline,
    opacity: visible && blocks.length ? 1 : 0,
    transition: 'opacity 220ms ease',
    ...(config.backgroundStyle === 'band' ? { background, padding: `${14 * scale}px 6%` } : {}),
  };
  return (
    <div ref={ref} aria-hidden="true" data-caption-overlay=""
      className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden" style={{ zIndex: 60 }}>
      {box.width > 0 && (
        <div className="relative" style={{ width: box.width, height: box.height }}>
          <div style={containerStyle}>
            {blocks.map((block, index) => {
              const fontSize = block.secondary ? size * .72 : size;
              const lines = block.secondary ? Math.min(2, config.maxLines) : config.maxLines;
              const span: CSSProperties = config.backgroundStyle === 'box' ? {
                background, padding: `${.08 * fontSize}px ${.35 * fontSize}px`, borderRadius: .12 * fontSize,
                boxDecorationBreak: 'clone', WebkitBoxDecorationBreak: 'clone',
              } : {};
              return (
                // Older words overflow above the clipped area: justify-end keeps the newest line visible.
                <div key={index} style={{
                  maxHeight: lines * LINE_HEIGHT * fontSize + .2 * fontSize, overflow: 'hidden',
                  display: 'flex', flexDirection: 'column', justifyContent: 'flex-end',
                  marginTop: index ? .2 * size : 0,
                }}>
                  <p dir="auto" style={{
                    margin: 0, fontSize, lineHeight: LINE_HEIGHT, whiteSpace: 'pre-wrap',
                    fontWeight: config.bold && !block.secondary ? 700 : 500, opacity: block.secondary ? .8 : 1,
                  }}>
                    <span style={span}>{block.text}</span>
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/** Live subtitles over whatever slide is on air, driven by the STT store. */
function CaptionOverlay({ slide }: { slide: Slide | undefined }) {
  const config = useCaptionOverlayStore(s => s.config);
  const state = useSttStore(useShallow(selectCaptionState));
  const blocks = useMemo(() => captionOverlayBlocks(state, config.source), [state, config.source]);
  const signature = blocks.map(b => b.text).join('\n');
  const [stale, setStale] = useState(false);
  // Hide like film subtitles once nobody has spoken for a while; any new word shows them again.
  useEffect(() => {
    setStale(false);
    if (!signature || config.hideAfterSeconds <= 0) return;
    const timer = setTimeout(() => setStale(true), config.hideAfterSeconds * 1000);
    return () => clearTimeout(timer);
  }, [signature, config.hideAfterSeconds]);
  // A captions slide already shows the same text full screen.
  if (!config.enabled || !slide || slide.type === 'captions') return null;
  return <CaptionOverlayView blocks={blocks} config={config} visible={!stale} />;
}

export default memo(CaptionOverlay);
