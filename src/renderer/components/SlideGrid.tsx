import { useMemo, useEffect, useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, X, Plus, ZoomIn, ZoomOut } from 'lucide-react';
import { useStore } from '../state/useStore';
import { SlideCard } from '../SlideCard';
import { useDragAndDrop } from '../hooks/useDragAndDrop';

const MIN_ZOOM = 0.4;
const MAX_ZOOM = 2;
const ZOOM_STEP = 0.1;

// Approximate card height ratio for virtual scrolling (aspect-video = 9/16 + badge + gap)
const CARD_ASPECT = 9 / 16;
const ROW_GAP = 12; // gap-3 = 12px

interface SlideGridProps {
  addSlide: () => void;
  reorderSlides: (from: number, to: number) => void;
  handleSlideClick: (id: string, index: number, e?: React.MouseEvent) => void;
}

/** Simple virtual-row hook: returns which row range is visible */
function useVirtualRows(
  totalRows: number,
  rowHeight: number,
  containerRef: React.RefObject<HTMLDivElement>,
  overscan = 3,
) {
  const [scrollTop, setScrollTop] = useState(0);
  const [viewHeight, setViewHeight] = useState(600);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      setViewHeight(entries[0].contentRect.height);
    });
    ro.observe(el);
    const onScroll = () => {
      // rAF-throttled to avoid excessive re-renders on fast scroll
      requestAnimationFrame(() => setScrollTop(el.scrollTop));
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      ro.disconnect();
      el.removeEventListener('scroll', onScroll);
    };
  }, [containerRef]);

  const startRow = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const endRow = Math.min(totalRows, Math.ceil((scrollTop + viewHeight) / rowHeight) + overscan);
  const totalHeight = totalRows * rowHeight;

  return { startRow, endRow, totalHeight };
}

