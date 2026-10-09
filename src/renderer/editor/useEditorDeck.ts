import { editorFilterTarget, filteredEditorSlides, isEditorEditableSlide, isVideoEditableSlide } from './slideCapabilities';
import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import type { Presentation, Slide, SlideItem } from '../types';
import {
  createDraft,
  makeClipboard,
  applyDraftsToDeck,
  applyItemStyle,
  counterpartItems,
  isItemEditableSlide,
  isSameSlidePaste,
  pasteItems,
  applyItemsToSlides,
  applyStyleToSlides,
  pruneDrafts,
  type ClipboardContent,
  type SlideDraft,
} from './slideDraft';
import {
  clickSelect,
  clearSelection,
  createSelection,
  moveActive,
  normalizeSelection,
  selectAll,
  selectEdge,
  type RailSelection,
  type SelectModifiers,
} from './editorSelection';
import { normalizeItems, updateItemAt } from './editorUtils';

/** Where an edit is applied: only the working slide, or every selected slide. */
export type EditScope = 'active' | 'selected';

/** Undo depth for in-editor edits, matching the deck history limit. */
export const EDITOR_HISTORY_LIMIT = 50;

export interface EditorNotice {
  /** i18n key under `common.` */
  key: string;
  count?: number;
  skipped?: number;
  tone: 'info' | 'warn';
}

/** Clipboard entry; shape lives with the other pure clipboard helpers. */
export type EditorClipboard = ClipboardContent;

interface EditorSession {
  /** Working copies, materialised as slides are visited or edited. */
  drafts: Map<string, SlideDraft>;
  /** Slides that actually received an edit — only these are written on save. */
  touchedIds: Set<string>;
  activeId: string;
  selection: RailSelection;
  /** Per-slide item selection, so returning to a slide restores the context. */
  itemSelection: Map<string, string[]>;
  notice: EditorNotice | null;
}

export interface EditorHistoryState {
  session: EditorSession;
  past: EditorSession[];
  future: EditorSession[];
  /**
   * State captured when a continuous gesture (drag, resize, typing) starts.
   * The first mutation of the gesture pushes it, so the whole gesture becomes
   * one undo step and a gesture that changes nothing leaves no entry behind.
   */
  gestureBase: EditorSession | null;
}
type HistoryState = EditorHistoryState;

export type EditorDeckAction =
  | { type: 'reset'; deck: Presentation; activeId: string }
  | { type: 'sync'; deck: Presentation; changedIds: Set<string> }
  | { type: 'videoPlayback'; slide: Slide; settings: NonNullable<Slide['videoPlayback']> }
  | { type: 'videoOverlays'; slide: Slide; overlays: NonNullable<Slide['videoOverlays']>; history?: boolean }
  | { type: 'ensure'; slide: Slide; draft?: SlideDraft }
  | { type: 'activate'; slide: Slide; order: string[]; modifiers?: SelectModifiers; editableIds?: string[] }
  | { type: 'navigate'; order: string[]; delta?: number; edge?: 'start' | 'end'; extend?: boolean; editableIds?: string[] }
  | { type: 'selectAll'; order: string[] }
  | { type: 'clearSlideSelection'; order: string[] }
  | { type: 'setItemSelection'; slideId: string; ids: string[] }
  | { type: 'mutateSlide'; slide: Slide; mutate: (draft: SlideDraft) => SlideDraft | null; history: boolean }
  | {
      type: 'pasteIntoActive';
      slide: Slide;
      clipboardItems: SlideItem[];
      sourceSlideId: string | null;
      exact: boolean;
    }
  | {
      type: 'bulk';
      drafts: Map<string, SlideDraft>;
      touched: string[];
      selection?: RailSelection;
      notice: EditorNotice;
      /** Typing gestures pass false so a whole focus session is one entry. */
      history?: boolean;
    }
  | { type: 'gestureStart' }
  | { type: 'gestureEnd' }
  | { type: 'notice'; notice: EditorNotice | null }
  | { type: 'undo' }
  | { type: 'redo' };

function withDraft(drafts: Map<string, SlideDraft>, slideId: string, draft: SlideDraft): Map<string, SlideDraft> {
  const next = new Map(drafts);
  next.set(slideId, draft);
  return next;
}

