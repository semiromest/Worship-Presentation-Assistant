import type { SlideItem } from '../types';

export interface SnapGuide {
  orientation: 'horizontal' | 'vertical';
  position: number;
}

const SNAP_THRESHOLD = 1.5;

export function snapValue(
  value: number,
  gridSize: number,
  enabled: boolean,
): number {
  if (!enabled || gridSize <= 0) return value;
  return Math.round(value / gridSize) * gridSize;
}
