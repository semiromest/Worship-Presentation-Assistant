import type { SlideItem } from '../types';
import { makeItemId, normalizeItems, normalizeItem, SLIDE_REFERENCE_HEIGHT, SLIDE_REFERENCE_WIDTH } from './editorUtils';

/**
 * Group geometry contract (matches how `CanvasItem` draws a group):
 * a child's x / y / width / height are percentages of the GROUP box, not of the
 * slide. Resizing a group therefore scales its children, and un-grouping maps
 * them back onto the slide.
 */

const round = (value: number) => Math.round(value * 1000) / 1000;

export function createGroup(
  items: SlideItem[],
  selectedIds: Set<string>,
): SlideItem[] {
  // Locked items stay out: grouping would let them be moved with the group.
  const selected = normalizeItems(items).filter(i => selectedIds.has(i.id) && !i.locked);
  if (selected.length < 2) return items;

  const ordered = normalizeItems(items);
  const minX = Math.min(...selected.map(i => i.x));
  const minY = Math.min(...selected.map(i => i.y));
  const maxX = Math.max(...selected.map(i => i.x + i.width));
  const maxY = Math.max(...selected.map(i => i.y + i.height));
  const width = Math.max(0.001, maxX - minX);
  const height = Math.max(0.001, maxY - minY);

  const group = normalizeItem({
    id: makeItemId('group'),
    type: 'group',
    x: minX,
    y: minY,
    width,
    height,
    zIndex: 0,
    visible: true,
    locked: false,
    rotation: 0,
    groupItems: selected.map((s, index) => ({
      ...s,
      x: round(((s.x - minX) / width) * 100),
      y: round(((s.y - minY) / height) * 100),
      width: round((s.width / width) * 100),
      height: round((s.height / height) * 100),
      zIndex: index,
    })),
    styles: undefined,
  });

  // The group takes the stacking slot of its top-most member, so items that
  // were above the selection stay above it.
  const topId = selected[selected.length - 1].id;
  const chosen = new Set(selected.map(i => i.id));
  const next = ordered.flatMap(item => item.id === topId ? [group] : chosen.has(item.id) ? [] : [item]);
  return next.map((item, index) => ({ ...item, zIndex: index }));
}

/** Maps a group's children back onto the slide (handles group resize and rotation). */
export function expandGroup(group: SlideItem, freshIds = true): SlideItem[] {
  if (group.type !== 'group' || !group.groupItems) return [group];
  const rotation = group.rotation ?? 0;
  const rad = (rotation * Math.PI) / 180;
  const groupCx = group.x + group.width / 2;
  const groupCy = group.y + group.height / 2;
  const children = [...group.groupItems].sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0));
  return children.map(child => {
    const width = (child.width * group.width) / 100;
    const height = (child.height * group.height) / 100;
    let x = group.x + (child.x * group.width) / 100;
    let y = group.y + (child.y * group.height) / 100;
    if (rotation) {
      // Rotate the child's centre around the group centre in pixel space, since
      // slide percentages are not square.
      const px = (x + width / 2 - groupCx) * SLIDE_REFERENCE_WIDTH / 100;
      const py = (y + height / 2 - groupCy) * SLIDE_REFERENCE_HEIGHT / 100;
      const rx = px * Math.cos(rad) - py * Math.sin(rad);
      const ry = px * Math.sin(rad) + py * Math.cos(rad);
      x = groupCx + (rx * 100) / SLIDE_REFERENCE_WIDTH - width / 2;
      y = groupCy + (ry * 100) / SLIDE_REFERENCE_HEIGHT - height / 2;
    }
    return {
      ...child,
      id: freshIds ? makeItemId('ungroup') : child.id,
      x: round(x),
      y: round(y),
      width: round(width),
      height: round(height),
      rotation: ((child.rotation ?? 0) + rotation) % 360,
      // A hidden group hides its children once they stand alone.
      visible: group.visible === false ? false : child.visible,
    };
  });
}

export function ungroupGroup(
  items: SlideItem[],
  groupId: string,
): SlideItem[] {
  const ordered = normalizeItems(items);
  const group = ordered.find(i => i.id === groupId);
  if (!group || group.type !== 'group' || !group.groupItems || group.locked) return items;
  // Children take the group's stacking slot instead of jumping above
  // everything that was stacked over the group.
  const next = ordered.flatMap(item => item.id === groupId ? expandGroup(item).map(normalizeItem) : [item]);
  return next.map((item, index) => ({ ...item, zIndex: index }));
}

/**
 * Replaces every group with its children. Used when the editor writes a slide
 * back to the deck: the presentation renderers only know text and image
 * items, so a saved group would otherwise project as an empty box.
 */
export function flattenGroups(items: SlideItem[]): SlideItem[] {
  if (!items.some(item => item.type === 'group')) return items;
  const used = new Set(items.filter(item => item.type !== 'group').map(item => item.id));
  const out: SlideItem[] = [];
  for (const item of normalizeItems(items)) {
    if (item.type !== 'group') { out.push(item); continue; }
    for (const child of flattenGroups(expandGroup(item, false))) {
      // Duplicated groups share child ids; only collisions get a new id.
      const id = used.has(child.id) ? makeItemId('ungroup') : child.id;
      used.add(id);
      out.push(normalizeItem({ ...child, id }));
    }
  }
  return out.map((item, index) => ({ ...item, zIndex: index }));
}

export function getGroupChildIds(
  items: SlideItem[],
  groupId: string,
): string[] {
  const group = items.find(i => i.id === groupId);
  if (!group || group.type !== 'group' || !group.groupItems) return [];
  return group.groupItems.map(g => g.id);
}

export function isItemInGroup(items: SlideItem[], itemId: string): string | null {
  for (const item of items) {
    if (item.type === 'group' && item.groupItems) {
      if (item.groupItems.some(g => g.id === itemId)) return item.id;
    }
  }
  return null;
}
