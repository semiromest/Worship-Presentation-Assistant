import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Clock, Timer } from 'lucide-react';
import { useStore } from '../state/useStore';
import { cn } from '../utils';
import type { Slide } from '../types';

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function formatElapsed(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

function formatClock(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/**
 * Plain text shown for a slide on the confidence monitor. Text/captions show
 * their content (active part for partsMode slides); media/utility slides show
 * a short localized type label so the operator still knows what's next.
 */
function slideText(slide: Slide | undefined, t: (key: string) => string): string {
  if (!slide) return '';
  switch (slide.type) {
    case 'text':
    case 'captions':
      return slide.content?.trim() || t('stage.empty');
    case 'image':
      return slide.content?.trim() || t('stage.imageSlide');
    case 'video':
      return slide.content?.trim() || t('stage.videoSlide');
    case 'countdown':
      return t('stage.countdownSlide');
    case 'loop':
      return t('stage.loopSlide');
    case 'screen':
      return t('stage.screenSlide');
    default:
      return slide.content?.trim() || t('stage.empty');
  }
}

/** True when the slide renders as an actual image (image slide or video with a stored thumbnail). */
function isVisualSlide(slide: Slide | undefined): boolean {
  return (
    !!slide &&
    ((slide.type === 'image' && !!slide.mediaUrl) ||
      (slide.type === 'video' && !!slide.thumbnailUrl))
  );
}

/**
 * Renders the slide's image (image slide → mediaUrl, video slide → thumbnail).
 * Returns null for text/media without a visual.
 */
function StagePreview({ slide, fill = false }: { slide?: Slide; fill?: boolean }) {
  const src =
    slide?.type === 'image' ? slide.mediaUrl
      : slide?.type === 'video' ? slide.thumbnailUrl
      : undefined;
  if (!src) return null;

  const fit =
    slide?.styles?.objectFit === 'cover' ? 'object-cover'
      : slide?.styles?.objectFit === 'fill' ? 'object-fill'
      : 'object-contain';

  return (
    <img
      src={src}
      alt=""
      draggable={false}
      className={cn(fit, fill ? 'w-full h-full' : 'max-w-full max-h-full')}
    />
  );
}

export default function StageDisplay() {
  const { t } = useTranslation();
  const presentation = useStore((s) => s.presentation);
  const liveIndex = useStore((s) => s.liveIndex);
  const [now, setNow] = useState(() => new Date());
  const startedAtRef = useRef(Date.now());

  // Live clock + elapsed time, updated every second.
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const current = presentation.slides[liveIndex];
  const next = presentation.slides[liveIndex + 1];
  const currentIsVisual = isVisualSlide(current);
  const nextIsVisual = isVisualSlide(next);
  const currentText = slideText(current, t);
  const nextText = slideText(next, t);
  // For visual slides the image IS the display; only a stored caption text
  // (not the generic type label) is shown alongside it.
  const nextDisplayText = nextIsVisual ? (next?.content?.trim() ?? '') : nextText;
  const elapsedSeconds = Math.max(0, Math.floor((now.getTime() - startedAtRef.current) / 1000));

  return (
    <div className="fixed inset-0 bg-[#0d0d12] text-white flex flex-col overflow-hidden select-none">
      {/* Top bar: presentation name + clock + elapsed */}
      <header className="flex items-center justify-between px-8 py-4 border-b border-white/10 bg-[#14141b]/80">
        <h1 className="text-2xl font-bold text-white/90 truncate">{presentation.name}</h1>
        <div className="flex items-center gap-6 shrink-0">
          <div
            className="flex items-center gap-2 text-4xl font-semibold tabular-nums text-white/90"
            aria-label={t('stage.clock')}
          >
            <Clock className="w-7 h-7 text-white/40" aria-hidden="true" />
            {formatClock(now)}
          </div>
          <div
            className="flex items-center gap-2 text-4xl font-semibold tabular-nums text-white/90"
            aria-label={t('stage.elapsed')}
          >
            <Timer className="w-7 h-7 text-white/40" aria-hidden="true" />
            {formatElapsed(elapsedSeconds)}
          </div>
        </div>
      </header>

      {/* Current slide — large, centered */}
      <main className="flex-1 flex flex-col items-center justify-center px-16 min-h-0">
        {current?.group?.title && (
          <p className="text-2xl font-bold text-blue-300/90 mb-4 text-center">{current.group.title}</p>
        )}
        {currentIsVisual ? (
          <>
            <div className="max-w-[85%] max-h-[58vh] rounded-lg overflow-hidden bg-black/40 border border-white/10 shadow-2xl">
              <StagePreview slide={current} />
            </div>
            {current?.content?.trim() && (
              <p className="mt-4 text-2xl text-white/60 text-center whitespace-pre-wrap break-words max-w-[80%]">
                {current.content}
              </p>
            )}
          </>
        ) : (
          <p className="text-6xl leading-snug font-semibold text-center whitespace-pre-wrap break-words max-w-[90%]">
            {currentText}
          </p>
        )}
        <p className="mt-6 text-xl text-white/40 tabular-nums">
          {liveIndex + 1} / {presentation.slides.length}
        </p>
      </main>

      {/* Next slide — smaller, dimmed */}
      <footer className="px-8 py-6 border-t border-white/10 bg-[#14141b]/80">
        <p className="text-sm font-semibold uppercase tracking-widest text-white/35 mb-2">
          {t('stage.next')}
        </p>
        {next ? (
          <div className="flex items-center gap-5 min-h-0">
            {nextIsVisual && (
              <div className="w-56 h-32 shrink-0 rounded-lg overflow-hidden bg-black/50 border border-white/10">
                <StagePreview slide={next} fill />
              </div>
            )}
            <div className="min-w-0 flex-1">
              {next.group?.title && (
                <p className="text-lg font-semibold text-blue-300/70 mb-1">{next.group.title}</p>
              )}
              <p className="text-3xl leading-snug text-white/55 whitespace-pre-wrap break-words max-w-[95%]">
                {nextDisplayText}
              </p>
            </div>
          </div>
        ) : (
          <p className="text-3xl text-white/25 italic">{t('stage.noNext')}</p>
        )}
      </footer>
    </div>
  );
}
