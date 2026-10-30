import { shallow } from 'zustand/shallow';
import { normalizeSections } from '../../shared/sectionModel';
import { Presentation } from '../types';
import { applyProjectorPatch, UndoAction, undoReducer, UndoState } from './undoReducer';
// UndoAction is used in setPresentationName to keep rename in undo history
import {
  chooseDefaultOutputDisplay,
  clampSlideIndex,
  createOutputAssignment,
  type OutputAssignment,
} from '../../shared/displays';
import { DEFAULT__TRANSITION, DEFAULT_STYLES, PROJECTOR_OUTPUT_MODE } from '../constants';
import i18n from '../i18n';
import { playSfx } from '../sfx';
import { pinSlide, resolveLiveSlidePosition, unpinSlide } from '../slideLock';
import { makeSlideId } from '../utils';

import type { AppSet, AppState } from './storeTypes';
const createInitialPresentation = (): Presentation => ({
  id: crypto.randomUUID(),
  name: i18n.t('common.presentation'),
  slides: [
    {
      id: makeSlideId(),
      type: 'text',
      content: i18n.t('common.newSlideContent'),
      styles: { ...DEFAULT_STYLES },
    },
  ],
  zoom: 1,
  transition: { ...DEFAULT__TRANSITION },
});

const initialUndoState: UndoState = {
  past: [],
  present: normalizeSections(createInitialPresentation()),
  future: [],
};

const sameSelection = (a: Set<string>, b: Set<string>) =>
  a === b || (a.size === b.size && [...a].every((id) => b.has(id)));

export function createPresentationSlice(
  set: AppSet
): Pick<
  AppState,
  | 'undoState'
  | 'presentation'
  | 'toastMessage'
  | 'toastKey'
  | 'setToastMessage'
  | 'importantNotification'
  | 'dismissImportantNotification'
  | 'dispatchUndo'
  | 'applyProjectorDelta'
  | 'selectedSlideId'
  | 'setSelectedSlideId'
  | 'selectedSlideIds'
  | 'setSelectedSlideIds'
  | 'selectSlides'
  | 'lastSelectedIndex'
  | 'setLastSelectedIndex'
  | 'liveSlideId'
  | 'liveIndex'
  | 'setLiveSlideId'
  | 'setLiveIndex'
  | 'toggleSlideLock'
  | 'displays'
  | 'setDisplays'
  | 'outputAssignments'
  | 'setOutputOpen'
  | 'setOutputMode'
  | 'setOutputSlide'
  | 'setOutputBlackout'
  | 'setProjectorOutputStatus'
  | 'instantTransition'
  | 'setInstantTransition'
  | 'autoTrackToSlide'
  | 'isProjectorWindowOpen'
  | 'setIsProjectorWindowOpen'
  | 'projectorReady'
  | 'setProjectorReady'
  | 'outputMode'
  | 'setOutputWindowMode'
  | 'isBlackout'
  | 'setIsBlackout'
  | 'autoGoLive'
  | 'setAutoGoLive'
  | 'setPresentationName'
