import { create } from 'zustand';
import { Presentation, Preset, MediaItem, MediaKind, LoopItem } from '../types';
import { undoReducer, UndoState, UndoAction } from './undoReducer';
// UndoAction is used in setPresentationName to keep rename in undo history
import { DEFAULT_STYLES, DEFAULT__TRANSITION } from '../constants';
import { makeSlideId } from '../utils';
import i18n from '../i18n';

const createInitialPresentation = (): Presentation => ({
  name: i18n.t('common.presentation'),
  slides: [
    {
      id: makeSlideId(),
      type: 'text',
      content: i18n.t('common.newSlideContent'),
      styles: { ...DEFAULT_STYLES },
    },
  ],
  transition: { ...DEFAULT__TRANSITION },
});

const initialUndoState: UndoState = {
  past: [],
  present: createInitialPresentation(),
  future: [],
};

interface AppState {
  // Undo State
  undoState: UndoState;
  dispatchUndo: (action: UndoAction) => void;
  presentation: Presentation;

  // Selected State
  selectedSlideId: string;
  setSelectedSlideId: (id: string) => void;
  selectedSlideIds: Set<string>;
  setSelectedSlideIds: (ids: Set<string> | ((prev: Set<string>) => Set<string>)) => void;
  lastSelectedIndex: number | null;
  setLastSelectedIndex: (idx: number | null) => void;

  // Projector State
  liveIndex: number;
  setLiveIndex: (idx: number | ((prev: number) => number)) => void;
  isProjectorWindowOpen: boolean;
  setIsProjectorWindowOpen: (open: boolean) => void;
  projectorReady: boolean;
  setProjectorReady: (ready: boolean) => void;
  isBlackout: boolean;
  setIsBlackout: (blackout: boolean | ((prev: boolean) => boolean)) => void;

  // UI State
  activeTab: 'presentations' | 'slides' | 'bible' | 'media' | 'hymns' | 'countdown' | 'screen' | 'loop' | 'calendar';
  setActiveTab: (tab: 'presentations' | 'slides' | 'bible' | 'media' | 'hymns' | 'countdown' | 'screen' | 'loop' | 'calendar') => void;
  presets: Preset[];
  setPresets: (presets: Preset[]) => void;
  panels: { preset: boolean; remote: boolean; styles: boolean; imageStyles: boolean };
  setPanels: (
    panels:
      | { preset: boolean; remote: boolean; styles: boolean; imageStyles: boolean }
      | ((prev: { preset: boolean; remote: boolean; styles: boolean; imageStyles: boolean }) => { preset: boolean; remote: boolean; styles: boolean; imageStyles: boolean })
  ) => void;
  selectedPresetName: string | null;
  setSelectedPresetName: (name: string | null) => void;

  // Remote Control State
  remoteUrl: string;
  setRemoteUrl: (url: string) => void;
  remoteQr: string | null;
  setRemoteQr: (qr: string | null) => void;
  remoteDebug: any;
  setRemoteDebug: (debug: any) => void;

  // Media Settings
  mediaVolume: number;
  setMediaVolume: (vol: number) => void;
  isMediaMuted: boolean;
  setIsMediaMuted: (muted: boolean | ((prev: boolean) => boolean)) => void;

  // Media Library (persists across tab switches)
  mediaItems: MediaItem[];
  setMediaItems: (items: MediaItem[] | ((prev: MediaItem[]) => MediaItem[])) => void;
  loopItems: LoopItem[];
  setLoopItems: (items: LoopItem[] | ((prev: LoopItem[]) => LoopItem[])) => void;

  // Editor State
  isEditorOpen: boolean;
  setIsEditorOpen: (open: boolean) => void;
  slideZoom: number;
  setSlideZoom: (zoom: number | ((prev: number) => number)) => void;

  // Drag & Drop State
  draggedSlideId: string | null;
  setDraggedSlideId: (id: string | null) => void;
  dragOverIndex: number | null;
  setDragOverIndex: (idx: number | null) => void;

  // Color Picker State
  activeColorPicker: 'bg' | 'text' | null;
  setActiveColorPicker: (picker: 'bg' | 'text' | null) => void;

  // Right panel toggle
  isRightPanelOpen: boolean;
  setIsRightPanelOpen: (open: boolean) => void;

  // Search & Modals
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  isCheatsheetOpen: boolean;
  setIsCheatsheetOpen: (open: boolean) => void;

  // Toast notification
  toastMessage: string | null;
  toastKey: number;
  setToastMessage: (msg: string | null) => void;

  // Presentation name
  setPresentationName: (name: string) => void;
}

