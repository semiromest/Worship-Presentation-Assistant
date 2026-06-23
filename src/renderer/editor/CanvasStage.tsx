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

interface CanvasStageProps {
  slideStyles: Record<string, unknown>;
  items: SlideItem[];
  selectedIds: Set<string>;
  onSelect: (id: string | null, multi?: boolean) => void;
  onSelectMany: (ids: Set<string>) => void;
  onDrag: (id: string, x: number, y: number) => void;
  onDragEnd: (id: string) => void;
  onResize: (id: string, width: number, height: number) => void;
  onRotate: (id: string, rotation: number) => void;
  gridEnabled?: boolean;
  gridSize?: number;
  gridColor?: string;
  snapEnabled?: boolean;
}

interface SnapGuide {
  orientation: 'horizontal' | 'vertical';
  position: number;
}

const SNAP_THRESHOLD = 1;

export function CanvasStage({
  slideStyles,
  items,
  selectedIds,
  onSelect,
  onSelectMany,
  onDrag,
  onDragEnd,
  onResize,
  onRotate,
  gridEnabled,
  gridSize = 10,
  gridColor,
  snapEnabled,
}: CanvasStageProps) {
  const { t } = useTranslation();
  const outerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState<number>(1024);
  const [zoom, setZoom] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const [isPanning, setIsPanning] = useState(false);
  const panStart = useRef({ x: 0, y: 0, startX: 0, startY: 0 });
  const [guides, setGuides] = useState<SnapGuide[]>([]);
  const [rubberBand, setRubberBand] = useState<{
    startX: number;
    startY: number;
    endX: number;
    endY: number;
  } | null>(null);
  const rubberStart = useRef({ x: 0, y: 0 });
  const rubberActive = useRef(false);

  useLayoutEffect(() => {
    const el = outerRef.current;
    if (!el) return;
    const update = () => setContainerWidth(el.offsetWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const scale = (containerWidth / SLIDE_REFERENCE_WIDTH) * zoom;

  // Zoom with Ctrl+Wheel
  useEffect(() => {
    const el = outerRef.current;
    if (!el) return;
    const handleWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      setZoom(prev => clampZoom(prev + delta));
    };
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, []);

  // Pan with middle mouse button
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button === 1 || (e.button === 0 && e.shiftKey)) {
      e.preventDefault();
      setIsPanning(true);
      panStart.current = {
        x: e.clientX,
        y: e.clientY,
        startX: panX,
        startY: panY,
      };
      return;
    }
    if (e.button === 0 && !(e.target as HTMLElement).closest('[data-item]')) {
      if (!e.shiftKey) {
        onSelect(null);
      }
      rubberStart.current = { x: e.clientX, y: e.clientY };
      setRubberBand({ startX: e.clientX, startY: e.clientY, endX: e.clientX, endY: e.clientY });
    }
  }, [onSelect, panX, panY]);

  const panningRef = useRef(false);

  useEffect(() => {
    if (!isPanning) return;
    panningRef.current = true;
    const handleMove = (e: PointerEvent) => {
      if (!panningRef.current) return;
      const start = panStart.current;
      setPanX(start.startX + (e.clientX - start.x));
      setPanY(start.startY + (e.clientY - start.y));
    };
    const handleUp = () => {
      panningRef.current = false;
      setIsPanning(false);
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };
  }, [isPanning]);

  const itemsRef = useRef(items);
  itemsRef.current = items;
  const onSelectManyRef = useRef(onSelectMany);
  onSelectManyRef.current = onSelectMany;

  useEffect(() => {
    if (!rubberBand) return;
    rubberActive.current = true;
    const handleMove = (e: PointerEvent) => {
      setRubberBand(prev => prev ? { ...prev, endX: e.clientX, endY: e.clientY } : null);
    };
    const handleUp = (e: PointerEvent) => {
      if (!rubberActive.current) return;
      rubberActive.current = false;
      const startX = rubberStart.current.x;
      const startY = rubberStart.current.y;
      const rx = Math.min(startX, e.clientX);
      const ry = Math.min(startY, e.clientY);
      const rw = Math.abs(e.clientX - startX);
      const rh = Math.abs(e.clientY - startY);

      if (rw > 5 || rh > 5) {
        const canvas = canvasRef.current;
        if (canvas) {
          const canvasRect = canvas.getBoundingClientRect();
          const hit = new Set<string>();
          const currentItems = itemsRef.current;
          for (const item of currentItems) {
            const itemLeft = canvasRect.left + (item.x / 100) * canvasRect.width;
            const itemTop = canvasRect.top + (item.y / 100) * canvasRect.height;
            const itemRight = itemLeft + (item.width / 100) * canvasRect.width;
            const itemBottom = itemTop + (item.height / 100) * canvasRect.height;

            if (
              itemLeft < rx + rw &&
              itemRight > rx &&
              itemTop < ry + rh &&
              itemBottom > ry
            ) {
              hit.add(item.id);
            }
          }
          if (hit.size > 0) onSelectManyRef.current(hit);
        }
      }
      setRubberBand(null);
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };
  }, [rubberBand]);

  const handleItemDrag = useCallback(
    (id: string, x: number, y: number) => {
      // Show snap guides
      if (snapEnabled) {
        const draggedItem = items.find(i => i.id === id);
        if (draggedItem) {
          const activeGuides: SnapGuide[] = [];
          const draggedCenter = { x: x + draggedItem.width / 2, y: y + draggedItem.height / 2 };

          for (const other of items) {
            if (other.id === id || !other.visible) continue;
            const otherCenter = {
              x: other.x + other.width / 2,
              y: other.y + other.height / 2,
            };

            const vChecks = [
              { d: x, o: other.x },
              { d: x + draggedItem.width, o: other.x + other.width },
              { d: draggedCenter.x, o: otherCenter.x },
            ];
            for (const c of vChecks) {
              if (Math.abs(c.d - c.o) < SNAP_THRESHOLD) {
                activeGuides.push({ orientation: 'vertical', position: c.o });
                break;
              }
            }

            const hChecks = [
              { d: y, o: other.y },
              { d: y + draggedItem.height, o: other.y + other.height },
              { d: draggedCenter.y, o: otherCenter.y },
            ];
            for (const c of hChecks) {
              if (Math.abs(c.d - c.o) < SNAP_THRESHOLD) {
                activeGuides.push({ orientation: 'horizontal', position: c.o });
                break;
              }
            }
          }
          setGuides(activeGuides);
        }
      }
      onDrag(id, x, y);
    },
    [items, onDrag, snapEnabled],
  );

  const handleDragEnd = useCallback(
    (id: string) => {
      setGuides([]);
      onDragEnd(id);
    },
    [onDragEnd],
  );

  const handleSelect = useCallback(
    (id: string | null, multi?: boolean) => {
      onSelect(id, multi);
    },
    [onSelect],
  );

  const bgColor = (slideStyles.backgroundColor as string) || '#000000';
  const bgImage = slideStyles.backgroundImage as string | undefined;
  const bgGradient = slideStyles.backgroundGradient as
    | { type: 'linear' | 'radial'; angle?: number; stops?: Array<{ color: string; position: number }> }
    | undefined;
  const bgBlur = (slideStyles.backgroundBlur as number) || 0;

  const gridLines = useMemo(() => {
    if (!gridEnabled || gridSize <= 0) return null;
    const lines: ReactNode[] = [];
    const step = (gridSize / 100) * SLIDE_REFERENCE_WIDTH;
    const strokeColor = gridColor || 'rgba(255,255,255,0.06)';
    for (let i = step; i < SLIDE_REFERENCE_WIDTH; i += step) {
      lines.push(
        <line
          key={`v${i}`}
          x1={i}
          y1={0}
          x2={i}
          y2={SLIDE_REFERENCE_HEIGHT}
          stroke={strokeColor}
          strokeWidth={1}
        />,
      );
    }
    for (let i = step; i < SLIDE_REFERENCE_HEIGHT; i += step) {
      lines.push(
        <line
          key={`h${i}`}
          x1={0}
          y1={i}
          x2={SLIDE_REFERENCE_WIDTH}
          y2={i}
          stroke={strokeColor}
          strokeWidth={1}
        />,
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
    <div className="flex flex-1 items-center justify-center bg-[#0a0a0a] p-6 overflow-hidden">
      <div
        ref={outerRef}
        className="relative w-full max-w-5xl select-none overflow-hidden rounded-2xl border border-white/10 bg-black shadow-2xl"
        style={{ aspectRatio: '16 / 9' }}
      >
        <div
          ref={canvasRef}
          onPointerDown={handlePointerDown}
          className={cn(
            'absolute top-0 left-0',
            isPanning ? 'cursor-grabbing' : 'cursor-default',
          )}
          style={{
            width: SLIDE_REFERENCE_WIDTH,
            height: SLIDE_REFERENCE_HEIGHT,
            transform: `scale(${scale}) translate(${panX / scale}px, ${panY / scale}px)`,
            transformOrigin: 'top left',
          }}
        >
          {/* Background */}
          <div
            className="absolute inset-0"
            style={{
              backgroundColor: bgColor,
              backgroundImage: bgImage ? `url(${bgImage})` : undefined,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              filter: bgBlur > 0 ? `blur(${bgBlur}px)` : undefined,
            }}
          />

          {/* Gradient */}
          {bgGradient && (
            <div
              className="absolute inset-0"
              style={{
                background:
                  bgGradient.type === 'linear'
                    ? `linear-gradient(${bgGradient.angle || 0}deg, ${(bgGradient.stops || [])
                        .map(s => `${s.color} ${s.position}%`)
                        .join(', ')})`
                    : `radial-gradient(circle, ${(bgGradient.stops || [])
                        .map(s => `${s.color} ${s.position}%`)
                        .join(', ')})`,
              }}
            />
          )}

          {/* Grid */}
          {gridLines}

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
          {rubberBand && (() => {
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

          {/* Empty state */}
          {items.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="rounded-2xl border border-dashed border-white/15 bg-black/20 px-6 py-4 text-center text-sm text-white/45 backdrop-blur-sm">
                {t('common.editorCanvasEmpty')}
              </div>
            </div>
          )}

          {/* Items */}
          {items.map(item => (
            <div key={item.id} data-item>
              <CanvasItem
                item={item}
                isSelected={selectedIds.has(item.id)}
                canvasRef={canvasRef as RefObject<HTMLDivElement>}
                onSelect={() => handleSelect(item.id, false)}
                onDrag={handleItemDrag}
                onDragEnd={handleDragEnd}
                onResize={onResize}
                onRotate={onRotate}
                snapEnabled={snapEnabled}
                gridSize={snapEnabled ? gridSize : 0}
                zoom={zoom}
              />
            </div>
          ))}
        </div>

        {/* Zoom controls */}
        <div className="absolute bottom-3 right-3 flex items-center gap-2 z-50">
          <button
            type="button"
            onClick={() => setZoom(prev => clampZoom(prev - 0.1))}
            className="rounded-md bg-black/60 px-2 py-1 text-xs text-white/80 hover:bg-black/80"
          >
            -
          </button>
          <span className="rounded-md bg-black/60 px-2 py-1 text-xs text-white/80 min-w-[3rem] text-center">
            {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            onClick={() => setZoom(prev => clampZoom(prev + 0.1))}
            className="rounded-md bg-black/60 px-2 py-1 text-xs text-white/80 hover:bg-black/80"
          >
            +
          </button>
          <button
            type="button"
            onClick={() => { setZoom(1); setPanX(0); setPanY(0); }}
            className="rounded-md bg-black/60 px-2 py-1 text-xs text-white/80 hover:bg-black/80"
          >
            {t('common.editorZoomReset')}
          </button>
        </div>
      </div>
    </div>
  );
}

function clampZoom(value: number): number {
  return Math.max(0.25, Math.min(4, value));
}
