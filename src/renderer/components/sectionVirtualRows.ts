import { ROW_GAP } from './slideGridGeometry';
export const SECTION_GAP = ROW_GAP;

export function sectionVirtualRows(count: number, columns: number, width: number, top: number, bottom: number, cardWidth?: number) {
  const rowCount = Math.ceil(count / columns);
  const cardHeight = Math.max(1, (cardWidth ?? (width - SECTION_GAP * (columns - 1)) / columns) * 9 / 16);
  const stride = cardHeight + SECTION_GAP;
  const start = Math.min(rowCount, Math.max(0, Math.floor(top / stride) - 3));
  const end = Math.max(start, Math.min(rowCount, Math.ceil(bottom / stride) + 3));
  return { start, end, stride, height: Math.max(0, rowCount * stride - SECTION_GAP) };
}
