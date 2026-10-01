import { memo, useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Captions, ListOrdered, Monitor, Pause, Play, Video } from 'lucide-react';
import type { Slide, SlideItem, TextStyle } from '../types';
import { getSlideDisplayContent } from '../../shared/slideContent';
import { cn } from '../utils';

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
export const TextItem = memo(({ item }: { item: SlideItem }) => {
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
        backgroundColor: styles.textHighlight && styles.textHighlight !== 'transparent'
          ? styles.textHighlight
          : (styles.backgroundColor ?? 'transparent'),
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

// Background video player — shows first frame, play/pause on click
export const BackgroundVideoPlayer = memo(({ src }: { src: string }) => {
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

// Slide items container
export const SlideItemsPreview = memo(({ items, slide }: {
  items: SlideItem[];
  slide: Slide;
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

// Legacy (item-less) text slide preview
export const TextSlidePreview = memo(({ slide, cardWidth = 320 }: { slide: Slide; cardWidth?: number }) => {
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
}

/**
 * Lightweight preview for any slide shape; used by the slide editor rail.
 * Deliberately avoids VideoPreview / LoopVideoPreview so that scrolling a long
 * deck never queues ffmpeg thumbnail jobs or video decoding per thumbnail.
 */
export const SlidePreviewAny = memo(({ slide, cardWidth = 320 }: SlidePreviewAnyProps) => {
  const { t } = useTranslation();

  if (slide.items && slide.items.length > 0) {
    return <SlideItemsPreview items={slide.items} slide={slide} />;
  }

  switch (slide.type) {
    case 'image':
      return (
        <img
          src={slide.mediaUrl}
          className={cn(
            'w-full h-full bg-black',
            slide.styles?.objectFit === 'cover' ? 'object-cover' : 'object-contain'
          )}
          alt="Slide"
          loading="lazy"
        />
      );

    case 'video':
      return slide.thumbnailUrl ? (
        <img
          src={slide.thumbnailUrl}
          className={cn(
            'w-full h-full bg-black',
            slide.styles?.objectFit === 'cover' ? 'object-cover' : 'object-contain'
          )}
          alt="Video thumbnail"
          loading="lazy"
        />
      ) : (
        <PlaceholderPreview icon={Video} label={t('common.slideVideo')} />
      );

    case 'screen':
      return <PlaceholderPreview icon={Monitor} label={t('common.slideScreenCapture')} />;

    case 'loop': {
      const first = slide.loopItems?.[0];
      if (!first) return <PlaceholderPreview icon={ListOrdered} label={t('common.loopLabel')} />;
      const src = first.type === 'video' ? first.thumbnailUrl : first.mediaUrl;
      return src ? (
        <img src={src} className="w-full h-full object-cover bg-black" alt="Loop" loading="lazy" />
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
          <span className="font-mono font-bold text-lg leading-none">
            {String(minutes).padStart(2, '0')}:{String(seconds).padStart(2, '0')}
          </span>
        </div>
      );
    }

    case 'captions':
      return <PlaceholderPreview icon={Captions} label={t('common.captionsSlide')} />;

    case 'text':
    default:
      return <TextSlidePreview slide={slide} cardWidth={cardWidth} />;
  }
});

SlidePreviewAny.displayName = 'SlidePreviewAny';
