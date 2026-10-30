import { useCallback, useEffect, useRef, useState, type DragEvent, type RefObject } from 'react';
import { insertionAtCard, moveSlidesAtInsertion, type SlideInsertion } from '../../shared/slideInsertion';
import { useStore } from '../state/useStore';
import { useImageDrop } from './useImageDrop';
import { playSfx } from '../sfx';
import { dropSide, type DropSide } from './slideDropGeometry';

type Indicator = { x: number; y: number; length: number; horizontal: boolean; section: string };
type Session = { source: string; ids: Set<string>; deckId: string | undefined; epoch: number; slides: unknown; sections: unknown; activeId: string };
const MIME = 'application/x-wpa-slide';

/** Both grid renderers share this controller; section-header dragging remains separate. */
export function useSlideInsertionDrag(root: RefObject<HTMLDivElement>, columns: number, sectionView: boolean) {
  const deck = useStore(state => state.presentation);
  const epoch = useStore(state => state.editorSessionVersion);
  const dropImages = useImageDrop();
  const session = useRef<Session | null>(null);
  const fileDeck = useRef<{ id: string | undefined; epoch: number } | null>(null);
  const cancelledFileDrag = useRef(false);
  const target = useRef<SlideInsertion | null>(null);
  const previousSide = useRef<{ id: string; side: DropSide } | null>(null);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const frame = useRef(0);
  const noOpCache = useRef(new Map<string, boolean>());
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [movingIds, setMovingIds] = useState<Set<string>>(new Set());
  const [indicator, setIndicator] = useState<Indicator | null>(null);

  const clearTarget = useCallback(() => {
    target.current = null;
    previousSide.current = null;
    setIndicator(null);
  }, []);
  const reset = useCallback(() => {
    cancelAnimationFrame(frame.current);
    frame.current = 0;
    pointer.current = null;
    session.current = null;
    fileDeck.current = null;
    cancelledFileDrag.current = false;
    noOpCache.current.clear();
    setSourceId(null);
    setMovingIds(new Set());
    clearTarget();
  }, [clearTarget]);

  useEffect(() => {
    if (fileDeck.current && (fileDeck.current.id !== deck.id || fileDeck.current.epoch !== epoch)) {
      reset(); cancelledFileDrag.current = true;
    }
    if (session.current && (session.current.deckId !== deck.id || session.current.epoch !== epoch || session.current.slides !== deck.slides || session.current.sections !== deck.sections)) reset();
  }, [deck, epoch, reset]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && (session.current || pointer.current)) {
        const files = !!fileDeck.current;
        event.stopPropagation(); reset();
        cancelledFileDrag.current = files;
      }
    };
    window.addEventListener('keydown', escape, true);
    window.addEventListener('blur', reset);
    window.addEventListener('dragend', reset);
    window.addEventListener('drop', reset);
    return () => {
      cancelAnimationFrame(frame.current);
      window.removeEventListener('keydown', escape, true);
      window.removeEventListener('blur', reset);
      window.removeEventListener('dragend', reset);
      window.removeEventListener('drop', reset);
    };
  }, [reset]);

  const locate = (x: number, y: number): SlideInsertion | null => {
    const container = root.current;
    if (!container) return null;
    const bounds = container.getBoundingClientRect();
    const view = { left: Math.max(0, bounds.left), right: Math.min(innerWidth, bounds.right), top: Math.max(0, bounds.top), bottom: Math.min(innerHeight, bounds.bottom) };
    const hit = document.elementFromPoint(x, y);
    if (x < view.left || x > view.right || y < view.top || y > view.bottom || !hit || !container.contains(hit)) { clearTarget(); return null; }
    const state = useStore.getState();
    if (sectionView && (state.searchQuery.trim() || state.sectionFilterId)) { clearTarget(); return null; }
    const section = sectionView ? hit.closest<HTMLElement>('[data-section-id]') : null;
    // Section headers/menus are not implicit slide insertion zones.
    if (sectionView && state.presentation.sections?.length && !hit.closest('[data-slide-drop-area]')) { clearTarget(); return null; }
    const scope = section ?? container;
    const cards = [...scope.querySelectorAll<HTMLElement>('[data-slide-id]')].filter(card => {
      const rect = card.getBoundingClientRect();
      return rect.width > 0 && rect.bottom > view.top && rect.top < view.bottom;
    });
    const lastId = section ? state.presentation.slides.filter(slide => slide.sectionId === section.dataset.sectionId).at(-1)?.id : state.presentation.slides.at(-1)?.id;
    const lastCard = cards.find(card => card.dataset.slideId === lastId);
    // Whitespace after the actual final row is an end zone, not a nearest-card gap.
    const trailingEnd = !!lastCard && y > lastCard.getBoundingClientRect().bottom + 6;
    const explicitEnd = !!hit.closest('[data-slide-end-drop]') || trailingEnd;
    let card = hit.closest<HTMLElement>('[data-slide-id]');
    if (!card && cards.length && !explicitEnd) {
      // Distance to rectangles includes the gaps, and ignores virtual rows off screen.
      let distance = Infinity;
      for (const candidate of cards) {
        const rect = candidate.getBoundingClientRect();
        const dx = Math.max(rect.left - x, 0, x - rect.right);
        const dy = Math.max(rect.top - y, 0, y - rect.bottom);
        const next = dx * dx + dy * dy;
        if (next < distance) { distance = next; card = candidate; }
      }
    }
    let destination: SlideInsertion | null = null;
    let line: Indicator | null = null;
    const sectionName = section ? state.presentation.sections?.find(item => item.id === section.dataset.sectionId)?.title ?? '' : '';
    if (card) {
      const id = card.dataset.slideId!;
      const rect = card.getBoundingClientRect();
      const horizontal = columns === 1;
      const last = previousSide.current;
      const side = dropSide(horizontal ? y - rect.top : x - rect.left, horizontal ? rect.height : rect.width, last?.id === id ? last.side : undefined);
      previousSide.current = { id, side };
      destination = insertionAtCard(state.presentation, id, side);
      // A selected card itself is not a destination for its moving block.
      if (session.current?.ids.has(id)) destination = null;
      line = { x: horizontal ? rect.left : side === 'before' ? rect.left - 7 : rect.right + 5,
        y: horizontal ? side === 'before' ? rect.top - 5 : rect.bottom + 3 : rect.top,
        length: horizontal ? rect.width : rect.height, horizontal, section: sectionName };
    } else {
      const sectionId = section?.dataset.sectionId ?? state.presentation.sections?.at(-1)?.id;
      if (sectionId || (!state.presentation.slides.length && !session.current)) {
        destination = { sectionId: sectionId ?? '', beforeId: null };
        const rect = (hit.closest('[data-slide-end-drop]') ?? section?.querySelector('[data-slide-drop-area]') ?? container).getBoundingClientRect();
        line = { x: rect.left + 12, y: trailingEnd ? lastCard!.getBoundingClientRect().bottom + 6 : Math.max(view.top + 4, rect.top + 12), length: Math.max(1, rect.width - 24), horizontal: true, section: sectionName };
      }
    }
    if (destination && session.current) {
      const key = JSON.stringify(destination);
      let noOp = noOpCache.current.get(key);
      if (noOp === undefined) {
        noOp = moveSlidesAtInsertion(state.presentation, session.current.ids, destination) === state.presentation;
        noOpCache.current.set(key, noOp);
      }
      if (noOp) destination = null;
    }
    target.current = destination;
    setIndicator(previous => {
      const next = destination ? line : null;
      return JSON.stringify(previous) === JSON.stringify(next) ? previous : next;
    });
    return destination;
  };
  // The rAF callback reads the latest render's geometry after resize/count changes.
  const locateRef = useRef(locate);
  locateRef.current = locate;
  const startScroll = () => {
    if (frame.current) return;
    const tick = () => {
      frame.current = 0;
      const container = root.current, point = pointer.current;
      if (!container || !point) return;
      const bounds = container.getBoundingClientRect();
      const rect = { left: Math.max(0, bounds.left), right: Math.min(innerWidth, bounds.right), top: Math.max(0, bounds.top), bottom: Math.min(innerHeight, bounds.bottom), height: Math.min(innerHeight, bounds.bottom) - Math.max(0, bounds.top) };
      if (point.x < rect.left || point.x > rect.right || point.y < rect.top || point.y > rect.bottom) return;
      const edge = Math.min(56, rect.height / 5);
      const amount = point.y < rect.top + edge ? -Math.ceil(14 * (1 - (point.y - rect.top) / edge))
        : point.y > rect.bottom - edge ? Math.ceil(14 * (1 - (rect.bottom - point.y) / edge)) : 0;
      if (amount) { container.scrollTop += amount; locateRef.current(point.x, point.y); }
      if (amount) frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  };
  const isFiles = (event: DragEvent) => event.dataTransfer.types.includes('Files');
  const handlers = {
    onDragStartCapture(event: DragEvent<HTMLDivElement>) {
      const card = (event.target as Element).closest<HTMLElement>('[data-slide-id]');
      if (!card) return;
      const state = useStore.getState();
      event.stopPropagation();
      if (sectionView && (state.searchQuery.trim() || state.sectionFilterId)) { event.preventDefault(); return; }
      const source = card.dataset.slideId!;
      noOpCache.current.clear();
      const ids = state.selectedSlideIds.has(source) ? new Set(state.selectedSlideIds) : new Set([source]);
      session.current = { source, ids, deckId: state.presentation.id, epoch: state.editorSessionVersion, slides: state.presentation.slides, sections: state.presentation.sections,
        activeId: ids.has(state.selectedSlideId) ? state.selectedSlideId : source };
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData(MIME, source);
      event.dataTransfer.setData('text/plain', source);
      setSourceId(source); setMovingIds(ids);
    },
    onDragOverCapture(event: DragEvent<HTMLDivElement>) {
      if (!session.current && !isFiles(event)) return;
      event.preventDefault(); event.stopPropagation();
      if (isFiles(event)) {
        if (cancelledFileDrag.current) { event.dataTransfer.dropEffect = 'none'; return; }
        if (!fileDeck.current) {
          const state = useStore.getState();
          fileDeck.current = { id: state.presentation.id, epoch: state.editorSessionVersion };
        }
      }
      event.dataTransfer.dropEffect = isFiles(event) ? 'copy' : 'move';
      pointer.current = { x: event.clientX, y: event.clientY };
      locate(event.clientX, event.clientY);
      startScroll();
    },
    onDragLeaveCapture(event: DragEvent<HTMLDivElement>) {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
        // External drags have no renderer dragend when abandoned outside the app.
        // Leaving this drop surface ends their session and allows the next entry.
        if (!session.current && (fileDeck.current || cancelledFileDrag.current)) { reset(); return; }
        pointer.current = null; cancelAnimationFrame(frame.current); frame.current = 0; clearTarget();
      }
    },
    onDropCapture(event: DragEvent<HTMLDivElement>) {
      if (!session.current && !isFiles(event)) return;
      event.preventDefault(); event.stopPropagation();
      if (isFiles(event) && cancelledFileDrag.current) { reset(); return; }
      const destination = locate(event.clientX, event.clientY);
      const current = session.current;
      if (destination && isFiles(event)) void dropImages(Array.from(event.dataTransfer.files), destination.sectionId ? destination : undefined);
      else if (destination && current) {
        const state = useStore.getState();
        if (state.presentation.id === current.deckId && state.editorSessionVersion === current.epoch && state.presentation.slides === current.slides && state.presentation.sections === current.sections) {
          const next = moveSlidesAtInsertion(state.presentation, current.ids, destination);
          if (next !== state.presentation) {
            state.dispatchUndo({ type: 'SET', payload: next });
            state.selectSlides({ activeId: current.activeId, ids: current.ids, anchorIndex: next.slides.findIndex(slide => slide.id === current.activeId) });
            playSfx('reorder');
          }
        }
      }
      reset();
    },
    onDragEndCapture: reset,
  };
  return { handlers, sourceId, movingIds, indicator, reset };
}
