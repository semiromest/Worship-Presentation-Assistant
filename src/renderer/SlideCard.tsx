import { memo, useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Video, Monitor, ListOrdered, Play, Pause, X } from 'lucide-react';
import type { Slide, SlideItem, TextStyle } from './types';
import { cn } from './utils';

interface SlideCardProps {
  slide: Slide;
  index: number;
  isSelected: boolean;
  isLive: boolean;
  onClick: (id: string, index: number, e?: React.MouseEvent) => void;
  onDragStart?: (id: string, index: number) => void;
  onDragOver?: (id: string, index: number) => void;
  onDragEnd?: () => void;
  onDrop?: () => void;
  isDragging?: boolean;
  zoom?: number;
}

// Badge component for top-left indicators
const Badge = memo(({
  children,
  variant = 'default',
  color,
}: {
  children: React.ReactNode;
  variant?: 'default' | 'live';
  color?: string;
}) => (
  <span className={cn(
    'text-[10px] font-bold bg-black/60 px-2 py-1 rounded-md border tabular-nums',
    variant === 'live'
      ? 'text-red-400 border-red-500/40'
      : 'border-white/10 text-white',
    color && 'bg-black/80'
  )} style={color ? { borderColor: color, color } : undefined}>
    {children}
  </span>
));

Badge.displayName = 'Badge';

// Image item renderer
const ImageItem = memo(({ item }: { item: SlideItem }) => {
  const imgStyles = item.imageStyles;
  const cssFilter = [
    imgStyles?.brightness !== 1 ? `brightness(${imgStyles?.brightness ?? 1})` : null,
    imgStyles?.contrast !== 1 ? `contrast(${imgStyles?.contrast ?? 1})` : null,
    imgStyles?.grayscale ? `grayscale(${imgStyles?.grayscale})` : null,
    imgStyles?.sepia ? `sepia(${imgStyles?.sepia})` : null,
    imgStyles?.blur ? `blur(${imgStyles?.blur}px)` : null,
  ].filter(Boolean).join(' ') || undefined;

  const flipTransform = [
    imgStyles?.flipX ? 'scaleX(-1)' : '',
    imgStyles?.flipY ? 'scaleY(-1)' : '',
  ].filter(Boolean).join(' ');

  return (
    <img
      src={item.mediaUrl}
      className={cn(
        'w-full h-full',
        imgStyles?.objectFit === 'cover' ? 'object-cover'
          : imgStyles?.objectFit === 'fill' ? 'object-fill'
            : 'object-contain'
      )}
      style={{
        opacity: imgStyles?.opacity ?? 1,
        filter: cssFilter,
        transform: flipTransform || undefined,
      }}
      alt="Slide content"
      loading="lazy"
    />
  );
});

ImageItem.displayName = 'ImageItem';

// Text item renderer
const TextItem = memo(({ item }: { item: SlideItem }) => {
  const CARD_SCALE = 0.2;
  const styles = item.textStyles ?? {} as TextStyle;
  const shadow = styles.textShadow;

  const textShadowStyle = useMemo(() =>
    shadow
      ? `${shadow.color || '#000'} ${(shadow.offsetX || 0) * CARD_SCALE}px ${(shadow.offsetY || 0) * CARD_SCALE}px ${(shadow.blur || 0) * CARD_SCALE}px`
      : undefined,
    [shadow]);

  return (
    <div
      className="w-full h-full overflow-hidden p-1 flex items-center justify-center"
      style={{
        color: styles.textColor ?? '#ffffff',
        fontSize: `${Math.max(2, (styles.fontSize ?? 32) * CARD_SCALE)}px`,
        backgroundColor: styles.backgroundColor ?? 'transparent',
        lineHeight: styles.lineHeight ?? 1.2,
        textAlign: styles.textAlign ?? 'center',
        fontWeight: styles.fontWeight ?? 'normal',
        fontStyle: styles.fontStyle ?? 'normal',
        letterSpacing: styles.letterSpacing ? `${styles.letterSpacing * CARD_SCALE}px` : undefined,
        textDecoration: styles.textDecoration || undefined,
        textShadow: textShadowStyle,
        WebkitTextStroke: styles.textStroke
          ? `${(styles.textStroke.width || 0) * CARD_SCALE}px ${styles.textStroke.color}`
          : undefined,
        whiteSpace: 'pre-wrap',
        fontFamily: styles.fontFamily,
      }}
    >
      {item.content}
    </div>
  );
});

TextItem.displayName = 'TextItem';

