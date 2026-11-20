import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { Clock, Timer } from 'lucide-react';
import { useStore } from '../state/useStore';
import { getActivePartIndex, getNextDisplaySlide, getSlideDisplayContent } from '../../shared/slideContent';
import { resolveCanvasSource } from '../canvasSource';
import type { Slide } from '../types';
import { parseChordLine } from '../../shared/chords';
import { getSlideChordKey, getSlideChordText } from '../../shared/slideChords';
import { useStageNextSlideEnabled, useStageNotesEnabled } from '../stageDisplayPreferences';
import './stage-display.css';

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

function canvasText(items: Slide['items']): string {
  return (items ?? []).map((item) => {
    if (item.visible === false) return '';
    if (item.type === 'group') return canvasText(item.groupItems);
    return item.type === 'text' ? item.content?.trim() : '';
  }).filter(Boolean).join('\n');
}

function slideText(slide: Slide | undefined, t: (key: string) => string): string {
  if (!slide) return '';
  const content = getSlideDisplayContent(slide).trim();
  switch (slide.type) {
    case 'text':
      return content || canvasText(slide.items) || t('stage.empty');
    case 'captions':
      return content || t('common.captionsSlide');
    case 'image':
      return content || t('stage.imageSlide');
    case 'video':
      return content || t('stage.videoSlide');
    case 'countdown':
      return t('stage.countdownSlide');
    case 'loop':
      return t('stage.loopSlide');
    case 'screen':
      return t('stage.screenSlide');
    default:
      return content || t('stage.empty');
  }
}

