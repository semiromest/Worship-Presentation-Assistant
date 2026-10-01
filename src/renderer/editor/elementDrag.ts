import type { SlideItem } from '../types';

/**
 * Drag payload used to move elements from the canvas / layer list onto a rail
 * thumbnail. Serialisation is split out from the DataTransfer plumbing so the
 * parsing rules are unit-testable.
 */

export const ELEMENT_DRAG_MIME = 'application/x-wpa-elements';

export interface ElementDragPayload {
  items: SlideItem[];
  sourceSlideId: string;
}

export function serializeElementDrag(payload: ElementDragPayload): string {
  return JSON.stringify({
    kind: 'wpa-elements',
    version: 1,
    sourceSlideId: payload.sourceSlideId,
    items: payload.items,
  });
}

export function parseElementDrag(raw: string | null | undefined): ElementDragPayload | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ElementDragPayload> & { items?: unknown };
    if (!Array.isArray(parsed.items) || parsed.items.length === 0) return null;
    if (typeof parsed.sourceSlideId !== 'string') return null;
    const items = parsed.items.filter(
      (item): item is SlideItem =>
        !!item && typeof item === 'object' && typeof (item as SlideItem).id === 'string',
    );
    if (items.length === 0) return null;
    return { items, sourceSlideId: parsed.sourceSlideId };
  } catch {
    return null;
  }
}

export function writeElementDrag(dataTransfer: DataTransfer, payload: ElementDragPayload): void {
  dataTransfer.setData(ELEMENT_DRAG_MIME, serializeElementDrag(payload));
  // text/plain keeps the drag legible to anything that ignores custom types.
  dataTransfer.setData('text/plain', payload.items.map((item) => item.type).join(', '));
  dataTransfer.effectAllowed = 'copy';
}

export function isElementDrag(dataTransfer: DataTransfer | null | undefined): boolean {
  if (!dataTransfer) return false;
  return Array.from(dataTransfer.types ?? []).includes(ELEMENT_DRAG_MIME);
}

export function readElementDrag(dataTransfer: DataTransfer | null | undefined): ElementDragPayload | null {
  if (!dataTransfer) return null;
  return parseElementDrag(dataTransfer.getData(ELEMENT_DRAG_MIME));
}
