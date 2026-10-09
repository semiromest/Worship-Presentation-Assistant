import type { SlideItem } from '../types';
import type { ItemBounds } from './canvasGeometry';

export function replaceImage(item: SlideItem, mediaUrl?: string): SlideItem {
  return { ...item, mediaUrl, imageStyles: { ...item.imageStyles, crop: undefined, cropMode: undefined } };
}

export function restoreImageRatio(item: ItemBounds, pixelRatio: number): ItemBounds {
  if (!Number.isFinite(pixelRatio) || pixelRatio <= 0) return item;
  const ratio = (pixelRatio * 9) / 16;
  const width = Math.min(100, 100 * ratio, Math.max(4, 4 * ratio, item.width));
  const height = width / ratio;
  return {
    x: Math.max(0, Math.min(100 - width, item.x + (item.width - width) / 2)),
    y: Math.max(0, Math.min(100 - height, item.y + (item.height - height) / 2)),
    width,
    height,
  };
}
