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
    setPresets,
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
      presentation: state.presentation,
      liveIndex: initialIndex,
      isBlackout: state.isBlackout,
      volume: state.mediaVolume,
      muted: state.isMediaMuted,
    };

    const isOpen = await window.electronAPI?.toggleProjector?.(initialData);
    setIsProjectorWindowOpen(isOpen);

    if (isOpen) {
      setTimeout(() => {
        window.electronAPI?.updateProjector?.(initialData);
      }, 220);
    }
  };

  const closeLive = async () => {
    const state = useStore.getState();
    if (!state.isProjectorWindowOpen) return;
    const isOpen = await window.electronAPI?.toggleProjector?.();
    setIsProjectorWindowOpen(isOpen);
  };

  useEffect(() => {
    // Preset'leri yükle
    (async () => {
      const loaded = await window.electronAPI?.loadPresets?.();
      if (Array.isArray(loaded)) setPresets(loaded);
    })();

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
      }
    });

    // Projektör modu listener'ları
    let removeProjectorUpdate: (() => void) | undefined;
    let removeProjectorClosed: (() => void) | undefined;

    if (IS_PROJECTOR_MODE) {
      setProjectorReady(true);

  removeProjectorUpdate = window.electronAPI?.onProjectorUpdate?.((data: any) => {
    if (data && typeof data === 'object') {
      if (data.presentation) {
        dispatchUndo({ type: 'SET', payload: data.presentation });
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

  // Listener kurulduktan SONRA main process'e hazır olduğumuzu bildiriyoruz
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