> {
  return {
    undoState: initialUndoState,
    presentation: initialUndoState.present,
    toastMessage: null,
    toastKey: 0,
    importantNotification: null,
    dismissImportantNotification: () => set({ importantNotification: null }),
    setToastMessage: (msg, severity) => set(state =>
      msg && msg !== 'undoNotification' && msg !== 'redoNotification'
        ? (severity === 'info' && state.importantNotification && state.importantNotification.severity !== 'info' ? state : { importantNotification: { message: msg, severity: severity ?? (msg === 'displayDisconnected' ? 'warning' : 'error'), key: Math.max(Date.now(), (state.importantNotification?.key ?? 0) + 1) } })
        : { toastMessage: msg, toastKey: msg ? Date.now() : 0 }),
    dispatchUndo: (action) =>
      set((state) => {
        const normalizedAction =
          action.type === 'SET' || action.type === 'RESET'
            ? { ...action, payload: normalizeSections(action.payload) }
            : action;
        const nextUndoState = undoReducer(state.undoState, normalizedAction);
        if (nextUndoState === state.undoState) return state;
        let toast: string | null = null;
        if (action.type === 'UNDO' && nextUndoState.past.length < state.undoState.past.length) {
          toast = 'undoNotification';
        } else if (action.type === 'REDO' && nextUndoState.future.length < state.undoState.future.length) {
          toast = 'redoNotification';
        }

        const restoring = action.type === 'RESET';
        const livePosition = action.type === 'EDIT_SLIDES'
          ? { slideId: state.liveSlideId, index: state.liveIndex }
          : resolveLiveSlidePosition(
          restoring ? nextUndoState.present.liveSlideId : state.liveSlideId,
          restoring ? (nextUndoState.present.liveIndex ?? 0) : state.liveIndex,
          nextUndoState.present.slides
        );
        return {
          editorSessionVersion: restoring ? state.editorSessionVersion + 1 : state.editorSessionVersion,
          editorTargetId: restoring ? null : state.editorTargetId,
          editorDirty: restoring ? false : state.editorDirty,
          undoState: nextUndoState,
          presentation: nextUndoState.present,
          liveSlideId: livePosition.slideId,
          liveIndex: livePosition.index,
          toastMessage: toast,
          toastKey: toast ? Date.now() : state.toastKey,
        };
      }),
    applyProjectorDelta: (patch) =>
      set((state) => {
        const next = applyProjectorPatch(state.presentation, patch);
        if (next === state.presentation) return state;
        const livePosition = resolveLiveSlidePosition(state.liveSlideId, state.liveIndex, next.slides);
        return {
          undoState: { ...state.undoState, present: next },
          presentation: next,
          liveSlideId: livePosition.slideId,
          liveIndex: livePosition.index,
        };
      }),
    selectedSlideId: initialUndoState.present.slides[0].id,
    setSelectedSlideId: (id) => set({ selectedSlideId: id }),
    selectedSlideIds: new Set([initialUndoState.present.slides[0].id]),
    setSelectedSlideIds: (ids) =>
      set((state) => {
        const next = typeof ids === 'function' ? ids(state.selectedSlideIds) : ids;
        return sameSelection(state.selectedSlideIds, next) ? state : { selectedSlideIds: new Set(next) };
      }),
    selectSlides: ({ activeId, ids, anchorIndex, liveTargetId }) =>
      set((state) => {
        const live =
          liveTargetId === undefined
            ? undefined
            : resolveLiveSlidePosition(liveTargetId, state.liveIndex, state.presentation.slides);
        return {
          ...(activeId === undefined ? {} : { selectedSlideId: activeId }),
          ...(ids === undefined || sameSelection(state.selectedSlideIds, ids)
            ? {}
            : { selectedSlideIds: new Set(ids) }),
          ...(anchorIndex === undefined ? {} : { lastSelectedIndex: anchorIndex }),
          ...(live ? { liveSlideId: live.slideId, liveIndex: live.index } : {}),
        };
      }),
    lastSelectedIndex: null,
    setLastSelectedIndex: (idx) => set({ lastSelectedIndex: idx }),
    liveSlideId: initialUndoState.present.slides[0].id,
    liveIndex: 0,
    setLiveSlideId: (id) =>
      set((state) => {
        const livePosition = resolveLiveSlidePosition(id, state.liveIndex, state.presentation.slides);
        return { liveSlideId: livePosition.slideId, liveIndex: livePosition.index };
      }),
    setLiveIndex: (idx) =>
      set((state) => {
        const requested = typeof idx === 'function' ? idx(state.liveIndex) : idx;
        const requestedSlideId = state.presentation.slides[Math.floor(requested)]?.id;
        const livePosition = resolveLiveSlidePosition(requestedSlideId, requested, state.presentation.slides);
        return { liveSlideId: livePosition.slideId, liveIndex: livePosition.index };
      }),
    toggleSlideLock: (slideId) =>
      set((state) => {
        const slides = state.presentation.slides;
        const target = slides.find((s) => s.id === slideId);
        if (!target) return state;
        const wasLocked = target.locked === true;

        if (wasLocked) {
          const nextSlides = unpinSlide(slides, slideId);
          playSfx('unlock');
          const nextPresentation = { ...state.presentation, slides: nextSlides };
          const livePosition = resolveLiveSlidePosition(state.liveSlideId, state.liveIndex, nextSlides);
          return {
            undoState: { ...state.undoState, present: nextPresentation },
            presentation: nextPresentation,
            liveSlideId: livePosition.slideId,
            liveIndex: livePosition.index,
          };
        }

        const pinned = pinSlide(slides, slideId);
        if (!pinned) return state;
        playSfx('lock');

        const idx = pinned.lockedIndex;
        const slide = pinned.slides[idx];
        const nextPresentation = { ...state.presentation, slides: pinned.slides };
        return {
          undoState: { ...state.undoState, present: nextPresentation },
          presentation: nextPresentation,
          liveSlideId: slide.id,
          liveIndex: idx,
          selectedSlideId: slide.id,
          selectedSlideIds: new Set([slide.id]),
          lastSelectedIndex: idx,
        };
      }),
    displays: [],
    setDisplays: (displays) =>
      set((state) => {
        // Rebuild from scratch — prune stale entries for disconnected
        // displays that would otherwise accumulate indefinitely.
        const outputAssignments: Record<string, OutputAssignment> = {};
        for (const display of displays) {
          outputAssignments[display.id] =
            state.outputAssignments[display.id] ?? createOutputAssignment(state.liveIndex);
        }
        const sameDisplays =
          state.displays.length === displays.length &&
          state.displays.every((old, i) => {
            const next = displays[i];
            return (
              old.id === next.id &&
              old.label === next.label &&
              old.isPrimary === next.isPrimary &&
              old.scaleFactor === next.scaleFactor &&
              shallow(old.bounds, next.bounds) &&
              shallow(old.workArea, next.workArea)
            );
          });
        return {
          displays: sameDisplays ? state.displays : displays,
          outputAssignments: shallow(state.outputAssignments, outputAssignments)
            ? state.outputAssignments
            : outputAssignments,
        };
      }),
    outputAssignments: {},
    setOutputOpen: (displayId, open) =>
      set((state) => {
        const current = state.outputAssignments[displayId] ?? createOutputAssignment(state.liveIndex);
        const resetBlackout = chooseDefaultOutputDisplay(state.displays)?.id === displayId && !open;
        const next = { ...current, isOpen: open, ...(resetBlackout ? { isBlackout: false } : {}) };
        return {
          outputAssignments:
            state.outputAssignments[displayId] && shallow(current, next)
              ? state.outputAssignments
              : { ...state.outputAssignments, [displayId]: next },
          ...(resetBlackout ? { isBlackout: false } : {}),
        };
      }),
    setOutputMode: (displayId, mode) =>
      set((state) => {
        const current = state.outputAssignments[displayId] ?? createOutputAssignment(state.liveIndex);
        const next = {
          ...current,
          mode,
          ...(mode === 'manual'
            ? { slideIndex: clampSlideIndex(state.liveIndex, state.presentation.slides.length) }
            : {}),
        };
        return state.outputAssignments[displayId] && shallow(current, next)
          ? state
          : { outputAssignments: { ...state.outputAssignments, [displayId]: next } };
      }),
    setOutputSlide: (displayId, index) =>
      set((state) => {
        const current = state.outputAssignments[displayId] ?? createOutputAssignment(state.liveIndex);
        const next = { ...current, mode: 'manual' as const, slideIndex: Math.max(0, Math.floor(index)) };
        return state.outputAssignments[displayId] && shallow(current, next)
          ? state
          : { outputAssignments: { ...state.outputAssignments, [displayId]: next } };
      }),
    setOutputBlackout: (displayId, blackout) =>
      set((state) => {
        const current = state.outputAssignments[displayId] ?? createOutputAssignment(state.liveIndex);
        const isDefault = chooseDefaultOutputDisplay(state.displays)?.id === displayId;
        const value =
          typeof blackout === 'function' ? blackout(isDefault ? state.isBlackout : current.isBlackout) : blackout;
        return {
          outputAssignments:
            state.outputAssignments[displayId] && current.isBlackout === value
              ? state.outputAssignments
              : { ...state.outputAssignments, [displayId]: { ...current, isBlackout: value } },
          ...(isDefault ? { isBlackout: value } : {}),
        };
      }),
    setProjectorOutputStatus: (outputs) =>
      set((state) => {
        let assignments = state.outputAssignments;
        const statuses = new Map(outputs.map((output) => [output.displayId, output.isOpen]));
        for (const id of new Set([...Object.keys(assignments), ...statuses.keys()])) {
          const current = state.outputAssignments[id] ?? createOutputAssignment(state.liveIndex);
          const isOpen = statuses.get(id) ?? false;
          if (state.outputAssignments[id] && current.isOpen === isOpen) continue;
          if (assignments === state.outputAssignments) assignments = { ...assignments };
          assignments[id] = { ...current, isOpen };
        }
        const defaultId = chooseDefaultOutputDisplay(state.displays)?.id;
        const defaultStatus = defaultId ? statuses.get(defaultId) : undefined;
        return {
          outputAssignments: assignments,
          ...(defaultStatus !== undefined
            ? { isProjectorWindowOpen: defaultStatus }
            : outputs.length === 0
              ? { isProjectorWindowOpen: false }
              : {}),
        };
      }),
    instantTransition: false,
    setInstantTransition: (instantTransition) => set({ instantTransition }),
    autoTrackToSlide: (target) =>
      set((state) => {
        const requestedSlideId = state.presentation.slides[target]?.id;
        const livePosition = resolveLiveSlidePosition(requestedSlideId, target, state.presentation.slides);
        const slide = state.presentation.slides[livePosition.index];
        return {
          instantTransition: true,
          liveSlideId: livePosition.slideId,
          liveIndex: livePosition.index,
          ...(slide
            ? {
                selectedSlideId: slide.id,
                selectedSlideIds: new Set([slide.id]),
              }
            : {}),
          lastSelectedIndex: livePosition.index,
        };
      }),
    isProjectorWindowOpen: false,
    setIsProjectorWindowOpen: (open) => set({ isProjectorWindowOpen: open }),
    projectorReady: false,
    setProjectorReady: (ready) => set({ projectorReady: ready }),
    outputMode: PROJECTOR_OUTPUT_MODE === 'stage' ? 'stage' : null,
    setOutputWindowMode: (outputMode) => set({ outputMode }),
    isBlackout: false,
    setIsBlackout: (blackout) =>
      set((state) => ({
        isBlackout: typeof blackout === 'function' ? blackout(state.isBlackout) : blackout,
      })),
    autoGoLive: false,
    setAutoGoLive: (auto) => set({ autoGoLive: auto }),
    setPresentationName: (name) =>
      set((state) => {
        if (name === state.presentation.name) return state;
        const action: UndoAction = { type: 'SET', payload: { ...state.presentation, name } };
        const nextUndoState = undoReducer(state.undoState, action);
        return {
          undoState: nextUndoState,
          presentation: nextUndoState.present,
        };
      }),
  };
}
