import type { Position } from './types';

const POSITIONS: Position[] = ['top-left', 'top-center', 'top-right', 'bottom-left', 'bottom-center', 'bottom-right'];
export const DEFAULT_AUTHOR_POSITION: Position = 'bottom-center';
export const DEFAULT_AUTHOR_SIZE = 28;
export function normalizeAuthorPosition(value: unknown): Position {
  return POSITIONS.includes(value as Position) ? (value as Position) : DEFAULT_AUTHOR_POSITION;
}
export function normalizeAuthorSize(value: unknown): number {
  if (value === null || value === undefined || value === '') return DEFAULT_AUTHOR_SIZE;
  const size = Number(value);
  return Number.isFinite(size) ? Math.max(10, Math.min(60, size)) : DEFAULT_AUTHOR_SIZE;
}
export function readHymnAuthorPosition(): Position {
  try {
    return normalizeAuthorPosition(localStorage.getItem('hymnAuthorPosition'));
  } catch {
    return DEFAULT_AUTHOR_POSITION;
  }
}
export function readHymnAuthorSize(): number {
  try {
    return normalizeAuthorSize(localStorage.getItem('hymnAuthorSize'));
  } catch {
    return DEFAULT_AUTHOR_SIZE;
  }
}
