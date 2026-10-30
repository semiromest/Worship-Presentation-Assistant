export type DropSide = 'before' | 'after';

/** Small dead band prevents jitter without making the target depend on drag direction. */
export function dropSide(position: number, size: number, previous?: DropSide): DropSide {
  const middle = size / 2;
  const tolerance = Math.min(10, size * 0.08);
  if (previous && Math.abs(position - middle) <= tolerance) return previous;
  return position < middle ? 'before' : 'after';
}