// Slide items container
const SlideItemsPreview = memo(({ items, slide, isHovered = false }: {
  items: SlideItem[];
  slide: Slide;
  isHovered?: boolean;
}) => {
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
      className="relative w-full h-full overflow-hidden"
      style={{
        backgroundColor: bgColor,
        backgroundImage: gradientStyle ? `${gradientStyle}, ${bgImage ? `url(${bgImage})` : 'none'}` : (bgImage ? `url(${bgImage})` : undefined),
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        filter: bgBlur && bgBlur > 0 ? `blur(${bgBlur}px)` : undefined,
      }}
    >
      {/* Background video — show first frame, play on click */}
      {slide.styles?.backgroundVideo && (
        <BackgroundVideoPlayer src={slide.styles.backgroundVideo} />
      )}
      <div className="absolute inset-0" style={{
        background: gradientStyle,
        pointerEvents: 'none' as const,
      }} />
      {items.map(item => (
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
  );
});

SlideItemsPreview.displayName = 'SlideItemsPreview';

// Media preview components
const VideoPreview = memo(({ thumbnailUrl, objectFit, mediaUrl }: {
  thumbnailUrl?: string;
  objectFit?: string;
  mediaUrl?: string;
}) => {
  const { t } = useTranslation();
  const [playing, setPlaying] = useState(false);

  if (playing && mediaUrl) {
    return (
      <div className="relative w-full h-full">
        <video
          src={mediaUrl}
          autoPlay
          loop
          muted
          className={cn('w-full h-full', objectFit === 'cover' ? 'object-cover' : 'object-contain')}
        />
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setPlaying(false); }}
          className="absolute top-1.5 left-1.5 w-6 h-6 rounded-full bg-black/60 flex items-center justify-center hover:bg-black/80 transition-colors z-10"
          aria-label={t('common.stopVideo')}
        >
          <X className="w-3.5 h-3.5 text-white" />
        </button>
      </div>
    );
  }

  return (
    <div
      className="relative w-full h-full group cursor-pointer"
      onClick={(e) => { e.stopPropagation(); if (mediaUrl) setPlaying(true); }}
      role="button"
      tabIndex={0}
      aria-label={t('common.playVideo')}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (mediaUrl) setPlaying(true); } }}
    >
      {thumbnailUrl ? (
        <img
          src={thumbnailUrl}
          className={cn('w-full h-full', objectFit === 'cover' ? 'object-cover' : 'object-contain')}
          alt="Video thumbnail"
          loading="lazy"
        />
      ) : (
        <div className="w-full h-full flex flex-col items-center justify-center gap-2">
          <Video className="w-10 h-10 text-white/20" aria-hidden="true" />
          <span className="text-[10px] text-white/50">{t('common.slideVideo')}</span>
        </div>
      )}
      <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity bg-black/20">
        <div className="w-10 h-10 rounded-full bg-white/90 flex items-center justify-center shadow-lg">
          <Play className="w-5 h-5 text-black ml-0.5" />
        </div>
      </div>
    </div>
  );
});

VideoPreview.displayName = 'VideoPreview';

