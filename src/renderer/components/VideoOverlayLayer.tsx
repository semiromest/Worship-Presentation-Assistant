import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { VideoTextOverlay } from '../types';
import { SlideTextItem } from './SlideTextItem';
import { CanvasItem } from '../editor/CanvasItem';
import { overlayVisible } from '../videoOverlays';
import { loadGoogleFont } from '../fontLoader';

/** A shared 1920×1080 scene keeps text proportional in editor, cards and projection. */
export function VideoOverlayLayer({
  overlays = [],
  position,
  selectedId,
  active = true,
  editing = false,
  onSelect,
  onPatch,
  onGestureEnd,
  children,
}: {
  overlays?: VideoTextOverlay[];
  position: number;
  selectedId?: string;
  active?: boolean;
  editing?: boolean;
  onSelect?: (id: string | undefined) => void;
  onPatch?: (id: string, patch: Partial<VideoTextOverlay>) => void;
  onGestureEnd?: () => void;
  children?: ReactNode;
}) {
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0, scale: 0 });
  useLayoutEffect(() => {
    if (!host.current) return;
    const update = () => {
      const { width, height } = host.current!.getBoundingClientRect();
      const fittedWidth = Math.min(width, (height * 16) / 9);
      setSize({ width: fittedWidth, height: (fittedWidth * 9) / 16, scale: fittedWidth / 1920 });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(host.current);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    overlays.forEach((item) => {
      if (item.textStyles?.fontFamily) void loadGoogleFont(item.textStyles.fontFamily);
    });
  }, [overlays]);
  return (
    <div
      ref={host}
      className="absolute inset-0"
      style={{ pointerEvents: children ? undefined : 'none' }}
      data-video-overlay-scene
      onPointerDown={(event) => {
        if (
          editing &&
          active &&
          (event.target === event.currentTarget || (event.target as HTMLElement).tagName === 'VIDEO')
        )
          onSelect?.(undefined);
      }}
    >
      <div
        className="absolute overflow-hidden"
        style={{ width: size.width, height: size.height, left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }}
      >
        {children}
        <div
          ref={canvas}
          className="absolute left-0 top-0"
          style={{
            width: 1920,
            height: 1080,
            transform: `scale(${size.scale})`,
            transformOrigin: 'top left',
            pointerEvents: 'none',
          }}
        >
          {overlays
            .filter(
              (item) =>
                item.type === 'text' &&
                (overlayVisible(item, position) || (editing && active && item.id === selectedId))
            )
            .map((item) => {
              const visible = overlayVisible(item, position);
              return editing && active ? (
                <div key={item.id} style={{ opacity: visible ? 1 : 0.4, pointerEvents: 'auto' }}>
                  <CanvasItem
                    item={item}
                    isSelected={selectedId === item.id}
                    canvasRef={canvas}
                    keyboardEnabled={active}
                    onSelect={(id) => onSelect?.(id)}
                    onDrag={(id, x, y) => onPatch?.(id, { x, y })}
                    onTransform={(id, bounds) => onPatch?.(id, bounds)}
                    onRotate={(id, rotation) => onPatch?.(id, { rotation })}
                    onDragEnd={onGestureEnd}
                  />
                </div>
              ) : (
                <div
                  key={item.id}
                  data-video-text={item.id}
                  className="absolute overflow-hidden"
                  style={{
                    left: `${item.x}%`,
                    top: `${item.y}%`,
                    width: `${item.width}%`,
                    height: `${item.height}%`,
                    zIndex: item.zIndex,
                    transform: `rotate(${item.rotation ?? 0}deg)`,
                    border: item.borderWidth
                      ? `${item.borderWidth}px solid ${item.borderColor ?? '#ffffff'}`
                      : undefined,
                    borderRadius: item.borderRadius,
                  }}
                >
                  <SlideTextItem item={item} />
                </div>
              );
            })}
        </div>
      </div>
    </div>
  );
}
