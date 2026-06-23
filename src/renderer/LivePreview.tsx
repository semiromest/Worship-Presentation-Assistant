import { memo, useEffect, useRef, useState } from 'react';
import type { Slide, SlideItem, LoopItem } from './types';
import { cn } from './utils';
import { SLIDE_REFERENCE_WIDTH, ANIM_MAP } from './constants';
import CountdownRenderer from './CountdownRenderer';
import ScreenCaptureRenderer from './ScreenCaptureRenderer';
import { useTranslation } from 'react-i18next';

export interface LivePreviewProps {
  slide: Slide | undefined;
  size?: 'preview' | 'projector';
  volume?: number;
  muted?: boolean;
  isActive?: boolean;
}

function VideoPlayer({ mediaUrl, objectFit, volume = 1, muted = false }: { mediaUrl?: string; objectFit?: string; volume?: number; muted?: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.volume = volume;
    video.muted = muted;
  }, [volume, muted]);

  if (!mediaUrl) return null;

  return (
    <video
      ref={videoRef}
      src={mediaUrl}
      autoPlay
      loop
      className={cn('w-full h-full', objectFit === 'cover' ? 'object-cover' : 'object-contain')}
    />
  );
}

// ─── Loop Renderer ──────────────────────────────────────────────────────────

function LoopRenderer({ slide, width, height, isActive = true }: { slide: Slide; width: number; height: number; isActive?: boolean }) {
  const { t } = useTranslation();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [outgoing, setOutgoing] = useState<{ item: LoopItem; idx: number } | null>(null);
  const items = slide.loopItems ?? [];
  const currentItem = items[currentIndex];
  const loopTr = slide.loopTransition;
  const trType = loopTr?.type ?? 'none';
  const trDuration = loopTr?.duration ?? 400;
  const anim = ANIM_MAP[trType];

  useEffect(() => {
    if (!items.length || !isActive) return;
    const timer = setTimeout(() => {
      setOutgoing({ item: currentItem, idx: currentIndex });
      setCurrentIndex(prev => (prev + 1) % items.length);
    }, currentItem?.duration ?? 5000);
    return () => clearTimeout(timer);
  }, [currentIndex, items.length, currentItem?.duration, isActive]);

  useEffect(() => {
    if (!outgoing) return;
    if (trType === 'none' || trDuration === 0) {
      setOutgoing(null);
      return;
    }
    const timer = setTimeout(() => setOutgoing(null), trDuration + 50);
    return () => clearTimeout(timer);
  }, [outgoing, trType, trDuration]);

  if (!items.length) {
    return (
      <div className="bg-black flex items-center justify-center" style={{ width, height }}>
        <span className="text-white/45 text-sm">{t('loop.noItems')}</span>
      </div>
    );
  }

  if (!currentItem) return null;

  const outgoingAnim = outgoing && anim.out ? `${anim.out} ${trDuration}ms ease forwards` : undefined;
  const incomingAnim = outgoing && anim.in ? `${anim.in} ${trDuration}ms ease forwards` : undefined;
  const showOutgoing = outgoing !== null && trType !== 'none' && trDuration > 0;

  return (
    <div className="relative overflow-hidden bg-black" style={{ width, height }}>
      {/* Outgoing layer */}
      {showOutgoing && outgoing && (
        <div className="absolute inset-0" style={{ animation: outgoingAnim }}>
          {outgoing.item.type === 'image' ? (
            <img
              src={outgoing.item.mediaUrl}
              className="w-full h-full object-contain"
              alt=""
            />
          ) : (
            <LoopVideoPlayer mediaUrl={outgoing.item.mediaUrl} isActive={false} />
          )}
        </div>
      )}

      {/* Incoming layer */}
      <div className="absolute inset-0" style={{ animation: incomingAnim }}>
        {currentItem.type === 'image' ? (
          <img
            src={currentItem.mediaUrl}
            className="w-full h-full object-contain"
            alt=""
          />
        ) : (
          <LoopVideoPlayer mediaUrl={currentItem.mediaUrl} isActive={isActive} />
        )}
      </div>
    </div>
  );
}

function LoopVideoPlayer({ mediaUrl, isActive = true }: { mediaUrl: string; isActive?: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = 0;
    if (isActive) {
      video.play().catch(() => {});
    } else {
      video.pause();
    }
  }, [mediaUrl, isActive]);

  return (
    <video
      ref={videoRef}
      src={mediaUrl}
      autoPlay
      className="w-full h-full object-contain"
    />
  );
}

