import { memo, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useSlideBox } from '../hooks/useSlideBox';
import { useLiveOverlayStore } from '../state/useLiveOverlayStore';
import {
  speakerVisible, tickerDurationSeconds, tickerLine, tickerRepeatCount, tickerVisible,
  type SpeakerOverlay, type TickerOverlay,
} from '../liveOverlays';

/** Band height on the 1920×1080 reference canvas. */
const TICKER_HEIGHT = 72;
const TICKER_FONT = 38;
const TICKER_FAMILY = 'Georgia, "Times New Roman", serif';
const SPEAKER_FAMILY = '"WPA UI Inter", "Segoe UI", Arial, sans-serif';

function TickerBand({ ticker, scale, width }: { ticker: TickerOverlay; scale: number; width: number }) {
  const line = tickerLine(ticker.text);
  const measureRef = useRef<HTMLSpanElement>(null);
  const [segment, setSegment] = useState(0);
  const fontSize = TICKER_FONT * scale;
  useLayoutEffect(() => {
    const width = measureRef.current?.getBoundingClientRect().width ?? 0;
    setSegment(prev => Math.abs(prev - width) < .5 ? prev : width);
  }, [line, fontSize]);
  const repeat = tickerRepeatCount(segment, width);
  const half = segment * repeat;
  const duration = tickerDurationSeconds(half, scale);
  const height = TICKER_HEIGHT * scale;
  const accent = Math.max(1, 3 * scale);
  const segmentNode = (key: string) => (
    <span key={key} style={{ display: 'inline-flex', alignItems: 'center', whiteSpace: 'pre' }}>
      <span>{line}</span>
      <span aria-hidden="true" style={{ margin: `0 ${fontSize * .9}px`, fontSize: fontSize * .55, color: '#e7c66f' }}>◆</span>
    </span>
  );
  const band: CSSProperties = {
    position: 'absolute', left: 0, right: 0, height, overflow: 'hidden',
    ...(ticker.position === 'top' ? { top: 0, borderBottom: `${accent}px solid #dc2626` } : { bottom: 0, borderTop: `${accent}px solid #dc2626` }),
    background: 'linear-gradient(180deg, rgba(18,18,22,.94), rgba(8,8,10,.94))',
    boxShadow: '0 0 24px rgba(0,0,0,.45)',
    display: 'flex', alignItems: 'center',
    fontFamily: TICKER_FAMILY, fontSize, color: '#f4e7c5', letterSpacing: '.01em',
  };
  return (
    <div style={band} data-live-ticker="">
      <span ref={measureRef} aria-hidden="true" style={{ position: 'absolute', visibility: 'hidden', whiteSpace: 'pre' }}>{segmentNode('measure')}</span>
      {segment > 0 && (
        // data-slide-transition: an output effect, not UI motion, so reduced-motion rules leave it running.
        <div data-slide-transition="" style={{
          display: 'flex', whiteSpace: 'nowrap', willChange: 'transform',
          animation: duration ? `liveTickerScroll ${duration}s linear infinite` : undefined,
          ['--ticker-shift' as string]: `${-half}px`,
        }}>
          {Array.from({ length: repeat * 2 }, (_, index) => segmentNode(String(index)))}
        </div>
      )}
    </div>
  );
}

function SpeakerLowerThird({ speaker, scale, liftForTicker }: { speaker: SpeakerOverlay; scale: number; liftForTicker: boolean }) {
  const bottom = (liftForTicker ? 9 + TICKER_HEIGHT / 10.8 : 9);
  return (
    <div data-live-speaker="" data-slide-transition="" className="live-speaker-enter" style={{
      position: 'absolute', left: '5%', bottom: `${bottom}%`, maxWidth: '70%',
      display: 'flex', alignItems: 'stretch', fontFamily: SPEAKER_FAMILY,
      filter: `drop-shadow(0 ${6 * scale}px ${18 * scale}px rgba(0,0,0,.45))`,
    }}>
      <span aria-hidden="true" style={{ width: Math.max(2, 8 * scale), borderRadius: 2 * scale, background: '#3b82f6', flexShrink: 0 }} />
      <div style={{
        padding: `${16 * scale}px ${40 * scale}px ${18 * scale}px ${24 * scale}px`,
        background: 'linear-gradient(90deg, rgba(10,12,18,.92) 0%, rgba(10,12,18,.82) 70%, rgba(10,12,18,0) 100%)',
        minWidth: 0,
      }}>
        <p dir="auto" style={{ margin: 0, fontSize: 64 * scale, lineHeight: 1.1, fontWeight: 800, color: '#ffffff', overflowWrap: 'anywhere' }}>{speaker.name}</p>
        {speaker.title.trim() && (
          <p dir="auto" style={{ margin: `${8 * scale}px 0 0`, fontSize: 34 * scale, lineHeight: 1.2, fontWeight: 600, color: 'rgba(255,255,255,.82)', overflowWrap: 'anywhere' }}>{speaker.title}</p>
        )}
      </div>
    </div>
  );
}

/** Ticker and speaker lower-third over the live 16:9 slide area (projector, NDI and operator preview). */
function LiveOverlays() {
  const { ticker, speaker } = useLiveOverlayStore(useShallow(s => ({ ticker: s.ticker, speaker: s.speaker })));
  const [ref, box] = useSlideBox();
  const showTicker = tickerVisible(ticker);
  const showSpeaker = speakerVisible(speaker);
  const scale = box.width / 1920;
  return (
    <div ref={ref} aria-hidden="true" data-live-overlays=""
      className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden" style={{ zIndex: 65 }}>
      {box.width > 0 && (showTicker || showSpeaker) && (
        <div className="relative overflow-hidden" style={{ width: box.width, height: box.height }}>
          {showSpeaker && <SpeakerLowerThird speaker={speaker} scale={scale} liftForTicker={showTicker && ticker.position === 'bottom'} />}
          {showTicker && <TickerBand ticker={ticker} scale={scale} width={box.width} />}
        </div>
      )}
    </div>
  );
}

export default memo(LiveOverlays);
