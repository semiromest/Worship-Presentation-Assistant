import type { SlideItem } from '../types';
import { normalizeItems } from './editorUtils';

/**
 * Pure multi-selection operations for the slide editor.
 *
 * Shared rules:
 *  - Locked items are never changed by a bulk operation (the lock tooltip
 *    promises "no moving or editing"); lock/unlock itself is the exception.
 *  - Hidden items can still be targeted when they are selected (e.g. from the
 *    layer list) because the user picked them explicitly.
 *  - Every function returns the input array untouched when nothing changes, so
 *    callers never record an empty undo step.
 */

export function isBulkEditable(item: SlideItem): boolean {
  return !item.locked;
}

/** Selected, unlocked items in canvas (array) order. */
export function bulkTargets(items: SlideItem[], ids: Iterable<string>): SlideItem[] {
  const wanted = new Set(ids);
  return items.filter((item) => wanted.has(item.id) && isBulkEditable(item));
}

/** Ids Ctrl/Cmd+A selects: what the user can see and edit on the canvas. */
export function selectableItemIds(items: SlideItem[]): string[] {
  return items.filter((item) => item.visible !== false && !item.locked).map((item) => item.id);
}

/** Deletes the unlocked part of a selection; locked items survive (and stay selected). */
export function deleteSelection(
  items: SlideItem[],
  ids: Iterable<string>
): { items: SlideItem[]; deleted: string[]; kept: string[] } {
  const wanted = new Set(ids);
  const deleted: string[] = [];
  const kept: string[] = [];
  for (const item of items) {
    if (!wanted.has(item.id)) continue;
    (item.locked ? kept : deleted).push(item.id);
  }
  if (deleted.length === 0) return { items, deleted, kept };
  const gone = new Set(deleted);
  return { items: normalizeItems(items.filter((item) => !gone.has(item.id))), deleted, kept };
}

/**
 * Moves the unlocked selection as one block. The delta is clamped so the block
 * stays on the slide without squashing the items against an edge.
 */
export function moveSelection(items: SlideItem[], ids: Iterable<string>, dx: number, dy: number): SlideItem[] {
  const targets = bulkTargets(items, ids);
  if (targets.length === 0 || (!dx && !dy)) return items;
  const minX = Math.min(...targets.map((item) => item.x));
  const minY = Math.min(...targets.map((item) => item.y));
  const maxX = Math.max(...targets.map((item) => item.x + item.width));
  const maxY = Math.max(...targets.map((item) => item.y + item.height));
  const cx = Math.max(-minX, Math.min(100 - maxX, dx));
  const cy = Math.max(-minY, Math.min(100 - maxY, dy));
  if (!cx && !cy) return items;
  const moving = new Set(targets.map((item) => item.id));
  const round = (value: number) => Math.round(value * 100) / 100;
  return items.map((item) =>
    moving.has(item.id) ? { ...item, x: round(item.x + cx), y: round(item.y + cy) } : item
  );
}

/** Bounding box of the unlocked selection, or null when there is none. */
export function selectionBounds(items: SlideItem[], ids: Iterable<string>) {
  const targets = bulkTargets(items, ids);
  if (targets.length === 0) return null;
  const x = Math.min(...targets.map((item) => item.x));
  const y = Math.min(...targets.map((item) => item.y));
  return {
    x,
    y,
    width: Math.max(...targets.map((item) => item.x + item.width)) - x,
    height: Math.max(...targets.map((item) => item.y + item.height)) - y,
  };
}

/**
 * Locks the whole selection when any of it is unlocked, otherwise unlocks it —
 * the mixed-state rule every layout tool uses.
 */
export function toggleSelectionLock(items: SlideItem[], ids: Iterable<string>): SlideItem[] {
  const wanted = new Set(ids);
  const selected = items.filter((item) => wanted.has(item.id));
  if (selected.length === 0) return items;
  const lock = selected.some((item) => !item.locked);
  return items.map((item) => (wanted.has(item.id) ? { ...item, locked: lock } : item));
}

/** Hides the selection when any of it is visible, otherwise shows it. Locked items keep their state. */
export function toggleSelectionVisibility(items: SlideItem[], ids: Iterable<string>): SlideItem[] {
  const targets = bulkTargets(items, ids);
  if (targets.length === 0) return items;
  const hide = targets.some((item) => item.visible !== false);
  const changing = new Set(targets.map((item) => item.id));
  return items.map((item) => (changing.has(item.id) ? { ...item, visible: !hide } : item));
}

