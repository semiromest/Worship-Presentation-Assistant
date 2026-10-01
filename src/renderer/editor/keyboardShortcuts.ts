import { useEffect } from 'react';
import { isEditableTarget } from './editorUtils';

export function useKeyboardShortcuts(params: {
  selectedIds: Set<string>;
  setSelectedIds: (ids: Set<string>) => void;
  onDeleteSelected: () => void;
  onDuplicateSelected: () => void;
  onSelectAll: () => void;
  onGroup: () => void;
  onUngroup: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  onCopy?: () => void;
  onPaste?: () => void;
  /** Ctrl/Cmd+Shift+V — opens the alternative paste menu. */
  onPasteVariant?: () => void;
  /** Escape is owned by the caller so it can run its own dismissal chain. */
  onEscape?: () => void;
}) {
  const {
    selectedIds,
    setSelectedIds,
    onDeleteSelected,
    onDuplicateSelected,
    onSelectAll,
    onGroup,
    onUngroup,
    onUndo,
    onRedo,
    onCopy,
    onPaste,
    onPasteVariant,
    onEscape,
  } = params;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return;
      const meta = e.ctrlKey || e.metaKey;

      if (e.key === 'Escape') {
        if (onEscape) onEscape();
        else setSelectedIds(new Set());
        return;
      }

      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIds.size > 0) {
        e.preventDefault();
        onDeleteSelected();
        return;
      }

      if (meta) {
        const key = e.key.toLowerCase();

        if (key === 'd') {
          e.preventDefault();
          if (selectedIds.size > 0) onDuplicateSelected();
          return;
        }

        if (key === 'a') {
          e.preventDefault();
          onSelectAll();
          return;
        }

        if (key === 'g' && !e.shiftKey) {
          e.preventDefault();
          onGroup();
          return;
        }

        if (key === 'g' && e.shiftKey) {
          e.preventDefault();
          onUngroup();
          return;
        }

        if (key === 'c' && selectedIds.size > 0) {
          e.preventDefault();
          onCopy?.();
          return;
        }

        if (key === 'v') {
          e.preventDefault();
          // Ctrl/Cmd+Shift+V asks for the paste variants instead of a plain paste.
          if (e.shiftKey) onPasteVariant?.();
          else onPaste?.();
          return;
        }

        if (key === 'z') {
          e.preventDefault();
          if (e.shiftKey) {
            onRedo?.();
          } else {
            onUndo?.();
          }
          return;
        }

        if (key === 'y') {
          e.preventDefault();
          onRedo?.();
          return;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    selectedIds,
    setSelectedIds,
    onDeleteSelected,
    onDuplicateSelected,
    onSelectAll,
    onGroup,
    onUngroup,
    onUndo,
    onRedo,
    onCopy,
    onPaste,
    onPasteVariant,
    onEscape,
  ]);
}
