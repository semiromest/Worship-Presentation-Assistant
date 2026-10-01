/**
 * Pure selection model for the editor's slide rail.
 *
 * Kept free of React so the trickiest rules — never zero slides selected, the
 * active slide always being one of them, and range anchors staying correct when
 * the editor opens deep in a long deck — are unit-testable.
 *
 * Invariants:
 *  - `selectedIds` is never empty.
 *  - `selectedIds` always contains `activeId`.
 *  - `selectedIds` follows deck order and has no duplicates.
 */

export interface RailSelection {
  /** The slide shown on the canvas. */
  activeId: string;
  /** Bulk-edit targets; always includes `activeId`. */
  selectedIds: string[];
  /**
   * Deck index a Shift range grows from, or null when it should re-anchor to
   * the active slide. Nulling instead of guessing an index is what keeps range
   * selection correct when the editor opens on slide 40 of a deck.
   */
  anchorIndex: number | null;
}

export interface SelectModifiers {
  ctrl?: boolean;
  shift?: boolean;
}

function uniqueInOrder(order: string[], ids: Iterable<string>): string[] {
  const wanted = new Set(ids);
  const inOrder = order.filter((id) => wanted.has(id));
  if (inOrder.length === wanted.size) return inOrder;
  const seen = new Set(inOrder);
  const extras: string[] = [];
  for (const id of wanted) if (!seen.has(id)) extras.push(id);
  return [...inOrder, ...extras];
}

function rangeBetween(order: string[], a: number, b: number): string[] {
  const start = Math.max(0, Math.min(a, b));
  const end = Math.min(order.length - 1, Math.max(a, b));
  return order.slice(start, end + 1);
}

/** Resolves the effective anchor: an explicit index, else the active slide. */
function resolveAnchor(selection: RailSelection, order: string[]): number {
  const { anchorIndex } = selection;
  if (anchorIndex !== null && anchorIndex >= 0 && anchorIndex < order.length) return anchorIndex;
  const index = order.indexOf(selection.activeId);
  return index === -1 ? 0 : index;
}

export function createSelection(activeId: string): RailSelection {
  return { activeId, selectedIds: [activeId], anchorIndex: null };
}

/**
 * Repairs a selection against the current deck: missing slides are dropped, the
 * active slide falls back to the first selection, an out-of-range anchor
 * re-anchors to the active slide, and empty selections collapse onto a valid
 * slide. This is what keeps the rail sane after slides are deleted or
 * reordered while the editor is open.
 */
export function normalizeSelection(selection: RailSelection, order: string[]): RailSelection {
  if (order.length === 0) return selection;

  const selected = uniqueInOrder(order, selection.selectedIds).filter((id) => order.includes(id));

  let activeId = selected.includes(selection.activeId) ? selection.activeId : selected[0];
  if (!activeId) {
    activeId = selection.activeId && order.includes(selection.activeId)
      ? selection.activeId
      : order[0];
  }

  const selectedIds = selected.length > 0 ? selected : [activeId];
  if (!selectedIds.includes(activeId)) selectedIds.push(activeId);

  const inRange =
    selection.anchorIndex !== null && selection.anchorIndex >= 0 && selection.anchorIndex < order.length;

  return {
    activeId,
    selectedIds: uniqueInOrder(order, selectedIds),
    anchorIndex: inRange ? selection.anchorIndex : null,
  };
}

export function isMultiSelect(selection: RailSelection): boolean {
  return selection.selectedIds.length > 1;
}

/**
 * Click rules:
 *  - plain click → activate + single selection
 *  - Ctrl/Cmd+click → toggle the slide in/out of the bulk set
 *  - Shift+click → select the range from the anchor to the clicked slide
 */
export function clickSelect(
  selection: RailSelection,
  order: string[],
  id: string,
  modifiers: SelectModifiers = {},
): RailSelection {
  const index = order.indexOf(id);
  if (index === -1) return selection;

  if (modifiers.shift) {
    const anchor = resolveAnchor(selection, order);
    return normalizeSelection(
      { activeId: id, selectedIds: rangeBetween(order, anchor, index), anchorIndex: anchor },
      order,
    );
  }

  if (modifiers.ctrl) {
    const isSelected = selection.selectedIds.includes(id);
    if (isSelected && selection.selectedIds.length === 1) {
      // Never drop to zero: a lone selected slide stays selected.
      return normalizeSelection({ activeId: id, selectedIds: [id], anchorIndex: index }, order);
    }

    if (isSelected) {
      const remaining = selection.selectedIds.filter((selectedId) => selectedId !== id);
      const activeId = selection.activeId === id
        ? remaining[remaining.length - 1]
        : selection.activeId;
      return normalizeSelection({ activeId, selectedIds: remaining, anchorIndex: index }, order);
    }

    // Added slides become the active one, matching how the canvas follows the
    // most recent click in every mainstream editor.
    return normalizeSelection(
      { activeId: id, selectedIds: [...selection.selectedIds, id], anchorIndex: index },
      order,
    );
  }

  return normalizeSelection({ activeId: id, selectedIds: [id], anchorIndex: null }, order);
}

/** Arrow / PageUp-PageDown navigation. `extend` keeps the anchor (Shift). */
export function moveActive(
  selection: RailSelection,
  order: string[],
  delta: number,
  extend = false,
): RailSelection {
  if (order.length === 0) return selection;
  const current = order.indexOf(selection.activeId);
  const from = current === -1 ? 0 : current;
  const next = Math.max(0, Math.min(order.length - 1, from + delta));
  const nextId = order[next];

  if (extend) {
    const anchor = resolveAnchor(selection, order);
    return normalizeSelection(
      { activeId: nextId, selectedIds: rangeBetween(order, anchor, next), anchorIndex: anchor },
      order,
    );
  }

  return normalizeSelection({ activeId: nextId, selectedIds: [nextId], anchorIndex: null }, order);
}

export function selectEdge(
  selection: RailSelection,
  order: string[],
  edge: 'start' | 'end',
  extend = false,
): RailSelection {
  if (order.length === 0) return selection;
  const current = Math.max(0, order.indexOf(selection.activeId));
  const target = edge === 'start' ? 0 : order.length - 1;
  return moveActive(selection, order, target - current, extend);
}

export function selectAll(selection: RailSelection, order: string[]): RailSelection {
  if (order.length === 0) return selection;
  return normalizeSelection(
    { activeId: selection.activeId, selectedIds: order, anchorIndex: null },
    order,
  );
}

/** Collapses a bulk selection back onto the active slide (Esc step 2). */
export function clearSelection(selection: RailSelection, order: string[]): RailSelection {
  return normalizeSelection(
    { activeId: selection.activeId, selectedIds: [selection.activeId], anchorIndex: null },
    order,
  );
}

/** True when every slide in the deck is already selected. */
export function isAllSelected(selection: RailSelection, order: string[]): boolean {
  return order.length > 0 && selection.selectedIds.length === order.length;
}
