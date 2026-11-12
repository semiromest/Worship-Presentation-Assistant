import { resolveCanvasSource } from '../canvasSource';
import { snapGuides, sameGuides, type SnapGuide } from './snapGuides';
import { AnimatedGradientBackground } from '../components/AnimatedGradientBackground';
import BackgroundDim from '../components/BackgroundDim';
import type { GeneratedBackground } from '../../shared/generatedBackground';
import { isHelpActive } from '../components/Tour/tourController';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import type { SlideItem } from '../types';
import { cn } from '../utils';
import { SLIDE_REFERENCE_WIDTH, SLIDE_REFERENCE_HEIGHT } from './editorUtils';
import { CanvasItem } from './CanvasItem';
import { usePointerGesture } from './usePointerGesture';
import type { ItemBounds } from './canvasGeometry';

interface CanvasStageProps {
  slideStyles: Record<string, unknown>;
  items: SlideItem[];
  selectedIds: Set<string>;
  keyboardEnabled?: boolean;
  onSelect: (id: string | null, multi?: boolean) => void;
  onSelectMany: (ids: Set<string>) => void;
  onDrag: (id: string, x: number, y: number) => void;
  onDragEnd: (id: string) => void;
  onTransform: (id: string, bounds: ItemBounds) => void;
  onRotate: (id: string, rotation: number) => void;
  gridEnabled?: boolean;
  gridSize?: number;
  gridColor?: string;
  snapEnabled?: boolean;
  lockedRatioIds?: Set<string>;
  safeAreaEnabled?: boolean;
  /** Canvas context menu (paste variants live there). */
  onContextMenu?: (event: React.MouseEvent) => void;
  /**
   * Alt+drag starts a native drag carrying the given items so they can be
   * dropped onto a slide thumbnail. Plain pointer dragging is untouched and Alt
   * suspends item moving/resizing for the duration of the gesture.
   */
  onItemDragStart?: (event: React.DragEvent, itemIds: string[]) => void;
  /** Inline text editing, owned by the editor so toolbars can start it. */
  editingId?: string | null;
  onRequestEdit?: (id: string) => void;
  onTextChange?: (id: string, content: string) => void;
  onEditStart?: () => void;
  onEditEnd?: (id: string) => void;
  /** Floating toolbar shown next to the current selection. */
  selectionToolbar?: ReactNode;
  /** View toggles (grid, snap, safe area) placed in the zoom pill. */
  viewControls?: ReactNode;
  /** Shown over an empty slide instead of the plain hint. */
  emptyState?: ReactNode;
}