function withTouched(touched: Set<string>, ids: Iterable<string>): Set<string> {
  const next = new Set(touched);
  for (const id of ids) next.add(id);
  return next;
}

function withItemSelection(selection: Map<string, string[]>, slideId: string, ids: string[]): Map<string, string[]> {
  const next = new Map(selection);
  if (ids.length === 0) next.delete(slideId);
  else next.set(slideId, ids);
  return next;
}

/** Draft for a slide, materialised from the deck on first access. */
function draftFor(session: EditorSession, slide: Slide): SlideDraft {
  return session.drafts.get(slide.id) ?? createDraft(slide);
}

function snapshotPush(state: HistoryState, session: EditorSession): HistoryState {
  return {
    session,
    past: [...state.past, state.session].slice(-EDITOR_HISTORY_LIMIT),
    future: [],
    gestureBase: null,
  };
}

/**
 * Applies a new session, recording history only when asked for.
 *
 * A pending gesture base is consumed exactly once: it becomes the recorded
 * entry instead of the current state, which is what makes "undo" return to
 * where a drag started rather than to an intermediate frame.
 */
function replace(state: HistoryState, session: EditorSession, history: boolean): HistoryState {
  const pending = state.gestureBase;
  if (!history && !pending) return { ...state, session };
  return {
    session,
    past: [...state.past, pending ?? state.session].slice(-EDITOR_HISTORY_LIMIT),
    future: [],
    gestureBase: null,
  };
}

