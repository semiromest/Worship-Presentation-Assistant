import { useSlidePrefetch } from '../hooks/useSlidePrefetch';
import { useToolbarOverflow } from '../hooks/useToolbarOverflow';
import ControlTooltip from './ControlTooltip';
import { useListMotion } from '../hooks/useListMotion';
import { createPortal } from 'react-dom';
import ServiceSections from './ServiceSections';
import { TransitionSelector } from '../TransitionSelector';
import { DEFAULT__TRANSITION } from '../constants';
import type { TransitionType } from '../types';
import { GradientQuickApply } from './GradientQuickApply';
import { SlideNavigation } from './OutputStatus';
import { slideGridGeometry, slideGridScrollTop, ROW_GAP, CONTENT_PADDING } from './slideGridGeometry';
import { memo, useMemo, useEffect, useLayoutEffect, useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, X, Plus, Grid2X2, Minus, ChevronLeft, ChevronRight, Lock, ChevronUp, ChevronDown, Copy, Trash2, Undo2, Redo2 } from 'lucide-react';
import { useStore } from '../state/useStore';
import { SlideCard } from '../SlideCard';
import { useSlideInsertionDrag } from '../hooks/useSlideInsertionDrag';
import { getSectionBlocks } from '../../shared/sectionModel';

// Session-only view state survives tab unmounts without entering saved decks.
const scrollPositions = new Map<string, number>();

interface SlideGridProps {
  updateTransition: (update: Partial<{ type: TransitionType; duration: number }>) => void;
  moveSelectedSlides: (direction: -1 | 1) => void;
  deleteSelectedSlides: () => void;
  duplicateSelectedSlides: () => void;
  addSlide: () => void;
  reorderSlides: (from: number, to: number) => void;
  handleSlideClick: (id: string, index: number, e?: React.MouseEvent) => void;
  handleSlideDoubleClick?: (id: string, index: number) => void;
}

/** Simple virtual-row hook: returns which row range is visible */
function useVirtualRows(
  totalRows: number,
  rowHeight: number,
  containerRef: React.RefObject<HTMLDivElement>,
  enabled = true,
  overscan = 3,
) {
  const [scrollTop, setScrollTop] = useState(0);
  const [viewHeight, setViewHeight] = useState(600);

  useEffect(() => {
    if (!enabled) return;
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      setViewHeight(entries[0].contentRect.height);
    });
    ro.observe(el);
    let frame = 0;
    const onScroll = () => {
      // rAF-throttled to avoid excessive re-renders on fast scroll
      if (!frame) frame = requestAnimationFrame(() => {
        frame = 0;
        const top = el.scrollTop;
        setScrollTop(previous => Math.floor(previous / rowHeight) === Math.floor(top / rowHeight) &&
          Math.ceil((previous + viewHeight) / rowHeight) === Math.ceil((top + viewHeight) / rowHeight) ? previous : top);
      });
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    setScrollTop(el.scrollTop);
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      el.removeEventListener('scroll', onScroll);
    };
  }, [containerRef, enabled, rowHeight, viewHeight]);

  const startRow = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const endRow = Math.min(totalRows, Math.ceil((scrollTop + viewHeight) / rowHeight) + overscan);
  const totalHeight = totalRows * rowHeight;

  return { startRow, endRow, totalHeight };
}

/**
 * Ghost slide — a quiet "empty slot" card that mirrors real slide
 * dimensions and creates a new slide on click without competing with slides.
 */
const GhostSlide = memo(({ onClick }: { onClick: () => void }) => {
  const { t } = useTranslation();
  return (
    <ControlTooltip><button
      type="button"
      data-guide-anchor="add-slide"
      onClick={onClick}
      aria-label={t('common.addNewSlide')}
      aria-describedby="add-slide-hint"
      title={t('common.addSlideHint')}
      className="group relative w-full aspect-video rounded-xl border border-dashed border-white/12 bg-white/[0.015] overflow-hidden cursor-pointer text-left transition-colors duration-150 hover:border-white/25 hover:bg-white/[0.035] focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
    >
      <span className="relative flex flex-col items-center justify-center gap-2 h-full">
        <Plus className="w-4 h-4 text-white/35" aria-hidden="true" />
        <span className="text-xs font-medium text-white/40">
          {t('common.addNewSlide')}
        </span>
      </span>
    </button></ControlTooltip>
  );
});

GhostSlide.displayName = 'GhostSlide';

