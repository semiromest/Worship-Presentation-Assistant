import { playSfx } from './sfx';
import { RangeVideo } from './components/RangeVideo';
import { VideoOverlayLayer } from './components/VideoOverlayLayer';
import { MediaPoster } from './components/MediaPoster';
import { memo, useCallback, useMemo, useState, useRef, useLayoutEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ListOrdered, Play, Square, Lock, AlertTriangle, AlertCircle } from 'lucide-react';
import { usePreparationStore } from './state/usePreparationStore';
import { useStore } from './state/useStore';
import type { Slide } from './types';
import { cn } from './utils';
import { resolveCanvasSource } from './canvasSource';
import { useImageDrop } from './hooks/useImageDrop';
import { SlideCardOverlays } from './components/SlideCardOverlays';
import {
  SlideItemsPreview,
  TextSlidePreview,
  ScreenPreview,
} from './components/SlidePreview';

interface SlideCardProps {
  slide: Slide;
  index: number;
  isSelected: boolean;
  isLive: boolean;
  onClick: (id: string, index: number, e?: React.MouseEvent) => void;
  onDoubleClick?: (id: string, index: number, nativeDoubleClick?: boolean) => void;
  onDragStart?: (id: string, index: number) => void;
  onDragOver?: (id: string, index: number) => void;
  onDragEnd?: () => void;
  onDrop?: () => void;
  isDragging?: boolean;
  draggable?: boolean;
  zoom?: number;
  /** Rendered card width in px — used for responsive text sizing. */
  cardWidth?: number;
}

// Badge component for top-left indicators
const Badge = memo(({
  children,
  variant = 'default',
  color,
  compact = false,
}: {
  children: React.ReactNode;
  variant?: 'default' | 'live' | 'selected';
  color?: string;
  compact?: boolean;
}) => (
  <span className={cn(
    'font-bold bg-black/60 rounded-md border tabular-nums whitespace-nowrap',
    compact ? 'text-[8px] leading-none px-1 py-px' : 'text-[10px] px-2 py-1',
    variant === 'live'
      ? 'text-red-400 border-red-500/40'
      : variant === 'selected'
        ? 'text-blue-300 border-blue-500/50'
        : 'border-white/10 text-white',
    color && 'bg-black/80'
  )} style={color ? { borderColor: color, color } : undefined}>
    {children}
  </span>
));

Badge.displayName = 'Badge';

// Media preview components
const VideoPreview = memo(({ thumbnailUrl, objectFit, mediaUrl, playback, slideId, overlays }: {
  overlays?: Slide['videoOverlays'];
  playback?: Slide['videoPlayback'];
  slideId: string;
  thumbnailUrl?: string;
  objectFit?: string;
  mediaUrl?: string;
}) => {
  const { t } = useTranslation();
  const [playing, setPlaying] = useState(false);
  const previewPlayPending = useRef(false);
  const [position, setPosition] = useState(playback?.startSeconds ?? 0);

  if (playing && mediaUrl) {
    return (
      <div className="relative w-full h-full">
        <RangeVideo
          key={slideId}
          src={mediaUrl}
          playback={playback}
          autoplay
          muted
          onPosition={overlays?.length ? setPosition : undefined}
          onPlayingChange={active => { if (active && previewPlayPending.current) { previewPlayPending.current = false; playSfx('play'); } }}
          onError={() => { if (previewPlayPending.current) { previewPlayPending.current = false; playSfx('error'); } }}
          className={cn('w-full h-full', objectFit === 'cover' ? 'object-cover' : 'object-contain')}
        />
        <VideoOverlayLayer overlays={overlays} position={position} />
        {/* Stop button is its own control: clicks elsewhere on the slide still select it. */}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); previewPlayPending.current = false; setPlaying(false); playSfx('stop'); }}
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-10 w-10 h-10 rounded-full bg-black/70 ring-1 ring-white/25 flex items-center justify-center shadow-lg hover:bg-black/85 transition-colors"
          aria-label={t('common.stopVideo')}
        >
          <Square className="w-4 h-4 text-white" fill="currentColor" aria-hidden="true" />
        </button>
      </div>
    );
  }

  return (
    <div className="relative w-full h-full">
      <MediaPoster mediaUrl={mediaUrl} thumbnailUrl={thumbnailUrl} objectFit={objectFit} />
      <VideoOverlayLayer overlays={overlays} position={playback?.startSeconds ?? 0} />
      {/* Play button is its own control: clicks elsewhere on the slide still select it. */}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); if (mediaUrl) { previewPlayPending.current = true; setPlaying(true); } }}
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-10 w-10 h-10 rounded-full bg-white/85 hover:bg-white flex items-center justify-center shadow-lg transition-colors"
        aria-label={t('common.playVideo')}
      >
        <Play className="w-5 h-5 text-black ml-0.5" aria-hidden="true" />
      </button>
    </div>
  );
});

