import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../state/useStore';
import { IS_PROJECTOR_MODE, DEFAULT__TRANSITION } from '../constants';
import { generateSlideThumbnail, useThrottle } from '../utils';
import { computePatch, isPatchEmpty, type ProjectorPatch } from '../state/undoReducer';
import type { Presentation, Slide, TransitionType } from '../types';

/**
 * Top-level style equality (mirrors undoReducer.shallowEqual). Replaces
 * `JSON.stringify(styles)` comparison which ran per slide per deck change.
 * Immutable updates mean a changed nested field always produces a new
 * top-level styles object, so top-level reference equality is sufficient.
 */
function stylesEqual(a: Slide['styles'], b: Slide['styles']): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if ((a as Record<string, unknown>)[k] !== (b as Record<string, unknown>)[k]) return false;
  }
  return true;
}

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
    projectorReady,
    mediaVolume,
    isMediaMuted,
  } = useStore();

  const transitionType = presentation.transition?.type ?? DEFAULT__TRANSITION.type;
  const transitionDuration = presentation.transition?.duration ?? DEFAULT__TRANSITION.duration;

  const throttledPresentation = useThrottle(presentation, 300);

  // ── Phase 4: delta sync ────────────────────────────────────────────────
  // The projector applies patches on top of the base it last received, so the
  // control renderer tracks that base here. The base is reset to null (forcing
  // a full snapshot) whenever the projector window (re)signals readiness — a
  // fresh open or a reload of an existing window — via the ready handshake.
  const lastSentPresentationRef = useRef<Presentation | null>(null);
  // Epoch forces the sync effect to re-run on every ready ack even when the
  // projector was already marked ready (reload case: store value doesn't change).
  const [projectorEpoch, setProjectorEpoch] = useState(0);

  useEffect(() => {
    const off = window.electronAPI?.onProjectorReady?.(() => {
      useStore.getState().setProjectorReady(true);
      lastSentPresentationRef.current = null;
      setProjectorEpoch((e) => e + 1);
    });
    return off;
  }, []);

  // The projector window is destroyed on close and recreated per open, so its
  // base state always starts from the first snapshot after (re)open.
  useEffect(() => {
    if (!isProjectorWindowOpen) lastSentPresentationRef.current = null;
  }, [isProjectorWindowOpen]);

  useEffect(() => {
    if (IS_PROJECTOR_MODE || !isProjectorWindowOpen || !projectorReady) return;

    const nav = {
      liveIndex,
      isBlackout,
      volume: mediaVolume,
      muted: isMediaMuted,
    };

    const base = lastSentPresentationRef.current;
    if (base === null || base === throttledPresentation) {
      if (base !== throttledPresentation) {
        // First send after (re)open: full snapshot establishes the base.
        lastSentPresentationRef.current = throttledPresentation;
        window.electronAPI?.updateProjector?.({ ...nav, fullPresentation: throttledPresentation });
      } else {
        // Presentation unchanged — navigation/blackout/volume only.
        window.electronAPI?.updateProjector?.(nav);
      }
      return;
    }

    // Delta: send only what changed since the base. prevSlide/prevOrder are
    // stripped (the projector never undoes); the order list is sent only when
    // it actually changed (add/remove/reorder).
    const patch = computePatch(base, throttledPresentation);
    lastSentPresentationRef.current = throttledPresentation;
    if (isPatchEmpty(patch)) {
      window.electronAPI?.updateProjector?.(nav);
      return;
    }

    const orderChanged =
      patch.prevOrder.length !== patch.nextOrder.length ||
      patch.prevOrder.some((id, i) => id !== patch.nextOrder[i]);

    const transport: ProjectorPatch = {
      slidesPatch: patch.slidesPatch.map(({ id, nextSlide }) => ({ id, nextSlide })),
      ...(orderChanged && { nextOrder: patch.nextOrder }),
      ...(patch.nextName !== undefined && { nextName: patch.nextName }),
      ...(patch.nextZoom !== undefined && { nextZoom: patch.nextZoom }),
      ...(patch.nextTransition !== undefined && { nextTransition: patch.nextTransition }),
    };

    window.electronAPI?.updateProjector?.({ ...nav, patch: transport });
  }, [
    throttledPresentation,
    liveIndex,
    isBlackout,
    isProjectorWindowOpen,
    projectorReady,
    projectorEpoch,
    mediaVolume,
    isMediaMuted,
  ]);

  const thumbnailCache = useRef<Map<string, { url: string }>>(new Map());
  const prevSlidesRef = useRef<Slide[]>([]);
  // Retry slides whose last generation failed (null) even if unchanged, so their preview never stays empty forever.
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

      // Structural change (add/remove/reorder) shifts every remote index, so
      // those runs must send a full snapshot for the phone grid to re-index.
      // A pure content change can send a {index, url} delta that the remote
      // applies in place — the common case (editing one slide) stays O(1).
      const structurePreserved =
        prevSlides.length === currentSlides.length &&
        prevSlides.every((p, i) => p.id === currentSlides[i].id);

      // O(n) removal pass instead of prevMap.keys() × currentSlides.some() (O(n²)).
      const currentIds = new Set(currentSlides.map((s) => s.id));
      for (const id of prevMap.keys()) {
        if (!currentIds.has(id)) {
          thumbnailCache.current.delete(id);
          pendingRetryRef.current.delete(id);
        }
      }

      const thumbs: (string | null)[] = structurePreserved ? [] : new Array(currentSlides.length);
      const delta: { i: number; url: string }[] = [];
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
            !stylesEqual(prev.styles, s.styles) ||
            // Retry slides whose last attempt failed
            pendingRetryRef.current.has(s.id);

          if (!changed) {
            if (!structurePreserved) thumbs[i] = cachedEntry?.url ?? null;
          } else {
            const url = await generateSlideThumbnail(s);
            if (url && !cancelled) {
              thumbnailCache.current.set(s.id, { url });
              pendingRetryRef.current.delete(s.id);
              if (structurePreserved) delta.push({ i, url });
              else thumbs[i] = url;
            } else if (!cancelled) {
              // On failure keep the last valid image and flag for retry instead of sending an empty preview.
              pendingRetryRef.current.add(s.id);
              if (!structurePreserved) thumbs[i] = cachedEntry?.url ?? null;
            } else if (!structurePreserved) {
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
        if (structurePreserved) {
          if (delta.length > 0) {
            window.electronAPI?.updateSlidePreviewsDelta?.(delta);
          }
        } else {
          window.electronAPI?.updateAllSlidePreviews?.(thumbs);
        }

        const liveSlide = currentSlides[liveIndex];
        // Read from cache (not thumbs[]): in delta mode thumbs is empty, and
        // the cache always holds the freshest url for both modes anyway.
        const liveThumb = liveSlide ? (thumbnailCache.current.get(liveSlide.id)?.url ?? null) : null;
        if (liveThumb) {
          window.electronAPI?.sendSlidePreview?.(liveThumb);
        }

        // If the live slide failed to generate, wait briefly and retry once so the preview self-heals.
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

  // Per-slide metadata for phones. Recomputed ONLY when the deck changes,
  // never on navigation — the map over all slides + IPC + main-side
  // JSON.stringify comparison used to run on every liveIndex change (O(T)).
  const slidePreviews = useMemo(
    () =>
      presentation.slides.map((slide) => ({
        type: slide.type,
        content: slide.content,
        mediaUrl: slide.mediaUrl,
        styles: slide.styles,
        partsMode: !!slide.partsMode,
        parts: slide.parts ?? null,
        title: slide.group?.title ?? null,
      })),
    [presentation.slides],
  );

  // Remote status rides the UNTHROTTLED presentation so part taps (partGoto)
  // reflect on phones immediately instead of lagging behind useThrottle().
  useEffect(() => {
    // FIX: only the CONTROL window publishes remote status. The projector
    // window also runs this hook, and its own store keeps isProjectorWindowOpen
    // false (projector mode never flips it), so its status broadcast used to
    // clobber the control's correct isProjectorOpen=true on phones.
    if (IS_PROJECTOR_MODE) return;
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
      slidePreviews,
    });
  }, [
    presentation.slides,
    slidePreviews,
    liveIndex,
    isBlackout,
    isProjectorWindowOpen,
    transitionType,
    transitionDuration,
  ]);
}
