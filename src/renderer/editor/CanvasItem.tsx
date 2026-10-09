import { memo, useCallback, useEffect, useRef, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import type { SlideItem } from '../types';
import { cn } from '../utils';
import { SlideImage } from '../components/SlideImage';
import { DEFAULT_TEXT_STYLE, DEFAULT_IMAGE_STYLE } from './editorUtils';
import {
  moveBounds,
  resizeItemBounds,
  rotateBounds,
  screenDelta,
  type ItemBounds,
  type ResizeCorner,
} from './canvasGeometry';
import { usePointerGesture, FINISH_EDITOR_GESTURE } from './usePointerGesture';

interface CanvasItemProps {
  item: SlideItem;
  isSelected: boolean;
  keyboardEnabled?: boolean;
  canvasRef: RefObject<HTMLDivElement | null>;
  onSelect: (id: string, multi?: boolean) => void;
  onDrag: (id: string, x: number, y: number) => void;
  onDragEnd?: (id: string) => void;
  onTransform: (id: string, bounds: ItemBounds) => void;
  onRotate?: (id: string, rotation: number) => void;
  snapEnabled?: boolean;
  gridSize?: number;
  lockRatio?: boolean;
}

function stylesTextHighlight(value?: string): React.CSSProperties['backgroundColor'] {
  return value && value !== 'transparent' ? value : undefined;
}

export const CanvasItem = memo(function CanvasItem({
  item,
  isSelected,
  keyboardEnabled = true,
  canvasRef,
  onSelect,
  onDrag,
  onDragEnd,
  onTransform,
  onRotate,
  snapEnabled,
  gridSize,
  lockRatio,
}: CanvasItemProps) {
  const { t } = useTranslation();
  const selfRef = useRef<HTMLDivElement>(null);
  const keyboardEnd = useRef<(() => void) | null>(null);
  const finishKeyboard = useCallback(() => {
    const finish = keyboardEnd.current;
    keyboardEnd.current = null;
    finish?.();
  }, []);
  useEffect(() => {
    const up = (event: KeyboardEvent) => {
      if (event.key.startsWith('Arrow')) finishKeyboard();
    };
    window.addEventListener('keyup', up);
    window.addEventListener('blur', finishKeyboard);
    window.addEventListener(FINISH_EDITOR_GESTURE, finishKeyboard);
    return () => {
      finishKeyboard();
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', finishKeyboard);
      window.removeEventListener(FINISH_EDITOR_GESTURE, finishKeyboard);
    };
  }, [finishKeyboard]);

  type Gesture = {
    kind: 'move' | 'rotate' | ResizeCorner;
    item: SlideItem;
    rect: DOMRect;
    x: number;
    y: number;
    moved: boolean;
  };
  const begin = usePointerGesture<Gesture>(
    (event, start) => {
      if (!start.moved && event.clientX === start.x && event.clientY === start.y) return;
      start.moved = true;
      const delta = screenDelta(event.clientX - start.x, event.clientY - start.y, start.rect);
      const grid = snapEnabled ? (gridSize ?? 0) : 0;
      if (start.kind === 'move') {
        const next = moveBounds(start.item, delta.x, delta.y, grid);
        onDrag(start.item.id, next.x, next.y);
      } else if (start.kind === 'rotate') {
        onRotate?.(
          start.item.id,
          rotateBounds(
            { ...start.item, rotation: start.item.rotation ?? 0 },
            start.rect,
            { x: start.x, y: start.y },
            { x: event.clientX, y: event.clientY }
          )
        );
      } else {
        onTransform(
          start.item.id,
          resizeItemBounds(
            start.item,
            start.kind,
            event.clientX - start.x,
            event.clientY - start.y,
            start.rect,
            grid,
            lockRatio
          )
        );
      }
    },
    (start) => onDragEnd?.(start.item.id)
  );

  const startGesture = (kind: Gesture['kind']) => (event: React.PointerEvent<HTMLDivElement>) => {
    if (item.locked || event.altKey || event.button !== 0 || !canvasRef.current) return;
    event.stopPropagation();
    event.preventDefault();
    finishKeyboard();
    selfRef.current?.focus({ preventScroll: true });
    const multi = event.shiftKey || event.ctrlKey || event.metaKey;
    onSelect(item.id, multi);
    if (multi && kind === 'move') return;
    begin(event, {
      kind,
      item,
      rect: canvasRef.current.getBoundingClientRect(),
      x: event.clientX,
      y: event.clientY,
      moved: false,
    });
  };
  const startDrag = startGesture('move');
  const startResize = (corner: ResizeCorner) => startGesture(corner);
  const startRotate = startGesture('rotate');

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (!keyboardEnabled || event.defaultPrevented) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      event.stopPropagation();
      onSelect(item.id);
      return;
    }
    if (item.locked || event.altKey || event.ctrlKey || event.metaKey) return;
    const step = event.shiftKey ? 2 : 0.5;
    const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
    const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
    if (!dx && !dy) return;
    event.preventDefault();
    event.stopPropagation();
    if (!keyboardEnd.current) keyboardEnd.current = () => onDragEnd?.(item.id);
    const next = moveBounds(item, dx, dy);
    onDrag(item.id, next.x, next.y);
  };

  const textStyles = item.textStyles ?? DEFAULT_TEXT_STYLE;
  const imageStyles = item.imageStyles ?? DEFAULT_IMAGE_STYLE;

  const vAlignMap: Record<string, string> = { top: 'flex-start', center: 'center', bottom: 'flex-end' };

  const borderStyle =
    item.borderWidth && item.borderWidth > 0
      ? `${item.borderWidth}px solid ${item.borderColor || '#ffffff'}`
      : undefined;

  const borderRadius = item.borderRadius ? `${item.borderRadius}px` : undefined;

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
    isSelected && 'ring-2 ring-blue-500 ring-offset-0'
  );

  const handleClassName = 'absolute w-3 h-3 bg-white border-2 border-blue-500 rounded-full z-10';

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
    return (
      <div
        ref={selfRef}
        tabIndex={0}
        role="button"
        onPointerDown={startDrag}
        onKeyDown={handleKeyDown}
        onBlur={finishKeyboard}
        aria-label={item.content || t('common.editorImage')}
        className={sharedClassName}
        style={{
          ...sharedStyle,
        }}
      >
        {item.mediaUrl ? (
          <SlideImage src={item.mediaUrl} styles={imageStyles} />
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
        onBlur={finishKeyboard}
        aria-label={item.content || t('common.editorImage')}
        className={cn(sharedClassName, 'border border-dashed border-blue-400/40')}
        style={sharedStyle}
      >
        {item.groupItems.map((child) => (
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
                {' '}
                <span
                  style={{
                    color: child.textStyles?.textColor ?? '#ffffff',
                    backgroundColor: stylesTextHighlight(child.textStyles?.textHighlight),
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
              <SlideImage src={child.mediaUrl} styles={child.imageStyles} />
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
      onBlur={finishKeyboard}
      aria-label={item.content || t('common.editorImage')}
      className={sharedClassName}
      style={{
        ...sharedStyle,
        display: 'flex',
        alignItems: vAlignMap[textStyles.verticalAlign || 'center'] || 'center',
        justifyContent: 'center',
        textAlign: textStyles.textAlign || 'center',
        padding: '8px',
      }}
    >
      <span
        style={{
          color: textStyles.textColor,
          textTransform: textStyles.textTransform ?? 'none',
          fontSize: `${Math.max(4, textStyles.fontSize || 32)}px`,
          fontFamily: textStyles.fontFamily,
          fontWeight: textStyles.fontWeight,
          fontStyle: textStyles.fontStyle,
          letterSpacing: textStyles.letterSpacing ? `${textStyles.letterSpacing}px` : undefined,
          lineHeight: textStyles.lineHeight || 1.25,
          backgroundColor: stylesTextHighlight(textStyles.textHighlight) ?? textStyles.backgroundColor,
          textDecoration: textStyles.textDecoration || undefined,
          textShadow: textStyles.textShadow
            ? `${textStyles.textShadow.color || '#000'} ${textStyles.textShadow.offsetX || 0}px ${textStyles.textShadow.offsetY || 0}px ${textStyles.textShadow.blur || 0}px`
            : undefined,
          WebkitTextStroke: textStyles.textStroke
            ? `${textStyles.textStroke.width}px ${textStyles.textStroke.color}`
            : undefined,
          whiteSpace: 'pre-wrap',
          width: '100%',
          maxHeight: '100%',
          overflow: 'hidden',
        }}
      >
        {item.content}
      </span>
      {renderResizeHandles()}
    </div>
  );
});
