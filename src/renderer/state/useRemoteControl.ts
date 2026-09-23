import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import QRCode from 'qrcode';
import { useStore } from './useStore';
import { useShallow } from 'zustand/shallow';
import { useSttStore } from './useSttStore';
import { IS_PROJECTOR_MODE, PROJECTOR_DISPLAY_ID } from '../constants';
import { chooseDefaultOutputDisplay, effectiveOutputSlideIndex } from '../../shared/displays';
import { findLockedSlideIndex } from '../slideLock';
import { getActivePartIndex, getNextPartIndex, getPartIndex, getPreviousPartIndex, getSlideDisplayContent } from '../../shared/slideContent';
import { createSlide } from '../hooks/useSlideOperations';
import { DEFAULT_STYLES } from '../constants';
import { makeSlideId } from '../utils';
import { describeQuickVerseError, resolveQuickVerse } from '../quickVerse';
import { bibleRepository } from '../bibleRepository';
import type { Slide } from '../types';
import { playSfx } from '../sfx';
import { confirmDialog } from '../dialogs';

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
  quickVerse: 'quickVerse',
} as const;

export function useRemoteControl() {
  const { t } = useTranslation();
  const {
    setLiveIndex,
    setLiveSlideId,
    setInstantTransition,
    setSelectedSlideId,
    setIsBlackout,
    setIsProjectorWindowOpen,
    setProjectorReady,
    setOutputWindowMode,
    setMediaVolume,
    setIsMediaMuted,
    dispatchUndo,
    setRemoteUrl,
    setRemoteQr,
    setRemoteDebug,
    setDisplays,
    setOutputOpen,
    setProjectorOutputStatus,
  } = useStore(
    useShallow((s) => ({
      setLiveIndex: s.setLiveIndex,
      setLiveSlideId: s.setLiveSlideId,
      setInstantTransition: s.setInstantTransition,
      setSelectedSlideId: s.setSelectedSlideId,
      setIsBlackout: s.setIsBlackout,
      setIsProjectorWindowOpen: s.setIsProjectorWindowOpen,
      setProjectorReady: s.setProjectorReady,
      setOutputWindowMode: s.setOutputWindowMode,
      setMediaVolume: s.setMediaVolume,
      setIsMediaMuted: s.setIsMediaMuted,
      dispatchUndo: s.dispatchUndo,
      setRemoteUrl: s.setRemoteUrl,
      setRemoteQr: s.setRemoteQr,
      setRemoteDebug: s.setRemoteDebug,
      setDisplays: s.setDisplays,
      setOutputOpen: s.setOutputOpen,
      setProjectorOutputStatus: s.setProjectorOutputStatus,
    })),
  );

  const buildInitialData = (displayId?: string) => {
    const state = useStore.getState();
    const defaultDisplayId = chooseDefaultOutputDisplay(state.displays)?.id;
    const targetId = displayId ?? defaultDisplayId;
    const assignment = targetId ? state.outputAssignments[targetId] : undefined;
    const outputIndex = effectiveOutputSlideIndex(
      assignment,
      state.liveIndex,
      state.presentation.slides.length,
    );
    const isDefaultOutput = targetId !== undefined && targetId === defaultDisplayId;

    return {
      // The first snapshot uses fullPresentation (projector applies it as a
      // history-clearing RESET). Subsequent syncs are {patch} deltas.
      fullPresentation: state.presentation,
      liveIndex: targetId ? outputIndex : state.liveIndex,
      liveSlideId: state.presentation.slides[targetId ? outputIndex : state.liveIndex]?.id ?? state.liveSlideId,
      isBlackout: isDefaultOutput ? state.isBlackout : (assignment?.isBlackout ?? false),
      // The output's mode decides how the window renders: 'stage' shows the
      // stage (confidence) display, anything else shows the projector view.
      outputMode: assignment?.mode ?? 'follow',
      volume: state.mediaVolume,
      muted: state.isMediaMuted,
    };
  };

  const openLive = async () => {
    const state = useStore.getState();
    if (state.isProjectorWindowOpen) return;

    const idx = state.presentation.slides.findIndex(s => s.id === state.selectedSlideId);
    const initialIndex = idx >= 0 ? idx : 0;
    setProjectorReady(false);
    setLiveIndex(initialIndex);

    const isOpen = await window.electronAPI?.toggleProjector?.(buildInitialData());
    setIsProjectorWindowOpen(!!isOpen);
    if (isOpen) playSfx('start');
  };

  const closeLive = async () => {
    const state = useStore.getState();
    if (!state.isProjectorWindowOpen) return;
    const isOpen = await window.electronAPI?.toggleProjector?.();
    setIsProjectorWindowOpen(!!isOpen);
    if (!isOpen) playSfx('stop');
  };

  const openOutput = async (displayId: string) => {
    const isOpen = await window.electronAPI?.openProjector?.(displayId, buildInitialData(displayId));
    setOutputOpen(displayId, !!isOpen);
    const defaultId = chooseDefaultOutputDisplay(useStore.getState().displays)?.id;
    if (displayId === defaultId) {
      setProjectorReady(false);
      setIsProjectorWindowOpen(!!isOpen);
    }
    if (isOpen) playSfx('start');
  };

  const closeOutput = async (displayId: string) => {
    const closed = await window.electronAPI?.closeProjector?.(displayId);
    setOutputOpen(displayId, false);
    const defaultId = chooseDefaultOutputDisplay(useStore.getState().displays)?.id;
    if (displayId === defaultId) setIsProjectorWindowOpen(false);
    if (closed) playSfx('stop');
  };

  // When the broadcast ends while live captions are still running, remind the
  // user to stop them so a forgotten session doesn't keep consuming tokens.
  // This runs on 'projector-closed', which covers BOTH the stop button/remote
  // close (toggleProjector → window close) and a direct window close, without
  // double-prompting.
  const promptStopCaptions = async () => {
    if (useSttStore.getState().status === 'idle') return;
    const outputs = await window.electronAPI?.getProjectorOutputs?.();
    if (Array.isArray(outputs) && outputs.length > 0) return;
    const shouldStop = await confirmDialog(t('common.sttBroadcastEndCaptionsPrompt'), {
      title: t('common.sttPanelTitle'),
      confirmLabel: t('common.close'),
      cancelLabel: t('common.sttKeepCaptions'),
    });
    if (shouldStop) {
      await window.electronAPI?.sttStop?.();
    }
  };

  useEffect(() => {
    let knownDisplayIds: Set<string> | null = null;
    let initialDisplayFetchDone = false;

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
    const removeListener = window.electronAPI?.onRemoteAction?.(async (data: any) => {
      if (!data?.action) return;

      const state = useStore.getState();
      const slides = state.presentation.slides;
      const lastIndex = slides.length - 1;
      const currentIdx = slides.findIndex(s => s.id === state.selectedSlideId);
      const projOpen = state.isProjectorWindowOpen;

      switch (data.action) {
        case REMOTE_ACTIONS.next: {
          // Broadcast lock: the live output stays pinned; phones only re-select.
          if (findLockedSlideIndex(slides) >= 0) break;
          const baseIdx = projOpen ? state.liveIndex : Math.max(currentIdx, 0);
          const nextIdx = Math.min(baseIdx + 1, lastIndex);
          setSelectedSlideId(slides[nextIdx].id);
          setLiveIndex(nextIdx);
          break;
        }
        case REMOTE_ACTIONS.prev: {
          if (findLockedSlideIndex(slides) >= 0) break;
          const baseIdx = projOpen ? state.liveIndex : Math.max(currentIdx, 0);
          const prevIdx = Math.max(baseIdx - 1, 0);
          setSelectedSlideId(slides[prevIdx].id);
          setLiveIndex(prevIdx);
          break;
        }
        case REMOTE_ACTIONS.blackout:
          if (projOpen) {
            const next = !useStore.getState().isBlackout;
            playSfx(next ? 'lock' : 'unlock');
            setIsBlackout(next);
          }
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
            if (findLockedSlideIndex(slides) >= 0) break;
            setLiveIndex(idx);
          }
          break;
        case REMOTE_ACTIONS.partGoto: {
          const val = data.value as { slide?: unknown; part?: unknown } | undefined;
          const slideIdx = typeof val?.slide === 'number' ? val.slide : NaN;
          const partIdx = typeof val?.part === 'number' ? val.part : NaN;
          const target = slides[slideIdx];
          if (target?.partsMode && target.parts?.length && Number.isInteger(partIdx)) {
            const activePart = getPartIndex(target, partIdx);
            const updatedSlides = state.presentation.slides.map((slide) =>
              slide.id === target.id
                ? { ...slide, activePart, content: getSlideDisplayContent({ ...slide, activePart }) }
                : slide,
            );
            setSelectedSlideId(target.id);
            setLiveIndex(slideIdx);
            dispatchUndo({ type: 'SET', payload: { ...state.presentation, slides: updatedSlides } });
          }
          break;
        }
        case REMOTE_ACTIONS.partNext:
        case REMOTE_ACTIONS.partPrev: {
          const liveSlide = slides[state.liveIndex];
          const activePart = liveSlide ? getActivePartIndex(liveSlide) : 0;
          const nextPart = data.action === REMOTE_ACTIONS.partNext
            ? liveSlide && getNextPartIndex(liveSlide)
            : liveSlide && getPreviousPartIndex(liveSlide);
          if (liveSlide && nextPart !== null && nextPart !== activePart) {
            const updatedSlides = state.presentation.slides.map((slide) =>
              slide.id === liveSlide.id
                ? { ...slide, activePart: nextPart, content: getSlideDisplayContent({ ...slide, activePart: nextPart }) }
                : slide,
            );
            dispatchUndo({ type: 'SET', payload: { ...state.presentation, slides: updatedSlides } });
          }
          break;
        }
        case REMOTE_ACTIONS.quickVerse: {
          if (IS_PROJECTOR_MODE) break;
          const val = data.value as { reference?: unknown; goLive?: unknown } | undefined;
          const reference = typeof val?.reference === 'string' ? val.reference.trim() : '';
          const goLive = val?.goLive === true;
          const notice = (text: string, tone: 'ok' | 'error') => {
            void window.electronAPI?.sendRemoteNotice?.({ text, tone });
          };
          if (!reference) {
            notice('Enter a reference', 'error');
            break;
          }
          try {
            await bibleRepository.restore();
          } catch {
            notice('Could not load the current Bible', 'error');
            break;
          }
          const outcome = resolveQuickVerse(reference);
          if (!outcome.ok) {
            notice(describeQuickVerseError(outcome.error), 'error');
            break;
          }
          // Broadcast lock: never move the pinned live output; still append so
          // the operator can queue the verse for later.
          const latest = useStore.getState();
          const locked = findLockedSlideIndex(latest.presentation.slides) >= 0;
          const groupId = makeSlideId();
          const chunks = outcome.result.slides;
          const newSlides: Slide[] = chunks.map((chunk, idx) =>
            createSlide('text', {
              content: chunk,
              group: {
                id: groupId,
                title: outcome.result.groupTitle,
                part: idx + 1,
                parts: chunks.length,
              },
              styles: { ...DEFAULT_STYLES, fontSize: 70, backgroundColor: '', textColor: '' },
            }),
          );
          const nextSlides = [...latest.presentation.slides, ...newSlides];
          dispatchUndo({ type: 'SET', payload: { ...latest.presentation, slides: nextSlides } });
          if (goLive && !locked) {
            setSelectedSlideId(newSlides[0].id);
            setLiveSlideId(newSlides[0].id);
            setIsBlackout(false);
            try {
              await openLive();
            } catch {
              notice(`Added, but could not open broadcast: ${outcome.result.groupTitle}`, 'error');
              break;
            }
          }
          playSfx('success');
          notice(
            goLive && !locked ? `Live: ${outcome.result.groupTitle}` : `Added: ${outcome.result.groupTitle}`,
            'ok',
          );
          break;
        }
      }
    });

    // Projector mode listeners
    let removeProjectorUpdate: (() => void) | undefined;
    let removeProjectorClosed: (() => void) | undefined;
    let removeDisplayListener: (() => void) | undefined;
    let removeOutputStatusListener: (() => void) | undefined;

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
    }
  });

  // Notify main process that listeners are ready
  window.electronAPI?.notifyProjectorReady?.(PROJECTOR_DISPLAY_ID ?? undefined);

} else {
  removeDisplayListener = window.electronAPI?.onDisplaysChanged?.((displays) => {
    const nextDisplays = Array.isArray(displays) ? displays : [];
    initialDisplayFetchDone = true;
    if (knownDisplayIds) {
      const removed = [...knownDisplayIds].some((id) => !nextDisplays.some((display) => display.id === id));
      if (removed) useStore.getState().setToastMessage('displayDisconnected');
    }
    knownDisplayIds = new Set(nextDisplays.map((display) => display.id));
    setDisplays(nextDisplays);
  });
  removeOutputStatusListener = window.electronAPI?.onProjectorOutputStatus?.((outputs) => {
    setProjectorOutputStatus(Array.isArray(outputs) ? outputs : []);
  });

  void window.electronAPI?.getDisplays?.().then((displays) => {
    // Avoid overwriting a more recent displays-changed event with the
    // initial mount fetch — the event handler runs first on display
    // hotplug and the async promise resolving later would regress.
    if (initialDisplayFetchDone) return;
    if (Array.isArray(displays)) {
      initialDisplayFetchDone = true;
      knownDisplayIds = new Set(displays.map((display) => display.id));
      setDisplays(displays);
    }
  });
  void window.electronAPI?.getProjectorOutputs?.().then((outputs) => {
    if (Array.isArray(outputs)) setProjectorOutputStatus(outputs);
  });

  removeProjectorClosed = window.electronAPI?.onProjectorClosed?.((data) => {
    const displayId = data?.displayId;
    if (displayId) setOutputOpen(displayId, false);
    const defaultId = chooseDefaultOutputDisplay(useStore.getState().displays)?.id;
    if (!displayId || displayId === defaultId) {
      setIsProjectorWindowOpen(false);
      // Reset the legacy/default blackout state so the next default open is safe.
      setIsBlackout(false);
    }
    void promptStopCaptions();
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
  if (typeof removeDisplayListener === 'function') removeDisplayListener();
  if (typeof removeOutputStatusListener === 'function') removeOutputStatusListener();
};
// eslint-disable-next-line react-hooks/exhaustive-deps
}, []);

return { openLive, closeLive, openOutput, closeOutput };
}
