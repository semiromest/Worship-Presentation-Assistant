import { useEffect, useRef } from 'react';
import { useStore } from '../state/useStore';
import { IS_PROJECTOR_MODE, DEFAULT__TRANSITION } from '../constants';
import { generateSlideThumbnail, useThrottle } from '../utils';
import type { Slide, TransitionType } from '../types';

const TRANSITION_MAP: Record<TransitionType, string> = {
  none: 'none',
  fade: 'fade',
  slideLeft: 'slide-left',
  slideRight: 'slide-right',
  slideUp: 'slide-up',
  slideDown: 'slide-down',
  zoom: 'zoom',
  zoomOut: 'zoom',
  blur: 'blur',
  flip: 'flip',
};

export function useProjectorSync() {
  const {
    presentation,
    liveIndex,
    isBlackout,
    isProjectorWindowOpen,
    mediaVolume,
    isMediaMuted,
  } = useStore();

  const transitionType = presentation.transition?.type ?? DEFAULT__TRANSITION.type;
  const transitionDuration = presentation.transition?.duration ?? DEFAULT__TRANSITION.duration;

  const throttledPresentation = useThrottle(presentation, 300);

  useEffect(() => {
    if (!IS_PROJECTOR_MODE && isProjectorWindowOpen) {
      window.electronAPI?.updateProjector?.({
        presentation: throttledPresentation,
        liveIndex: liveIndex,
        isBlackout,
        volume: mediaVolume,
        muted: isMediaMuted,
      });
    }
  }, [throttledPresentation, liveIndex, isBlackout, isProjectorWindowOpen, mediaVolume, isMediaMuted]);

  const thumbnailCache = useRef<Map<string, { hash: string; url: string }>>(new Map());
  const prevSlidesRef = useRef<Slide[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const prevSlides = prevSlidesRef.current;
      const currentSlides = throttledPresentation.slides;

      if (prevSlides === currentSlides) return;

      const prevMap = new Map(prevSlides.map(s => [s.id, s]));

      for (const id of prevMap.keys()) {
        if (!currentSlides.some(s => s.id === id)) {
          thumbnailCache.current.delete(id);
        }
      }

      const thumbs = await Promise.all(
        currentSlides.map(async (s) => {
          const prev = prevMap.get(s.id);
          const changed = !prev ||
            prev.content !== s.content ||
            prev.mediaUrl !== s.mediaUrl ||
            prev.type !== s.type ||
            prev.thumbnailUrl !== s.thumbnailUrl ||
            (prev.items?.length ?? 0) !== (s.items?.length ?? 0) ||
            (prev.loopItems?.length ?? 0) !== (s.loopItems?.length ?? 0) ||
            JSON.stringify(prev.styles) !== JSON.stringify(s.styles);

          if (!changed) {
            const cached = thumbnailCache.current.get(s.id);
            return cached?.url ?? null;
          }

          const hash = `${s.id}-${s.content}-${s.mediaUrl}-${JSON.stringify(s.styles)}-${s.items?.length ?? 0}`;
          const url = await generateSlideThumbnail(s);
          if (url) {
            thumbnailCache.current.set(s.id, { hash, url });
          }
          return url;
        })
      );

      prevSlidesRef.current = currentSlides;

      if (!cancelled) {
        window.electronAPI?.updateAllSlidePreviews?.(thumbs);

        const liveSlide = currentSlides[liveIndex];
        const liveThumb = liveSlide ? thumbs[liveIndex] : null;
        if (liveThumb) {
          window.electronAPI?.sendSlidePreview?.(liveThumb);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [throttledPresentation.slides, liveIndex]);

  useEffect(() => {
    const slides = throttledPresentation.slides;
    const liveSlide = slides[liveIndex];
    if (!liveSlide) return;

    const cached = thumbnailCache.current.get(liveSlide.id);
    if (cached?.url) {
      window.electronAPI?.sendSlidePreview?.(cached.url);
    }
  }, [liveIndex, throttledPresentation.slides]);

  useEffect(() => {
    const remoteTransition = TRANSITION_MAP[transitionType as TransitionType] ?? 'fade';

    window.electronAPI?.updateRemoteStatus?.({
      slideCount: throttledPresentation.slides.length,
      currentIndex: liveIndex,
      isBlackout,
      isProjectorOpen: isProjectorWindowOpen,
      slideTransition: remoteTransition,
      transitionDurationMs: transitionDuration,
      slidePreviews: throttledPresentation.slides.map((slide) => ({
        type: slide.type,
        content: slide.content,
        mediaUrl: slide.mediaUrl,
        styles: slide.styles,
      })),
    });
  }, [
    throttledPresentation.slides,
    liveIndex,
    isBlackout,
    isProjectorWindowOpen,
    transitionType,
    transitionDuration,
  ]);
}
