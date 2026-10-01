import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type MouseEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Check, ChevronLeft, ChevronRight, ChevronsLeft, ListOrdered, Monitor, Timer, Captions, Video, X } from 'lucide-react';
import type { Slide } from '../types';
import { cn } from '../utils';
import { SlidePreviewAny } from '../components/SlidePreview';
import { isItemEditableSlide, type SlideDraft } from './slideDraft';
import { isElementDrag, readElementDrag, type ElementDragPayload } from './elementDrag';
import type { SelectModifiers } from './editorSelection';

export const RAIL_WIDTH = 140;
export const RAIL_COLLAPSED_WIDTH = 40;

const RAIL_PADDING = 8;
const ROW_GAP = 8;
const LABEL_HEIGHT = 16;
const THUMB_ASPECT = 9 / 16;
const OVERSCAN = 4;

/** Icon shown in the corner of slides the editor cannot edit. */
function readOnlyIcon(slide: Slide) {
  if (slide.partsMode) return ListOrdered;
  switch (slide.type) {
    case 'video': return Video;
    case 'screen': return Monitor;
    case 'loop': return ListOrdered;
    case 'countdown': return Timer;
    case 'captions': return Captions;
    default: return Monitor;
  }
}

/** Cheap structural check so a keystroke re-renders one thumbnail, not all of them. */
function sameSlideInputs(prev: RailThumbProps, next: RailThumbProps): boolean {
  return (
    prev.slide === next.slide &&
    prev.draft === next.draft &&
    prev.index === next.index &&
    prev.isActive === next.isActive &&
    prev.isSelected === next.isSelected &&
    prev.isLive === next.isLive &&
    prev.isDropTarget === next.isDropTarget &&
    prev.thumbWidth === next.thumbWidth
  );
}

interface RailThumbProps {
  slide: Slide;
  draft?: SlideDraft;
  index: number;
  isActive: boolean;
  isSelected: boolean;
  isLive: boolean;
  isDropTarget: boolean;
  thumbWidth: number;
  onActivate: (slide: Slide, modifiers: SelectModifiers) => void;
  onContextMenu: (event: MouseEvent, slideId: string) => void;
  onDragOverThumb: (event: DragEvent, slideId: string) => void;
  onDragLeaveThumb: () => void;
  onDropThumb: (event: DragEvent, slideId: string) => void;
}

const RailThumb = memo(function RailThumb({
  slide,
  draft,
  index,
  isActive,
  isSelected,
  isLive,
  isDropTarget,
  thumbWidth,
  onActivate,
  onContextMenu,
  onDragOverThumb,
  onDragLeaveThumb,
  onDropThumb,
}: RailThumbProps) {
  const { t } = useTranslation();
  const editable = isItemEditableSlide(slide);
  const RowIcon = editable ? null : readOnlyIcon(slide);

  // The preview always reflects the editor's working copy, so applying an
  // element to many slides is visible immediately in the rail.
  const previewSlide = useMemo<Slide>(
    () =>
      draft
        ? {
            ...slide,
            items: draft.items,
            styles: draft.styles as Slide['styles'],
            gridEnabled: draft.gridEnabled,
            gridSize: draft.gridSize,
            gridColor: draft.gridColor,
            snapEnabled: draft.snapEnabled,
          }
        : slide,
    [slide, draft],
  );

  return (
    <div
      role="option"
      aria-selected={isSelected}
      aria-current={isActive ? 'true' : undefined}
      aria-label={t('common.editorRailSlideLabel', { number: index + 1 })}
      data-rail-slide={slide.id}
      title={editable ? undefined : t('common.editorRailReadOnly')}
      onClick={(event) => {
        if (!editable && !event.ctrlKey && !event.metaKey && !event.shiftKey) return;
        onActivate(slide, { ctrl: event.ctrlKey || event.metaKey, shift: event.shiftKey });
      }}
      onContextMenu={(event) => onContextMenu(event, slide.id)}
      onDragOver={(event) => onDragOverThumb(event, slide.id)}
      onDragLeave={onDragLeaveThumb}
      onDrop={(event) => onDropThumb(event, slide.id)}
      className={cn(
        'group relative flex cursor-pointer flex-col gap-1 rounded-lg p-1 transition-colors',
        'focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none',
        isSelected ? 'bg-blue-500/10' : 'hover:bg-white/5',
        !editable && 'opacity-55',
      )}
    >
      <div
        className={cn(
          'relative w-full overflow-hidden rounded-md border bg-black',
          isActive ? 'border-blue-500 ring-2 ring-blue-500/60' : 'border-white/10',
          isSelected && !isActive && 'border-blue-400/50',
          isDropTarget && 'border-blue-300 ring-2 ring-blue-300/70',
        )}
        style={{ height: thumbWidth * THUMB_ASPECT }}
      >
        <SlidePreviewAny slide={previewSlide} cardWidth={Math.max(120, thumbWidth * 2.6)} />

        {/* Selected marker: distinguishable from the active ring at a glance. */}
        {isSelected && !isActive && (
          <span className="absolute right-1 top-1 grid h-4 w-4 place-items-center rounded-full bg-blue-500 text-white shadow">
            <Check className="h-2.5 w-2.5" aria-hidden="true" />
          </span>
        )}

        {isActive && (
          <span
            className="absolute inset-y-0 left-0 w-[3px] rounded-r bg-blue-400"
            aria-hidden="true"
          />
        )}

        {isLive && (
          <span
            className="absolute left-1 top-1 h-2 w-2 rounded-full bg-red-500 ring-2 ring-black/50"
            aria-label={t('common.editorRailLive')}
          />
        )}

        {RowIcon && (
          <span className="absolute bottom-1 right-1 rounded bg-black/70 p-0.5 text-white/70">
            <RowIcon className="h-3 w-3" aria-hidden="true" />
          </span>
        )}

        {isDropTarget && (
          <span className="absolute inset-x-0 bottom-0 bg-blue-500/90 px-1 py-0.5 text-center text-[9px] font-medium text-white">
            {t('common.editorRailDropHere')}
          </span>
        )}
      </div>

      <span
        className={cn(
          'text-center text-[10px] tabular-nums leading-none',
          isActive ? 'font-semibold text-blue-200' : 'text-white/45',
        )}
      >
        {index + 1}
      </span>
    </div>
  );
}, sameSlideInputs);

