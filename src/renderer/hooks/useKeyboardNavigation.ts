import { useEffect } from 'react';
import { useStore } from '../state/useStore';

const NAV_KEYS = {
  NEXT: new Set(['ArrowRight', 'ArrowDown', ' ', 'PageDown', 'j', 'J']),
  PREV: new Set(['ArrowLeft', 'ArrowUp', 'PageUp', 'k', 'K']),
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
  '9': 'settings',
};

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
    setSelectedSlideId,
    setLiveIndex,
    setIsBlackout,
    setSelectedSlideIds,
    setLastSelectedIndex,
    setIsEditorOpen,
    setIsCheatsheetOpen,
    setActiveTab,
    setIsMediaMuted,
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
        // Arrow/Home/End/Space/J/K only change the selection; live position moves only via Enter (Send to Live).
        // Keep the selection set and anchor in sync so the last keyboard target reads as selected.
        const id = slides[index].id;
        setSelectedSlideId(id);
        setSelectedSlideIds(new Set([id]));
        setLastSelectedIndex(index);
        // "Instant Live" mode: while the broadcast is open, selection changes also go live.
        // Needed for remotes that only send left/right keys; off preserves the old behavior.
        if (state.autoGoLive && canLive) {
          setLiveIndex(index);
        }
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
      } else if (e.ctrlKey && !e.metaKey && e.key.toLowerCase() === 'd' && !state.isEditorOpen && !state.isCheatsheetOpen && state.activeTab === 'slides') {
        e.preventDefault();
        onDuplicateSlides?.();
      } else if (e.key === 'Delete' && !state.isEditorOpen && !state.isCheatsheetOpen && state.activeTab === 'slides' && state.selectedSlideIds.size > 0) {
        e.preventDefault();
        onDeleteSlides?.();
      } else if ((e.key === 'm' || e.key === 'M') && !state.isCheatsheetOpen) {
        e.preventDefault();
        setIsMediaMuted((p) => !p);
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
      } else if (e.key === 'Enter' && selectedIdx >= 0) {
        e.preventDefault();
        // Enter = "Send to Live": moves the selected slide live (staged when broadcast is off, projected when on).
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
    setIsMediaMuted,
    onDeleteSlides,
    onDuplicateSlides,
  ]);
}
