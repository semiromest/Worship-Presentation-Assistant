import { MediaPoster } from './MediaPoster';
import { VideoOverlayLayer } from './VideoOverlayLayer';
import { memo, useCallback, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ListOrdered, Monitor, Pause, Play, Video } from 'lucide-react';
import type { Slide, SlideItem } from '../types';
import { getSlideDisplayContent } from '../../shared/slideContent';
import { SlideImage } from './SlideImage';
import { resolveCanvasSource } from '../canvasSource';
import { cn } from '../utils';
import { SlideTextItem as TextItem } from './SlideTextItem';
export { SlideTextItem as TextItem } from './SlideTextItem';
import { SLIDE_REFERENCE_HEIGHT, SLIDE_REFERENCE_WIDTH } from '../editor/editorUtils';
import { slidePreviewGeometry } from '../slidePreviewGeometry';

/**
 * Shared slide previews.
 *
 * `SlideItemsPreview` / `TextSlidePreview` / `ScreenPreview` are used by the
 * main slide grid (SlideCard) and by the slide editor's thumbnail rail, so the
 * two surfaces cannot drift apart visually.
 *
 * `SlidePreviewAny` is the rail's entry point: it picks a representation for
 * any slide type without ever starting the heavy media work (ffmpeg thumbnail
 * extraction, video frame decoding) that SlideCard's video/loop previews do —
 * a rail can show dozens of thumbnails at once.
 */

// Image item renderer
export const ImageItem = memo(({ item }: { item: SlideItem }) => {
  return <SlideImage src={item.mediaUrl} styles={item.imageStyles} alt="Slide content" lazy />;
});

ImageItem.displayName = 'ImageItem';

// Background video player — shows first frame, play/pause on click
export const BackgroundVideoPlayer = memo(({ src, previewScale = 1 }: { src: string; previewScale?: number }) => {
  const [playing, setPlaying] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  const toggle = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play();
      setPlaying(true);
    } else {
      video.pause();
      setPlaying(false);
    }
  }, []);

  return (
    <>
      <video
        ref={videoRef}
        src={src}
        loop
        muted
        playsInline
        preload="metadata"
        className="absolute inset-0 w-full h-full object-cover pointer-events-none"
      />
      <button
        type="button"
        onClick={toggle}
        className="absolute bottom-1.5 left-1.5 w-5 h-5 rounded-full bg-black/50 flex items-center justify-center hover:bg-black/70 transition-colors z-10"
        style={previewScale > 0 ? {
          left: 6 / previewScale, bottom: 6 / previewScale,
          transform: `scale(${1 / previewScale})`, transformOrigin: 'bottom left',
        } : undefined}
        aria-label={playing ? 'Pause' : 'Play'}
      >
        {playing ? (
          <Pause className="w-3 h-3 text-white" />
        ) : (
          <Play className="w-3 h-3 text-white ml-0.5" />
        )}
      </button>
    </>
  );
});

BackgroundVideoPlayer.displayName = 'BackgroundVideoPlayer';

// Slide items container
export const SlideItemsPreview = memo(({ items, slide, staticMedia = false, enabled = true }: {
  items: SlideItem[];
  slide: Slide;
  staticMedia?: boolean;
  enabled?: boolean;
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const update = (width: number, height: number) => setViewport((previous) =>
      previous.width === width && previous.height === height ? previous : { width, height });
    update(container.clientWidth, container.clientHeight);
    const observer = new ResizeObserver(([entry]) => update(entry.contentRect.width, entry.contentRect.height));
    observer.observe(container);
    return () => observer.disconnect();
  }, []);
  const geometry = slidePreviewGeometry(viewport.width, viewport.height);
  const bgColor = slide.styles?.backgroundColor ?? '#000000';
  const bgImage = slide.styles?.backgroundImage;
  const bgGradient = slide.styles?.backgroundGradient;
  const bgBlur = (slide.styles as Record<string, unknown>)?.backgroundBlur as number | undefined;

  const getItemStyle = useCallback((item: SlideItem) => {
    const borderWidth = item.borderWidth || 0;
    return {
      left: `${item.x}%`,
      top: `${item.y}%`,
      width: `${item.width}%`,
      height: `${item.height}%`,
      transform: item.rotation ? `rotate(${item.rotation}deg)` : undefined,
      transformOrigin: item.rotation ? 'center center' : undefined,
      zIndex: item.zIndex ?? 0,
      border: borderWidth > 0 ? `${borderWidth}px solid ${item.borderColor || '#ffffff'}` : undefined,
      borderRadius: item.borderRadius ? `${item.borderRadius}px` : undefined,
    };
  }, []);

  const gradientStyle = bgGradient
    ? bgGradient.type === 'linear'
      ? `linear-gradient(${bgGradient.angle || 0}deg, ${(bgGradient.stops || [])
        .map(s => `${s.color} ${s.position}%`)
        .join(', ')})`
      : `radial-gradient(circle, ${(bgGradient.stops || [])
        .map(s => `${s.color} ${s.position}%`)
        .join(', ')})`
    : undefined;

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full overflow-hidden bg-black"
    >
      <div
        className="absolute overflow-hidden"
        style={{
          width: SLIDE_REFERENCE_WIDTH,
          height: SLIDE_REFERENCE_HEIGHT,
          left: geometry.left,
          top: geometry.top,
          transform: `scale(${geometry.scale})`,
          transformOrigin: 'top left',
          backgroundColor: bgColor,
          backgroundImage: gradientStyle ? `${gradientStyle}, ${bgImage ? `url(${bgImage})` : 'none'}` : (bgImage ? `url(${bgImage})` : undefined),
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          filter: bgBlur && bgBlur > 0 ? `blur(${bgBlur}px)` : undefined,
        }}
      >
        {/* Background video — show first frame, play on click */}
        {slide.styles?.backgroundVideo && (
          staticMedia ? <div className="absolute inset-0"><MediaPoster mediaUrl={slide.styles.backgroundVideo} enabled={enabled} objectFit="cover" /></div> : <BackgroundVideoPlayer src={slide.styles.backgroundVideo} previewScale={geometry.scale} />
        )}
        <div className="absolute inset-0" style={{
          background: gradientStyle,
          pointerEvents: 'none' as const,
        }} />
        {/* Slide layers share their own stack so they cannot cover media controls. */}
        <div className="absolute inset-0 isolate">
          {items.filter(item => item.visible !== false).map(item => (
            <div
              key={item.id}
              className="absolute overflow-hidden"
              style={getItemStyle(item)}
            >
              {item.type === 'image' ? (
                <ImageItem item={item} />
              ) : (
                <TextItem item={item} />
              )}
            </div>
          ))}
        </div>
    </div>
    </div>
  );
});

