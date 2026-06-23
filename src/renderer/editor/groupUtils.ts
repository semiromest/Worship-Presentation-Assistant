import type { SlideItem } from '../types';
import { normalizeItems, normalizeItem } from './editorUtils';

export function createGroup(
  items: SlideItem[],
  selectedIds: Set<string>,
): SlideItem[] {
  const selected = items.filter(i => selectedIds.has(i.id));
  if (selected.length < 2) return items;

  const remaining = items.filter(i => !selectedIds.has(i.id));

  const minX = Math.min(...selected.map(i => i.x));
  const minY = Math.min(...selected.map(i => i.y));
  const maxX = Math.max(...selected.map(i => i.x + i.width));
  const maxY = Math.max(...selected.map(i => i.y + i.height));

  const maxZ = Math.max(...selected.map(i => i.zIndex ?? 0));

  const group = normalizeItem({
    id: `group-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    type: 'group',
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
    zIndex: maxZ,
    visible: true,
    locked: false,
    rotation: 0,
    groupItems: selected.map(s => ({
      ...s,
      x: s.x - minX,
      y: s.y - minY,
      zIndex: s.zIndex - (Math.min(...selected.map(i => i.zIndex ?? 0))),
    })),
    styles: undefined,
  });

  return normalizeItems([...remaining, group]);
}

export function ungroupGroup(
  items: SlideItem[],
  groupId: string,
): SlideItem[] {
  const group = items.find(i => i.id === groupId);
  if (!group || group.type !== 'group' || !group.groupItems) return items;

  const remaining = items.filter(i => i.id !== groupId);
  const ungrouped = group.groupItems.map(child =>
    normalizeItem({
      ...child,
      x: child.x + group.x,
      y: child.y + group.y,
      zIndex: child.zIndex + group.zIndex,
      id: `ungroup-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    }),
  );

  return normalizeItems([...remaining, ...ungrouped]);
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