export const LivePreview = memo(({ slide, size = 'preview', volume = 1, muted = false, isActive = true }: LivePreviewProps) => {
  const outerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0, scale: 1 });

  useEffect(() => {
    const el = outerRef.current;
    if (!el) return;

    const update = () => {
      const parentW = el.clientWidth;
      const parentH = el.clientHeight;
      if (parentW === 0 || parentH === 0) return;

      // 16:9 hedef oran
      const targetRatio = 16 / 9;
      const parentRatio = parentW / parentH;

      let w, h;
      if (parentRatio > targetRatio) {
        // Ekran daha geniş - yüksekliğe göre sığdır
        h = parentH;
        w = h * targetRatio;
      } else {
        // Ekran daha dar - genişliğe göre sığdır
        w = parentW;
        h = w / targetRatio;
      }

      setDimensions({
        width: w,
        height: h,
        scale: w / SLIDE_REFERENCE_WIDTH
      });
    };

    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (!slide) return null;

  const { scale, width, height } = dimensions;

  // İçerik katmanı - her zaman 16:9 ve ortalanmış
  const renderContent = () => {
    if (slide.items?.length) {
      return (
        <div
          className="relative overflow-hidden"
          style={{ 
            width: `${width}px`, 
            height: `${height}px`,
            backgroundColor: slide.styles?.backgroundColor ?? '#000000',
          }}
        >
          {slide.styles?.backgroundVideo && (
            <video
              src={slide.styles.backgroundVideo}
              autoPlay
              loop
              muted
              className="absolute inset-0 w-full h-full object-cover pointer-events-none"
            />
          )}
          {slide.items.map(item => {
            const borderWidth = item.borderWidth || 0;
            const borderStyle = borderWidth > 0
              ? `${borderWidth}px solid ${item.borderColor || '#ffffff'}`
              : undefined;
            const borderRadius = item.borderRadius
              ? `${item.borderRadius * scale}px`
              : undefined;

            return (
            <div
              key={item.id}
              className="absolute overflow-hidden"
              style={{
                left: `${item.x}%`, top: `${item.y}%`,
                width: `${item.width}%`, height: `${item.height}%`,
                transform: item.rotation ? `rotate(${item.rotation}deg)` : undefined,
                transformOrigin: item.rotation ? 'center center' : undefined,
                zIndex: item.zIndex || 0,
                border: borderStyle,
                borderRadius,
              }}
            >
              {item.type === 'image' ? (() => {
                const imgStyles = item.imageStyles;
                const cssFilter = [
                  imgStyles?.brightness !== 1 ? `brightness(${imgStyles?.brightness ?? 1})` : null,
                  imgStyles?.contrast   !== 1 ? `contrast(${imgStyles?.contrast ?? 1})`     : null,
                  imgStyles?.grayscale ? `grayscale(${imgStyles?.grayscale})`   : null,
                  imgStyles?.sepia     ? `sepia(${imgStyles?.sepia})`            : null,
                  imgStyles?.blur      ? `blur(${imgStyles?.blur}px)`             : null,
                ].filter(Boolean).join(' ') || undefined;

                const flipTransform = [
                  imgStyles?.flipX ? 'scaleX(-1)' : '',
                  imgStyles?.flipY ? 'scaleY(-1)' : '',
                ].filter(Boolean).join(' ');

                const cropClipPath = imgStyles?.crop
                  ? `inset(${imgStyles.crop.y}% ${100 - imgStyles.crop.x - imgStyles.crop.width}% ${100 - imgStyles.crop.y - imgStyles.crop.height}% ${imgStyles.crop.x}%)`
                  : undefined;

                return (
                  <div className="w-full h-full" style={{ clipPath: cropClipPath }}>
                    <img
                      src={item.mediaUrl}
                      className={cn('w-full h-full', imgStyles?.objectFit === 'cover' ? 'object-cover' : 'object-contain')}
                      style={{
                        opacity: imgStyles?.opacity ?? 1,
                        filter: cssFilter,
                        transform: flipTransform || undefined,
                      }}
                      alt=""
                    />
                  </div>
                );
              })() : (
                <div
                  className="w-full h-full overflow-hidden p-2 flex items-center justify-center"
                  style={{
                    padding:         `${8 * scale}px`,
                    textAlign:       item.textStyles?.textAlign || 'center',
                  }}
                >
                  <span
                    style={{
                      textTransform:   item.textStyles?.textTransform || 'none',
                      color:           item.textStyles?.textColor ?? '#ffffff',
                      fontSize:        `${Math.max(4, (item.textStyles?.fontSize || 32) * scale)}px`,
                      fontFamily:      item.textStyles?.fontFamily,
                      fontWeight:      item.textStyles?.fontWeight || 'normal',
                      fontStyle:       item.textStyles?.fontStyle || 'normal',
                      letterSpacing:   item.textStyles?.letterSpacing ? `${item.textStyles.letterSpacing * scale}px` : undefined,
                      lineHeight:      item.textStyles?.lineHeight || 1.25,
                      backgroundColor: item.textStyles?.backgroundColor ?? 'transparent',
                      textDecoration:  item.textStyles?.textDecoration || undefined,
                      textShadow:      item.textStyles?.textShadow
                        ? `${item.textStyles.textShadow.color || '#000'} ${(item.textStyles.textShadow.offsetX || 0) * scale}px ${(item.textStyles.textShadow.offsetY || 0) * scale}px ${(item.textStyles.textShadow.blur || 0) * scale}px`
                        : undefined,
                      WebkitTextStroke: item.textStyles?.textStroke
                        ? `${(item.textStyles.textStroke.width || 0) * scale}px ${item.textStyles.textStroke.color}`
                        : undefined,
                      whiteSpace:      'pre-wrap',
                      width:           '100%',
                      display:         'block',
                    }}
                  >
                    {item.content}
                  </span>
                </div>
              )}
            </div>
            );
          })}
        </div>
      );
    }

    if (slide.type === 'image') {
      const s = (slide.styles || {}) as Record<string, any>;
      const cssFilter = [
        s.imageBrightness !== 1 && s.imageBrightness !== undefined ? `brightness(${s.imageBrightness})` : null,
        s.imageContrast !== 1 && s.imageContrast !== undefined ? `contrast(${s.imageContrast})` : null,
        s.imageGrayscale ? `grayscale(${s.imageGrayscale})` : null,
        s.imageSepia ? `sepia(${s.imageSepia})` : null,
        s.imageBlur ? `blur(${s.imageBlur}px)` : null,
      ].filter(Boolean).join(' ') || undefined;

      const flipTransform = [
        s.imageFlipX ? 'scaleX(-1)' : '',
        s.imageFlipY ? 'scaleY(-1)' : '',
      ].filter(Boolean).join(' ');

      const objectFitClass =
        s.objectFit === 'cover' ? 'object-cover'
          : s.objectFit === 'fill' ? 'object-fill'
            : 'object-contain';

      return (
        <div className="relative overflow-hidden" style={{ width: `${width}px`, height: `${height}px` }}>
          <img
            src={slide.mediaUrl}
            className={cn('w-full h-full', objectFitClass)}
            style={{
              opacity: s.opacity ?? 1,
              filter: cssFilter,
              transform: flipTransform || undefined,
            }}
            alt=""
          />
        </div>
      );
    }

    if (slide.type === 'video') {
      return (
        <div className="relative overflow-hidden" style={{ width: `${width}px`, height: `${height}px` }}>
          <VideoPlayer
            mediaUrl={slide.mediaUrl}
            objectFit={slide.styles?.objectFit}
            volume={volume}
            muted={muted}
          />
        </div>
      );
    }

    if (slide.type === 'countdown') {
      return <CountdownRenderer slide={slide} size={size} />;
    }

    if (slide.type === 'screen') {
      return (
        <div className="bg-black flex items-center justify-center" style={{ width: `${width}px`, height: `${height}px` }}>
          <ScreenCaptureRenderer
            sourceId={slide.mediaUrl}
            sourceName={slide.content}
            volume={volume}
            muted={muted}
          />
        </div>
      );
    }

    if (slide.type === 'loop') {
      return <LoopRenderer slide={slide} width={width} height={height} isActive={isActive} />;
    }

    const styles = (slide.styles || {}) as Record<string, any>;
    const displayContent = slide.partsMode && slide.parts?.length
      ? slide.parts[slide.activePart ?? 0]
      : slide.content;
    const fontSize = styles.fontSize || 48;
    const fontWeight = (styles as any).fontWeight || 'bold';
    const textAlign = (styles as any).textAlign || 'center';
    const verticalAlign = (styles as any).verticalAlign || 'center';
    const alignItemsMap: Record<string, string> = { top: 'flex-start', center: 'center', bottom: 'flex-end' };

    return (
      <div
        className="flex relative overflow-hidden"
        style={{
          width: `${width}px`,
          height: `${height}px`,
          backgroundColor: styles.backgroundColor ?? '#000',
          backgroundImage: styles.backgroundImage ? `url(${styles.backgroundImage})` : undefined,
          backgroundSize: 'cover', backgroundPosition: 'center',
          textAlign: textAlign as any,
          alignItems: alignItemsMap[verticalAlign] || 'center',
          justifyContent: 'center',
        }}
      >
        {styles.backgroundVideo && (
          <video
            src={styles.backgroundVideo}
            autoPlay
            loop
            muted
            className="absolute inset-0 w-full h-full object-cover pointer-events-none"
          />
        )}
        <p
          className="whitespace-pre-wrap leading-snug relative z-10"
          style={{ 
            textTransform: (styles as any).textTransform || 'none',
            fontSize: `${Math.max(8, fontSize * scale)}px`, 
            color: styles.textColor ?? '#fff',
            fontWeight: fontWeight as any,
            fontStyle: (styles as any).fontStyle || 'normal',
            fontFamily: (styles as any).fontFamily || 'inherit',
            lineHeight: (styles as any).lineHeight || 1.3,
            width: '100%',
            padding: `${20 * scale}px`,
          }}
        >
          {displayContent}
        </p>
      </div>
    );
  };

  return (
    <div 
      ref={outerRef} 
      className="w-full h-full flex items-center justify-center overflow-hidden"
      style={{ backgroundColor: '#000' }}
    >
      {renderContent()}
    </div>
  );
});