SlideItemsPreview.displayName = 'SlideItemsPreview';

// Legacy (item-less) text slide preview
export const TextSlidePreview = memo(({ slide, cardWidth = 320, staticMedia = false, enabled = true }: { slide: Slide; cardWidth?: number; staticMedia?: boolean; enabled?: boolean }) => {
  const displayContent = getSlideDisplayContent(slide);
  const bgColor = slide.styles?.backgroundColor ?? '#000000';
  const bgImage = slide.styles?.backgroundImage;
  const bgGradient = slide.styles?.backgroundGradient;
  const bgBlur = (slide.styles as Record<string, unknown>)?.backgroundBlur as number | undefined;

  const gradientStyle = bgGradient
    ? bgGradient.type === 'linear'
      ? `linear-gradient(${bgGradient.angle || 0}deg, ${(bgGradient.stops || [])
        .map(s => `${s.color} ${s.position}%`)
        .join(', ')})`
      : `radial-gradient(circle, ${(bgGradient.stops || [])
        .map(s => `${s.color} ${s.position}%`)
        .join(', ')})`
    : undefined;

  // Font size scales with card width — at the reference card width (320px
  // at zoom=1 in a ~1200px container) the baseline is 16px, proportional
  // elsewhere. Clamped so text is never illegible or absurdly large.
  const fontSize = Math.round(Math.max(7, Math.min(42, cardWidth / 20)));

  return (
    <div
      className="w-full h-full flex items-center justify-center p-4 text-center relative overflow-hidden"
      style={{
        backgroundColor: bgColor,
        backgroundImage: bgImage ? `url(${bgImage})` : undefined,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        filter: bgBlur && bgBlur > 0 ? `blur(${bgBlur}px)` : undefined,
      }}
    >
      {/* Background video — show first frame, play on click */}
      {slide.styles?.backgroundVideo && (
        staticMedia ? <div className="absolute inset-0"><MediaPoster mediaUrl={slide.styles.backgroundVideo} enabled={enabled} objectFit="cover" /></div> : <BackgroundVideoPlayer src={slide.styles.backgroundVideo} />
      )}
      <div className="absolute inset-0" style={{
        background: gradientStyle,
        pointerEvents: 'none' as const,
      }} />
      <p
        className="font-bold whitespace-pre-wrap text-white/90 leading-snug line-clamp-6 relative z-10"
        style={{
          color: slide.styles?.textColor ?? '#ffffff',
          fontSize: `${fontSize}px`,
          fontFamily: slide.styles?.fontFamily || 'inherit',
        }}
      >
        {displayContent}
      </p>
    </div>
  );
});

TextSlidePreview.displayName = 'TextSlidePreview';

export const ScreenPreview = memo(({ content }: { content?: string }) => {
  const { t } = useTranslation();
  return (
    <div className="w-full h-full flex flex-col items-center justify-center bg-[#1a1a2e]">
      <Monitor className="w-10 h-10 text-blue-400" aria-hidden="true" />
      <span className="text-[10px] text-blue-300 mt-2">{t('common.slideScreenCapture')}</span>
      {content && (
        <span className="text-[8px] text-white/50 mt-1">{content}</span>
      )}
    </div>
  );
});

ScreenPreview.displayName = 'ScreenPreview';

