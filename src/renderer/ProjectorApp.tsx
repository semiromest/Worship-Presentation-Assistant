import { useEffect } from 'react';
import { useStore } from './state/useStore';
import { DEFAULT__TRANSITION, PROJECTOR_DISPLAY_ID } from './constants';
import { resolveCanvasSource } from './canvasSource';
import StageDisplay from './components/StageDisplay';
import { AnimatedPreview } from './AnimatedPreview';
import { useKeyboardNavigation } from './hooks/useKeyboardNavigation';
import { useSlideOperations } from './hooks/useSlideOperations';
import { useStt } from './hooks/useStt';
import CaptionOverlay from './components/CaptionOverlay';

export default function ProjectorApp() {
  useStt();
  useEffect(() => {
    const { dispatchUndo, setLiveIndex, setIsBlackout, setMediaVolume, setIsMediaMuted,
      setInstantTransition, setOutputWindowMode, setProjectorReady } = useStore.getState();
    setProjectorReady(false);
    const receiverToken = crypto.randomUUID();
    let removeProjectorUpdate: (() => void) | undefined;
  removeProjectorUpdate = window.electronAPI?.onProjectorUpdate?.((data: any) => {
    if (data && typeof data === 'object' && (!data.receiverToken || data.receiverToken === receiverToken)) {
      if (data.fullPresentation) {
        // Initial snapshot (open) or re-sync after reload: replace the state
        // and clear history — the projector never uses undo, so SET used to
        // grow an unbounded history on every sync (wasted memory).
        dispatchUndo({ type: 'RESET', payload: {
          ...data.fullPresentation,
          ...(typeof data.liveIndex === 'number' && { liveIndex: data.liveIndex }),
          ...(typeof data.liveSlideId === 'string' && { liveSlideId: data.liveSlideId }),
        } });
      } else if (data.patch) {
        // Delta sync (Phase 4): apply without touching the undo history.
        useStore.getState().applyProjectorDelta(data.patch);
      }

      if (typeof data.liveSlideId === 'string') {
        useStore.getState().setLiveSlideId(data.liveSlideId);
      } else if (typeof data.liveIndex === 'number') {
        setLiveIndex(data.liveIndex);
      }

      if (typeof data.isBlackout === 'boolean') {
        setIsBlackout(data.isBlackout);
      }

      if (data.volume !== undefined) {
        setMediaVolume(data.volume);
      }

      if (data.muted !== undefined) {
        setIsMediaMuted(data.muted);
      }

      if (typeof data.instantTransition === 'boolean') {
        setInstantTransition(data.instantTransition);
      }

      if (typeof data.outputMode === 'string') {
        setOutputWindowMode(data.outputMode as any);
      }
      if (data.fullPresentation) setProjectorReady(true);
    }
  });

  // Notify main process that listeners are ready
  window.electronAPI?.notifyProjectorReady?.(PROJECTOR_DISPLAY_ID ?? undefined, receiverToken);

    return () => { removeProjectorUpdate?.(); useStore.getState().setProjectorReady(false); };
  }, []);
  const instant = useStore(s => s.instantTransition);
  useEffect(() => { if (!instant) return; const timer = setTimeout(() => useStore.getState().setInstantTransition(false), 0);
    return () => clearTimeout(timer); }, [instant]);
  return <ProjectorView />;
}

function ProjectorView() {
  // Keep the focused output window's existing keyboard behavior (including
  // local mute/Enter); moving the visual branch must not remove its listener.
  const { deleteSelectedSlides, duplicateSelectedSlides } = useSlideOperations();
  useKeyboardNavigation({ onDeleteSlides: deleteSelectedSlides, onDuplicateSlides: duplicateSelectedSlides });
  const liveSlide = useStore(s => s.presentation.slides[s.liveIndex] ?? s.presentation.slides[0]);
  const transition = useStore(s => s.presentation.transition);
  const instantTransition = useStore(s => s.instantTransition);
  const transitionType = instantTransition ? 'none' : transition?.type ?? DEFAULT__TRANSITION.type;
  const transitionDuration = instantTransition ? 0 : transition?.duration ?? DEFAULT__TRANSITION.duration;
  const projectorReady = useStore(s => s.projectorReady);
  const isBlackout = useStore(s => s.isBlackout);
  const mediaVolume = useStore(s => s.mediaVolume);
  const isMediaMuted = useStore(s => s.isMediaMuted);
  const outputMode = useStore(s => s.outputMode);
  if (!projectorReady) {
    return <div className="fixed inset-0 bg-black" data-projector-loading />;
  }

  if (isBlackout) {
    return <div className="fixed inset-0 bg-black z-50" />;
  }

  // Stage display (confidence monitor): shows current + next slide text,
  // a live clock and elapsed time — instead of the styled projector view.
  if (outputMode === 'stage') {
    return <StageDisplay />;
  }

  return (
    <div
      className="slide-surface fixed inset-0 flex items-center justify-center overflow-hidden bg-black"
      style={{
        backgroundColor: liveSlide?.type === 'text' ? (liveSlide.styles?.backgroundColor ?? '#000') : '#000',
        backgroundImage:
          liveSlide?.type === 'text' && liveSlide.styles?.backgroundImage
            ? `url(${resolveCanvasSource(liveSlide.styles.backgroundImage, false).url})`
            : undefined,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }}
    >
      <AnimatedPreview
        slide={liveSlide}
        transitionType={transitionType}
        duration={transitionDuration}
        size="projector"
        volume={mediaVolume}
        muted={isMediaMuted}
      />
      {/* Outside AnimatedPreview so subtitles stay put while slides transition. */}
      <CaptionOverlay slide={liveSlide} />
    </div>
  );

}