/** Keep the chord attached to its lyric fragment while letting the rest of the line wrap. */
function ChordSheet({ text }: { text: string }) {
  return (
    <div className="stage-chord-sheet">
      {text.split('\n').map((line, lineIndex) => (
        <div key={lineIndex} className="stage-chord-line">
          {parseChordLine(line).map(({ chord, text: lyric }, index) => {
            if (!chord) return <span key={index}>{lyric}</span>;
            const firstSpace = lyric.search(/\s/);
            const anchor = firstSpace < 0 ? lyric : lyric.slice(0, firstSpace);
            const rest = firstSpace < 0 ? '' : lyric.slice(firstSpace);
            return (
              <span key={index}>
                <span className="stage-chord-anchor">
                  <span className="stage-chord-symbol">{chord}</span>
                  <span>{anchor || '\u00a0'}</span>
                </span>
                {rest}
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function StageText({ text, chords, upcoming = false }: {
  text: string;
  chords: string | null;
  upcoming?: boolean;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const lineUnits = chords
    ? chords.split('\n').reduce((units, line) => {
        if (!line.trim()) return units + 0.55;
        const hasChord = parseChordLine(line).some((segment) => segment.chord);
        return units + (hasChord ? 2.1 : 1.18);
      }, 0)
    : text.split('\n').length * 1.18;

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const content = textRef.current;
    if (!viewport || !content) return;

    const minSize = upcoming ? 16 : 20;
    let fitTimer: ReturnType<typeof setTimeout>;
    const fit = () => {
      const heightRatio = viewport.clientHeight / Math.max(1, viewport.scrollHeight);
      const widthRatio = viewport.clientWidth / Math.max(1, viewport.scrollWidth);
      const ratio = Math.min(heightRatio, widthRatio);
      const size = Number.parseFloat(getComputedStyle(content).fontSize);
      if (ratio >= 1 || size <= minSize) return;
      // Recheck after layout, since reducing the font may also unwrap lines.
      const nextSize = Math.max(minSize, Math.floor(size * Math.max(0.85, ratio)));
      content.style.setProperty('--stage-fitted-size', `${nextSize}px`);
      fitTimer = setTimeout(fit, 0);
    };
    const scheduleFit = () => {
      clearTimeout(fitTimer);
      content.style.removeProperty('--stage-fitted-size');
      viewport.scrollTop = 0;
      fit();
    };
    scheduleFit();
    const observer = new ResizeObserver(scheduleFit);
    // A scrollbar changes the content box while fitting. Only refit from
    // the maximum size when the allotted space itself changes.
    observer.observe(viewport, { box: 'border-box' });
    document.fonts.addEventListener('loadingdone', scheduleFit);
    return () => {
      clearTimeout(fitTimer);
      observer.disconnect();
      document.fonts.removeEventListener('loadingdone', scheduleFit);
    };
  }, [text, chords, upcoming]);

  return (
    <div ref={viewportRef} className="stage-text-viewport">
      <div
        ref={textRef}
        className="stage-text"
        style={{ '--stage-line-units': Math.max(1, lineUnits) } as CSSProperties}
      >
        {chords ? <ChordSheet text={chords} /> : <p>{text}</p>}
      </div>
    </div>
  );
}

function StageClock() {
  const { t } = useTranslation();
  const [now, setNow] = useState(() => new Date());
  const startedAtRef = useRef(now.getTime());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const elapsedSeconds = Math.max(0, Math.floor((now.getTime() - startedAtRef.current) / 1000));
  return (
    <div className="stage-clock">
      <div title={t('stage.clock')} aria-label={t('stage.clock')} role="timer">
        <Clock aria-hidden="true" />
        {formatClock(now)}
      </div>
      <div title={t('stage.elapsed')} aria-label={t('stage.elapsed')} role="timer">
        <Timer aria-hidden="true" />
        {formatElapsed(elapsedSeconds)}
      </div>
    </div>
  );
}

function StageCue({ slide, chords, upcoming = false }: {
  slide?: Slide;
  chords: string | null;
  upcoming?: boolean;
}) {
  const { t } = useTranslation();
  const [failedSrc, setFailedSrc] = useState<string>();
  const source = slide?.type === 'image' ? slide.mediaUrl
    : slide?.type === 'video' ? slide.thumbnailUrl : undefined;
  const src = source ? resolveCanvasSource(source, false).url : undefined;

  if (!slide || !src || failedSrc === src) {
    return <StageText text={slideText(slide, t)} chords={chords} upcoming={upcoming} />;
  }

  const caption = getSlideDisplayContent(slide).trim();
  return (
    <div className="stage-visual">
      <div className="stage-media">
        <img
          key={src}
          src={src}
          alt=""
          draggable={false}
          className="w-full h-full"
          style={{ objectFit: slide.styles?.objectFit ?? 'contain' }}
          onError={() => setFailedSrc(src)}
        />
      </div>
      {caption && (upcoming ? <StageText text={caption} chords={null} upcoming /> : <p>{caption}</p>)}
    </div>
  );
}


function StageKey({ slide }: { slide: Slide | undefined }) {
  const { t } = useTranslation();
  const { from, to, transpose } = getSlideChordKey(slide);
  if (!to && !transpose) return null;
  const offset = `${transpose > 0 ? '+' : ''}${transpose}`;

  return (
    <span className="stage-key">
      <span>{t('stage.key')}</span>
      {to && <strong>{to}</strong>}
      {transpose !== 0 && <span>{from ? `${from} → ${to} (${offset})` : offset}</span>}
    </span>
  );
}

function StageNotes({ notes }: { notes?: string }) {
  const { t } = useTranslation();
  if (!notes?.trim()) return null;
  return (
    <aside className="stage-notes" aria-label={t('common.stageNotes')}>
      <strong>{t('common.stageNotes')}</strong> {notes}
    </aside>
  );
}

export default function StageDisplay() {
  const { t } = useTranslation();
  const presentation = useStore((s) => s.presentation);
  const liveIndex = useStore((s) => s.liveIndex);
  const showStageNotes = useStageNotesEnabled();
  const showNextSlide = useStageNextSlideEnabled();
  const current = presentation.slides[liveIndex];
  const next = showNextSlide ? getNextDisplaySlide(presentation.slides, liveIndex) : undefined;
  const currentChords = showStageNotes ? getSlideChordText(current) : null;
  const nextChords = showStageNotes ? getSlideChordText(next) : null;
  const part = current?.partsMode && current.parts?.length
    ? ` · ${getActivePartIndex(current) + 1}/${current.parts.length}`
    : '';

  return (
    <div className="stage-screen" data-show-next={showNextSlide} data-has-next={Boolean(next)}>
      <header className="stage-header">
        <h1>{presentation.name}</h1>
        <StageClock />
      </header>

      <main className="stage-panel stage-current">
        <div className="stage-meta">
          <h2>{current?.group?.title}</h2>
          {currentChords && <StageKey slide={current} />}
          <span className="stage-progress">
            {current ? liveIndex + 1 : 0} / {presentation.slides.length}{part}
          </span>
        </div>
        <StageCue key={current?.id} slide={current} chords={currentChords} />
        {showStageNotes && <StageNotes notes={current?.operatorNotes} />}
      </main>

      {showNextSlide && (
        <section className="stage-panel stage-next" aria-label={t('stage.next')}>
          <div className="stage-meta">
            <span className="stage-next-label">{t('stage.next')}</span>
            {next?.group?.title && <h2>{next.group.title}</h2>}
            {nextChords && <StageKey slide={next} />}
          </div>
          {next ? (
            <StageCue key={next.id} slide={next} chords={nextChords} upcoming />
          ) : (
            <p className="stage-no-next">{t('stage.noNext')}</p>
          )}
          {showStageNotes && <StageNotes notes={next?.operatorNotes} />}
        </section>
      )}
    </div>
  );
}