/** Small icon-only placeholder for rail thumbnails of non-previewable slides. */
const PlaceholderPreview = memo(({ icon: Icon, label }: { icon: typeof Video; label: string }) => (
  <div className="w-full h-full flex flex-col items-center justify-center gap-1 bg-[#141414]">
    <Icon className="w-4 h-4 text-white/30" aria-hidden="true" />
    <span className="text-[7px] leading-none text-white/35 truncate max-w-full px-1">{label}</span>
  </div>
));

PlaceholderPreview.displayName = 'PlaceholderPreview';

interface SlidePreviewAnyProps {
  slide: Slide;
  /** Rendered preview width in px — used for proportional text sizing. */
  cardWidth?: number;
  enabled?: boolean;
}

/**
 * Lightweight preview for any slide shape; used by the slide editor rail.
 * Deliberately avoids VideoPreview / LoopVideoPreview so that scrolling a long
 * deck never queues ffmpeg thumbnail jobs or video decoding per thumbnail.
 */
export const SlidePreviewAny = memo(({ slide, cardWidth = 320, enabled = true }: SlidePreviewAnyProps) => {
  const { t } = useTranslation();

  if (!slide.partsMode && (slide.type === 'text' || slide.type === 'image') && slide.items && slide.items.length > 0) {
    return <SlideItemsPreview items={slide.items} slide={slide} staticMedia enabled={enabled} />;
  }

  if (slide.partsMode) return <div className="relative h-full w-full"><TextSlidePreview slide={slide} cardWidth={cardWidth} staticMedia enabled={enabled} /><span className="absolute bottom-1 right-1 rounded bg-black/70 px-1 text-[9px] text-white">{(slide.activePart ?? 0) + 1} / {slide.parts?.length ?? 1}</span></div>;

  switch (slide.type) {
    case 'image':
      return (
        <img
          src={slide.mediaUrl ? resolveCanvasSource(slide.mediaUrl, false).url : undefined}
          style={{ filter: `grayscale(${slide.styles?.imageGrayscale ?? 0})` }}
          className={cn(
            'w-full h-full bg-black',
            slide.styles?.objectFit === 'cover' ? 'object-cover' : 'object-contain'
          )}
          alt="Slide"
          loading="lazy"
        />
      );

    case 'video':
      return <div className="relative h-full w-full"><MediaPoster mediaUrl={slide.mediaUrl} thumbnailUrl={slide.thumbnailUrl} objectFit={slide.styles?.objectFit} enabled={enabled} /><VideoOverlayLayer overlays={slide.videoOverlays} position={slide.videoPlayback?.startSeconds ?? 0} /></div>;

    case 'screen':
      return slide.thumbnailUrl ? <img src={slide.thumbnailUrl} alt={t('common.slideScreenCapture')} className="h-full w-full object-contain" /> : <ScreenPreview content={slide.content} />;

    case 'loop': {
      const first = slide.loopItems?.[0];
      if (!first) return <PlaceholderPreview icon={ListOrdered} label={t('common.loopLabel')} />;
      if (first.type === 'video') return <div className="relative h-full w-full"><MediaPoster mediaUrl={first.mediaUrl} thumbnailUrl={first.thumbnailUrl} objectFit="cover" enabled={enabled} /><span className="absolute left-1 top-1 rounded bg-black/70 px-1 text-[9px] text-white">{t('common.loopLabel')} · {slide.loopItems?.length}</span></div>;
      const src = first.mediaUrl;
      return src ? (
        <div className="relative h-full w-full"><img src={src} className="w-full h-full object-cover bg-black" alt="Loop" loading="lazy" /><span className="absolute left-1 top-1 rounded bg-black/70 px-1 text-[9px] text-white">{t('common.loopLabel')} · {slide.loopItems?.length}</span></div>
      ) : (
        <PlaceholderPreview icon={ListOrdered} label={t('common.loopLabel')} />
      );
    }

    case 'countdown': {
      let minutes = 0;
      let seconds = 0;
      try {
        const data = JSON.parse(slide.content);
        minutes = data.minutes ?? 0;
        seconds = data.seconds ?? 0;
      } catch {
        // Invalid countdown content uses the 00:00 fallback.
      }
      return (
        <div
          className="w-full h-full flex items-center justify-center"
          style={{
            backgroundColor: slide.styles?.backgroundColor ?? '#1a1a1a',
            color: slide.styles?.textColor ?? '#ffffff',
          }}
        >
          <span className="font-mono font-bold leading-none" style={{ fontSize: Math.max(12, cardWidth / 10) }}>
            {String(minutes).padStart(2, '0')}:{String(seconds).padStart(2, '0')}
          </span>
        </div>
      );
    }

    case 'captions':
      return <TextSlidePreview slide={{ ...slide, content: t('common.editorCaptionsSample'), items: undefined, styles: slide.styles }} cardWidth={cardWidth} staticMedia enabled={enabled} />;

    case 'text':
    default:
      return <TextSlidePreview slide={{ ...slide, styles: slide.styles }} cardWidth={cardWidth} staticMedia enabled={enabled} />;
  }
});

SlidePreviewAny.displayName = 'SlidePreviewAny';
