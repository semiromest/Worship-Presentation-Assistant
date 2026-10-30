import type { DriveFile, LoopItem, MediaItem, Presentation, Preset } from '../types';
import type { ProjectorPatch, UndoAction, UndoState } from './undoReducer';
// UndoAction is used in setPresentationName to keep rename in undo history
import type { DisplayInfo, DisplayMode, OutputAssignment, ProjectorOutputStatus } from '../../shared/displays';

export interface SlideSelectionUpdate {
  activeId?: string;
  ids?: Set<string>;
  anchorIndex?: number | null;
  liveTargetId?: string;
}

export interface AppState {
  // Undo State
  undoState: UndoState;
  dispatchUndo: (action: UndoAction) => void;
  /** Projector-only: applies a delta without growing the undo history. */
  applyProjectorDelta: (patch: ProjectorPatch) => void;
  presentation: Presentation;

  // Selected State
  selectedSlideId: string;
  setSelectedSlideId: (id: string) => void;
  selectedSlideIds: Set<string>;
  setSelectedSlideIds: (ids: Set<string> | ((prev: Set<string>) => Set<string>)) => void;
  lastSelectedIndex: number | null;
  setLastSelectedIndex: (idx: number | null) => void;

  /** Commit selection and optional live navigation atomically. */
  selectSlides: (selection: SlideSelectionUpdate) => void;

  // Projector State
  /** Stable identity of the live slide; survives slide reordering. */
  liveSlideId: string | null;
  setLiveSlideId: (id: string | null) => void;
  /** Derived index retained for index-based renderers and output assignments. */
  liveIndex: number;
  setLiveIndex: (idx: number | ((prev: number) => number)) => void;
  /** Broadcast lock: pins the live output to one slide (single lock). */
  toggleSlideLock: (slideId: string) => void;
  /** Connected displays; hidden from the UI when there is only one display. */
  displays: DisplayInfo[];
  setDisplays: (displays: DisplayInfo[]) => void;
  /** Per-output relationship between a display and its shown slide. */
  outputAssignments: Record<string, OutputAssignment>;
  setOutputOpen: (displayId: string, open: boolean) => void;
  setOutputMode: (displayId: string, mode: DisplayMode) => void;
  setOutputSlide: (displayId: string, index: number) => void;
  setOutputBlackout: (displayId: string, blackout: boolean | ((prev: boolean) => boolean)) => void;
  setProjectorOutputStatus: (outputs: ProjectorOutputStatus[]) => void;
  /** One-shot: next slide change was auto-tracked → skip the transition. */
  instantTransition: boolean;
  setInstantTransition: (instant: boolean) => void;
  /** Navigate + select + instant transition in a single store update. */
  autoTrackToSlide: (target: number) => void;
  isProjectorWindowOpen: boolean;
  setIsProjectorWindowOpen: (open: boolean) => void;
  projectorReady: boolean;
  setProjectorReady: (ready: boolean) => void;
  /** Projector/stage window only: how this output renders ('follow' | 'manual' → projector, 'stage' → stage display). */
  outputMode: DisplayMode | null;
  setOutputWindowMode: (mode: DisplayMode | null) => void;
  isBlackout: boolean;
  setIsBlackout: (blackout: boolean | ((prev: boolean) => boolean)) => void;

  // Navigation Mode: go live instantly on selection change
  autoGoLive: boolean;
  setAutoGoLive: (auto: boolean) => void;

  operatorNotesEnabled: boolean;
  setOperatorNotesEnabled: (enabled: boolean) => void;

  // Live Save: regularly write presentation changes to a local backup (power-outage safety)
  liveSaveEnabled: boolean;
  setLiveSaveEnabled: (enabled: boolean) => void;
  liveSaveRetentionMs: number;
  setLiveSaveRetentionMs: (ms: number) => void;
  liveSaveLastSaved: number | null;
  setLiveSaveLastSaved: (ts: number | null) => void;
  liveSaveStatus: 'idle' | 'saving' | 'error';
  setLiveSaveStatus: (status: 'idle' | 'saving' | 'error') => void;

  // UI sound effects (uisfx, minimal pack) — off by default
  uiSfxMuteDuringLive: boolean;
  setUiSfxMuteDuringLive: (enabled: boolean) => void;
  uiSfxEnabled: boolean;
  setUiSfxEnabled: (enabled: boolean) => void;

  // Purposeful UI motion — control window only, on by default
  uiMotionEnabled: boolean;
  setUiMotionEnabled: (enabled: boolean) => void;

  sectionFilterId: string;
  setSectionFilterId: (id: string) => void;
  serviceSectionsEnabled: boolean;
  setServiceSectionsEnabled: (enabled: boolean) => void;
  sessionSaveStatus: 'idle' | 'error';
  setSessionSaveStatus: (status: 'idle' | 'error') => void;