VideoPreview.displayName = 'VideoPreview';

const LoopVideoPreview = memo(({ item }: { item: NonNullable<Slide['loopItems']>[number] }) => (
  <MediaPoster mediaUrl={item.mediaUrl} thumbnailUrl={item.thumbnailUrl} objectFit="cover" />
));
LoopVideoPreview.displayName = 'LoopVideoPreview';

// Slide content renderer
const SlideContent = memo(({ slide, cardWidth }: { slide: Slide; cardWidth?: number }) => {
  const { t } = useTranslation();
  const hasItems = !slide.partsMode && (slide.type === 'text' || slide.type === 'image') && slide.items && slide.items.length > 0;

  if (hasItems) {
    return (
      <SlideItemsPreview
        items={slide.items!}
        slide={slide}
      />
    );
  }

  switch (slide.type) {
    case 'image':
      return (
        <img
          src={slide.mediaUrl ? resolveCanvasSource(slide.mediaUrl, false).url : undefined}
          style={{ filter: `grayscale(${slide.styles?.imageGrayscale ?? 0})` }}
          className={cn(
            'w-full h-full',
            slide.styles?.objectFit === 'cover' ? 'object-cover' : 'object-contain'
          )}
          alt="Slide"
          loading="lazy"
        />
      );

    case 'video':
      return (
        <VideoPreview
          slideId={slide.id}
          overlays={slide.videoOverlays}
          playback={slide.videoPlayback}
          thumbnailUrl={slide.thumbnailUrl}
          objectFit={slide.styles?.objectFit}
          mediaUrl={slide.mediaUrl}
        />
      );

    case 'screen':
      return <ScreenPreview content={slide.content} />;

    case 'loop': {
      const firstItem = slide.loopItems?.[0];
      if (firstItem) {
        return firstItem.type === 'image' ? (
          <img
            src={firstItem.mediaUrl}
            className="w-full h-full object-cover"
            alt="Loop"
            loading="lazy"
          />
        ) : (
          <LoopVideoPreview item={firstItem} />
        );
      }
      return (
        <div className="w-full h-full flex items-center justify-center bg-black/30 text-white/45 text-[10px]">
          {t('common.loopLabel')}
        </div>
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
        // Invalid countdown content uses the initial 00:00 fallback.
      }
      const timeStr = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
      return (
        <div
          className="w-full h-full flex items-center justify-center"
          style={{
            backgroundColor: slide.styles?.backgroundColor ?? '#1a1a1a',
            color: slide.styles?.textColor ?? '#ffffff',
          }}
        >
          <span className="font-mono font-bold text-3xl leading-none">
            {timeStr}
          </span>
        </div>
      );
    }

    case 'captions':
      return (
        <div
          className="w-full h-full flex items-center justify-center bg-black relative overflow-hidden"
          style={{ backgroundColor: slide.styles?.backgroundColor ?? '#000000' }}
        >
          <span className="text-[10px] text-white/60 font-medium">
            {t('common.captionsSlide')}
          </span>
        </div>
      );

    default:
      return <TextSlidePreview slide={slide} cardWidth={cardWidth} />;
  }
});

SlideContent.displayName = 'SlideContent';