/** Exported for tests: the reducer is the whole history contract. */
export function editorDeckReducer(state: HistoryState, action: EditorDeckAction): HistoryState {
  const { session } = state;

  switch (action.type) {
    case 'reset': {
      const slide = action.deck.slides.find((candidate) => candidate.id === action.activeId) ?? action.deck.slides[0];
      const next = createEditorHistory(slide);
      if (slide && isItemEditableSlide(slide)) {
        const validIds = new Set(next.session.drafts.get(slide.id)!.items.map((item) => item.id));
        const ids = (session.itemSelection.get(slide.id) ?? []).filter((id) => validIds.has(id));
        if (ids.length) next.session.itemSelection.set(slide.id, ids);
      }
      return next;
    }
    case 'sync': {
      const byId = new Map(action.deck.slides.map((slide) => [slide.id, slide]));
      const sync = (value: EditorSession): EditorSession => ({
        ...value,
        drafts: new Map([...value.drafts].flatMap(([id, draft]) => {
          const slide = byId.get(id);
          if (!slide || !isEditorEditableSlide(slide)) return [];
          return [[id, !value.touchedIds.has(id) && action.changedIds.has(id) ? createDraft(slide) : draft] as const];
        })),
        touchedIds: new Set([...value.touchedIds].filter((id) => { const slide = byId.get(id); return !!slide && isEditorEditableSlide(slide); })),
        itemSelection: new Map([...value.itemSelection].filter(([id]) => byId.has(id))),
      });
      return { ...state, session: sync(session), past: state.past.map(sync), future: state.future.map(sync),
        gestureBase: state.gestureBase ? sync(state.gestureBase) : null };
    }
    case 'ensure': {
      if (!isEditorEditableSlide(action.slide) || session.drafts.has(action.slide.id)) return state;
      // Materialising is a working-copy concern only: it must not mark the
      // slide as touched, otherwise merely visiting a slide would rewrite it.
      return {
        ...state,
        session: {
          ...session,
          drafts: withDraft(session.drafts, action.slide.id, action.draft ?? createDraft(action.slide)),
        },
      };
    }

    case 'activate': {
      let selection = clickSelect(session.selection, action.order, action.slide.id, action.modifiers);
      if (action.editableIds && action.modifiers && (action.modifiers.ctrl || action.modifiers.shift)) {
        selection = { ...selection, selectedIds: selection.selectedIds.filter(id => action.editableIds!.includes(id)) };
      }
      const drafts = !isEditorEditableSlide(action.slide) || session.drafts.has(action.slide.id)
        ? session.drafts
        : withDraft(session.drafts, action.slide.id, createDraft(action.slide));
      return {
        ...state,
        session: { ...session, activeId: selection.activeId, selection, drafts, notice: null },
      };
    }

    case 'navigate': {
      let selection = action.edge
        ? selectEdge(session.selection, action.order, action.edge, action.extend)
        : moveActive(session.selection, action.order, action.delta ?? 0, action.extend);
      if (action.editableIds && action.extend) {
        selection = { ...selection, selectedIds: action.editableIds.includes(selection.activeId) ? selection.selectedIds.filter(id => action.editableIds!.includes(id)) : [selection.activeId] };
      }
      return { ...state, session: { ...session, activeId: selection.activeId, selection, notice: null } };
    }

    case 'selectAll': {
      const selection = selectAll(session.selection, action.order);
      return { ...state, session: { ...session, activeId: selection.activeId, selection } };
    }

    case 'clearSlideSelection': {
      const selection = clearSelection(session.selection, action.order);
      return { ...state, session: { ...session, activeId: selection.activeId, selection } };
    }

    case 'setItemSelection': {
      const current = session.itemSelection.get(action.slideId) ?? [];
      const same = current.length === action.ids.length && current.every((id, i) => id === action.ids[i]);
      if (same) return state;
      return {
        ...state,
        session: {
          ...session,
          itemSelection: withItemSelection(session.itemSelection, action.slideId, action.ids),
        },
      };
    }

    case 'videoOverlays': {
      if (!isVideoEditableSlide(action.slide)) return state;
      const draft = draftFor(session, action.slide);
      if (JSON.stringify(draft.videoOverlays ?? []) === JSON.stringify(action.overlays)) return state;
      return replace(state, { ...session, drafts: withDraft(session.drafts, action.slide.id, { ...draft, videoOverlays: action.overlays.map(item => ({ ...item, type: 'text', textStyles: item.textStyles ? { ...item.textStyles } : undefined })) }), touchedIds: withTouched(session.touchedIds, [action.slide.id]), notice: null }, action.history ?? true);
    }
    case 'videoPlayback': {
      if (!isVideoEditableSlide(action.slide)) return state;
      const draft = draftFor(session, action.slide);
      if (JSON.stringify(draft.videoPlayback) === JSON.stringify(action.settings)) return state;
      return replace(state, { ...session, drafts: withDraft(session.drafts, action.slide.id, { ...draft, videoPlayback: { ...action.settings } }), touchedIds: withTouched(session.touchedIds, [action.slide.id]), notice: null }, true);
    }
    case 'mutateSlide': {
      if (!isItemEditableSlide(action.slide)) return state;
      const draft = draftFor(session, action.slide);
      const nextDraft = action.mutate(draft);
      if (!nextDraft || nextDraft === draft) return state;
      const nextSession: EditorSession = {
        ...session,
        drafts: withDraft(session.drafts, action.slide.id, nextDraft),
        touchedIds: withTouched(session.touchedIds, [action.slide.id]),
        notice: null,
      };
      return replace(state, nextSession, action.history);
    }

    case 'pasteIntoActive': {
      if (!isItemEditableSlide(action.slide) || action.clipboardItems.length === 0) return state;
      const draft = draftFor(session, action.slide);
      const offset = action.exact ? false : isSameSlidePaste(action.sourceSlideId, action.slide.id);
      const { items, pastedIds } = pasteItems(draft.items, action.clipboardItems, { offset });
      const nextSession: EditorSession = {
        ...session,
        drafts: withDraft(session.drafts, action.slide.id, { ...draft, items }),
        touchedIds: withTouched(session.touchedIds, [action.slide.id]),
        itemSelection: withItemSelection(session.itemSelection, action.slide.id, pastedIds),
        notice: null,
      };
      return snapshotPush(state, nextSession);
    }

    case 'bulk': {
      if (action.drafts === session.drafts && action.touched.length === 0 && !action.selection) {
        return { ...state, session: { ...session, notice: action.notice } };
      }
      const nextSession: EditorSession = {
        ...session,
        drafts: action.drafts,
        touchedIds: withTouched(session.touchedIds, action.touched),
        selection: action.selection ?? session.selection,
        activeId: action.selection?.activeId ?? session.activeId,
        notice: action.notice,
      };
      return replace(state, nextSession, (action.history ?? true) && action.touched.length > 0);
    }

    case 'gestureStart':
      // Remembering (not pushing) keeps a gesture that changes nothing from
      // leaving an empty undo entry behind.
      return state.gestureBase ? state : { ...state, gestureBase: state.session };

    case 'gestureEnd':
      return state.gestureBase ? { ...state, gestureBase: null } : state;

    case 'notice':
      return { ...state, session: { ...session, notice: action.notice } };

    case 'undo': {
      if (state.past.length === 0) return state;
      const previous = state.past[state.past.length - 1];
      return {
        session: { ...previous, notice: null },
        past: state.past.slice(0, -1),
        future: [session, ...state.future].slice(0, EDITOR_HISTORY_LIMIT),
        gestureBase: null,
      };
    }

    case 'redo': {
      if (state.future.length === 0) return state;
      const next = state.future[0];
      return {
        session: { ...next, notice: null },
        past: [...state.past, session].slice(-EDITOR_HISTORY_LIMIT),
        future: state.future.slice(1),
        gestureBase: null,
      };
    }

    default:
      return state;
  }
}

