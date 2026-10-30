export const ROW_GAP = 12;
export const CONTENT_PADDING = 16;


export function slideCardHeight(width: number): number {
  return Math.floor(width * 9 / 16) + 8;
}

/** contentWidth excludes the scroll container's padding and scrollbar. */
export function slideGridGeometry(contentWidth: number, requestedColumns: number) {
  const available = Math.max(1, contentWidth);
  const requested = normalizeSlideColumns(requestedColumns);
  // Only relevant while the container is hidden or exceptionally narrow.
  const columns = Math.min(requested, Math.max(1, Math.floor((available + ROW_GAP) / (ROW_GAP + 1))));
  const cardWidth = (available - ROW_GAP * (columns - 1)) / columns;
  const cardHeight = slideCardHeight(cardWidth);
  return { columns, cardWidth, cardHeight, rowHeight: cardHeight + ROW_GAP };
}

export function normalizeSlideColumns(value: number): number {
  return Number.isFinite(value) ? Math.max(1, Math.min(8, Math.round(value))) : 4;
}

/** Keep the first visible slide's row in view when zoom or width changes. */
export function slideGridScrollTop(top: number, previous: { columns: number; rowHeight: number }, next: { columns: number; rowHeight: number }): number {
  if (previous.rowHeight <= 0) return top;
  const oldRow = Math.floor(top / previous.rowHeight);
  const firstSlide = oldRow * previous.columns;
  const fraction = (top - oldRow * previous.rowHeight) / previous.rowHeight;
  return Math.round((Math.floor(firstSlide / next.columns) + fraction) * next.rowHeight);
}