// Badges section
const SlideBadges = memo(({ slide, index, isSelected, isLive, cardWidth, zoom }: {
  slide: Slide;
  index: number;
  isSelected: boolean;
  isLive: boolean;
  cardWidth: number;
  zoom: number;
}) => {
  const { t } = useTranslation();
  const showGroup = slide.group;
  const showType = slide.type !== 'text' || !!slide.youtubeMusic;
  const groupColor = slide.group?.color;
  const showBadges = showGroup || showType || isSelected || isLive;
  const compact = cardWidth < 360;
  const hideGroupTitle = zoom <= 0.6;
  const tiny = cardWidth < 180;
  const groupLabel = slide.group
    ? `${slide.group.title} ${slide.partsMode && slide.parts?.length ? (slide.activePart ?? 0) + 1 : slide.group.part}/${slide.partsMode && slide.parts?.length ? slide.parts.length : slide.group.parts}`
    : undefined;

  if (!showBadges && !isLive) {
    return (
      <div className={cn('absolute z-10', tiny ? 'top-0.5 left-1' : 'top-2 left-2')}>
        <Badge compact={tiny}>{index + 1}</Badge>
      </div>
    );
  }

  return (
    <div className={cn('absolute z-10 flex items-center', tiny ? 'top-0.5 left-1 gap-1' : 'top-2 left-2 gap-2')}>
      <Badge compact={tiny}>{index + 1}</Badge>

      {isSelected && !compact && (
        <Badge variant="selected">{t('common.selectedCardLabel')}</Badge>
      )}

      {showGroup && !slide.partsMode && (
        <Badge color={groupColor} compact={tiny}>
          <span title={groupLabel} className="max-w-[160px] truncate inline-block align-middle" style={{ color: groupColor }}>
            {!hideGroupTitle && `${slide.group!.title} `}{slide.group!.part}/{slide.group!.parts}
          </span>
        </Badge>
      )}

      {slide.partsMode && slide.parts && slide.parts.length > 0 && slide.group && (
        <Badge color={groupColor} compact={tiny}>
          <span title={groupLabel} className="flex items-center gap-1" style={{ color: groupColor }}>
            {!hideGroupTitle && <ListOrdered className="w-3 h-3 shrink-0" />}
            {!hideGroupTitle && <span className="max-w-[160px] truncate">{slide.group.title}</span>}
            {(slide.activePart ?? 0) + 1}/{slide.parts.length}
          </span>
        </Badge>
      )}

      {showType && (
        <Badge compact={tiny}>{slide.youtubeMusic ? (slide.musicSettings?.attachment ? '♫' : t('settings.youtubeMusicSlideLabel')) : slide.type}</Badge>
      )}

      {isLive && (
        <Badge variant="live" compact={tiny}>{t('common.liveCardLabel')}</Badge>
      )}
    </div>
  );
});

SlideBadges.displayName = 'SlideBadges';

// Small lock badge for the broadcast-locked slide (top-right corner)
const LockBadge = memo(() => {
  const { t } = useTranslation();
  return (
    <span
      className="absolute top-2 right-2 z-10 inline-flex items-center justify-center w-6 h-6 rounded-md bg-amber-500/90 text-black shadow-md"
      title={t('common.slideLockOn')}
      aria-label={t('common.slideLockOn')}
    >
      <Lock className="w-3.5 h-3.5" aria-hidden="true" />
    </span>
  );
});

LockBadge.displayName = 'LockBadge';

const PreparationBadge = memo(({ slideId }: { slideId: string }) => {
  const { t } = useTranslation();
  const result = usePreparationStore(state => state.results.find(result => result.slideId === slideId));
  if (!result) return null;
  const error = result.issues.some(issue => issue.severity === 'error');
  const Icon = error ? AlertCircle : AlertTriangle;
  const label = t(error ? 'prepCheck.slideErrors' : 'prepCheck.slideWarnings', { count: result.issues.length });
  return (
    <button type="button" draggable={false} aria-label={label} title={label}
      data-preparation-badge={slideId}
      className={`absolute bottom-2 right-2 z-20 flex items-center gap-1 rounded-md px-2 py-1 text-xs shadow-md focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none ${error ? 'bg-red-600 text-white' : 'bg-amber-400 text-black'}`}
      onMouseDown={event => event.stopPropagation()}
      onKeyDown={event => event.stopPropagation()}
      onDoubleClick={event => event.stopPropagation()}
      onClick={event => {
        event.stopPropagation();
        usePreparationStore.setState({ focusedSlideId: slideId });
        useStore.getState().setIsPrepCheckOpen(true);
      }}>
      <Icon className="w-3.5 h-3.5" aria-hidden="true" />
      {result.issues.length}
    </button>
  );
});
PreparationBadge.displayName = 'PreparationBadge';

