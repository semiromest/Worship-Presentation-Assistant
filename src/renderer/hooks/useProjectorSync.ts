import { setPreviewBroadcast } from '../scrollPreviewPolicy';
import { useRemotePreviews } from './useRemotePreviews';
import { usePractice } from '../hooks/usePractice';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../state/useStore';
import { useShallow } from 'zustand/shallow';
import { IS_PROJECTOR_MODE, DEFAULT__TRANSITION } from '../constants';
import { useThrottle } from '../utils';
import { computePatch, isPatchEmpty, type ProjectorPatch } from '../state/undoReducer';
import type { Presentation, TransitionType } from '../types';
import { chooseDefaultOutputDisplay, effectiveOutputSlideIndex, type DisplayMode } from '../../shared/displays';
import { findLockedSlideIndex } from '../slideLock';

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
  const practice = usePractice();
  const {
    presentation,
    liveSlideId,
    liveIndex,
    instantTransition,
    isBlackout,
    isProjectorWindowOpen,
    projectorReady,
    mediaVolume,
    isMediaMuted,
    displays,
    outputAssignments,
  } = useStore(
    useShallow((s) => ({
      presentation: s.presentation,
      liveSlideId: s.liveSlideId,
      liveIndex: s.liveIndex,
      instantTransition: s.instantTransition,
      isBlackout: s.isBlackout,
      isProjectorWindowOpen: s.isProjectorWindowOpen,
      projectorReady: s.projectorReady,
      mediaVolume: s.mediaVolume,
      isMediaMuted: s.isMediaMuted,
      displays: s.displays,
      outputAssignments: s.outputAssignments,
    })),
  );

  const transitionType = presentation.transition?.type ?? DEFAULT__TRANSITION.type;
  const transitionDuration = presentation.transition?.duration ?? DEFAULT__TRANSITION.duration;

  const throttledPresentation = useThrottle(presentation, 300);

  const hasOpenOutputs = useMemo(
    () => isProjectorWindowOpen || Object.values(outputAssignments).some((assignment) => assignment.isOpen),
    [isProjectorWindowOpen, outputAssignments],
  );

  useEffect(() => { if (!IS_PROJECTOR_MODE) setPreviewBroadcast(hasOpenOutputs); return () => { if (!IS_PROJECTOR_MODE) setPreviewBroadcast(false); }; }, [hasOpenOutputs]);

  const outputFrames = useMemo(() => {
    const defaultDisplayId = chooseDefaultOutputDisplay(displays)?.id;
    const ids = new Set(
      Object.entries(outputAssignments)
        .filter(([, assignment]) => assignment.isOpen)
        .map(([displayId]) => displayId),
    );
    if (isProjectorWindowOpen && defaultDisplayId) ids.add(defaultDisplayId);

    const frames: Record<string, {
      mode: DisplayMode;
      slideIndex: number;
      slideId: string | null;
      isBlackout: boolean;
    }> = {};
    for (const displayId of ids) {
      const assignment = outputAssignments[displayId];
      const slideIndex = effectiveOutputSlideIndex(assignment, liveIndex, presentation.slides.length);
      frames[displayId] = {
        mode: assignment?.mode ?? 'follow',
        slideIndex,
        slideId: presentation.slides[slideIndex]?.id ?? null,
        isBlackout: displayId === defaultDisplayId
          ? isBlackout
          : !!assignment?.isBlackout,
      };
    }
    return frames;
  }, [
    displays,
    outputAssignments,
    liveIndex,
    presentation.slides,
    isProjectorWindowOpen,
    isBlackout,
  ]);

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
    if (IS_PROJECTOR_MODE || !hasOpenOutputs || !projectorReady) return;

    // Broadcast lock: the output always receives the locked slide's index,
    // so a transient navigation request can never repaint it elsewhere.
    const lockedIdx = findLockedSlideIndex(presentation.slides);
    const effectiveLiveIndex = lockedIdx >= 0 ? lockedIdx : liveIndex;
    const effectiveLiveSlideId = presentation.slides[effectiveLiveIndex]?.id ?? liveSlideId;

    const nav = {
      liveIndex: effectiveLiveIndex,
      liveSlideId: effectiveLiveSlideId,
      isBlackout,
      volume: mediaVolume,
      muted: isMediaMuted,
      instantTransition,
      outputs: outputFrames,
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
      ...(patch.nextSections !== undefined && { nextSections: patch.nextSections }),
      slidesPatch: patch.slidesPatch.map(({ id, nextSlide }) => ({ id, nextSlide })),
      ...(orderChanged && { nextOrder: patch.nextOrder }),
      ...(patch.nextName !== undefined && { nextName: patch.nextName }),
      ...(patch.nextZoom !== undefined && { nextZoom: patch.nextZoom }),
      ...((patch.prevTransition !== undefined || patch.nextTransition !== undefined) && { nextTransition: patch.nextTransition ?? DEFAULT__TRANSITION }),
    };

    window.electronAPI?.updateProjector?.({ ...nav, patch: transport });
  }, [
    throttledPresentation,
    presentation.slides,
    liveSlideId,
    liveIndex,
    instantTransition,
    isBlackout,
    isProjectorWindowOpen,
    hasOpenOutputs,
    projectorReady,
    projectorEpoch,
    mediaVolume,
    isMediaMuted,
    outputFrames,
  ]);

  useRemotePreviews(presentation.slides, presentation.id ?? 'default', !practice && !IS_PROJECTOR_MODE);

  // Per-slide metadata for phones. Recomputed ONLY when the deck changes,
  // never on navigation — the map over all slides + IPC + main-side
  // JSON.stringify comparison used to run on every liveIndex change (O(T)).
  const slidePreviews = useMemo(
    () =>
      presentation.slides.map((slide) => ({
        type: slide.type,
        content: slide.content,
        mediaUrl: slide.mediaUrl,
        videoPlayback: slide.videoPlayback,
        videoOverlays: slide.videoOverlays,
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
    if (IS_PROJECTOR_MODE || practice) return;
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
    practice,
    slidePreviews,
    liveIndex,
    isBlackout,
    isProjectorWindowOpen,
    transitionType,
    transitionDuration,
  ]);
}
