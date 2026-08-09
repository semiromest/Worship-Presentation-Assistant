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

  const thumbnailCache = useRef<Map<string, { url: string }>>(new Map());
  const prevSlidesRef = useRef<Slide[]>([]);
  // Son üretimi başarısız olan (null dönen) slaytlar: içerik değişmese bile
  // bir sonraki run'da yeniden denenir. Aksi halde prevSlidesRef ilerlediği
  // için changed bir daha true olmaz ve önizleme kalıcı olarak boş kalır.
  const pendingRetryRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    const CACHE_MAX = 100;

    (async () => {
      const prevSlides = prevSlidesRef.current;
      const currentSlides = throttledPresentation.slides;

      if (prevSlides === currentSlides) return;

      if (thumbnailCache.current.size > CACHE_MAX) {
        const keys = [...thumbnailCache.current.keys()];
        for (let i = 0; i < keys.length - CACHE_MAX; i++) {
          thumbnailCache.current.delete(keys[i]);
        }
      }

      const prevMap = new Map(prevSlides.map(s => [s.id, s]));

      for (const id of prevMap.keys()) {
        if (!currentSlides.some(s => s.id === id)) {
          thumbnailCache.current.delete(id);
          pendingRetryRef.current.delete(id);
        }
      }

      const thumbs: (string | null)[] = new Array(currentSlides.length);
      let idx = 0;

      const worker = async () => {
        while (idx < currentSlides.length && !cancelled) {
          const i = idx++;
          const s = currentSlides[i];
          const prev = prevMap.get(s.id);
          const cachedEntry = thumbnailCache.current.get(s.id);
          const changed = !prev ||
            prev.content !== s.content ||
            prev.mediaUrl !== s.mediaUrl ||
            prev.type !== s.type ||
            prev.thumbnailUrl !== s.thumbnailUrl ||
            (prev.items?.length ?? 0) !== (s.items?.length ?? 0) ||
            (prev.loopItems?.length ?? 0) !== (s.loopItems?.length ?? 0) ||
            // FIX: partsMode slides must regenerate when activePart changes
            prev.activePart !== s.activePart ||
            JSON.stringify(prev.styles) !== JSON.stringify(s.styles) ||
            // Son denemesi başarısız olan slayt tekrar denenir
            pendingRetryRef.current.has(s.id);

          if (!changed) {
            thumbs[i] = cachedEntry?.url ?? null;
          } else {
            const url = await generateSlideThumbnail(s);
            if (url && !cancelled) {
              thumbnailCache.current.set(s.id, { url });
              pendingRetryRef.current.delete(s.id);
              thumbs[i] = url;
            } else if (!cancelled) {
              // Üretim başarısız (ctx/taint hatası vb.): hiç boş göndermek
              // yerine son geçerli görseli koru ve retry için işaretle.
              pendingRetryRef.current.add(s.id);
              thumbs[i] = cachedEntry?.url ?? null;
            } else {
              thumbs[i] = null;
            }
          }
        }
      };

      await Promise.all(Array.from({ length: 4 }, () => worker()));

      // FIX: only a non-cancelled run may advance prevSlidesRef; a late-finishing
      // cancelled run could otherwise corrupt the next changed() comparison.
      if (!cancelled) prevSlidesRef.current = currentSlides;

      if (!cancelled) {
        window.electronAPI?.updateAllSlidePreviews?.(thumbs);

        const liveSlide = currentSlides[liveIndex];
        const liveThumb = liveSlide ? thumbs[liveIndex] : null;
        if (liveThumb) {
          window.electronAPI?.sendSlidePreview?.(liveThumb);
        }

        // Canlı slaytın üretimi başarısızsa, kısa bir bekleyip bir kez daha
        // dene — kullanıcı başka bir değişiklik yapmadan önizleme düzelir.
        if (liveSlide && pendingRetryRef.current.has(liveSlide.id)) {
          setTimeout(async () => {
            if (cancelled) return;
            const retryUrl = await generateSlideThumbnail(liveSlide);
            if (cancelled || !retryUrl) return;
            thumbnailCache.current.set(liveSlide.id, { url: retryUrl });
            pendingRetryRef.current.delete(liveSlide.id);
            window.electronAPI?.sendSlidePreview?.(retryUrl);
          }, 180);
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

  // Remote status rides the UNTHROTTLED presentation so part taps (partGoto)
  // reflect on phones immediately instead of lagging behind useThrottle().
  useEffect(() => {
    const remoteTransition = TRANSITION_MAP[transitionType as TransitionType] ?? 'fade';
    const liveSlide = presentation.slides[liveIndex];

    window.electronAPI?.updateRemoteStatus?.({
      slideCount: presentation.slides.length,
      currentIndex: liveIndex,
      isBlackout,
      isProjectorOpen: isProjectorWindowOpen,
      slideTransition: remoteTransition,
      transitionDurationMs: transitionDuration,
      // partsMode: expose active part info so remote can show part navigation
      activePart: liveSlide?.partsMode ? (liveSlide.activePart ?? 0) : undefined,
      partsCount: liveSlide?.partsMode ? (liveSlide.parts?.length ?? 1) : undefined,
      slidePreviews: presentation.slides.map((slide) => ({
        type: slide.type,
        content: slide.content,
        mediaUrl: slide.mediaUrl,
        styles: slide.styles,
        partsMode: !!slide.partsMode,
        parts: slide.parts ?? null,
        title: slide.group?.title ?? null,
      })),
    });
  }, [
    presentation.slides,
    liveIndex,
    isBlackout,
    isProjectorWindowOpen,
    transitionType,
    transitionDuration,
  ]);
}