export const useStore = create<AppState>((set) => ({
  undoState: initialUndoState,
  presentation: initialUndoState.present,
  toastMessage: null,
  toastKey: 0,
  setToastMessage: (msg) => set({ toastMessage: msg, toastKey: msg ? Date.now() : 0 }),
  dispatchUndo: (action) =>
    set((state) => {
      const nextUndoState = undoReducer(state.undoState, action);
      let toast: string | null = null;
      if (action.type === 'UNDO' && nextUndoState.past.length < state.undoState.past.length) {
        toast = 'undoNotification';
      } else if (action.type === 'REDO' && nextUndoState.future.length < state.undoState.future.length) {
        toast = 'redoNotification';
      }
      return {
        undoState: nextUndoState,
        presentation: nextUndoState.present,
        toastMessage: toast,
        toastKey: toast ? Date.now() : state.toastKey,
      };
    }),

  selectedSlideId: initialUndoState.present.slides[0].id,
  setSelectedSlideId: (id) => set({ selectedSlideId: id }),

  selectedSlideIds: new Set([initialUndoState.present.slides[0].id]),
  setSelectedSlideIds: (ids) =>
    set((state) => ({
      selectedSlideIds: typeof ids === 'function' ? ids(state.selectedSlideIds) : ids,
    })),

  lastSelectedIndex: null,
  setLastSelectedIndex: (idx) => set({ lastSelectedIndex: idx }),

  liveIndex: 0,
  setLiveIndex: (idx) =>
    set((state) => ({
      liveIndex: typeof idx === 'function' ? idx(state.liveIndex) : idx,
    })),

  isProjectorWindowOpen: false,
  setIsProjectorWindowOpen: (open) => set({ isProjectorWindowOpen: open }),

  projectorReady: false,
  setProjectorReady: (ready) => set({ projectorReady: ready }),

  isBlackout: false,
  setIsBlackout: (blackout) =>
    set((state) => ({
      isBlackout: typeof blackout === 'function' ? blackout(state.isBlackout) : blackout,
    })),

  activeTab: 'slides',
  setActiveTab: (tab) => set({ activeTab: tab }),

  presets: [],
  setPresets: (presets) => set({ presets }),

  panels: { preset: false, remote: false, styles: false, imageStyles: false },
  setPanels: (panels) =>
    set((state) => ({
      panels: typeof panels === 'function' ? panels(state.panels) : panels,
    })),

  isRightPanelOpen: true,
  setIsRightPanelOpen: (open) => set({ isRightPanelOpen: open }),

  selectedPresetName: null,
  setSelectedPresetName: (name) => set({ selectedPresetName: name }),

  remoteUrl: '',
  setRemoteUrl: (url) => set({ remoteUrl: url }),

  remoteQr: null,
  setRemoteQr: (qr) => set({ remoteQr: qr }),

  remoteDebug: null,
  setRemoteDebug: (debug) => set({ remoteDebug: debug }),

  mediaVolume: 1,
  setMediaVolume: (vol) => set({ mediaVolume: vol }),

  isMediaMuted: false,
  setIsMediaMuted: (muted) =>
    set((state) => ({
      isMediaMuted: typeof muted === 'function' ? muted(state.isMediaMuted) : muted,
    })),

  mediaItems: [],
  setMediaItems: (items) =>
    set((state) => ({
      mediaItems: typeof items === 'function' ? items(state.mediaItems) : items,
    })),
  loopItems: [],
  setLoopItems: (items) =>
    set((state) => ({
      loopItems: typeof items === 'function' ? items(state.loopItems) : items,
    })),

  slideZoom: 1,
  setSlideZoom: (zoom) =>
    set((state) => ({
      slideZoom: typeof zoom === 'function' ? zoom(state.slideZoom) : zoom,
    })),

  isEditorOpen: false,
  setIsEditorOpen: (open) => set({ isEditorOpen: open }),

  draggedSlideId: null,
  setDraggedSlideId: (id) => set({ draggedSlideId: id }),

  dragOverIndex: null,
  setDragOverIndex: (idx) => set({ dragOverIndex: idx }),

  activeColorPicker: null,
  setActiveColorPicker: (picker) => set({ activeColorPicker: picker }),

  searchQuery: '',
  setSearchQuery: (query) => set({ searchQuery: query }),

  isCheatsheetOpen: false,
  setIsCheatsheetOpen: (open) => set({ isCheatsheetOpen: open }),

  setPresentationName: (name) => set((state) => {
    // Use the undo reducer so the rename is tracked in undo history
    const action: UndoAction = { type: 'SET', payload: { ...state.presentation, name } };
    const nextUndoState = undoReducer(state.undoState, action);
    return {
      undoState: nextUndoState,
      presentation: nextUndoState.present,
    };
  }),
}));