export default function SlideGrid({
  moveSelectedSlides, deleteSelectedSlides, duplicateSelectedSlides,
  addSlide,
  handleSlideClick,
  handleSlideDoubleClick,
  updateTransition,
}: SlideGridProps) {
  const { t } = useTranslation();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const tools = useToolbarOverflow();
  const sectionsEnabled = useStore(s => s.serviceSectionsEnabled);
  const presentation = useStore((s) => s.presentation);
  const searchQuery = useStore((s) => s.searchQuery);
  const setSearchQuery = useStore((s) => s.setSearchQuery);
  const sectionFilterId = useStore((s) => s.sectionFilterId);
  const setSectionFilterId = useStore((s) => s.setSectionFilterId);
  const selectedSlideIds = useStore((s) => s.selectedSlideIds);
  const selectedSlideId = useStore((s) => s.selectedSlideId);
  const scrollKey = `${presentation.id ?? presentation.slides[0]?.id ?? 'empty'}:${sectionsEnabled}`;
  const isProjectorWindowOpen = useStore((s) => s.isProjectorWindowOpen);
  const isRightPanelOpen = useStore(s => s.isRightPanelOpen);
  const canUndo = useStore(s => s.undoState.past.length > 0);
  const canRedo = useStore(s => s.undoState.future.length > 0);
  const dispatchUndo = useStore(s => s.dispatchUndo);
  const liveIndex = useStore((s) => s.liveIndex);
  const slideColumns = useStore((s) => s.slideColumns);
  const setSlideColumns = useStore((s) => s.setSlideColumns);
  const setSelectedSlideIds = useStore((s) => s.setSelectedSlideIds);

  // Section filter lives next to search: both narrow the grid and both suspend
  // order editing, so they belong to the same control group.
  const sectionBlocks = useMemo(
    () => (sectionsEnabled ? getSectionBlocks(presentation) : []),
    [sectionsEnabled, presentation]
  );
  const sectionTitle = (block: { title: string; unassigned?: boolean }) =>
    block.unassigned ? t('sections.none') : block.title;
  const orderRestricted = sectionsEnabled && (!!searchQuery.trim() || !!sectionFilterId);

  const containerRef = useRef<HTMLDivElement>(null);
  const { handlers: insertionHandlers, sourceId: draggedSlideId, movingIds, indicator } = useSlideInsertionDrag(containerRef, slideColumns, sectionsEnabled);
  const scrollTopBeforeLayoutRef = useRef(0);
  const motionSlideIds = useMemo(() => presentation.slides.map(slide => slide.id), [presentation.slides]);
  useListMotion(containerRef, motionSlideIds, `${presentation.id ?? ''}:${sectionsEnabled}`, 'slide', `${searchQuery}:${sectionFilterId}`);
  const restoringScrollRef = useRef(true);
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

  const { columns: columnCount, cardWidth, cardHeight, rowHeight } = useMemo(
    () => slideGridGeometry(containerWidth, slideColumns), [containerWidth, slideColumns]
  );

  const changeColumns = useCallback((columns: number) => {
    scrollTopBeforeLayoutRef.current = containerRef.current?.scrollTop ?? 0;
    setSlideColumns(columns);
  }, [setSlideColumns]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      const tag = el?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || el?.isContentEditable) return;
      if (useStore.getState().activeTab === 'editor') return;
      if (e.ctrlKey || e.metaKey) {
        if (e.key === '=' || e.key === '+') { e.preventDefault(); changeColumns(slideColumns - 1); }
        else if (e.key === '-') { e.preventDefault(); changeColumns(slideColumns + 1); }
        else if (e.key === '0') { e.preventDefault(); changeColumns(4); }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [changeColumns, slideColumns]);

  const slideIndexMap = useMemo(
    () => new Map(presentation.slides.map((s, i) => [s.id, i])),
    [presentation.slides],
  );

  const filteredSlides = useMemo(() => {
    if (!searchQuery.trim()) return presentation.slides;
    const q = searchQuery.trim().toLowerCase();
    return presentation.slides.filter(
      (s) =>
        s.content.toLowerCase().includes(q) ||
        s.group?.title.toLowerCase().includes(q) ||
        s.section?.title.toLowerCase().includes(q) ||
        s.type.toLowerCase().includes(q),
    );
  }, [presentation.slides, searchQuery]);

  useSlidePrefetch(containerRef, filteredSlides, columnCount, isProjectorWindowOpen);

  // Track previous selectedSlideId so we only scroll+focus on actual selection
  // changes, not on every zoom/layout/content update (which would steal focus
  // from the textarea or cause jarring scroll jumps during editing).
  const prevSelectedIdRef = useRef<string | null>(scrollPositions.has(scrollKey) ? selectedSlideId : null);

  const previousDeckRef = useRef(presentation);

  // On selection change, scroll the selected card into view (keyboard users);
  // virtualized off-screen cards may not exist in the DOM, so compute from row geometry.
  useEffect(() => {
    const previousDeck = previousDeckRef.current;
    const previousSelection = prevSelectedIdRef.current;
    const selectionWasDeleted = previousDeck.id === presentation.id && !!previousSelection &&
      previousDeck.slides.some(s => s.id === previousSelection) &&
      !presentation.slides.some(s => s.id === previousSelection);
    previousDeckRef.current = presentation;
    const idChanged = previousSelection !== selectedSlideId;
    prevSelectedIdRef.current = selectedSlideId;
    if (!idChanged || selectionWasDeleted || restoringScrollRef.current) return; // Preserve restored viewport on return.

    const el = containerRef.current;
    if (!el || !selectedSlideId) return;

    if (sectionsEnabled) {
      requestAnimationFrame(() => el.querySelector<HTMLElement>(`[data-slide-id="${CSS.escape(selectedSlideId)}"]`)?.scrollIntoView({ block: 'nearest' }));
      return;
    }
    const idx = filteredSlides.findIndex((s) => s.id === selectedSlideId);
    if (idx === -1) return;

    const cardTop = Math.floor(idx / columnCount) * rowHeight;
    const cardBottom = cardTop + cardHeight;
    const viewTop = el.scrollTop - CONTENT_PADDING;
    const viewBottom = viewTop + el.clientHeight;

    if (cardTop < viewTop) {
      el.scrollTop = cardTop + CONTENT_PADDING;
    } else if (cardBottom > viewBottom) {
      el.scrollTop = cardBottom - el.clientHeight + CONTENT_PADDING;
    }

    // Focus the card after scroll once rendered (focus ring for keyboard users).
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        el.querySelector<HTMLElement>(`[data-slide-id="${selectedSlideId}"]`)?.focus({ preventScroll: true });
      });
    });
  }, [selectedSlideId, filteredSlides, columnCount, rowHeight, cardHeight, sectionsEnabled, presentation]);

  // Ghost slide ("add new") sits at the end of the grid; reserve a slot for it
  const showGhost = !searchQuery;

  // Group slides into rows for virtual rendering
  const rows = useMemo(() => {
    const result: (typeof filteredSlides)[] = [];
    if (sectionsEnabled) return result;
    for (let i = 0; i < filteredSlides.length; i += columnCount) {
      result.push(filteredSlides.slice(i, i + columnCount));
    }
    const last = result[result.length - 1];
    if (showGhost && (!last || last.length === columnCount)) {
      result.push([]);
    }
    return result;
  }, [filteredSlides, columnCount, showGhost, sectionsEnabled]);

  const { startRow, endRow, totalHeight } = useVirtualRows(rows.length, rowHeight, containerRef, !sectionsEnabled);
  // Keep the native drag source mounted when scrolling beyond the overscan.
  const renderedRowIndices = useMemo(() => {
    const indices = Array.from({ length: Math.max(0, endRow - startRow) }, (_, i) => startRow + i);
    const sourceIndex = draggedSlideId ? filteredSlides.findIndex(s => s.id === draggedSlideId) : -1;
    const sourceRow = Math.floor(sourceIndex / columnCount);
    if (sourceIndex >= 0 && !indices.includes(sourceRow)) indices.push(sourceRow);
    return indices;
  }, [startRow, endRow, draggedSlideId, filteredSlides, columnCount]);

  const restoredKeyRef = useRef<string | null>(null);
  const restoreTopRef = useRef(0);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    if (restoredKeyRef.current !== scrollKey) {
      restoredKeyRef.current = scrollKey;
      restoreTopRef.current = scrollPositions.get(scrollKey) ?? 0;
      restoringScrollRef.current = scrollPositions.has(scrollKey);
      el.scrollTop = restoreTopRef.current;
      el.dispatchEvent(new Event('scroll'));
    }
    if (!restoringScrollRef.current) return;
    // Reapply after measured card geometry has replaced the initial estimate.
    el.scrollTop = restoreTopRef.current;
    el.dispatchEvent(new Event('scroll'));
    let secondFrame = 0;
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => {
        el.scrollTop = restoreTopRef.current;
        restoringScrollRef.current = false;
        el.dispatchEvent(new Event('scroll'));
      });
    });
    return () => {
      cancelAnimationFrame(firstFrame);
      cancelAnimationFrame(secondFrame);
    };
  }, [scrollKey, rowHeight, totalHeight]);

  const previousGridRef = useRef({ columnCount, rowHeight, sectionsEnabled, scrollKey });
  useLayoutEffect(() => {
    const previous = previousGridRef.current;
    previousGridRef.current = { columnCount, rowHeight, sectionsEnabled, scrollKey };
    const el = containerRef.current;
    if (!el || restoringScrollRef.current || sectionsEnabled || previous.sectionsEnabled || previous.scrollKey !== scrollKey) return;
    if (previous.columnCount === columnCount && previous.rowHeight === rowHeight) return;
    // The browser may already have clamped scrollTop after the spacer shrank.
    el.scrollTop = slideGridScrollTop(scrollTopBeforeLayoutRef.current,
      { columns: previous.columnCount, rowHeight: previous.rowHeight }, { columns: columnCount, rowHeight });
    scrollTopBeforeLayoutRef.current = el.scrollTop;
    el.dispatchEvent(new Event('scroll'));
  }, [columnCount, rowHeight, sectionsEnabled, scrollKey]);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const remember = () => {
      scrollTopBeforeLayoutRef.current = el.scrollTop;
      if (!restoringScrollRef.current) scrollPositions.set(scrollKey, el.scrollTop);
    };
    el.addEventListener('scroll', remember, { passive: true });
    return () => {
      remember();
      el.removeEventListener('scroll', remember);
    };
  }, [scrollKey]);

  return (
    <div className={`design-slide-grid flex flex-col overflow-hidden h-full flex-1${isRightPanelOpen ? ' inspector-open' : ''}`}>
      {/* Search Bar */}
      <div className="design-searchbar-shell" data-overflow-left={tools.edges.left} data-overflow-right={tools.edges.right}>
      <div ref={tools.ref} className="design-searchbar border-b border-white/5 bg-surface-raised flex-shrink-0">
        <div className="design-search-fields flex items-center gap-3">
          <div className="design-slide-search flex-1" data-has-query={!!searchQuery || undefined}>
            <Search
              className="slide-search-icon"
              aria-hidden="true"
            />
            <label htmlFor="slide-search" className="sr-only">
              {t('common.searchPlaceholder')}
            </label>
            <input
              id="slide-search"
              ref={searchInputRef}
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('common.searchPlaceholder')}
              className="slide-search-input"
            />
            {searchQuery && (
              <ControlTooltip><button
                type="button"
                onClick={() => { setSearchQuery(''); searchInputRef.current?.focus(); }}
                aria-label={t('common.clearSearch')}
                title={t('common.clearSearch')}
                className="slide-search-clear"
              >
                <X className="w-3 h-3" aria-hidden="true" />
              </button></ControlTooltip>
            )}
          </div>

          {sectionsEnabled && sectionBlocks.length > 1 && (
            <select
              aria-label={t('sections.filter')}
              value={sectionFilterId}
              onChange={(e) => setSectionFilterId(e.target.value)}
              className="h-9 max-w-40 shrink-0 rounded-xl border border-white/10 bg-white/5 px-2 text-xs text-white/70 outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
            >
              <option value="">{t('sections.all')}</option>
              {sectionBlocks.map((block) => (
                <option key={block.id} value={block.id}>
                  {sectionTitle(block)} · {t('sections.slideCount', { count: block.slides.length })}
                </option>
              ))}
            </select>
          )}

          {orderRestricted && (
            <div
              role="status"
              className="flex shrink-0 items-center gap-1.5 rounded-xl border border-amber-400/30 bg-amber-500/10 px-2 py-1.5 text-[11px] font-medium text-amber-100"
            >
              <Lock className="h-3.5 w-3.5" aria-hidden="true" />
              {t('sections.orderLocked')}
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setSectionFilterId('');
                }}
                className="rounded px-1 underline hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
              >
                {t('sections.fullFlow')}
              </button>
            </div>
          )}

        </div>
        <div className="design-slide-actions">
          <div className="design-search-history design-search-tool-group" role="group" aria-label={`${t('common.undo')} / ${t('common.redo')}`}>
            <ControlTooltip shortcut="Ctrl+Z"><button type="button" onClick={() => dispatchUndo({ type: 'UNDO' })} disabled={!canUndo} title={t('common.undo')} aria-label={t('common.undo')}><Undo2 aria-hidden="true" /></button></ControlTooltip>
            <ControlTooltip shortcut="Ctrl+Y"><button type="button" onClick={() => dispatchUndo({ type: 'REDO' })} disabled={!canRedo} title={t('common.redo')} aria-label={t('common.redo')}><Redo2 aria-hidden="true" /></button></ControlTooltip>
          </div>
          <div className="design-search-navigation design-search-tool-group" role="group" aria-label={t('common.navigation')}>
            <SlideNavigation />
          </div>
          <div className="design-slide-view-tools">
          <div className="design-slide-columns design-search-tool-group" role="group" aria-label={t('slidesWorkspace.slidesPerRow')}
            onKeyDown={event => event.stopPropagation()}>
            <ControlTooltip><button type="button" data-columns-action="decrease" onClick={() => changeColumns(slideColumns - 1)} disabled={slideColumns <= 1}
              aria-label={t('slidesWorkspace.fewerSlidesPerRow')} title={t('slidesWorkspace.fewerSlidesPerRow')}>
              <Minus aria-hidden="true" />
            </button></ControlTooltip>
            <output className="design-slide-columns-value" aria-live="polite" aria-atomic="true" title={t('slidesWorkspace.slidesPerRow')}>
              <Grid2X2 aria-hidden="true" />
              <span className="sr-only">{t('slidesWorkspace.slidesPerRow')}: </span>{slideColumns}
            </output>
            <ControlTooltip><button type="button" data-columns-action="increase" onClick={() => changeColumns(slideColumns + 1)} disabled={slideColumns >= 8}
              aria-label={t('slidesWorkspace.moreSlidesPerRow')} title={t('slidesWorkspace.moreSlidesPerRow')}>
              <Plus aria-hidden="true" />
            </button></ControlTooltip>
          </div>
          <TransitionSelector
            transitionType={presentation.transition?.type ?? DEFAULT__TRANSITION.type}
            duration={presentation.transition?.duration ?? DEFAULT__TRANSITION.duration}
            onChange={updateTransition}
          />
          </div>
        <div className="design-selection-tools" role="group" aria-label={t('slidesWorkspace.selectionTools')}>
          <span className="design-selection-count">{selectedSlideIds.size} {t('common.selected')}</span>
          <ControlTooltip><button type="button" onClick={() => setSelectedSlideIds(new Set([selectedSlideId]))}
            disabled={selectedSlideIds.size <= 1} aria-label={t('common.clearSelection')} title={t('common.clearSelection')}
            className={selectedSlideIds.size <= 1 ? 'invisible' : undefined}><X /></button></ControlTooltip>
          <GradientQuickApply />
          <div className="design-selection-actions design-search-tool-group">
          <ControlTooltip shortcut="Alt+↑"><button onClick={()=>moveSelectedSlides(-1)} disabled={orderRestricted || !selectedSlideIds.size} title={t('common.moveSelectedUp')} aria-label={t('common.moveSelectedUp')}><ChevronUp /></button></ControlTooltip>
          <ControlTooltip shortcut="Alt+↓"><button onClick={()=>moveSelectedSlides(1)} disabled={orderRestricted || !selectedSlideIds.size} title={t('common.moveSelectedDown')} aria-label={t('common.moveSelectedDown')}><ChevronDown /></button></ControlTooltip>
          <span className="design-tool-divider" aria-hidden="true" />
          <ControlTooltip shortcut="Ctrl+D"><button onClick={duplicateSelectedSlides} disabled={!selectedSlideIds.size} title={t('common.duplicateSelected')} aria-label={t('common.duplicateSelected')}><Copy /></button></ControlTooltip>
          <ControlTooltip shortcut="Del"><button onClick={deleteSelectedSlides} disabled={!selectedSlideIds.size} title={t('common.deleteSelected')} aria-label={t('common.deleteSelected')} className="design-delete"><Trash2 /></button></ControlTooltip>
          </div>
        </div>
        </div>
      </div>

      {(tools.edges.left || tools.edges.right) && <>
        <ControlTooltip><button type="button" className="design-toolbar-scroll design-toolbar-scroll-left" disabled={!tools.edges.left} aria-label={t('slidesWorkspace.previousTools')} onClick={() => tools.scroll(-1)}><ChevronLeft aria-hidden="true" /></button></ControlTooltip>
        <ControlTooltip><button type="button" className="design-toolbar-scroll design-toolbar-scroll-right" disabled={!tools.edges.right} aria-label={t('slidesWorkspace.nextTools')} onClick={() => tools.scroll(1)}><ChevronRight aria-hidden="true" /></button></ControlTooltip>
      </>}
      </div>
      {indicator && createPortal(<div aria-hidden="true" className="design-insertion-overlay">
        <div data-slide-insertion-indicator data-horizontal={indicator.horizontal} className="design-slide-insertion" style={{
          left: indicator.x, top: indicator.y, width: indicator.horizontal ? indicator.length : 3, height: indicator.horizontal ? 3 : indicator.length,
        }} />
        {(indicator.section || movingIds.size > 1) && <div className="design-insertion-label" style={{
          left: Math.max(8, Math.min(indicator.x + 12, window.innerWidth - 208)),
          top: Math.max(8, Math.min(indicator.y >= 48 ? indicator.y - 34 : indicator.y + 14, window.innerHeight - 40)),
        }}>
          {movingIds.size > 1 && <span className="design-insertion-count"><Copy aria-hidden="true" />{movingIds.size}</span>}
          {indicator.section && <span className="design-insertion-section" title={indicator.section}>{indicator.section}</span>}
        </div>}
      </div>, document.body)}
      {draggedSlideId && movingIds.size > 1 && <span className="sr-only" role="status">{movingIds.size} {t('common.selected')}</span>}
      {/* Virtual scroll container */}
      <div ref={containerRef} data-guide-scroll className="flex-1 overflow-y-auto p-4" role="list" aria-label={t('common.slideList')}
        {...insertionHandlers}>
        <div aria-live="polite">
          {filteredSlides.length === 0 && searchQuery.trim() ? (
            <div data-testid="slides-empty-search" className="flex min-h-48 flex-col items-center justify-center gap-3 px-6 py-8 text-center">
              <Search className="h-7 w-7 text-white/40" aria-hidden="true" />
              <p className="text-sm font-medium text-white/80">{t('slidesWorkspace.noSearchResults')}</p>
              <button type="button" onClick={() => { setSearchQuery(''); searchInputRef.current?.focus(); }} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') event.stopPropagation(); }} className="rounded-lg border border-white/15 px-3 py-2 text-xs text-white/80 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400">{t('common.clearSearch')}</button>
            </div>
          ) : sectionsEnabled ? (
            <>
              <ServiceSections slides={filteredSlides} columns={slideColumns} draggedSlideId={draggedSlideId} renderSlide={(slide, drag) => {
                const index = slideIndexMap.get(slide.id)!;
                return <div key={slide.id} role="listitem" data-motion-item="slide" data-motion-id={slide.id}><SlideCard slide={slide} index={index}
                  isSelected={selectedSlideIds.has(slide.id)} isLive={isProjectorWindowOpen && liveIndex === index}
                  onClick={handleSlideClick} onDoubleClick={handleSlideDoubleClick} {...drag} isDragging={movingIds.has(slide.id)} zoom={1} /></div>;
              }} />
            </>
          ) : (
            <div style={{ position: 'relative', height: totalHeight }}>
              {renderedRowIndices.map((rowIdx) => {
                const rowSlides = rows[rowIdx];
                return (
                  <div
                    key={rowIdx}
                    style={{
                      position: 'absolute',
                      top: rowIdx * rowHeight,
                      left: 0,
                      right: 0,
                      display: 'grid',
                      gridTemplateColumns: `repeat(${columnCount}, ${cardWidth}px)`,
                      gap: ROW_GAP,
                    }}
                  >
                    {rowSlides.map((slide) => {
                      const originalIndex = slideIndexMap.get(slide.id)!;
                      return (
                        <div key={slide.id} className="relative" role="listitem" data-motion-item="slide" data-motion-id={slide.id}>
                          <SlideCard
                            slide={slide}
                            index={originalIndex}
                            cardWidth={cardWidth}
                            isSelected={selectedSlideIds.has(slide.id)}
                            isLive={isProjectorWindowOpen && liveIndex === originalIndex}
                            onClick={handleSlideClick}
                            onDoubleClick={handleSlideDoubleClick}
                            isDragging={movingIds.has(slide.id)}
                            zoom={1}
                          />
                        </div>
                      );
                    })}

                    {rowIdx === rows.length - 1 && showGhost && (
                      <div role="listitem" className="relative" data-slide-end-drop>
                        <GhostSlide onClick={addSlide} />
                        <p id="add-slide-hint" className="sr-only">
                          {t('common.addSlideHint')}
                        </p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
