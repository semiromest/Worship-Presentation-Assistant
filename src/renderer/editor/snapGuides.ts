import type { SlideItem } from '../types';

export interface SnapGuide { orientation: 'vertical' | 'horizontal'; position: number }
const THRESHOLD = 1;
type Coordinates = { right: number; bottom: number; centerX: number; centerY: number };
const coordinates = new WeakMap<SlideItem, Coordinates>();
function bounds(item: SlideItem): Coordinates {
  let found = coordinates.get(item);
  if (!found) {
    found = { right: item.x + item.width, bottom: item.y + item.height,
      centerX: item.x + item.width / 2, centerY: item.y + item.height / 2 };
    coordinates.set(item, found);
  }
  return found;
}

export function snapGuides(items: SlideItem[], id: string, x: number, y: number): SnapGuide[] {
  const dragged = items.find(item => item.id === id);
  if (!dragged) return [];
  const guides: SnapGuide[] = [];
  const right = x + dragged.width, bottom = y + dragged.height;
  const centerX = x + dragged.width / 2, centerY = y + dragged.height / 2;
  for (const other of items) {
    if (other.id === id || other.visible === false) continue;
    const box = bounds(other);
    // Preserve the existing edge-based candidate gate and match priority.
    if (Math.abs(x - other.x) > THRESHOLD && Math.abs(right - box.right) > THRESHOLD &&
        Math.abs(y - other.y) > THRESHOLD && Math.abs(bottom - box.bottom) > THRESHOLD) continue;
    const vertical = Math.abs(x - other.x) < THRESHOLD ? other.x
      : Math.abs(right - box.right) < THRESHOLD ? box.right
      : Math.abs(centerX - box.centerX) < THRESHOLD ? box.centerX : undefined;
    const horizontal = Math.abs(y - other.y) < THRESHOLD ? other.y
      : Math.abs(bottom - box.bottom) < THRESHOLD ? box.bottom
      : Math.abs(centerY - box.centerY) < THRESHOLD ? box.centerY : undefined;
    if (vertical !== undefined) guides.push({ orientation: 'vertical', position: vertical });
    if (horizontal !== undefined) guides.push({ orientation: 'horizontal', position: horizontal });
  }
  return guides;
}

export function sameGuides(previous: SnapGuide[], next: SnapGuide[]): boolean {
  return previous.length === next.length && previous.every((guide, index) =>
    guide.orientation === next[index].orientation && guide.position === next[index].position);
}
