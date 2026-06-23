import { useEffect } from 'react';
import { useStore } from '../state/useStore';

const NAV_KEYS = {
  NEXT: new Set(['ArrowRight', ' ', 'PageDown', 'j', 'J']),
  PREV: new Set(['ArrowLeft', 'PageUp', 'k', 'K']),
  HOME: new Set(['Home']),
  END: new Set(['End']),
};

const TAB_KEYS: Record<string, string> = {
  '1': 'presentations',
  '2': 'slides',
  '3': 'bible',
  '4': 'media',
  '5': 'hymns',
  '6': 'countdown',
  '7': 'screen',
  '8': 'calendar',
};

export function useKeyboardNavigation() {
  const {
    dispatchUndo,
    setSelectedSlideId,
    setLiveIndex,
    setIsBlackout,
    setSelectedSlideIds,
    setLastSelectedIndex,
    setIsEditorOpen,
    setIsCheatsheetOpen,
    setActiveTab,
  } = useStore();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      const tag = el?.tagName?.toLowerCase();

      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        dispatchUndo({ type: 'UNDO' });
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        dispatchUndo({ type: 'REDO' });
        return;
      }

      if (e.key === '?' && !e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault();
        setIsCheatsheetOpen(!useStore.getState().isCheatsheetOpen);
        return;
      }

      if (e.altKey && !e.ctrlKey && !e.metaKey && TAB_KEYS[e.key]) {
        e.preventDefault();
        setActiveTab(TAB_KEYS[e.key] as any);
        return;
      }

      if (tag === 'input' || tag === 'textarea' || tag === 'select' || el?.isContentEditable) return;

      const state = useStore.getState();
      const slides = state.presentation.slides;
      const lastIndex = slides.length - 1;
      const selectedIdx = slides.findIndex(s => s.id === state.selectedSlideId);
      const canLive = state.isProjectorWindowOpen;

      const navigate = (index: number) => {
        if (index < 0 || index > lastIndex) return;
        if (canLive) setLiveIndex(index);
        setSelectedSlideId(slides[index].id);
      };

      const moveSelectedSlide = (direction: -1 | 1) => {
        if (selectedIdx === -1) return;
        const target = selectedIdx + direction;
        if (target < 0 || target >= slides.length) return;

        const reordered = [...slides];
        const [item] = reordered.splice(selectedIdx, 1);
        reordered.splice(target, 0, item);

        if (canLive) {
          setLiveIndex((current) => {
            if (current === selectedIdx) return target;
            if (direction === -1 && current >= target && current < selectedIdx) return current + 1;
            if (direction === 1 && current > selectedIdx && current <= target) return current - 1;
            return current;
          });
        }

        dispatchUndo({
          type: 'SET',
          payload: { ...state.presentation, slides: reordered },
        });
      };

      if (e.altKey && e.key === 'ArrowUp' && state.activeTab === 'slides') {
        e.preventDefault();
        moveSelectedSlide(-1);
      } else if (e.altKey && e.key === 'ArrowDown' && state.activeTab === 'slides') {
        e.preventDefault();
        moveSelectedSlide(1);
      } else if (NAV_KEYS.NEXT.has(e.key)) {
        e.preventDefault();
        navigate(Math.min(selectedIdx + 1, lastIndex));
      } else if (NAV_KEYS.PREV.has(e.key)) {
        e.preventDefault();
        navigate(Math.max(selectedIdx - 1, 0));
      } else if (NAV_KEYS.HOME.has(e.key)) {
        e.preventDefault();
        navigate(0);
      } else if (NAV_KEYS.END.has(e.key)) {
        e.preventDefault();
        navigate(lastIndex);
      } else if (e.key === 'Enter' && state.isProjectorWindowOpen && selectedIdx >= 0) {
        e.preventDefault();
        setLiveIndex(selectedIdx);
      } else if (e.key === 'Escape' && state.isProjectorWindowOpen) {
        e.preventDefault();
        window.electronAPI?.toggleProjector?.();
      } else if ((e.key === 'b' || e.key === 'B') && state.isProjectorWindowOpen) {
        e.preventDefault();
        setIsBlackout(p => !p);
      } else if (e.key === 'Escape') {
        if (state.isCheatsheetOpen) return;
        if (state.isEditorOpen) {
          e.preventDefault();
          setIsEditorOpen(false);
          return;
        }
        setSelectedSlideIds(new Set());
        setLastSelectedIndex(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    dispatchUndo,
    setSelectedSlideId,
    setLiveIndex,
    setIsBlackout,
    setSelectedSlideIds,
    setLastSelectedIndex,
    setIsEditorOpen,
    setIsCheatsheetOpen,
    setActiveTab,
  ]);
}
