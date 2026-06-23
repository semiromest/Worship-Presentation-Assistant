import type { SlideItem } from '../types';

type AlignType = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';
type DistributeType = 'horizontal' | 'vertical';

export function alignItems(items: SlideItem[], align: AlignType): SlideItem[] {
  if (items.length < 2) return items;

  const bounds = getBounds(items);

  return items.map(item => {
    let x = item.x;
    let y = item.y;

    switch (align) {
      case 'left':
        x = bounds.minX;
        break;
      case 'center':
        x = bounds.minX + (bounds.maxX - bounds.minX) / 2 - item.width / 2;
        break;
      case 'right':
        x = bounds.maxX - item.width;
        break;
      case 'top':
        y = bounds.minY;
        break;
      case 'middle':
        y = bounds.minY + (bounds.maxY - bounds.minY) / 2 - item.height / 2;
        break;
      case 'bottom':
        y = bounds.maxY - item.height;
        break;
    }

    return { ...item, x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 };
  });
}

export function distributeItems(items: SlideItem[], type: DistributeType): SlideItem[] {
  if (items.length < 3) return items;

  const sorted = [...items].sort((a, b) =>
    type === 'horizontal' ? a.x - b.x : a.y - b.y,
  );

  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const totalSpace =
    type === 'horizontal'
      ? last.x + last.width - first.x
      : last.y + last.height - first.y;
  const itemSize = type === 'horizontal' ? 'width' : 'height';
  const posKey = type === 'horizontal' ? 'x' : 'y';

  const itemsTotalSize = sorted.reduce((sum, item) => sum + item[itemSize], 0);
  const gap = (totalSpace - itemsTotalSize) / (sorted.length - 1);

  let currentPos = first[posKey];
  return sorted.map(item => {
    const updated = { ...item, [posKey]: Math.round(currentPos * 10) / 10 };
    currentPos += item[itemSize] + gap;
    return updated;
  });
}

function getBounds(items: SlideItem[]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const item of items) {
    if (item.x < minX) minX = item.x;
    if (item.y < minY) minY = item.y;
    if (item.x + item.width > maxX) maxX = item.x + item.width;
    if (item.y + item.height > maxY) maxY = item.y + item.height;
  }
  return { minX, minY, maxX, maxY };
}