export default function SlideGrid({
  addSlide,
  reorderSlides,
  handleSlideClick,
}: SlideGridProps) {
  const { t } = useTranslation();
  const {
    presentation,
    searchQuery,
    setSearchQuery,
    selectedSlideIds,
    isProjectorWindowOpen,
    liveIndex,
    slideZoom,
    setSlideZoom,
  } = useStore();

  const { handleDragStart, handleDragOver, handleDragEnd, handleDrop, resetDragState, draggedSlideId, dragOverIndex } =
    useDragAndDrop(reorderSlides);

  const slidesRef = useRef(presentation.slides);

  useEffect(() => {
    if (draggedSlideId !== null && slidesRef.current !== presentation.slides) {
      resetDragState();
    }
    slidesRef.current = presentation.slides;
  }, [presentation.slides, draggedSlideId, resetDragState]);

  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(800);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      setContainerWidth(entries[0].contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const columnCount = useMemo(() => {
    if (slideZoom <= 0.4) return 8;
    if (slideZoom <= 0.5) return 7;
    if (slideZoom <= 0.6) return 6;
    if (slideZoom <= 0.7) return 5;
    if (slideZoom <= 0.9) return 4;
    if (slideZoom <= 1.1) return 3;
    if (slideZoom <= 1.5) return 2;
    return 1;
  }, [slideZoom]);

  // Card width and height (height = width * aspect + small overhead for badges)
  const cardWidth = useMemo(
    () => Math.floor((containerWidth - ROW_GAP * (columnCount - 1) - 32) / columnCount),
    [containerWidth, columnCount],
  );
  const cardHeight = useMemo(() => Math.floor(cardWidth * CARD_ASPECT) + 8, [cardWidth]);
  const rowHeight = cardHeight + ROW_GAP;

  const adjustZoom = useCallback(
    (delta: number) => {
      setSlideZoom((prev) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, +(prev + delta).toFixed(1))));
    },
    [setSlideZoom],
  );
  const resetZoom = useCallback(() => setSlideZoom(1), [setSlideZoom]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      const tag = el?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || el?.isContentEditable) return;
      if (e.ctrlKey || e.metaKey) {
        if (e.key === '=' || e.key === '+') { e.preventDefault(); adjustZoom(ZOOM_STEP); }
        else if (e.key === '-') { e.preventDefault(); adjustZoom(-ZOOM_STEP); }
        else if (e.key === '0') { e.preventDefault(); resetZoom(); }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [adjustZoom, resetZoom]);

  const slideIndexMap = useMemo(
    () => new Map(presentation.slides.map((s, i) => [s.id, i])),
    [presentation.slides],
  );

  const filteredSlides = useMemo(() => {
    if (!searchQuery.trim()) return presentation.slides;
    const q = searchQuery.toLowerCase();
    return presentation.slides.filter(
      (s) =>
        s.content.toLowerCase().includes(q) ||
        s.group?.title.toLowerCase().includes(q) ||
        s.type.toLowerCase().includes(q),
    );
  }, [presentation.slides, searchQuery]);

  // Group slides into rows for virtual rendering
  const rows = useMemo(() => {
    const result: (typeof filteredSlides)[] = [];
    for (let i = 0; i < filteredSlides.length; i += columnCount) {
      result.push(filteredSlides.slice(i, i + columnCount));
    }
    return result;
  }, [filteredSlides, columnCount]);

  const { startRow, endRow, totalHeight } = useVirtualRows(rows.length, rowHeight, containerRef);

  return (
    <div className="flex flex-col overflow-hidden h-full flex-1">
      {/* Search Bar */}
      <div className="p-4 border-b border-white/5 bg-surface-raised flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="relative group flex-1">
            <Search
              className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/45 group-focus-within:text-blue-500 transition-colors"
              aria-hidden="true"
            />
            <label htmlFor="slide-search" className="sr-only">
              {t('common.searchPlaceholder')}
            </label>
            <input
              id="slide-search"
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('common.searchPlaceholder')}
              className="w-full bg-white/5 border border-white/10 rounded-xl py-2 pl-10 pr-4 text-sm outline-none focus-visible:border-blue-500/60 focus-visible:ring-2 focus-visible:ring-blue-500/40 focus-visible:bg-white/10 transition-[background-color,border-color] placeholder:text-white/40"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                aria-label={t('common.clearSearch')}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-full hover:bg-white/10 text-white/40 hover:text-white transition-colors active:scale-[0.88]"
              >
                <X className="w-3 h-3" aria-hidden="true" />
              </button>
            )}
          </div>

          {/* Zoom Controls */}
          <div className="flex items-center gap-1 shrink-0" role="group" aria-label={t('common.zoomControls')}>
            <button
              onClick={() => adjustZoom(-ZOOM_STEP)}
              disabled={slideZoom <= MIN_ZOOM}
              aria-label={t('common.zoomOut')}
              className="w-8 h-8 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center transition-colors focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none active:scale-[0.92] disabled:active:scale-100"
            >
              <ZoomOut className="w-4 h-4 text-white/60" aria-hidden="true" />
            </button>

            <button
              onClick={resetZoom}
              aria-label={t('common.zoomReset')}
              className="h-8 px-2 rounded-lg text-[11px] font-medium text-white/55 hover:text-white/80 hover:bg-white/5 transition-colors min-w-[44px] text-center focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none active:scale-[0.92]"
            >
              {Math.round(slideZoom * 100)}%
            </button>

            <button
              onClick={() => adjustZoom(ZOOM_STEP)}
              disabled={slideZoom >= MAX_ZOOM}
              aria-label={t('common.zoomIn')}
              className="w-8 h-8 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center transition-colors focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none active:scale-[0.92] disabled:active:scale-100"
            >
              <ZoomIn className="w-4 h-4 text-white/60" aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>

      {/* Virtual scroll container */}
      <div ref={containerRef} className="flex-1 overflow-y-auto p-4" role="list" aria-label={t('common.slideList')}>
        <div aria-live="polite">
          {filteredSlides.length === 0 && searchQuery ? (
            <div className="h-64 flex flex-col items-center justify-center text-center opacity-30 space-y-4">
              <Search className="w-16 h-16" aria-hidden="true" />
              <p className="text-lg font-medium">{t('common.noResults')}</p>
            </div>
          ) : (
            <div style={{ position: 'relative', height: totalHeight }}>
              {rows.slice(startRow, endRow).map((rowSlides, relIdx) => {
                const rowIdx = startRow + relIdx;
                return (
                  <div
                    key={rowIdx}
                    style={{
                      position: 'absolute',
                      top: rowIdx * rowHeight,
                      left: 0,
                      right: 0,
                      display: 'grid',
                      gridTemplateColumns: `repeat(${columnCount}, 1fr)`,
                      gap: ROW_GAP,
                    }}
                  >
                    {rowSlides.map((slide) => {
                      const originalIndex = slideIndexMap.get(slide.id)!;
                      return (
                        <div key={slide.id} className="relative" role="listitem">
                          {draggedSlideId && dragOverIndex === originalIndex && (
                            <div className="absolute -left-1.5 top-0 bottom-0 w-1 bg-blue-500 rounded-full shadow-[0_0_8px_rgba(59,130,246,0.8)] z-20 pointer-events-none" />
                          )}
                          <SlideCard
                            slide={slide}
                            index={originalIndex}
                            isSelected={selectedSlideIds.has(slide.id)}
                            isLive={isProjectorWindowOpen && liveIndex === originalIndex}
                            onClick={handleSlideClick}
                            onDragStart={handleDragStart}
                            onDragOver={handleDragOver}
                            onDragEnd={handleDragEnd}
                            onDrop={handleDrop}
                            isDragging={draggedSlideId === slide.id}
                            zoom={slideZoom}
                          />
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Add New Slide — fixed at bottom, always visible */}
      {!searchQuery && (
        <div className="flex-shrink-0 px-4 py-3 border-t border-white/5 bg-surface-raised">
          <button
            onClick={addSlide}
            aria-describedby="add-slide-hint"
            className="group w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border-2 border-dashed border-white/10 hover:border-blue-500/50 hover:bg-blue-500/5 transition-[border-color,background-color] focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none active:scale-[0.98]"
          >
            <Plus className="w-4 h-4 text-white/60 group-hover:text-blue-400 transition-colors" aria-hidden="true" />
            <span className="text-sm font-semibold text-white/60 group-hover:text-blue-400 transition-colors">
              {t('common.addNewSlide')}
            </span>
          </button>
          <p id="add-slide-hint" className="sr-only">{t('common.addSlideHint')}</p>
        </div>
      )}
    </div>
  );
}