export type ZOrderAction = 'front' | 'forward' | 'backward' | 'back';

/**
 * Re-stacks the unlocked selection while keeping its internal order.
 * `forward`/`backward` step each selected item past its nearest unselected
 * neighbour, so a contiguous block moves as one.
 */
export function reorderSelection(items: SlideItem[], ids: Iterable<string>, action: ZOrderAction): SlideItem[] {
  const ordered = normalizeItems(items);
  const moving = new Set(bulkTargets(ordered, ids).map((item) => item.id));
  if (moving.size === 0) return items;
  let next = [...ordered];
  if (action === 'front') next = [...next.filter((i) => !moving.has(i.id)), ...next.filter((i) => moving.has(i.id))];
  else if (action === 'back') next = [...next.filter((i) => moving.has(i.id)), ...next.filter((i) => !moving.has(i.id))];
  else if (action === 'forward') {
    for (let i = next.length - 2; i >= 0; i -= 1) {
      if (moving.has(next[i].id) && !moving.has(next[i + 1].id)) [next[i], next[i + 1]] = [next[i + 1], next[i]];
    }
  } else {
    for (let i = 1; i < next.length; i += 1) {
      if (moving.has(next[i].id) && !moving.has(next[i - 1].id)) [next[i], next[i - 1]] = [next[i - 1], next[i]];
    }
  }
  if (next.every((item, index) => item.id === ordered[index].id)) return items;
  return next.map((item, index) => ({ ...item, zIndex: index }));
}

/** Whether `reorderSelection` would change anything (drives button disabled states). */
export function canReorderSelection(items: SlideItem[], ids: Iterable<string>, action: ZOrderAction): boolean {
  return reorderSelection(items, ids, action) !== items;
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * The keys a style editor changed, given the full object it started from and
 * the full object it emitted. Lets one editor drive many items without
 * flattening their other differences (e.g. changing only the colour keeps each
 * item's own font size).
 */
export function stylePatch<T extends object>(previous: T | undefined, next: T): Partial<T> {
  const patch: Partial<T> = {};
  const before = (previous ?? {}) as Record<string, unknown>;
  const after = next as Record<string, unknown>;
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (!sameValue(before[key], after[key])) (patch as Record<string, unknown>)[key] = after[key];
  }
  return patch;
}

/** Geometry for a multi-selection's inspector fields. */
export function resizeSelection(
  items: SlideItem[],
  ids: Iterable<string>,
  key: 'width' | 'height',
  value: number
): SlideItem[] {
  const targets = new Set(bulkTargets(items, ids).map((item) => item.id));
  if (targets.size === 0) return items;
  const size = Math.max(4, Math.min(100, value));
  let changed = false;
  const next = items.map((item) => {
    if (!targets.has(item.id) || item[key] === size) return item;
    changed = true;
    const pos = key === 'width' ? 'x' : 'y';
    // Grow from the centre, like the single-item fields, then keep it on the slide.
    const centred = item[pos] + (item[key] - size) / 2;
    return { ...item, [key]: size, [pos]: Math.max(0, Math.min(100 - size, Math.round(centred * 100) / 100)) };
  });
  return changed ? next : items;
}

/**
 * Layer-list click rules, matching the slide rail: plain click selects one row,
 * Ctrl/Cmd toggles a row, Shift selects the range from the primary selection.
 */
export function layerClickSelection(
  order: string[],
  selectedIds: Set<string>,
  id: string,
  modifiers: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean }
): string[] {
  const current = [...selectedIds].filter((selected) => order.includes(selected));
  if (modifiers.shiftKey && current.length > 0) {
    const anchor = order.indexOf(current[current.length - 1]);
    const target = order.indexOf(id);
    const range = order.slice(Math.min(anchor, target), Math.max(anchor, target) + 1);
    const merged = [...new Set([...current, ...range])].filter((rowId) => rowId !== id);
    return [...merged, id];
  }
  if (modifiers.ctrlKey || modifiers.metaKey) {
    if (selectedIds.has(id)) return current.filter((rowId) => rowId !== id);
    return [...current, id];
  }
  return [id];
}
