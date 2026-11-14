import { useEffect, useRef, useState } from 'react';
import { useStore } from '../state/useStore';
import { DEFAULT__TRANSITION } from '../constants';
import { lyricsFontSize, lyricsKey, lyricsText } from '../lyricsLayer';
import CaptionOverlay from './CaptionOverlay';

type Layer = { key: string; text: string; leaving: boolean };

/**
 * NDI Lyrics output: the live slide's lines as a lower third on a fully transparent page, meant to
 * be keyed over a camera in OBS/vMix. Blackout, loading, media slides and empty slides send a fully
 * transparent frame (never black), so the camera picture is never covered. Lines cross-fade with
 * the presentation's transition duration.
 */
export default function LyricsView() {
  const ready = useStore((s) => s.projectorReady);
  const blackout = useStore((s) => s.isBlackout);
  const slide = useStore((s) => s.presentation.slides[s.liveIndex]);
  const instant = useStore((s) => s.instantTransition);
  const duration = useStore((s) => (s.instantTransition ? 0 : s.presentation.transition?.type === 'none' ? 0 : s.presentation.transition?.duration ?? DEFAULT__TRANSITION.duration));

  const visible = ready && !blackout;
  const text = visible ? lyricsText(slide) : '';
  const key = text ? lyricsKey(slide) + '|' + text : '';

  const [layers, setLayers] = useState<Layer[]>(() => (key ? [{ key, text, leaving: false }] : []));
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  useEffect(() => () => { for (const timer of timers.current) clearTimeout(timer); }, []);

  useEffect(() => {
    setLayers((current) => {
      const active = current.find((layer) => !layer.leaving);
      if ((active?.key ?? '') === key) return current;
      const next = current.filter((layer) => !layer.leaving && layer.key !== key).map((layer) => ({ ...layer, leaving: true }));
      if (duration <= 0) return key ? [{ key, text, leaving: false }] : [];
      const timer = setTimeout(() => {
        timers.current.delete(timer);
        setLayers((all) => all.filter((layer) => !layer.leaving));
      }, duration + 50);
      timers.current.add(timer);
      return key ? [...next, { key, text, leaving: false }] : next;
    });
  }, [key, text, duration, instant]);

  return (
    <div className="fixed inset-0 overflow-hidden" style={{ background: 'transparent' }} data-lyrics-output>
      {layers.map((layer) => (
        <div
          key={layer.key}
          data-slide-transition=""
          className="absolute left-0 right-0 flex justify-center"
          style={{
            bottom: 64,
            opacity: layer.leaving ? 0 : 1,
            animation: !layer.leaving && duration > 0 ? `tr-fadeIn ${duration}ms ease both` : undefined,
            transition: `opacity ${duration}ms ease`,
          }}
        >
          <p
            className="whitespace-pre-wrap text-center"
            style={{
              maxWidth: 1680,
              margin: 0,
              padding: '18px 44px',
              borderRadius: 14,
              background: 'rgba(0, 0, 0, 0.55)',
              color: '#ffffff',
              fontWeight: 700,
              fontSize: lyricsFontSize(layer.text),
              lineHeight: 1.25,
              textShadow: '0 2px 6px rgba(0, 0, 0, 0.8)',
            }}
          >
            {layer.text}
          </p>
        </div>
      ))}
      {visible && <CaptionOverlay slide={slide} />}
    </div>
  );
}
