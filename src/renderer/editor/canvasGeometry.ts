import { clamp } from './editorUtils';

export interface ItemBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}
export type ResizeCorner = 'tl' | 'tr' | 'bl' | 'br';

// getBoundingClientRect already contains the canvas zoom and window scaling.
export function screenDelta(dx: number, dy: number, rect: { width: number; height: number }) {
  return { x: rect.width > 0 ? (dx / rect.width) * 100 : 0, y: rect.height > 0 ? (dy / rect.height) * 100 : 0 };
}

const snap = (value: number, grid: number) =>
  Number.isFinite(grid) && grid > 0 ? Math.round(value / grid) * grid : value;

export function moveBounds(start: ItemBounds, dx: number, dy: number, grid = 0): ItemBounds {
  return {
    ...start,
    x: clamp(snap(start.x + dx, grid), 0, Math.max(0, 100 - start.width)),
    y: clamp(snap(start.y + dy, grid), 0, Math.max(0, 100 - start.height)),
  };
}

export function resizeBounds(
  start: ItemBounds,
  corner: ResizeCorner,
  dx: number,
  dy: number,
  grid = 0,
  lockRatio = false
): ItemBounds {
  const left = corner.endsWith('l');
  const top = corner.startsWith('t');
  const right = start.x + start.width;
  const bottom = start.y + start.height;
  let width = clamp(snap(start.width + (left ? -dx : dx), grid), 4, left ? right : 100 - start.x);
  let height = clamp(snap(start.height + (top ? -dy : dy), grid), 4, top ? bottom : 100 - start.y);
  if (lockRatio && start.width > 0 && start.height > 0) {
    const ratio = start.width / start.height;
    const wanted = Math.abs(dx / start.width) >= Math.abs(dy / start.height) ? width : height * ratio;
    width = clamp(
      wanted,
      Math.max(4, 4 * ratio),
      Math.min(left ? right : 100 - start.x, (top ? bottom : 100 - start.y) * ratio)
    );
    height = width / ratio;
  }
  return { x: left ? right - width : start.x, y: top ? bottom - height : start.y, width, height };
}

export function resizeItemBounds(
  start: ItemBounds & { rotation?: number },
  corner: ResizeCorner,
  dx: number,
  dy: number,
  rect: { width: number; height: number },
  grid = 0,
  lockRatio = false
): ItemBounds {
  const angle = ((start.rotation ?? 0) * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const delta = screenDelta(cos * dx + sin * dy, -sin * dx + cos * dy, rect);
  const next = resizeBounds(start, corner, delta.x, delta.y, grid, lockRatio);
  if (!angle) return next;
  // Keep the opposite displayed corner anchored: the local center displacement
  // rotates with the item, while its unrotated CSS origin changes with size.
  const dw = ((next.width - start.width) / 100) * rect.width;
  const dh = ((next.height - start.height) / 100) * rect.height;
  const cx = (corner.endsWith('l') ? -dw : dw) / 2;
  const cy = (corner.startsWith('t') ? -dh : dh) / 2;
  const offset = screenDelta(cos * cx - sin * cy - dw / 2, sin * cx + cos * cy - dh / 2, rect);
  return {
    ...next,
    x: clamp(start.x + offset.x, 0, 100 - next.width),
    y: clamp(start.y + offset.y, 0, 100 - next.height),
  };
}

/** Property-panel resize keeps the center and fits the result within slide bounds. */
export function sizeFromCenter(
  start: ItemBounds,
  axis: 'width' | 'height',
  value: number,
  lockRatio = false
): ItemBounds {
  const ratio = start.width / start.height;
  let width = axis === 'width' ? clamp(value, 4, 100) : start.width;
  let height = axis === 'height' ? clamp(value, 4, 100) : start.height;
  if (lockRatio && Number.isFinite(ratio) && ratio > 0) {
    width = clamp(axis === 'width' ? width : height * ratio, Math.max(4, 4 * ratio), Math.min(100, 100 * ratio));
    height = width / ratio;
  }
  return {
    x: clamp(start.x + (start.width - width) / 2, 0, 100 - width),
    y: clamp(start.y + (start.height - height) / 2, 0, 100 - height),
    width,
    height,
  };
}

export function rotateBounds(
  start: ItemBounds & { rotation: number },
  rect: { left: number; top: number; width: number; height: number },
  from: { x: number; y: number },
  to: { x: number; y: number }
) {
  const cx = rect.left + ((start.x + start.width / 2) / 100) * rect.width;
  const cy = rect.top + ((start.y + start.height / 2) / 100) * rect.height;
  const delta = ((Math.atan2(to.y - cy, to.x - cx) - Math.atan2(from.y - cy, from.x - cx)) * 180) / Math.PI;
  return Math.round((((start.rotation + delta) % 360) + 360) % 360);
}
