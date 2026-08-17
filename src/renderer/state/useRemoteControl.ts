import { useEffect } from 'react';
import QRCode from 'qrcode';
import { useStore } from './useStore';
import { IS_PROJECTOR_MODE } from '../constants';

const REMOTE_ACTIONS = {
  next: 'next',
  prev: 'prev',
  blackout: 'blackout',
  openProjector: 'openProjector',
  closeProjector: 'closeProjector',
  goto: 'goto',
  partNext: 'partNext',
  partPrev: 'partPrev',
  partGoto: 'partGoto',
} as const;

export function useRemoteControl() {
  const {
    setLiveIndex,
    setSelectedSlideId,
    setIsBlackout,
    setIsProjectorWindowOpen,
    setProjectorReady,
    setMediaVolume,
    setIsMediaMuted,
    dispatchUndo,
    setRemoteUrl,
    setRemoteQr,
    setRemoteDebug,
  } = useStore();

  const openLive = async () => {
    const state = useStore.getState();
    if (state.isProjectorWindowOpen) return;
    const idx = state.presentation.slides.findIndex(s => s.id === state.selectedSlideId);
    const initialIndex = idx >= 0 ? idx : 0;

    setProjectorReady(false);
    setLiveIndex(initialIndex);

    const initialData = {
      // Phase 4: the first snapshot uses fullPresentation (projector applies
      // it as a history-clearing RESET). Subsequent syncs are {patch} deltas
      // sent by useProjectorSync once the projector signals ready.
      fullPresentation: state.presentation,
      liveIndex: initialIndex,
      isBlackout: state.isBlackout,
      volume: state.mediaVolume,
      muted: state.isMediaMuted,
    };

    const isOpen = await window.electronAPI?.toggleProjector?.(initialData);
    setIsProjectorWindowOpen(isOpen);

    // No manual retry here: main flushes pendingProjectorPayload on
    // 'projector-ready' and acks the control window, which triggers
    // useProjectorSync to (re)establish the base with a full snapshot.
  };

  const closeLive = async () => {
    const state = useStore.getState();
    if (!state.isProjectorWindowOpen) return;
    const isOpen = await window.electronAPI?.toggleProjector?.();
    setIsProjectorWindowOpen(isOpen);
  };

  useEffect(() => {
    // Note: presets are hydrated once by App.tsx — do NOT reload them here
    // (was a duplicate loadPresets IPC call on every mount).

    // Remote URL al
    const fetchRemoteUrl = async () => {
      const url = await window.electronAPI?.getRemoteUrl?.();
      const info = await window.electronAPI?.getRemoteDebug?.();
      if (info?.remoteServerUrl) setRemoteDebug(info);

      if (typeof url === 'string' && url) {
        setRemoteUrl(url);
        QRCode.toDataURL(url)
          .then(setRemoteQr)
          .catch(() => setRemoteQr(null));
      } else {
        setTimeout(fetchRemoteUrl, 400);
      }
    };
    fetchRemoteUrl();

    // Remote action listener
    const removeListener = window.electronAPI?.onRemoteAction?.((data: any) => {
      if (!data?.action) return;

      const state = useStore.getState();
      const slides = state.presentation.slides;
      const lastIndex = slides.length - 1;
      const currentIdx = slides.findIndex(s => s.id === state.selectedSlideId);
      const projOpen = state.isProjectorWindowOpen;

      switch (data.action) {
        case REMOTE_ACTIONS.next: {
          const baseIdx = projOpen ? state.liveIndex : Math.max(currentIdx, 0);
          const nextIdx = Math.min(baseIdx + 1, lastIndex);
          setSelectedSlideId(slides[nextIdx].id);
          setLiveIndex(nextIdx);
          break;
        }
        case REMOTE_ACTIONS.prev: {
          const baseIdx = projOpen ? state.liveIndex : Math.max(currentIdx, 0);
          const prevIdx = Math.max(baseIdx - 1, 0);
          setSelectedSlideId(slides[prevIdx].id);
          setLiveIndex(prevIdx);
          break;
        }
        case REMOTE_ACTIONS.blackout:
          if (projOpen) setIsBlackout(p => !p);
          break;
        case REMOTE_ACTIONS.openProjector:
          if (!projOpen) openLive();
          break;
        case REMOTE_ACTIONS.closeProjector:
          if (projOpen) closeLive();
          break;
        case REMOTE_ACTIONS.goto:
          if (typeof data.value === 'number') {
            const idx = Math.max(0, Math.min(lastIndex, data.value));
            setSelectedSlideId(slides[idx]?.id ?? state.selectedSlideId);
            setLiveIndex(idx);
          }
          break;
        case REMOTE_ACTIONS.partGoto: {
          const val = data.value as { slide?: unknown; part?: unknown } | undefined;
          const slideIdx = typeof val?.slide === 'number' ? val.slide : NaN;
          const partIdx  = typeof val?.part  === 'number' ? val.part  : NaN;
          const target = slides[slideIdx];
          if (target?.partsMode && target.parts && Number.isInteger(partIdx)) {
            const p = Math.max(0, Math.min(partIdx, target.parts.length - 1));
            const updatedSlides = state.presentation.slides.map(s =>
              s.id === target.id ? { ...s, activePart: p, content: s.parts![p] } : s
            );
            setSelectedSlideId(target.id);
            setLiveIndex(slideIdx);
            dispatchUndo({ type: 'SET', payload: { ...state.presentation, slides: updatedSlides } });
          }
          break;
        }
        case REMOTE_ACTIONS.partNext: {
          const liveSlide = slides[state.liveIndex];
          if (liveSlide?.partsMode && liveSlide.parts) {
            const nextPart = Math.min((liveSlide.activePart ?? 0) + 1, liveSlide.parts.length - 1);
            if (nextPart !== (liveSlide.activePart ?? 0)) {
              const updatedSlides = state.presentation.slides.map(s =>
                s.id === liveSlide.id ? { ...s, activePart: nextPart, content: s.parts![nextPart] } : s
              );
              dispatchUndo({ type: 'SET', payload: { ...state.presentation, slides: updatedSlides } });
            }
          }
          break;
        }
        case REMOTE_ACTIONS.partPrev: {
          const liveSlide = slides[state.liveIndex];
          if (liveSlide?.partsMode && liveSlide.parts) {
            const prevPart = Math.max((liveSlide.activePart ?? 0) - 1, 0);
            if (prevPart !== (liveSlide.activePart ?? 0)) {
              const updatedSlides = state.presentation.slides.map(s =>
                s.id === liveSlide.id ? { ...s, activePart: prevPart, content: s.parts![prevPart] } : s
              );
              dispatchUndo({ type: 'SET', payload: { ...state.presentation, slides: updatedSlides } });
            }
          }
          break;
        }
      }
    });

    // Projector mode listeners
    let removeProjectorUpdate: (() => void) | undefined;
    let removeProjectorClosed: (() => void) | undefined;

    if (IS_PROJECTOR_MODE) {
      setProjectorReady(true);

  removeProjectorUpdate = window.electronAPI?.onProjectorUpdate?.((data: any) => {
    if (data && typeof data === 'object') {
      if (data.fullPresentation) {
        // Initial snapshot (open) or re-sync after reload: replace the state
        // and clear history — the projector never uses undo, so SET used to
        // grow an unbounded history on every sync (wasted memory).
        dispatchUndo({ type: 'RESET', payload: data.fullPresentation });
      } else if (data.patch) {
        // Delta sync (Phase 4): apply without touching the undo history.
        useStore.getState().applyProjectorDelta(data.patch);
      }

      if (typeof data.liveIndex === 'number') {
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
    }
  });

  // Notify main process that listeners are ready
  window.electronAPI?.notifyProjectorReady?.();

} else {
  removeProjectorClosed = window.electronAPI?.onProjectorClosed?.(() => {
    setIsProjectorWindowOpen(false);
    // BUG FIX: Reset blackout when projector window closes so it
    // doesn't start in blackout state on the next openLive() call.
    setIsBlackout(false);
  });
  removeProjectorUpdate = window.electronAPI?.onProjectorUpdate?.((data: any) => {
    if (data?.isProjectorOpen !== undefined) {
      setIsProjectorWindowOpen(data.isProjectorOpen);
    }
  });
  window.electronAPI?.getProjectorStatus?.()?.then(setIsProjectorWindowOpen);
}

return () => {
  if (typeof removeListener === 'function') removeListener();
  if (typeof removeProjectorUpdate === 'function') removeProjectorUpdate();
  if (typeof removeProjectorClosed === 'function') removeProjectorClosed();
};
// eslint-disable-next-line react-hooks/exhaustive-deps
}, []);

return { openLive, closeLive };
}