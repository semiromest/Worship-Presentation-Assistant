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
  } = params;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return;
      const meta = e.ctrlKey || e.metaKey;

      if (e.key === 'Escape') {
        setSelectedIds(new Set());
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
          onPaste?.();
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
  ]);
}
