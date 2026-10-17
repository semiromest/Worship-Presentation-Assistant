import { notifyPageVisit } from '../components/Tour/tourController';
import { moveSectionSlidesOneStep } from '../../shared/sectionModel';
import { useShallow } from 'zustand/react/shallow';
import { useEffect } from 'react';
import { useStore } from '../state/useStore';
import { playSfx, withSfxOutputTransition } from '../sfx';
import { resolveKeyboardCommand } from '../keyboardCommands';

interface KeyboardNavigationOptions {
  /** Delete selected slides (Delete) */
  onDeleteSlides?: () => void;
  /** Duplicate selected slides (Ctrl+D) */
  onDuplicateSlides?: () => void;
}

export function useKeyboardNavigation(options?: KeyboardNavigationOptions) {
  const { onDeleteSlides, onDuplicateSlides } = options ?? {};
  const {
    dispatchUndo,
    setLiveIndex,
    setIsBlackout,
    setIsCheatsheetOpen,
    setActiveTab,
    setIsMediaMuted,
  } = useStore(useShallow((s) => ({
    dispatchUndo: s.dispatchUndo,
    setLiveIndex: s.setLiveIndex,
    setIsBlackout: s.setIsBlackout,
    setIsCheatsheetOpen: s.setIsCheatsheetOpen,
    setActiveTab: s.setActiveTab,
    setIsMediaMuted: s.setIsMediaMuted,
  })));

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      const tag = el?.tagName?.toLowerCase();
      // Dialogs own their keys; inputs retain native text undo and punctuation.
      if (el?.closest('[role="dialog"]')) return;
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || el?.isContentEditable) return;

      const state = useStore.getState();
      const slides = state.presentation.slides;
      const lastIndex = slides.length - 1;
      const selectedIdx = slides.findIndex(s => s.id === state.selectedSlideId);
      const canLive = state.isProjectorWindowOpen;
      // Broadcast lock: the live output is pinned; navigation only re-selects.
      const isLocked = slides.some(s => s.locked);

      const navigate = (index: number) => {
        if (index < 0 || index > lastIndex) return;
        // Arrow/Home/End/Space/J/K only change the selection; live position moves only via Enter (Send to Live).
        // Keep the selection set and anchor in sync so the last keyboard target reads as selected.
        const id = slides[index].id;
        if (id !== state.selectedSlideId || state.selectedSlideIds.size !== 1 || !state.selectedSlideIds.has(id)) playSfx('focus');
        state.selectSlides({ activeId: id, ids: new Set([id]), anchorIndex: index,
          liveTargetId: state.autoGoLive && canLive && !isLocked ? id : undefined });
      };

      const moveSelectedSlide = (direction: -1 | 1) => {
        if (state.serviceSectionsEnabled && (state.searchQuery.trim() || state.sectionFilterId)) return;
        if (selectedIdx === -1) return;
        const target = selectedIdx + direction;
        if (target < 0 || target >= slides.length) return;

        dispatchUndo({
          type: 'SET',
          payload: moveSectionSlidesOneStep(state.presentation, state.selectedSlideIds.size ? state.selectedSlideIds : new Set([state.selectedSlideId]), direction),
        });
        playSfx('reorder');
      };

      const command = resolveKeyboardCommand(e, { activeTab: state.activeTab, helpOpen: state.isCheatsheetOpen,
        outputOpen: state.isProjectorWindowOpen, hasSelection: state.selectedSlideIds.size > 0, selectedIndex: selectedIdx });
      if (!command) return;
      if (command.type !== 'clear') e.preventDefault();
      switch (command.type) {
        case 'undo': dispatchUndo({ type: 'UNDO' }); break;
        case 'redo': dispatchUndo({ type: 'REDO' }); break;
        case 'help': setIsCheatsheetOpen(!state.isCheatsheetOpen); playSfx(state.isCheatsheetOpen ? 'close' : 'open'); break;
        case 'tab':
          if (state.activeTab !== command.destination) playSfx('forward');
          setActiveTab(command.destination); notifyPageVisit(command.destination); break;
        case 'move': moveSelectedSlide(command.direction); break;
        case 'duplicate': onDuplicateSlides?.(); break;
        case 'delete': onDeleteSlides?.(); break;
        case 'mute': { const muted = !state.isMediaMuted; playSfx(muted ? 'toggle-on' : 'toggle-off'); setIsMediaMuted(muted); break; }
        case 'navigate': {
          const targets = { next: Math.min(selectedIdx + 1, lastIndex), previous: Math.max(selectedIdx - 1, 0), first: 0, last: lastIndex };
          navigate(targets[command.direction]); break;
        }
        case 'live': setLiveIndex(selectedIdx); if (!isLocked) playSfx('start'); break;
        case 'close-output':
          void withSfxOutputTransition(async () => { await window.electronAPI?.toggleProjector?.(); playSfx('stop'); }); break;
        case 'blackout': { const blackout = !state.isBlackout; playSfx(blackout ? 'lock' : 'unlock'); setIsBlackout(blackout); break; }
        case 'clear': state.selectSlides({ ids: new Set(), anchorIndex: null }); break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    dispatchUndo,
    setLiveIndex,
    setIsBlackout,
    setIsCheatsheetOpen,
    setActiveTab,
    setIsMediaMuted,
    onDeleteSlides,
    onDuplicateSlides,
  ]);
}