export function CanvasStage({
  slideStyles,
  items,
  selectedIds,
  keyboardEnabled = true,
  onSelect,
  onSelectMany,
  onDrag,
  onDragEnd,
  onTransform,
  onRotate,
  gridEnabled,
  gridSize = 10,
  gridColor,
  snapEnabled,
  lockedRatioIds,
  safeAreaEnabled,
  onContextMenu,
  onItemDragStart,
  editingId,
  onRequestEdit,
  onTextChange,
  onEditStart,
  onEditEnd,
  selectionToolbar,
  viewControls,
  emptyState,
}: CanvasStageProps) {
  const { t } = useTranslation();
  const outerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState<number>(1024);
  const [zoom, setZoom] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const [isPanning, setIsPanning] = useState(false);
  const [guides, setGuides] = useState<SnapGuide[]>([]);
  const [rubberBand, setRubberBand] = useState<{
    startX: number;
    startY: number;
    endX: number;
    endY: number;
  } | null>(null);
  // Held Alt turns the selection into a drag source for cross-slide transfer.
  const [altHeld, setAltHeld] = useState(false);

  useEffect(() => {
    if (!keyboardEnabled || !onItemDragStart) return;
    const sync = (event: KeyboardEvent) => { if (!isHelpActive()) setAltHeld(event.altKey); };
    const clear = () => setAltHeld(false);
    window.addEventListener('keydown', sync, true);
    window.addEventListener('keyup', sync, true);
    window.addEventListener('blur', clear);
    return () => {
      window.removeEventListener('keydown', sync, true);
      window.removeEventListener('keyup', sync, true);
      window.removeEventListener('blur', clear);
    };
  }, [onItemDragStart, keyboardEnabled]);

  useLayoutEffect(() => {
    const el = outerRef.current;
    if (!el) return;
    const update = () => {
      const host = el.parentElement;
      if (!host || host.clientWidth === 0 || host.clientHeight === 0) return;
      const styles = getComputedStyle(host);
      const availableWidth = host.clientWidth - parseFloat(styles.paddingLeft) - parseFloat(styles.paddingRight);
      const availableHeight = host.clientHeight - parseFloat(styles.paddingTop) - parseFloat(styles.paddingBottom);
      setContainerWidth(Math.max(1, Math.min(availableWidth, availableHeight * 16 / 9)));
    };
    update();
    const ro = new ResizeObserver(update);
    if (el.parentElement) ro.observe(el.parentElement);
    return () => ro.disconnect();
  }, []);

  const scale = (containerWidth / SLIDE_REFERENCE_WIDTH) * zoom;

  // Selection bounds in surface pixels, for the floating toolbar.
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const [toolbarSize, setToolbarSize] = useState({ width: 0, height: 0 });
  const selectionBounds = useMemo(() => {
    const picked = items.filter((item) => selectedIds.has(item.id) && item.visible !== false);
    if (!picked.length) return null;
    const left = Math.min(...picked.map((item) => item.x));
    const top = Math.min(...picked.map((item) => item.y));
    const right = Math.max(...picked.map((item) => item.x + item.width));
    const bottom = Math.max(...picked.map((item) => item.y + item.height));
    const toX = (value: number) => panX + (value / 100) * SLIDE_REFERENCE_WIDTH * scale;
    const toY = (value: number) => panY + (value / 100) * SLIDE_REFERENCE_HEIGHT * scale;
    return { left: toX(left), top: toY(top), right: toX(right), bottom: toY(bottom) };
  }, [items, selectedIds, panX, panY, scale]);
  const toolbarVisible = !!selectionToolbar && !!selectionBounds;
  useLayoutEffect(() => {
    const el = toolbarRef.current;
    if (!toolbarVisible || !el) return;
    const measure = () =>
      setToolbarSize((previous) =>
        previous.width === el.offsetWidth && previous.height === el.offsetHeight
          ? previous
          : { width: el.offsetWidth, height: el.offsetHeight }
      );
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [toolbarVisible]);
  const surfaceHeight = (containerWidth * 9) / 16;
  const toolbarPosition = (() => {
    if (!selectionBounds) return null;
    const gap = 10;
    // Prefer below the selection (the rotation handle lives above it); flip when there is no room.
    const below = selectionBounds.bottom + gap;
    const above = selectionBounds.top - gap - 32 * scale - toolbarSize.height;
    let top = below + toolbarSize.height <= surfaceHeight + 24 ? below : above;
    top = Math.max(-toolbarSize.height - 4, Math.min(top, surfaceHeight + 4));
    const center = (selectionBounds.left + selectionBounds.right) / 2;
    const half = toolbarSize.width / 2;
    const left = Math.max(half + 4, Math.min(center, containerWidth - half - 4));
    return { top, left };
  })();

  // Zoom with Ctrl+Wheel
  useEffect(() => {
    const el = outerRef.current;
    if (!el) return;
    const handleWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      setZoom((prev) => clampZoom(prev + delta));
    };
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, []);

  type StageGesture = { kind: 'pan' | 'select'; x: number; y: number; panX: number; panY: number };
  const selectionEnd = useRef({ x: 0, y: 0 });
  const actionsRef = useRef({ onDrag, onTransform, onRotate, onDragEnd, onSelect });
  actionsRef.current = { onDrag, onTransform, onRotate, onDragEnd, onSelect };
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const beginStage = usePointerGesture<StageGesture>(
    (event, start) => {
      if (start.kind === 'pan') {
        setPanX(start.panX + event.clientX - start.x);
        setPanY(start.panY + event.clientY - start.y);
      } else {
        selectionEnd.current = { x: event.clientX, y: event.clientY };
        setRubberBand({ startX: start.x, startY: start.y, endX: event.clientX, endY: event.clientY });
      }
    },
    (start, unmount) => {
      if (start.kind === 'select' && !unmount) {
        const canvas = canvasRef.current;
        if (canvas) {
          const rect = canvas.getBoundingClientRect();
          const rx = Math.min(start.x, selectionEnd.current.x);
          const ry = Math.min(start.y, selectionEnd.current.y);
          const rw = Math.abs(start.x - selectionEnd.current.x);
          const rh = Math.abs(start.y - selectionEnd.current.y);
          if (rw > 5 || rh > 5) {
            const hit = new Set<string>();
            for (const item of itemsRef.current) {
              if (item.visible === false || item.locked) continue;
              const left = rect.left + (item.x / 100) * rect.width;
              const top = rect.top + (item.y / 100) * rect.height;
              if (
                left < rx + rw &&
                left + (item.width / 100) * rect.width > rx &&
                top < ry + rh &&
                top + (item.height / 100) * rect.height > ry
              )
                hit.add(item.id);
            }
            onSelectMany(hit);
          }
        }
      }
      if (!unmount) {
        setIsPanning(false);
        setRubberBand(null);
      }
    }
  );
  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const pan = event.button === 1 || (event.button === 0 && event.shiftKey);
    if (!pan && (event.button !== 0 || (event.target as HTMLElement).closest('[data-item]'))) return;
    event.preventDefault();
    if (beginStage(event, { kind: pan ? 'pan' : 'select', x: event.clientX, y: event.clientY, panX, panY })) {
      if (pan) setIsPanning(true);
      else {
        onSelect(null);
        selectionEnd.current = { x: event.clientX, y: event.clientY };
        setRubberBand({ startX: event.clientX, startY: event.clientY, endX: event.clientX, endY: event.clientY });
      }
    }
  };

  const handleItemDrag = useCallback(
    (id: string, x: number, y: number) => {
      const next = snapEnabled ? snapGuides(itemsRef.current, id, x, y) : [];
      setGuides(previous => sameGuides(previous, next) ? previous : next);
      actionsRef.current.onDrag(id, x, y);
    },
    [snapEnabled]
  );

  const handleDragEnd = useCallback((id: string) => {
    setGuides(previous => previous.length ? [] : previous);
    actionsRef.current.onDragEnd(id);
  }, []);

  const handleSelect = useCallback((id: string | null, multi?: boolean) => {
    actionsRef.current.onSelect(id, multi);
  }, []);

  const handleTransform = useCallback(
    (id: string, bounds: ItemBounds) => actionsRef.current.onTransform(id, bounds),
    []
  );
  const handleRotate = useCallback((id: string, rotation: number) => actionsRef.current.onRotate(id, rotation), []);

  const bgColor = (slideStyles.backgroundColor as string) || '#000000';
  const bgImage = slideStyles.backgroundImage as string | undefined;
  const bgGradient = slideStyles.backgroundGradient as
    | { type: 'linear' | 'radial'; angle?: number; stops?: Array<{ color: string; position: number }> }
    | undefined;
  const bgBlur = (slideStyles.backgroundBlur as number) || 0;

  const gridLines = useMemo(() => {
    if (!gridEnabled || !Number.isFinite(gridSize) || gridSize <= 0) return null;
    const lines: ReactNode[] = [];
    const gridPercent = Math.max(1, gridSize);
    const stepX = (gridPercent / 100) * SLIDE_REFERENCE_WIDTH;
    const stepY = (gridPercent / 100) * SLIDE_REFERENCE_HEIGHT;
    const strokeColor = gridColor || 'rgba(255,255,255,0.06)';
    for (let i = stepX; i < SLIDE_REFERENCE_WIDTH; i += stepX) {
      lines.push(
        <line key={`v${i}`} x1={i} y1={0} x2={i} y2={SLIDE_REFERENCE_HEIGHT} stroke={strokeColor} strokeWidth={1} />
      );
    }
    for (let i = stepY; i < SLIDE_REFERENCE_HEIGHT; i += stepY) {
      lines.push(
        <line key={`h${i}`} x1={0} y1={i} x2={SLIDE_REFERENCE_WIDTH} y2={i} stroke={strokeColor} strokeWidth={1} />
      );
    }
    return (
      <svg
        className="absolute inset-0 pointer-events-none"
        width={SLIDE_REFERENCE_WIDTH}
        height={SLIDE_REFERENCE_HEIGHT}
      >
        {lines}
      </svg>
    );
  }, [gridEnabled, gridSize, gridColor]);

  // These are unused - CanvasItem receives id from its props and uses it directly
  // The onDrag/onResize/onRotate callbacks are typed to match CanvasItem's expectations

  return (
    <div className="editor-canvas-stage relative isolate flex min-w-0 flex-1 items-center justify-center overflow-hidden bg-surface-base px-4 pb-14 pt-4 lg:px-8 lg:pt-6">
      <div ref={outerRef} className="relative" style={{ width: containerWidth, maxWidth: '100%', aspectRatio: '16 / 9' }}>
      <div className="slide-surface relative h-full w-full select-none touch-none overflow-clip rounded-lg bg-black shadow-[0_0_0_1px_rgba(255,255,255,0.06),0_20px_50px_-20px_rgba(0,0,0,0.8)]">
        <div
          ref={canvasRef}
          onPointerDown={handlePointerDown}
          onContextMenu={onContextMenu}
          className={cn('absolute top-0 left-0', isPanning ? 'cursor-grabbing' : 'cursor-default')}
          style={{
            width: SLIDE_REFERENCE_WIDTH,
            height: SLIDE_REFERENCE_HEIGHT,
            transform: `translate(${panX}px, ${panY}px) scale(${scale})`,
            transformOrigin: 'top left',
          }}
        >
          {/* Background */}
          <div
            data-testid="editor-canvas-background"
            className="absolute inset-0"
            style={{
              backgroundColor: bgColor,
              backgroundImage: bgImage ? `url(${resolveCanvasSource(bgImage, false).url})` : undefined,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              filter: bgBlur > 0 ? `blur(${bgBlur}px)` : undefined,
            }}
          />

          <AnimatedGradientBackground recipe={slideStyles.generatedBackground as GeneratedBackground | undefined} />
          {/* Gradient */}
          {bgGradient && (
            <div
              className="absolute inset-0"
              style={{
                background:
                  bgGradient.type === 'linear'
                    ? `linear-gradient(${bgGradient.angle || 0}deg, ${(bgGradient.stops || [])
                        .map((s) => `${s.color} ${s.position}%`)
                        .join(', ')})`
                    : `radial-gradient(circle, ${(bgGradient.stops || [])
                        .map((s) => `${s.color} ${s.position}%`)
                        .join(', ')})`,
              }}
            />
          )}

          <BackgroundDim value={slideStyles.backgroundDim} />
          {/* Grid */}
          {gridLines}
          {safeAreaEnabled && (
            <div
              aria-hidden="true"
              className="absolute pointer-events-none border border-dashed border-amber-300/70"
              style={{ inset: '5%', zIndex: 9998 }}
            />
          )}

          {/* Snap guides */}
          {guides.map((guide, i) => (
            <div
              key={i}
              className="absolute pointer-events-none z-50"
              style={{
                [guide.orientation === 'vertical' ? 'left' : 'top']: `${guide.position}%`,
                [guide.orientation === 'vertical' ? 'top' : 'left']: 0,
                [guide.orientation === 'vertical' ? 'width' : 'height']: 1,
                [guide.orientation === 'vertical' ? 'height' : 'width']: '100%',
                backgroundColor: 'rgba(59, 130, 246, 0.7)',
                zIndex: 9999,
              }}
            />
          ))}

          {/* Rubber band selection */}
          {rubberBand &&
            (() => {
              const canvas = canvasRef.current;
              if (!canvas) return null;
              const canvasRect = canvas.getBoundingClientRect();
              const rx = (Math.min(rubberBand.startX, rubberBand.endX) - canvasRect.left) / scale;
              const ry = (Math.min(rubberBand.startY, rubberBand.endY) - canvasRect.top) / scale;
              const rw = Math.abs(rubberBand.endX - rubberBand.startX) / scale;
              const rh = Math.abs(rubberBand.endY - rubberBand.startY) / scale;
              return (
                <div
                  className="absolute pointer-events-none z-40 border border-blue-500/60 bg-blue-500/10"
                  style={{
                    left: rx,
                    top: ry,
                    width: rw,
                    height: rh,
                  }}
                />
              );
            })()}


          {/* Items */}
          {items.map((item) => (
            <div
              key={item.id}
              data-item
              draggable={altHeld && !item.locked && !!onItemDragStart}
              onDragStart={(event) => {
                if (!keyboardEnabled || !onItemDragStart) return;
                const dragged = selectedIds.has(item.id) && selectedIds.size > 0 ? [...selectedIds] : [item.id];
                onItemDragStart(event, dragged);
              }}
            >
              <CanvasItem
                item={item}
                isSelected={selectedIds.has(item.id)}
                keyboardEnabled={keyboardEnabled}
                canvasRef={canvasRef as RefObject<HTMLDivElement>}
                onSelect={handleSelect}
                onDrag={handleItemDrag}
                onDragEnd={handleDragEnd}
                onTransform={handleTransform}
                onRotate={handleRotate}
                snapEnabled={snapEnabled}
                gridSize={snapEnabled ? gridSize : 0}
                lockRatio={item.type === 'image' && lockedRatioIds?.has(item.id)}
                editing={editingId === item.id}
                onRequestEdit={item.type === 'text' ? onRequestEdit : undefined}
                onTextChange={onTextChange}
                onEditStart={onEditStart}
                onEditEnd={onEditEnd}
              />
            </div>
          ))}
        </div>

        {items.length === 0 && (
          <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center p-4">
            {emptyState ?? (
              <div className="rounded-lg border border-dashed border-white/15 bg-black/30 px-5 py-3 text-center text-sm text-white/60">
                {t('common.editorCanvasEmpty')}
              </div>
            )}
          </div>
        )}
      </div>

      {toolbarVisible && toolbarPosition && (
        <div
          ref={toolbarRef}
          className="editor-selection-toolbar absolute z-50"
          style={{ top: toolbarPosition.top, left: toolbarPosition.left, transform: 'translateX(-50%)' }}
        >
          {selectionToolbar}
        </div>
      )}
      </div>

      {/* View pill: toggles + zoom */}
      <div className="absolute bottom-3 right-3 z-50 flex h-8 items-center gap-0.5 rounded-lg border border-white/[0.08] bg-surface/90 px-1 text-white/70 shadow-lg backdrop-blur">
        {viewControls}
        {viewControls && <span aria-hidden="true" className="mx-0.5 h-4 w-px bg-white/10" />}
        <button
          type="button"
          aria-label={t('common.editorZoomOut')}
          title={t('common.editorZoomOut')}
          onClick={() => setZoom((prev) => clampZoom(prev - 0.1))}
          className="grid h-6 w-6 place-items-center rounded-md text-sm hover:bg-white/[0.08] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        >
          {'\u2212'}
        </button>
        <button
          type="button"
          onClick={() => {
            setZoom(1);
            setPanX(0);
            setPanY(0);
          }}
          title={t('common.editorZoomReset')}
          aria-label={t('common.editorZoomReset')}
          className="h-6 min-w-[3rem] rounded-md px-1 text-center text-[11px] tabular-nums hover:bg-white/[0.08] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        >
          {Math.round(zoom * 100)}%
        </button>
        <button
          type="button"
          aria-label={t('common.editorZoomIn')}
          title={t('common.editorZoomIn')}
          onClick={() => setZoom((prev) => clampZoom(prev + 0.1))}
          className="grid h-6 w-6 place-items-center rounded-md text-sm hover:bg-white/[0.08] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        >
          +
        </button>
      </div>
    </div>
  );
}

function clampZoom(value: number): number {
  return Math.max(0.25, Math.min(4, value));
}