export function createEditorHistory(initialSlide?: Slide): HistoryState {
  return {
    session: {
      // The entry slide gets its working copy immediately so item ids stay
      // stable from the first frame (selection depends on them).
      drafts: initialSlide && isEditorEditableSlide(initialSlide) ? new Map([[initialSlide.id, createDraft(initialSlide)]]) : new Map(),
      touchedIds: new Set(),
      activeId: initialSlide?.id ?? '',
      selection: createSelection(initialSlide?.id ?? ''),
      itemSelection: new Map(),
      notice: null,
    },
    past: [],
    future: [],
    gestureBase: null,
  };
}

export interface UseEditorDeckOptions {
  deck: Presentation;
  initialSlide?: Slide;
  editableOnly?: boolean;
}

/**
 * Owns the editor's multi-slide working state.
 *
 * Mutations are pure session transforms dispatched to a reducer, so the
 * unchanged deck is never a source of truth while editing and one commit at
 * save time is all the deck history sees.
 */
export function useEditorDeck({ deck, initialSlide, editableOnly = false }: UseEditorDeckOptions) {
  const [history, dispatch] = useReducer(editorDeckReducer, initialSlide, createEditorHistory);
  const session = history.session;
  const bases = useRef(new Map(deck.slides.map((slide) => [slide.id, slide])));
  const previousSlides = useRef(deck.slides);
  useEffect(() => {
    if (previousSlides.current === deck.slides) return;
    const previous = new Map(previousSlides.current.map((slide) => [slide.id, slide]));
    const changedIds = new Set(deck.slides.filter((slide) => JSON.stringify(previous.get(slide.id)) !== JSON.stringify(slide)).map((slide) => slide.id));
    previousSlides.current = deck.slides;
    dispatch({ type: 'sync', deck, changedIds });
  }, [deck]);
  // Keep the original version for any slide that can still be restored by undo.
  const historicalTouched = new Set([session, ...history.past, ...history.future].flatMap((value) => [...value.touchedIds]));
  for (const slide of deck.slides) {
    if (!historicalTouched.has(slide.id)) bases.current.set(slide.id, slide);
  }
  const reset = useCallback((nextDeck: Presentation, nextActiveId: string) => {
    bases.current = new Map(nextDeck.slides.map((slide) => [slide.id, slide]));
    previousSlides.current = nextDeck.slides;
    dispatch({ type: 'reset', deck: nextDeck, activeId: nextActiveId });
  }, []);

  const slideById = useMemo(() => new Map(deck.slides.map((slide) => [slide.id, slide] as const)), [deck.slides]);
  const editableIds = useMemo(() => deck.slides.filter(isItemEditableSlide).map(slide => slide.id), [deck.slides]);
  const order = useMemo(() => filteredEditorSlides(deck.slides, editableOnly).map((slide) => slide.id), [deck.slides, editableOnly]);

  // A slide deleted while the editor is open must not leave the canvas blank.
  const activeId = editorFilterTarget(deck.slides, session.activeId, editableOnly)?.id ?? (slideById.has(session.activeId) ? session.activeId : deck.slides[0]?.id ?? '');
  const activeSlide = slideById.get(activeId);
  const selection = useMemo(
    () => normalizeSelection({ ...session.selection, activeId }, order),
    [session.selection, activeId, order]
  );

  const activeDraft = useMemo<SlideDraft | null>(
    () => (activeSlide ? (session.drafts.get(activeId) ?? createDraft(activeSlide)) : null),
    // createDraft is only reached before the reducer materialises the draft.
    [activeSlide, activeId, session.drafts]
  );
  // Keyboard navigation and externally deleted active slides also need a stable
  // materialized draft: legacy item IDs are generated once, before the first edit.
  useEffect(() => {
    if (activeSlide && session.activeId !== activeId) dispatch({ type: 'activate', slide: activeSlide, order });
    if (activeSlide && isEditorEditableSlide(activeSlide) && activeDraft && !session.drafts.has(activeId)) {
      dispatch({ type: 'ensure', slide: activeSlide, draft: activeDraft });
    }
  }, [activeSlide, activeDraft, activeId, session.activeId, session.drafts, order]);

  const activeItems = useMemo(() => activeDraft?.items ?? [], [activeDraft]);
  const selectedItemIds = useMemo(
    () => new Set(session.itemSelection.get(activeId) ?? []),
    [session.itemSelection, activeId]
  );
  const selectedItems = useMemo(() => {
    const byId = new Map(activeItems.map((item) => [item.id, item]));
    return [...selectedItemIds].flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
  }, [activeItems, selectedItemIds]);

  const isDirty = session.touchedIds.size > 0;
  const touchedCount = session.touchedIds.size;

  // ── Navigation & selection ─────────────────────────────────────────────────

  const activateSlide = useCallback(
    (slide: Slide, modifiers?: SelectModifiers) => {
      dispatch({ type: 'activate', slide, order, editableIds, modifiers: isItemEditableSlide(slide) ? modifiers : undefined });
    },
    [order, editableIds]
  );

  const navigate = useCallback(
    (delta: number, extend = false) => dispatch({ type: 'navigate', order, delta, extend, editableIds }),
    [order, editableIds]
  );

  const jumpToEdge = useCallback(
    (edge: 'start' | 'end', extend = false) => dispatch({ type: 'navigate', order, edge, extend, editableIds }),
    [order, editableIds]
  );

  const selectEverySlide = useCallback(() => dispatch({ type: 'selectAll', order: order.filter(id => isItemEditableSlide(slideById.get(id)!)) }), [order, slideById]);
  const collapseSlideSelection = useCallback(() => dispatch({ type: 'clearSlideSelection', order }), [order]);

  const setItemSelection = useCallback(
    (ids: Set<string>) => dispatch({ type: 'setItemSelection', slideId: activeId, ids: [...ids] }),
    [activeId]
  );

  // ── Editing the active slide ───────────────────────────────────────────────

  const mutateActive = useCallback(
    (mutate: (draft: SlideDraft) => SlideDraft | null, history: boolean) => {
      if (!activeSlide) return;
      dispatch({ type: 'mutateSlide', slide: activeSlide, mutate, history });
    },
    [activeSlide]
  );

  const updateItems = useCallback(
    (next: SlideItem[] | ((prev: SlideItem[]) => SlideItem[]), options?: { history?: boolean }) => {
      mutateActive((draft) => {
        const items = typeof next === 'function' ? next(draft.items) : next;
        if (items === draft.items) return null;
        return { ...draft, items };
      }, options?.history ?? true);
    },
    [mutateActive]
  );

  const setGridField = useCallback(
    (field: 'gridEnabled' | 'gridSize' | 'gridColor' | 'snapEnabled', value: boolean | number | string) => {
      mutateActive((draft) => ({ ...draft, [field]: value }), true);
    },
    [mutateActive]
  );

  // ── Gesture batching (drag / resize / rotate / typing) ─────────────────────

  const gestureStart = useCallback(() => dispatch({ type: 'gestureStart' }), []);
  const gestureEnd = useCallback(() => dispatch({ type: 'gestureEnd' }), []);

  // ── Clipboard ──────────────────────────────────────────────────────────────

  const copyItems = useCallback(
    (items: SlideItem[]): EditorClipboard | null => (activeSlide ? makeClipboard(items, activeSlide.id) : null),
    [activeSlide]
  );

  /**
   * Inserts clipboard items into the active slide.
   * The reducer owns the paste so item ids and the resulting selection are
   * produced in one pure step (no side channel that could drift from state).
   */
  const pasteIntoActive = useCallback(
    (clipboard: EditorClipboard, options?: { exact?: boolean }) => {
      if (!activeSlide || clipboard.items.length === 0) return;
      dispatch({
        type: 'pasteIntoActive',
        slide: activeSlide,
        clipboardItems: clipboard.items,
        sourceSlideId: clipboard.sourceSlideId,
        exact: options?.exact ?? false,
      });
    },
    [activeSlide]
  );

  /** Applies clipboard items to the selected slides (active slide excluded). */
  const pasteIntoSelectedSlides = useCallback(
    (clipboard: EditorClipboard, slideIds: string[]): EditorNotice => {
      const targetIds = slideIds.filter((id) => id !== activeId);
      if (clipboard.items.length === 0 || targetIds.length === 0) {
        return { key: 'common.editorNothingToApply', tone: 'warn' };
      }
      const result = applyItemsToSlides(new Map(session.drafts), slideById, targetIds, clipboard.items, activeId);

      const applied = result.appliedSlideIds.length;
      const notice: EditorNotice =
        applied > 0
          ? {
              key: 'common.editorAppliedToSlides',
              count: applied,
              skipped: result.skippedSlideIds.length,
              tone: 'info',
            }
          : { key: 'common.editorApplySkipped', count: result.skippedSlideIds.length, tone: 'warn' };

      dispatch({
        type: 'bulk',
        drafts: result.drafts,
        touched: result.appliedSlideIds,
        notice,
      });
      return notice;
    },
    [activeId, session.drafts, slideById]
  );

  /** Copies the working selection's style onto counter-parts of the other selected slides. */
  const applySelectionStyleToSlides = useCallback(
    (slideIds: string[]): EditorNotice => {
      const sourceItems = activeItems;
      const sourceSelected = selectedItemIds;
      if (sourceSelected.size === 0) {
        return { key: 'common.editorStyleNeedsSelection', tone: 'warn' };
      }
      const result = applyStyleToSlides(
        new Map(session.drafts),
        slideById,
        slideIds.filter((id) => id !== activeId),
        sourceItems,
        sourceSelected
      );

      const applied = result.appliedSlideIds.length;
      const notice: EditorNotice =
        applied > 0
          ? { key: 'common.editorStyleApplied', count: applied, tone: 'info' }
          : { key: 'common.editorStyleUnmatched', count: result.unmatchedSlideIds.length, tone: 'warn' };

      dispatch({ type: 'bulk', drafts: result.drafts, touched: result.appliedSlideIds, notice });
      return notice;
    },
    [activeId, activeItems, selectedItemIds, session.drafts, slideById]
  );

  /**
   * Applies the clipboard's look to the current item selection on the working
   * slide plus the counter-parts of the other selected slides.
   */
  const pasteStyleFromClipboard = useCallback(
    (clipboard: EditorClipboard, slideIds: string[]): EditorNotice => {
      if (clipboard.items.length === 0) {
        return { key: 'common.editorPasteEmptyClipboard', tone: 'warn' };
      }
      const drafts = new Map(session.drafts);
      const touched: string[] = [];
      let matched = 0;

      // Working slide: restyle exactly what the user picked (a different item
      // than the copied one is the common case).
      if (activeSlide && activeDraft) {
        const selection = new Set(selectedItemIds);
        if (selection.size > 0) {
          const byType = new Map(clipboard.items.map((item) => [item.type, item]));
          let localMatched = 0;
          const items = activeDraft.items.map((item) => {
            if (!selection.has(item.id)) return item;
            const source = byType.get(item.type);
            if (!source) return item;
            localMatched += 1;
            return applyItemStyle(source, item);
          });
          if (localMatched > 0) {
            drafts.set(activeId, { ...activeDraft, items });
            touched.push(activeId);
            matched += localMatched;
          }
        }
      }

      const result = applyStyleToSlides(
        drafts,
        slideById,
        slideIds.filter((id) => id !== activeId),
        clipboard.items,
        new Set(clipboard.items.map((item) => item.id))
      );
      matched += result.appliedSlideIds.length;

      const notice: EditorNotice =
        matched > 0
          ? { key: 'common.editorStyleApplied', count: result.appliedSlideIds.length + touched.length, tone: 'info' }
          : { key: 'common.editorStyleUnmatched', count: slideIds.length, tone: 'warn' };

      dispatch({ type: 'bulk', drafts: result.drafts, touched: [...touched, ...result.appliedSlideIds], notice });
      return notice;
    },
    [activeDraft, activeId, activeSlide, selectedItemIds, session.drafts, slideById]
  );

  /**
   * Pastes into every given slide in one undo step (the active slide included).
   * Same-slide pastes keep the small offset; every other slide receives the
   * exact copied position, size and styles.
   */
  const pasteIntoSlides = useCallback(
    (clipboard: EditorClipboard, slideIds: string[]): EditorNotice => {
      if (clipboard.items.length === 0) {
        return { key: 'common.editorPasteEmptyClipboard', tone: 'warn' };
      }
      const drafts = new Map(session.drafts);
      const applied: string[] = [];
      const skipped: string[] = [];
      let activePastedIds: string[] | null = null;

      for (const slideId of slideIds) {
        const slide = slideById.get(slideId);
        if (!slide) continue;
        if (!isItemEditableSlide(slide)) {
          skipped.push(slideId);
          continue;
        }
        const draft = drafts.get(slideId) ?? createDraft(slide);
        const { items, pastedIds } = pasteItems(draft.items, clipboard.items, {
          offset: isSameSlidePaste(clipboard.sourceSlideId, slideId),
        });
        drafts.set(slideId, { ...draft, items });
        applied.push(slideId);
        if (slideId === activeId) activePastedIds = pastedIds;
      }

      const notice: EditorNotice =
        applied.length > 0
          ? { key: 'common.editorAppliedToSlides', count: applied.length, skipped: skipped.length, tone: 'info' }
          : { key: 'common.editorApplySkipped', count: skipped.length, tone: 'warn' };

      dispatch({ type: 'bulk', drafts, touched: applied, notice });
      // Selection updates are history-free, so the paste stays one undo step.
      if (activePastedIds) {
        dispatch({ type: 'setItemSelection', slideId: activeId, ids: activePastedIds });
      }
      return notice;
    },
    [activeId, session.drafts, slideById]
  );

  // ── Scope-aware edits ──────────────────────────────────────────────────────

  /**
   * Applies an item update to the working slide and, in bulk scope, to the
   * counter-part item of every other selected slide.
   *
   * Counter-parts are matched by type + ordinal, so the edit lands on the item
   * that plays the same role instead of the item with the same id (ids are
   * per-slide). Slides without a counter-part are reported, never invented.
   */
  const applyItemUpdate = useCallback(
    (
      itemId: string,
      updates: Partial<SlideItem> | ((item: SlideItem) => Partial<SlideItem>),
      slideIds: string[],
      scope: EditScope,
      options?: { history?: boolean }
    ) => {
      if (!activeSlide || !activeDraft) return;
      if (scope === 'active' || slideIds.length <= 1) {
        dispatch({
          type: 'mutateSlide',
          slide: activeSlide,
          history: true,
          mutate: (draft) => ({ ...draft, items: updateItemAt(draft.items, itemId, updates) }),
        });
        return;
      }

      const source = activeDraft.items.find((item) => item.id === itemId);
      if (!source) return;
      const sourceItems = activeDraft.items;
      const drafts = new Map(session.drafts);
      const touched: string[] = [];
      let unmatched = 0;
      let skipped = 0;

      for (const slideId of slideIds) {
        const slide = slideById.get(slideId);
        if (!slide) continue;
        if (!isItemEditableSlide(slide)) {
          skipped += 1;
          continue;
        }
        const draft = drafts.get(slideId) ?? createDraft(slide);
        const match = counterpartItems(sourceItems, itemId, draft.items)[0];
        if (!match) {
          unmatched += 1;
          continue;
        }
        drafts.set(slideId, { ...draft, items: updateItemAt(draft.items, match.id, updates) });
        touched.push(slideId);
      }

      const notice: EditorNotice =
        skipped + unmatched > 0
          ? { key: 'common.editorScopePartial', count: touched.length, skipped: skipped + unmatched, tone: 'info' }
          : { key: 'common.editorScopeApplied', count: touched.length, tone: 'info' };

      dispatch({ type: 'bulk', drafts, touched, notice, history: options?.history ?? true });
    },
    [activeDraft, activeSlide, session.drafts, slideById]
  );

  /** Applies a slide-style patch to the working slide and every selected slide. */
  const applySlideStylePatch = useCallback(
    (updates: Record<string, unknown>, slideIds: string[], scope: EditScope) => {
      if (!activeSlide) return;
      if (scope === 'active' || slideIds.length <= 1) {
        dispatch({
          type: 'mutateSlide',
          slide: activeSlide,
          history: true,
          mutate: (draft) => ({ ...draft, styles: { ...draft.styles, ...updates } }),
        });
        return;
      }
      const drafts = new Map(session.drafts);
      const touched: string[] = [];
      let skipped = 0;
      for (const slideId of slideIds) {
        const slide = slideById.get(slideId);
        if (!slide) continue;
        if (!isItemEditableSlide(slide)) {
          skipped += 1;
          continue;
        }
        const draft = drafts.get(slideId) ?? createDraft(slide);
        drafts.set(slideId, { ...draft, styles: { ...draft.styles, ...updates } });
        touched.push(slideId);
      }
      dispatch({
        type: 'bulk',
        drafts,
        touched,
        notice: {
          key: skipped > 0 ? 'common.editorScopePartial' : 'common.editorScopeApplied',
          count: touched.length,
          skipped,
          tone: 'info',
        },
      });
    },
    [activeSlide, session.drafts, slideById]
  );
  const setNotice = useCallback((notice: EditorNotice | null) => dispatch({ type: 'notice', notice }), []);

  // ── History ────────────────────────────────────────────────────────────────

  const undo = useCallback(() => dispatch({ type: 'undo' }), []);
  const redo = useCallback(() => dispatch({ type: 'redo' }), []);
  const canUndo = history.past.length > 0;
  const canRedo = history.future.length > 0;

  // ── Save ───────────────────────────────────────────────────────────────────

  /** Slides that will actually be written on save. */
  const buildSavePayload = useCallback((currentDeck = deck): Presentation | null => {
    if (session.touchedIds.size === 0) return null;
    const touched = new Map<string, SlideDraft>();
    for (const id of session.touchedIds) {
      const draft = session.drafts.get(id);
      if (draft) touched.set(id, draft);
    }
    return applyDraftsToDeck(currentDeck, pruneDrafts(touched, currentDeck));
  }, [deck, session.drafts, session.touchedIds]);

  return {
    // state
    drafts: session.drafts,
    touchedIds: session.touchedIds,
    isDirty,
    touchedCount,
    activeId,
    activeSlide,
    activeDraft,
    activeItems,
    selectedItems,
    selectedItemIds,
    selection,
    notice: session.notice,
    itemSelection: session.itemSelection,
    canUndo,
    canRedo,

    // navigation & selection
    activateSlide,
    navigate,
    jumpToEdge,
    selectEverySlide,
    collapseSlideSelection,
    setItemSelection,

    // editing
    updateVideoPlayback: (settings: NonNullable<Slide['videoPlayback']>) => { if (activeSlide) dispatch({ type: 'videoPlayback', slide: activeSlide, settings }); },
    updateVideoOverlays: (overlays: NonNullable<Slide['videoOverlays']>, history = true) => { if (activeSlide) dispatch({ type: 'videoOverlays', slide: activeSlide, overlays, history }); },
    updateItems,
    setGridField,
    gestureStart,
    gestureEnd,
    normalizeActiveItems: (options?: { history?: boolean }) =>
      mutateActive((draft) => ({ ...draft, items: normalizeItems(draft.items) }), options?.history ?? true),

    // clipboard & bulk
    copyItems,
    pasteIntoActive,
    pasteIntoSlides,
    pasteIntoSelectedSlides,
    pasteStyleFromClipboard,
    applySelectionStyleToSlides,
    applyItemUpdate,
    applySlideStylePatch,
    setNotice,

    // history & save
    undo,
    redo,
    buildSavePayload,
    reset,
    bases: bases.current,

    // helpers for the component
    slideById,
    order,
  };
}