  // UI State
  activeTab:
    | 'presentations'
    | 'slides'
    | 'bible'
    | 'media'
    | 'hymns'
    | 'countdown'
    | 'screen'
    | 'loop'
    | 'calendar'
    | 'autosaves'
    | 'editor'
    | 'settings';
  setActiveTab: (
    tab:
      | 'presentations'
      | 'slides'
      | 'bible'
      | 'media'
      | 'hymns'
      | 'countdown'
      | 'screen'
      | 'loop'
      | 'calendar'
      | 'autosaves'
      | 'editor'
      | 'settings'
  ) => void;
  presets: Preset[];
  setPresets: (presets: Preset[]) => void;
  panels: { preset: boolean; remote: boolean; styles: boolean; imageStyles: boolean };
  setPanels: (
    panels:
      | { preset: boolean; remote: boolean; styles: boolean; imageStyles: boolean }
      | ((prev: { preset: boolean; remote: boolean; styles: boolean; imageStyles: boolean }) => {
          preset: boolean;
          remote: boolean;
          styles: boolean;
          imageStyles: boolean;
        })
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

  // Live-screen phone viewers modal
  isLiveShareOpen: boolean;
  setIsLiveShareOpen: (open: boolean) => void;

  // Phone captions/translation share state
  shareActive: boolean;
  setShareActive: (active: boolean) => void;
  shareUrl: string;
  setShareUrl: (url: string) => void;
  shareQr: string | null;
  setShareQr: (qr: string | null) => void;
  shareClientCount: number;
  setShareClientCount: (count: number) => void;
  shareNetworkChanged: boolean;
  setShareNetworkChanged: (changed: boolean) => void;

  // Live-screen phone broadcast state (Canlı Ekran tab)
  screenShareActive: boolean;
  setScreenShareActive: (active: boolean) => void;
  screenShareUrl: string;
  setScreenShareUrl: (url: string) => void;
  screenShareQr: string | null;
  setScreenShareQr: (qr: string | null) => void;
  screenShareClientCount: number;
  setScreenShareClientCount: (count: number) => void;
  screenShareNetworkChanged: boolean;
  setScreenShareNetworkChanged: (changed: boolean) => void;

  // Background music
  backgroundMusicFolder: string;
  backgroundMusicFiles: string[];
  backgroundMusicCurrent: string | null;
  backgroundMusicPlaying: boolean;
  setBackgroundMusicFolder: (folder: string) => void;
  setBackgroundMusicFiles: (files: string[]) => void;
  setBackgroundMusicCurrent: (file: string | null) => void;
  setBackgroundMusicPlaying: (playing: boolean) => void;

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
  editorDirty: boolean;
  setEditorDirty: (dirty: boolean) => void;
  editorSessionVersion: number;
  editorTargetId: string | null;
  openEditor: (slideId: string) => void;
  slideColumns: number;
  setSlideColumns: (columns: number) => void;
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

  // Live captions (STT) panel toggle
  isSttPanelOpen: boolean;
  setIsSttPanelOpen: (open: boolean) => void;

  // Search & Modals
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  isCheatsheetOpen: boolean;
  setIsCheatsheetOpen: (open: boolean) => void;
  isPrepCheckOpen: boolean;
  setIsPrepCheckOpen: (open: boolean) => void;
  isUpdatesOpen: boolean;
  setIsUpdatesOpen: (open: boolean) => void;
  isRemoteOpen: boolean;
  setIsRemoteOpen: (open: boolean) => void;

  // Toast notification
  toastMessage: string | null;
  toastKey: number;
  setToastMessage: (msg: string | null, severity?: 'info' | 'warning' | 'error') => void;
  importantNotification: { message: string; key: number; severity: 'info' | 'warning' | 'error' } | null;
  dismissImportantNotification: () => void;

  // Presentation name
  setPresentationName: (name: string) => void;

  // Google Drive State
  driveSignedIn: boolean;
  driveEmail: string | null;
  driveFiles: DriveFile[];
  drivePanelOpen: boolean;
  driveSigningIn: boolean;
  /** Has the first list scan been done? (avoids rescanning every time the panel opens) */
  driveFilesLoaded: boolean;
  setDriveSignedIn: (signedIn: boolean, email?: string | null) => void;
  setDriveFiles: (files: DriveFile[]) => void;
  setDrivePanelOpen: (open: boolean) => void;
  setDriveSigningIn: (signingIn: boolean) => void;
  setDriveFilesLoaded: (loaded: boolean) => void;
}

export type AppSet = (update: Partial<AppState> | ((state: AppState) => Partial<AppState>)) => void;