// Main SlideCard component
export const SlideCard = memo(({
  slide,
  index,
  isSelected,
  isLive,
  onClick,
  onDoubleClick,
  onDragStart,
  onDragOver,
  onDragEnd,
  onDrop,
  isDragging,
  draggable = true,
  cardWidth,
  zoom = 1,
}: SlideCardProps) => {
  const { t } = useTranslation();
  const dropImages = useImageDrop();

  const handleClick = useCallback((e: React.MouseEvent) => {
    onClick(slide.id, index, e);
  }, [onClick, slide.id, index]);

  const handleDoubleClick = useCallback(() => {
    onDoubleClick?.(slide.id, index, true);
  }, [onDoubleClick, slide.id, index]);

  const handleDragStart = useCallback((e: React.DragEvent) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', slide.id);
    e.stopPropagation();
    onDragStart?.(slide.id, index);
  }, [onDragStart, slide.id, index]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.types.includes('Files')) {
      e.dataTransfer.dropEffect = 'copy';
      return;
    }
    e.dataTransfer.dropEffect = 'move';
    onDragOver?.(slide.id, index);
  }, [onDragOver, slide, index]);

  const handleDragEnd = useCallback(() => {
    onDragEnd?.();
  }, [onDragEnd]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.types.includes('Files')) {
      void dropImages(Array.from(e.dataTransfer.files), slide.id);
      return;
    }
    onDrop?.();
  }, [onDrop, slide.id, dropImages]);

  const groupColor = slide.group?.color;
  const cardClassName = useMemo(() => cn(
    'ui-selection-surface relative rounded-xl border text-left transition-[border-color,box-shadow,background-color,opacity] overflow-hidden bg-white/5 hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none active:scale-[0.98]',
    isSelected && 'border-blue-500 shadow-[0_0_0_2px_rgba(59,130,246,0.6)]',
    !isSelected && !isLive && 'border-white/10',
    isLive && 'live-border-pulse',
    isDragging && 'opacity-50'
  ), [isSelected, isLive, isDragging]);

  const previewRef = useRef<HTMLDivElement>(null);
  const [previewWidth, setPreviewWidth] = useState(0);
  useLayoutEffect(() => {
    const preview = previewRef.current;
    if (!preview) return;
    setPreviewWidth(preview.clientWidth);
    const observer = new ResizeObserver(([entry]) => setPreviewWidth(entry.contentRect.width));
    observer.observe(preview);
    return () => observer.disconnect();
  }, []);

  const slideLabel = isLive
    ? t('common.slideCardLiveLabel', { index: index + 1 })
    : t('common.slideCardLabel', { index: index + 1, content: slide.content?.substring(0, 40) });

  return (
    <div
      draggable={draggable}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDrop={handleDrop}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      tabIndex={0}
      data-slide-id={slide.id}
      role="button"
      className={cn(cardClassName, draggable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer')}
      style={{ ...(groupColor ? { borderLeftWidth: 4, borderLeftColor: groupColor } : {}) }}
      aria-pressed={isSelected}
      aria-label={slide.group ? `${slideLabel}, ${slide.group.title}, ${slide.partsMode && slide.parts?.length ? (slide.activePart ?? 0) + 1 : slide.group.part}/${slide.partsMode && slide.parts?.length ? slide.parts.length : slide.group.parts}` : slideLabel}
    >
      <SlideBadges slide={slide} index={index} isSelected={isSelected} isLive={isLive} cardWidth={previewWidth || cardWidth || 320} zoom={zoom} />
      {slide.locked && <LockBadge />}
      <PreparationBadge slideId={slide.id} />

      <div ref={previewRef} className="aspect-video bg-black flex items-center justify-center overflow-hidden relative isolate">
        <SlideContent slide={slide} cardWidth={previewWidth || cardWidth} />
        <SlideCardOverlays slide={slide} width={previewWidth || cardWidth || 320} />
      </div>
    </div>
  );
});

SlideCard.displayName = 'SlideCard';
