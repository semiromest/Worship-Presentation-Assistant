import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from 'react';
import { useTranslation } from 'react-i18next';
import type { SlideItem } from '../types';
import { cn } from '../utils';
import { clamp, DEFAULT_TEXT_STYLE, DEFAULT_IMAGE_STYLE } from './editorUtils';

interface CanvasItemProps {
  item: SlideItem;
  isSelected: boolean;
  canvasRef: RefObject<HTMLDivElement | null>;
  onSelect: () => void;
  onDrag: (id: string, x: number, y: number) => void;
  onDragEnd?: (id: string) => void;
  onResize?: (id: string, width: number, height: number) => void;
  onRotate?: (id: string, rotation: number) => void;
  snapEnabled?: boolean;
  gridSize?: number;
  zoom: number;
}

const HANDLE_SIZE = 10;
const ROTATION_HANDLE_OFFSET = 30;

export const CanvasItem = memo(function CanvasItem({
  item,
  isSelected,
  canvasRef,
  onSelect,
  onDrag,
  onDragEnd,
  onResize,
  onRotate,
  snapEnabled,
  gridSize,
  zoom,
}: CanvasItemProps) {
  const { t } = useTranslation();
  const selfRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const [resizing, setResizing] = useState<'tl' | 'tr' | 'bl' | 'br' | null>(null);
  const [rotating, setRotating] = useState(false);
  const dragStart = useRef<{
    pointerX: number;
    pointerY: number;
    startX: number;
    startY: number;
    startWidth: number;
    startHeight: number;
    startRotation: number;
    rect: DOMRect;
  } | null>(null);
  const dragActive = useRef(false);

  const snap = useCallback(
    (value: number, grid: number): number => {
      if (!snapEnabled || grid <= 0) return value;
      return Math.round(value / grid) * grid;
    },
    [snapEnabled],
  );

  const startDrag = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (item.locked) return;
      if (!canvasRef.current) return;
      e.stopPropagation();
      onSelect();
      const rect = canvasRef.current.getBoundingClientRect();
      dragStart.current = {
        pointerX: e.clientX,
        pointerY: e.clientY,
        startX: item.x,
        startY: item.y,
        startWidth: item.width,
        startHeight: item.height,
        startRotation: item.rotation || 0,
        rect,
      };
      setDragging(true);
      (e.currentTarget as HTMLDivElement).setPointerCapture?.(e.pointerId);
    },
    [canvasRef, item.locked, item.x, item.y, onSelect],
  );

  const startResize = useCallback(
    (handle: 'tl' | 'tr' | 'bl' | 'br') =>
      (e: React.PointerEvent<HTMLDivElement>) => {
        if (item.locked) return;
        if (!canvasRef.current) return;
        e.stopPropagation();
        e.preventDefault();
        const rect = canvasRef.current.getBoundingClientRect();
        dragStart.current = {
          pointerX: e.clientX,
          pointerY: e.clientY,
          startX: item.x,
          startY: item.y,
          startWidth: item.width,
          startHeight: item.height,
          startRotation: item.rotation || 0,
          rect,
        };
        setResizing(handle);
        (e.currentTarget as HTMLDivElement).setPointerCapture?.(e.pointerId);
      },
    [item.locked, canvasRef, item.x, item.y, item.width, item.height, item.rotation],
  );

  const startRotate = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (item.locked) return;
      if (!canvasRef.current) return;
      e.stopPropagation();
      e.preventDefault();
      const rect = canvasRef.current.getBoundingClientRect();
      dragStart.current = {
        pointerX: e.clientX,
        pointerY: e.clientY,
        startX: item.x,
        startY: item.y,
        startWidth: item.width,
        startHeight: item.height,
        startRotation: item.rotation || 0,
        rect,
      };
      setRotating(true);
      (e.currentTarget as HTMLDivElement).setPointerCapture?.(e.pointerId);
    },
    [item.locked, canvasRef, item.x, item.y, item.width, item.height, item.rotation],
  );

  useEffect(() => {
    if (!dragging && !resizing && !rotating) return;
    dragActive.current = true;

    const handleMove = (e: PointerEvent) => {
      if (!dragActive.current) return;
      const start = dragStart.current;
      if (!start) return;

      const dxPct = ((e.clientX - start.pointerX) / start.rect.width) * 100 * zoom;
      const dyPct = ((e.clientY - start.pointerY) / start.rect.height) * 100 * zoom;

      if (dragging) {
        let nextX = clamp(start.startX + dxPct, 0, Math.max(0, 100 - item.width));
        let nextY = clamp(start.startY + dyPct, 0, Math.max(0, 100 - item.height));

        if (snapEnabled && gridSize && gridSize > 0) {
          nextX = snap(nextX, gridSize);
          nextY = snap(nextY, gridSize);
        }

        onDrag(item.id, nextX, nextY);
      }

      if (resizing) {
        let newW: number;
        let newH: number;
        let newX = start.startX;
        let newY = start.startY;

        if (resizing === 'br') {
          newW = start.startWidth + dxPct;
          newH = start.startHeight + dyPct;
        } else if (resizing === 'bl') {
          newW = start.startWidth - dxPct;
          newH = start.startHeight + dyPct;
          newX = start.startX + dxPct;
        } else if (resizing === 'tr') {
          newW = start.startWidth + dxPct;
          newH = start.startHeight - dyPct;
          newY = start.startY + dyPct;
        } else {
          newW = start.startWidth - dxPct;
          newH = start.startHeight - dyPct;
          newX = start.startX + dxPct;
          newY = start.startY + dyPct;
        }

        if (snapEnabled && gridSize && gridSize > 0) {
          newW = snap(newW, gridSize);
          newH = snap(newH, gridSize);
        }

        newW = clamp(newW, 4, 100);
        newH = clamp(newH, 4, 100);
        newX = clamp(newX, 0, 100 - newW);
        newY = clamp(newY, 0, 100 - newH);

        onDrag(item.id, newX, newY);
        onResize?.(item.id, newW, newH);
      }

      if (rotating && onRotate) {
        const centerX = start.rect.left + start.rect.width / 2;
        const centerY = start.rect.top + start.rect.height / 2;
        const angle =
          (Math.atan2(e.clientY - centerY, e.clientX - centerX) * 180) / Math.PI;
        const startAngle =
          (Math.atan2(
            start.pointerY - centerY,
            start.pointerX - centerX,
          ) * 180) /
          Math.PI;
        const delta = angle - startAngle;
        const newRotation = ((start.startRotation + delta) % 360 + 360) % 360;
        onRotate(item.id, Math.round(newRotation));
      }
    };

    const handleUp = () => {
      if (!dragActive.current) return;
      dragActive.current = false;
      setDragging(false);
      setResizing(null);
      setRotating(false);
      onDragEnd?.(item.id);
      dragStart.current = null;
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };
  }, [
    dragging,
    resizing,
    rotating,
    item.id,
    item.width,
    item.height,
    onDrag,
    onResize,
    onRotate,
    onDragEnd,
    snap,
    snapEnabled,
    gridSize,
    zoom,
  ]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (item.locked) return;
      const STEP = e.shiftKey ? 2 : 0.5;
      let dx = 0;
      let dy = 0;
      switch (e.key) {
        case 'ArrowLeft':
          dx = -STEP;
          break;
        case 'ArrowRight':
          dx = STEP;
          break;
        case 'ArrowUp':
          dy = -STEP;
          break;
        case 'ArrowDown':
          dy = STEP;
          break;
        default:
          return;
      }
      e.preventDefault();
      e.stopPropagation();
      const nextX = clamp(item.x + dx, 0, Math.max(0, 100 - item.width));
      const nextY = clamp(item.y + dy, 0, Math.max(0, 100 - item.height));
      onDrag(item.id, nextX, nextY);
    },
    [item, onDrag],
  );

  const textStyles = item.textStyles ?? DEFAULT_TEXT_STYLE;
  const imageStyles = item.imageStyles ?? DEFAULT_IMAGE_STYLE;

  const vAlignMap: Record<string, string> = { top: 'flex-start', center: 'center', bottom: 'flex-end' };

  const cssFilter = [
    imageStyles.brightness !== 1
      ? `brightness(${imageStyles.brightness})`
      : null,
    imageStyles.contrast !== 1
      ? `contrast(${imageStyles.contrast})`
      : null,
    imageStyles.grayscale ? `grayscale(${imageStyles.grayscale})` : null,
    imageStyles.sepia ? `sepia(${imageStyles.sepia})` : null,
    imageStyles.blur ? `blur(${imageStyles.blur}px)` : null,
  ]
    .filter(Boolean)
    .join(' ') || undefined;

  const borderStyle =
    item.borderWidth && item.borderWidth > 0
      ? `${item.borderWidth}px solid ${item.borderColor || '#ffffff'}`
      : undefined;

  const borderRadius = item.borderRadius ? `${item.borderRadius}px` : undefined;

  const cropClipPath = imageStyles.crop
    ? `inset(${imageStyles.crop.y}% ${100 - imageStyles.crop.x - imageStyles.crop.width}% ${100 - imageStyles.crop.y - imageStyles.crop.height}% ${imageStyles.crop.x}%)`
    : undefined;

  const sharedStyle: React.CSSProperties = {
    left: `${item.x}%`,
    top: `${item.y}%`,
    width: `${item.width}%`,
    height: `${item.height}%`,
    transform: `rotate(${item.rotation || 0}deg)`,
    zIndex: item.zIndex ?? 0,
    border: borderStyle,
    borderRadius,
  };

  const sharedClassName = cn(
    'absolute select-none focus-visible:outline-none',
    item.locked ? 'cursor-not-allowed' : 'cursor-move',
    item.visible === false && 'opacity-0 pointer-events-none',
    isSelected && 'ring-2 ring-blue-500 ring-offset-0',
  );

  const handleClassName =
    'absolute w-3 h-3 bg-white border-2 border-blue-500 rounded-full z-10';

  const renderResizeHandles = () => {
    if (!isSelected || item.locked) return null;
    return (
      <>
        <div
          className={cn(handleClassName, 'top-0 left-0 -translate-x-1/2 -translate-y-1/2 cursor-nw-resize')}
          onPointerDown={startResize('tl')}
        />
        <div
          className={cn(handleClassName, 'top-0 right-0 translate-x-1/2 -translate-y-1/2 cursor-ne-resize')}
          onPointerDown={startResize('tr')}
        />
        <div
          className={cn(handleClassName, 'bottom-0 left-0 -translate-x-1/2 translate-y-1/2 cursor-sw-resize')}
          onPointerDown={startResize('bl')}
        />
        <div
          className={cn(handleClassName, 'bottom-0 right-0 translate-x-1/2 translate-y-1/2 cursor-se-resize')}
          onPointerDown={startResize('br')}
        />
        {/* Rotation handle */}
        <div
          className="absolute left-1/2 -top-8 -translate-x-1/2 cursor-grab active:cursor-grabbing z-20"
          onPointerDown={startRotate}
        >
          <div className="w-0.5 h-6 bg-blue-400 mx-auto" />
          <div className="w-3 h-3 rounded-full border-2 border-blue-400 bg-white mx-auto -mt-1" />
        </div>
      </>
    );
  };

  if (item.type === 'image') {
    const flipTransform = [
      imageStyles.flipX ? 'scaleX(-1)' : '',
      imageStyles.flipY ? 'scaleY(-1)' : '',
    ]
      .filter(Boolean)
      .join(' ');

    return (
      <div
        ref={selfRef}
        tabIndex={0}
        role="button"
        onPointerDown={startDrag}
        onKeyDown={handleKeyDown}
        className={sharedClassName}
        style={{
          ...sharedStyle,
          opacity: imageStyles.opacity ?? 1,
          filter: cssFilter,
          overflow: 'hidden',
        }}
      >
        {item.mediaUrl ? (
          <div className="h-full w-full" style={{ clipPath: cropClipPath }}>
            <img
              src={item.mediaUrl}
              alt=""
              draggable={false}
              className={cn(
                'h-full w-full pointer-events-none',
                imageStyles.objectFit === 'cover'
                  ? 'object-cover'
                  : imageStyles.objectFit === 'fill'
                    ? 'object-fill'
                    : 'object-contain',
              )}
              style={{
                transform: flipTransform || undefined,
              }}
            />
          </div>
        ) : (
          <div className="flex h-full w-full items-center justify-center rounded-lg border border-dashed border-white/20 bg-white/5 text-xs text-white/50">
            {t('common.editorNoImageShort')}
          </div>
        )}
        {renderResizeHandles()}
      </div>
    );
  }

  if (item.type === 'group' && item.groupItems) {
    return (
      <div
        ref={selfRef}
        tabIndex={0}
        role="button"
        onPointerDown={startDrag}
        onKeyDown={handleKeyDown}
        className={cn(sharedClassName, 'border border-dashed border-blue-400/40')}
        style={sharedStyle}
      >
        {item.groupItems.map(child => (
          <div
            key={child.id}
            className="absolute"
            style={{
              left: `${child.x}%`,
              top: `${child.y}%`,
              width: `${child.width}%`,
              height: `${child.height}%`,
              zIndex: child.zIndex ?? 0,
              transform: child.rotation ? `rotate(${child.rotation}deg)` : undefined,
            }}
          >
            {child.type === 'text' ? (
              <div
                className="w-full h-full flex overflow-hidden"
                style={{
                  alignItems: vAlignMap[child.textStyles?.verticalAlign || 'center'] || 'center',
                  justifyContent: 'center',
                  textAlign: child.textStyles?.textAlign || 'center',
                  padding: '4px',
                }}
              >
                <span
                  style={{
                    color: child.textStyles?.textColor ?? '#ffffff',
                    fontSize: `${Math.max(4, child.textStyles?.fontSize || 32)}px`,
                    fontFamily: child.textStyles?.fontFamily,
                    fontWeight: child.textStyles?.fontWeight,
                    fontStyle: child.textStyles?.fontStyle,
                    lineHeight: child.textStyles?.lineHeight || 1.25,
                    whiteSpace: 'pre-wrap',
                    width: '100%',
                  }}
                >
                  {child.content}
                </span>
              </div>
            ) : (
              <img
                src={child.mediaUrl}
                alt=""
                draggable={false}
                className="w-full h-full object-contain"
              />
            )}
          </div>
        ))}
        {renderResizeHandles()}
      </div>
    );
  }

  return (
    <div
      ref={selfRef}
      tabIndex={0}
      role="button"
      onPointerDown={startDrag}
      onKeyDown={handleKeyDown}
      className={sharedClassName}
      style={{
        ...sharedStyle,
        display: 'flex',
        alignItems: vAlignMap[textStyles.verticalAlign || 'center'] || 'center',
        justifyContent: 'center',
        textAlign: textStyles.textAlign || 'center',
        padding: '8px',
        overflow: 'hidden',
      }}
    >
      <span
        style={{
          color: textStyles.textColor,
          fontSize: `${Math.max(4, textStyles.fontSize || 32)}px`,
          fontFamily: textStyles.fontFamily,
          fontWeight: textStyles.fontWeight,
          fontStyle: textStyles.fontStyle,
          letterSpacing: textStyles.letterSpacing
            ? `${textStyles.letterSpacing}px`
            : undefined,
          lineHeight: textStyles.lineHeight || 1.25,
          backgroundColor: textStyles.backgroundColor,
          textDecoration: textStyles.textDecoration || undefined,
          textShadow: textStyles.textShadow
            ? `${textStyles.textShadow.color || '#000'} ${textStyles.textShadow.offsetX || 0}px ${textStyles.textShadow.offsetY || 0}px ${textStyles.textShadow.blur || 0}px`
            : undefined,
          WebkitTextStroke: textStyles.textStroke
            ? `${textStyles.textStroke.width}px ${textStyles.textStroke.color}`
            : undefined,
          whiteSpace: 'pre-wrap',
          width: '100%',
        }}
      >
        {item.content}
      </span>
      {renderResizeHandles()}
    </div>
  );
});
