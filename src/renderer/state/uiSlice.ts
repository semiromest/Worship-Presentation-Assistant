import { normalizeSlideColumns } from '../components/slideGridGeometry';
import { shallow } from 'zustand/shallow';
// UndoAction is used in setPresentationName to keep rename in undo history

import type { AppSet, AppState } from './storeTypes';

export function createUiSlice(
  set: AppSet
): Pick<
  AppState,
  | 'activeTab'
  | 'setActiveTab'
  | 'presets'
  | 'setPresets'
  | 'panels'
  | 'setPanels'
  | 'isRightPanelOpen'
  | 'setIsRightPanelOpen'
  | 'isSttPanelOpen'
  | 'setIsSttPanelOpen'
  | 'selectedPresetName'
  | 'setSelectedPresetName'
  | 'remoteUrl'
  | 'setRemoteUrl'
  | 'remoteQr'
  | 'setRemoteQr'
  | 'remoteDebug'
  | 'setRemoteDebug'
  | 'slideColumns'
  | 'setSlideColumns'
  | 'slideZoom'
  | 'setSlideZoom'
  | 'editorDirty'
  | 'setEditorDirty'
  | 'editorSessionVersion'
  | 'editorTargetId'
  | 'openEditor'
  | 'draggedSlideId'
  | 'setDraggedSlideId'
  | 'dragOverIndex'
  | 'setDragOverIndex'
  | 'activeColorPicker'
  | 'setActiveColorPicker'
  | 'searchQuery'
  | 'setSearchQuery'
  | 'isCheatsheetOpen'
  | 'setIsCheatsheetOpen'
  | 'isPrepCheckOpen'
  | 'setIsPrepCheckOpen'
  | 'isUpdatesOpen'
  | 'setIsUpdatesOpen'
  | 'isRemoteOpen'
  | 'setIsRemoteOpen'
  | 'isLiveShareOpen'
  | 'setIsLiveShareOpen'
> {
  return {
    activeTab: 'presentations',
    setActiveTab: (tab) => set({ activeTab: tab }),
    presets: [],
    setPresets: (presets) => set({ presets }),
    panels: { preset: false, remote: false, styles: false, imageStyles: false },
    setPanels: (panels) =>
      set((state) => {
        const next = typeof panels === 'function' ? panels(state.panels) : panels;
        return shallow(state.panels, next) ? state : { panels: next };
      }),
    isRightPanelOpen: true,
    setIsRightPanelOpen: (open) => set({ isRightPanelOpen: open }),
    isSttPanelOpen: false,
    setIsSttPanelOpen: (open) => set({ isSttPanelOpen: open }),
    selectedPresetName: null,
    setSelectedPresetName: (name) => set({ selectedPresetName: name }),
    remoteUrl: '',
    setRemoteUrl: (url) => set({ remoteUrl: url }),
    remoteQr: null,
    setRemoteQr: (qr) => set({ remoteQr: qr }),
    remoteDebug: null,
    setRemoteDebug: (debug) => set({ remoteDebug: debug }),
    slideColumns: 4,
    setSlideColumns: (columns) => set({ slideColumns: normalizeSlideColumns(columns) }),
    slideZoom: 1,
    setSlideZoom: (zoom) =>
      set((state) => {
        const newZoom = typeof zoom === 'function' ? zoom(state.slideZoom) : zoom;
        // Zoom is UI-only state. It must NOT write into `presentation`: doing so
        // re-triggered the entire pipeline (autosave, projector IPC, thumbnail
        // scan, remote status) on every zoom change. It is re-attached to the
        // payload only at save time (see useSlideOperations.savePresentation).
        return { slideZoom: newZoom };
      }),
    editorDirty: false,
    setEditorDirty: (editorDirty) => set({ editorDirty }),
    editorSessionVersion: 0,
    editorTargetId: null,
    openEditor: (editorTargetId) => set({ editorTargetId, activeTab: 'editor' }),
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
    isPrepCheckOpen: false,
    setIsPrepCheckOpen: (open) => set({ isPrepCheckOpen: open }),
    isUpdatesOpen: false,
    setIsUpdatesOpen: (open) => set({ isUpdatesOpen: open }),
    isRemoteOpen: false,
    setIsRemoteOpen: (open) => set({ isRemoteOpen: open }),
    isLiveShareOpen: false,
    setIsLiveShareOpen: (open) => set({ isLiveShareOpen: open }),
  };
}