const ScreenPreview = memo(({ content }: { content?: string }) => {
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

// Background video player — shows first frame, play/pause on click
const BackgroundVideoPlayer = memo(({ src }: { src: string }) => {
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

const TextSlidePreview = memo(({ slide, isHovered = false }: { slide: Slide; isHovered?: boolean }) => {
  const displayContent = slide.partsMode && slide.parts?.length
    ? slide.parts[slide.activePart ?? 0]
    : slide.content;
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
        <BackgroundVideoPlayer src={slide.styles.backgroundVideo} />
      )}
      <div className="absolute inset-0" style={{
        background: gradientStyle,
        pointerEvents: 'none' as const,
      }} />
      <p
        className="font-bold whitespace-pre-wrap text-white/90 leading-snug line-clamp-6 relative z-10"
        style={{
          color: slide.styles?.textColor ?? '#ffffff',
          fontSize: '16px',
          fontFamily: slide.styles?.fontFamily || 'inherit',
        }}
      >
        {displayContent}
      </p>
    </div>
  );
});

TextSlidePreview.displayName = 'TextSlidePreview';

// Slide content renderer
const SlideContent = memo(({ slide, isHovered = false }: { slide: Slide; isHovered?: boolean }) => {
  const { t } = useTranslation();
  const hasItems = slide.items && slide.items.length > 0;

  if (hasItems) {
    return (
      <SlideItemsPreview
        items={slide.items!}
        slide={slide}
        isHovered={isHovered}
      />
    );
  }

  switch (slide.type) {
    case 'image':
      return (
        <img
          src={slide.mediaUrl}
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
          <div className="w-full h-full flex items-center justify-center bg-black/50">
            <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center">
              <div className="w-0 h-0 border-l-[8px] border-l-white border-t-[5px] border-t-transparent border-b-[5px] border-b-transparent ml-1" />
            </div>
          </div>
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
      } catch {}
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

    default:
      return <TextSlidePreview slide={slide} isHovered={isHovered} />;
  }
});

SlideContent.displayName = 'SlideContent';

// Badges section
const SlideBadges = memo(({ slide, index, isLive }: {
  slide: Slide;
  index: number;
  isLive: boolean;
}) => {
  const { t } = useTranslation();
  const showGroup = slide.group;
  const showType = slide.type !== 'text';
  const groupColor = slide.group?.color;
  const showBadges = showGroup || showType || isLive;

  if (!showBadges && !isLive) {
    return (
      <div className="absolute top-2 left-2 z-10">
        <Badge>{index + 1}</Badge>
      </div>
    );
  }

  return (
    <div className="absolute top-2 left-2 z-10 flex items-center gap-2">
      <Badge>{index + 1}</Badge>

      {showGroup && !slide.partsMode && (
        <Badge color={groupColor}>
          <span className="max-w-[160px] truncate inline-block" style={{ color: groupColor }}>
            {slide.group!.title} {slide.group!.part}/{slide.group!.parts}
          </span>
        </Badge>
      )}

      {slide.partsMode && slide.parts && slide.parts.length > 0 && slide.group && (
        <Badge color={groupColor}>
          <span className="flex items-center gap-1" style={{ color: groupColor }}>
            <ListOrdered className="w-3 h-3" />
            {slide.group.title} {(slide.activePart ?? 0) + 1}/{slide.parts.length}
          </span>
        </Badge>
      )}

      {showType && (
        <Badge>{slide.type}</Badge>
      )}

      {isLive && (
        <Badge variant="live">{t('common.liveCardLabel')}</Badge>
      )}
    </div>
  );
});

SlideBadges.displayName = 'SlideBadges';

// Main SlideCard component
export const SlideCard = memo(({
  slide,
  index,
  isSelected,
  isLive,
  onClick,
  onDragStart,
  onDragOver,
  onDragEnd,
  onDrop,
  isDragging,
  zoom = 1,
}: SlideCardProps) => {
  const { t } = useTranslation();
  const [isHovered, setIsHovered] = useState(false);

  const handleClick = useCallback((e: React.MouseEvent) => {
    onClick(slide.id, index, e);
  }, [onClick, slide.id, index]);

  const handleDragStart = useCallback((e: React.DragEvent) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', slide.id);
    e.stopPropagation();
    onDragStart?.(slide.id, index);
  }, [onDragStart, slide.id, index]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    onDragOver?.(slide.id, index);
  }, [onDragOver, slide.id, index]);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDragEnd = useCallback(() => {
    onDragEnd?.();
  }, [onDragEnd, slide.id]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onDrop?.();
  }, [onDrop, slide.id]);

  const groupColor = slide.group?.color;
  const cardClassName = useMemo(() => cn(
    'relative rounded-xl border text-left transition-[border-color,box-shadow,background-color,opacity] overflow-hidden bg-white/5 hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none active:scale-[0.98]',
    isSelected && 'border-blue-500 shadow-[0_0_0_2px_rgba(59,130,246,0.6)]',
    !isSelected && !isLive && 'border-white/10',
    isLive && 'live-border-pulse',
    isDragging && 'opacity-50'
  ), [isSelected, isLive, isDragging]);

  const slideLabel = isLive
    ? t('common.slideCardLiveLabel', { index: index + 1 })
    : t('common.slideCardLabel', { index: index + 1, content: slide.content?.substring(0, 40) });

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDrop={handleDrop}
      onClick={handleClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onFocus={() => setIsHovered(true)}
      onBlur={() => setIsHovered(false)}
      tabIndex={0}
      role="button"
      className={cn(cardClassName, 'cursor-grab active:cursor-grabbing')}
      style={{ ...(groupColor ? { borderLeftWidth: 4, borderLeftColor: groupColor } : {}), zoom }}
      aria-pressed={isSelected}
      aria-label={slideLabel}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick(slide.id, index, undefined);
        }
      }}
    >
      <SlideBadges slide={slide} index={index} isLive={isLive} />

      <div className="aspect-video bg-black flex items-center justify-center overflow-hidden">
        <SlideContent slide={slide} isHovered={isHovered} />
      </div>
    </div>
  );
});

SlideCard.displayName = 'SlideCard';
