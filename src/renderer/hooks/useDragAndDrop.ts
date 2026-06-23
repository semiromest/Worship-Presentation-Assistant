import { useCallback, useRef, useState } from 'react';

export function useDragAndDrop(reorderSlides: (from: number, to: number) => void) {
  const [draggedSlideId, setDraggedSlideId] = useState<string | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const draggedSlideIdRef = useRef<string | null>(null);
  const dragStartIndexRef = useRef<number | null>(null);
  const dragOverIndexRef = useRef<number | null>(null);
  const committedRef = useRef(false);

  const resetDragState = useCallback(() => {
    setDraggedSlideId(null);
    setDragOverIndex(null);
    draggedSlideIdRef.current = null;
    dragStartIndexRef.current = null;
    dragOverIndexRef.current = null;
    committedRef.current = false;
  }, []);

  const handleDragStart = useCallback((id: string, index: number) => {
    setDraggedSlideId(id);
    setDragOverIndex(index);
    draggedSlideIdRef.current = id;
    dragStartIndexRef.current = index;
    dragOverIndexRef.current = index;
    committedRef.current = false;
  }, []);

  const handleDragOver = useCallback((id: string, index: number) => {
    if (draggedSlideIdRef.current !== null && draggedSlideIdRef.current !== id) {
      setDragOverIndex(index);
      dragOverIndexRef.current = index;
    }
  }, []);

  const handleDrop = useCallback(() => {
    if (committedRef.current) return;
    committedRef.current = true;

    const startIdx = dragStartIndexRef.current;
    const toIdx = dragOverIndexRef.current;
    const currentDraggedId = draggedSlideIdRef.current;

    if (currentDraggedId && startIdx !== null && toIdx !== null && startIdx !== toIdx) {
      reorderSlides(startIdx, toIdx);
    }

    resetDragState();
  }, [reorderSlides, resetDragState]);

  const handleDragEnd = useCallback(() => {
    if (!committedRef.current) {
      resetDragState();
    }
  }, [resetDragState]);

  return {
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    handleDrop,
    resetDragState,
    draggedSlideId,
    dragOverIndex,
  };
}