export interface EditorSlideRailProps {
  slides: Slide[];
  drafts: Map<string, SlideDraft>;
  activeId: string;
  selectedIds: string[];
  liveSlideId: string | null;
  onActivate: (slide: Slide, modifiers: SelectModifiers) => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onOpenPasteMenu: (position: { x: number; y: number }, slideId?: string) => void;
  /** Drop handler receives the ids that should receive the elements. */
  onDropElements: (slideId: string, payload: ElementDragPayload) => void;
  onCollapse: () => void;
}

/**
 * Vertical thumbnail rail: the editor's answer to "which slide am I on, how do
 * I move, how do I send this element elsewhere".
 *
 * Rows are windowed so a deck with hundreds of slides keeps the DOM small, and
 * the thumbnails are memoised so typing on the canvas only repaints the slide
 * being edited.
 */
export default function EditorSlideRail({
  slides,
  drafts,
  activeId,
  selectedIds,
  liveSlideId,
  onActivate,
  onSelectAll,
  onClearSelection,
  onOpenPasteMenu,
  onDropElements,
  onCollapse,
}: EditorSlideRailProps) {
  const { t } = useTranslation();
  // Handlers are read through a ref so every row keeps stable props: a single
  // edit must repaint one thumbnail, not the whole rail.
  const handlersRef = useRef({ onActivate, onOpenPasteMenu, onDropElements });
  handlersRef.current = { onActivate, onOpenPasteMenu, onDropElements };
  const activate = useCallback(
    (slide: Slide, modifiers: SelectModifiers) => handlersRef.current.onActivate(slide, modifiers),
    [],
  );
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewHeight, setViewHeight] = useState(600);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);

  const thumbWidth = RAIL_WIDTH - RAIL_PADDING * 2 - 8;
  const rowHeight = thumbWidth * THUMB_ASPECT + LABEL_HEIGHT + ROW_GAP + 8;

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const update = () => setViewHeight(element.clientHeight);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    const onScroll = () => {
      requestAnimationFrame(() => setScrollTop(element.scrollTop));
    };
    element.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      observer.disconnect();
      element.removeEventListener('scroll', onScroll);
    };
  }, []);

  const startRow = Math.max(0, Math.floor(scrollTop / rowHeight) - OVERSCAN);
  const endRow = Math.min(slides.length, Math.ceil((scrollTop + viewHeight) / rowHeight) + OVERSCAN);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  // Keep the working slide visible: navigation may move it off-screen.
  const previousActiveRef = useRef<string | null>(null);
  useEffect(() => {
    const element = scrollRef.current;
    if (!element || previousActiveRef.current === activeId) {
      previousActiveRef.current = activeId;
      return;
    }
    previousActiveRef.current = activeId;
    const index = slides.findIndex((slide) => slide.id === activeId);
    if (index === -1) return;
    const top = index * rowHeight;
    const bottom = top + rowHeight;
    if (top < element.scrollTop) element.scrollTop = top;
    else if (bottom > element.scrollTop + element.clientHeight) {
      element.scrollTop = bottom - element.clientHeight;
    }
  }, [activeId, slides, rowHeight]);

  const handleContextMenu = useCallback((event: MouseEvent, slideId: string) => {
    event.preventDefault();
    handlersRef.current.onOpenPasteMenu({ x: event.clientX, y: event.clientY }, slideId);
  }, []);

  const handleDragOverThumb = useCallback((event: DragEvent, slideId: string) => {
    if (!isElementDrag(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setDropTargetId(slideId);
  }, []);

  const handleDropThumb = useCallback((event: DragEvent, slideId: string) => {
    if (!isElementDrag(event.dataTransfer)) return;
    event.preventDefault();
    const payload = readElementDrag(event.dataTransfer);
    setDropTargetId(null);
    if (payload) handlersRef.current.onDropElements(slideId, payload);
  }, []);

  const handleDragLeaveThumb = useCallback(() => setDropTargetId(null), []);

  const activeCount = selectedIds.length;

  return (
    <div
      className="flex h-full shrink-0 flex-col border-r border-white/10 bg-[#151515]"
      style={{ width: RAIL_WIDTH }}
      data-editor-rail
    >
      <div className="flex items-center justify-between gap-1 border-b border-white/10 px-2 py-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-white/45">
          {t('common.editorRailTitle', { count: slides.length })}
        </span>
        <button
          type="button"
          onClick={onCollapse}
          aria-label={t('common.editorRailCollapse')}
          title={t('common.editorRailCollapse')}
          className="rounded-md p-1 text-white/40 transition hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
        >
          <ChevronsLeft className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>

      {/* Scope indicator: the user must never wonder which slides an edit hits. */}
      {activeCount > 1 ? (
        <div
          role="status"
          className="flex items-center justify-between gap-1 border-b border-blue-500/30 bg-blue-500/15 px-2 py-1"
        >
          <span className="text-[10px] font-semibold text-blue-100">
            {t('common.editorSlidesSelected', { count: activeCount })}
          </span>
          <span className="flex items-center gap-0.5">
            <button
              type="button"
              onClick={onSelectAll}
              className="rounded px-1 py-0.5 text-[9px] text-blue-100/80 hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:outline-none"
            >
              {t('common.editorSelectAllSlides')}
            </button>
            <button
              type="button"
              onClick={onClearSelection}
              aria-label={t('common.editorClearSlideSelection')}
              title={t('common.editorClearSlideSelection')}
              className="rounded p-0.5 text-blue-100/80 hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:outline-none"
            >
              <X className="h-3 w-3" aria-hidden="true" />
            </button>
          </span>
        </div>
      ) : (
        <div className="border-b border-white/10 px-2 py-1">
          <button
            type="button"
            onClick={onSelectAll}
            className="text-[9px] text-white/40 hover:text-white/70 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
          >
            {t('common.editorSelectAllSlides')}
          </button>
        </div>
      )}

      <div
        ref={scrollRef}
        role="listbox"
        aria-multiselectable="true"
        aria-label={t('common.editorRailTitle', { count: slides.length })}
        tabIndex={-1}
        className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden"
        style={{ padding: RAIL_PADDING }}
        onDragLeave={() => setDropTargetId(null)}
      >
        <div style={{ position: 'relative', height: slides.length * rowHeight }}>
          {slides.slice(startRow, endRow).map((slide, offset) => {
            const index = startRow + offset;
            return (
              <div
                key={slide.id}
                style={{
                  position: 'absolute',
                  top: index * rowHeight,
                  left: 0,
                  right: 0,
                  height: rowHeight - ROW_GAP,
                }}
              >
                <RailThumb
                  slide={slide}
                  draft={drafts.get(slide.id)}
                  index={index}
                  isActive={slide.id === activeId}
                  isSelected={selectedSet.has(slide.id)}
                  isLive={slide.id === liveSlideId}
                  isDropTarget={dropTargetId === slide.id}
                  thumbWidth={thumbWidth}
                  onActivate={activate}
                  onContextMenu={handleContextMenu}
                  onDragOverThumb={handleDragOverThumb}
                  onDragLeaveThumb={handleDragLeaveThumb}
                  onDropThumb={handleDropThumb}
                />
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex items-center justify-between gap-1 border-t border-white/10 px-1.5 py-1">
        <button
          type="button"
          onClick={() => activate(slides[Math.max(0, slides.findIndex((s) => s.id === activeId) - 1)], {})}
          disabled={slides.findIndex((s) => s.id === activeId) <= 0}
          aria-label={t('common.editorPreviousSlide')}
          title={t('common.editorPreviousSlide')}
          className="rounded-md p-1 text-white/50 transition hover:bg-white/10 hover:text-white disabled:opacity-25 disabled:hover:bg-transparent focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
        >
          <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
        <span className="px-1 text-[10px] tabular-nums text-white/50">
          {slides.findIndex((s) => s.id === activeId) + 1} / {slides.length}
        </span>
        <button
          type="button"
          onClick={() => activate(slides[Math.min(slides.length - 1, slides.findIndex((s) => s.id === activeId) + 1)], {})}
          disabled={slides.findIndex((s) => s.id === activeId) >= slides.length - 1}
          aria-label={t('common.editorNextSlide')}
          title={t('common.editorNextSlide')}
          className="rounded-md p-1 text-white/50 transition hover:bg-white/10 hover:text-white disabled:opacity-25 disabled:hover:bg-transparent focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
        >
          <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
