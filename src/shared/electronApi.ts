import type { SttConfig, SttStatus } from './stt';
import type { DisplayInfo, ProjectorOutputStatus } from './displays';
import type { DriveFile, DriveStatus } from './presentation';
import type { PerfSnapshot, MainPerfSnapshot } from './perf';
type MediaKind = 'image' | 'video';

/** The preload capability surface shared by the bridge and renderer. */
export interface ElectronAPI {
  getScreenSources: () => Promise<{ id: string; name: string; thumbnail: string; display_id?: string }[]>;
  captureScreenSource: (sourceId: string) => Promise<string | null>;
  getMediaThumbnail: (source: string, maxEdge: number) => Promise<string | null>;
  cleanupTempDir: () => Promise<boolean>;
  getMainPerfSnapshot: () => Promise<MainPerfSnapshot>;
  resetMainPerf: () => Promise<boolean>;
  getPreloadPerfSnapshot: () => PerfSnapshot;
  getPerfSnapshot: () => PerfSnapshot;
  resetPerf: () => void;
  generateGradient: (
    recipe: import('./generatedBackground').GeneratedBackground,
    regions: import('./gradientContrast').ContrastRegion[]
  ) => Promise<import('./gradientDraft').GradientDraft>;
  saveGradient: (token: string) => Promise<string>;
  discardGradient: () => Promise<void>;
  listGradientLibrary: () => Promise<import('./gradientLibrary').GradientLibraryEntry[]>;
  saveGradientLibrary: (input: import('./gradientLibrary').SaveGradientLibraryInput) => Promise<import('./gradientLibrary').GradientLibraryEntry[]>;
  deleteGradientLibrary: (id: string) => Promise<import('./gradientLibrary').GradientLibraryEntry[]>;
  onPracticeWorkspaceChanged: (
    callback: (value: { sessionId: string; workspace: import('./practice').PracticeWorkspace }) => void
  ) => () => void;
  controlPracticeGuide: (
    id: string,
    step: import('./practice').GuideStep,
    action: string,
    input: import('./practice').GuideObservation,
    label: string,
    destination?: import('./practice').GuideStep
  ) => Promise<import('./practice').PracticeWorkspace>;
  resumePracticeExercise: (id: string, deck: unknown) => Promise<import('./practice').PracticeWorkspace>;
  readPracticeWorkspace: (deck: unknown) => Promise<import('./practice').PracticeWorkspace>;
  closePractice: (id?: string) => Promise<{ ok: true }>;
  onPracticeCloseRequested: (callback: () => void) => () => void;
  startPracticeExercise: (
    exercise: string,
    deck: unknown,
    label: string
  ) => Promise<import('./practice').PracticeWorkspace>;
  observePracticeWorkspace: (id: string | null, deck: unknown) => Promise<import('./practice').PracticeWorkspace>;
  pausePracticeExercise: (id: string, skip?: boolean) => Promise<import('./practice').PracticeWorkspace>;
  getPracticeInfo: () => Promise<{ mode: 'normal' | 'practice' | 'smoke' }>;
  getPracticeProgress: () => Promise<import('./practice').ProgressRead>;
  openPractice: () => Promise<{ ok: boolean }>;
  getTourProfileInfo: () => Promise<{ profileKind: 'new' | 'existing' | 'unknown' }>;
  saveFile: (content: string) => Promise<string>;
  openFile: () => Promise<{ content: string; path: string }>;
  loadPresets: (retentionMs?: number) => Promise<any[]>;
  savePreset: (preset: { name: string; presentation: any; retentionMs?: number }) => Promise<any[]>;
  deletePreset: (name: string, retentionMs?: number) => Promise<any[]>;
  renamePreset: (oldName: string, newName: string, retentionMs?: number) => Promise<any[]>;
  getDisplays: () => Promise<DisplayInfo[]>;
  getProjectorOutputs: () => Promise<ProjectorOutputStatus[]>;
  toggleProjector: (initialData?: any, displayId?: string) => Promise<boolean>;
  openProjector: (displayId: string, initialData?: any) => Promise<boolean>;
  closeProjector: (displayId: string) => Promise<boolean>;
  updateProjector: (data: any) => Promise<boolean>;
  checkMediaResources: (urls: string[]) => Promise<Record<string, boolean>>;
  cacheGoogleFont: (family: string) => Promise<string>;
  getProjectorStatus: () => Promise<boolean>;
  importBibleXml: (filePath?: string) => Promise<any>;
  saveBibleData: (id: string, data: unknown) => Promise<string | null>;
  readBibleData: (filePath: string) => Promise<{ content: string } | null>;
  deleteBibleData: (filePath: string) => Promise<boolean | null>;
  selectMediaFile: (type: MediaKind) => Promise<string | null>;
  getDroppedImagePath: (file: File) => Promise<string | null>;
  selectMediaFilesAll?: () => Promise<string[] | null>;
  importHymnArchive: (dirPath?: string) => Promise<any>;
  selectPptxFile: () => Promise<string | null>;
  importPptx: (filePath: string) => Promise<any>;
  exportPptx: (content: string) => Promise<{
    success: boolean;
    filePath?: string;
    slideCount?: number;
    warnings?: string[];
    error?: string;
    canceled?: boolean;
  }>;
  getRemoteUrl: () => Promise<string>;
  publicTunnelStart: () => Promise<{ active: boolean; url: string; state: string; error?: string }>;
  publicTunnelStop: () => Promise<{ active: boolean; url: string; state: string; error?: string }>;
  publicTunnelStatus: () => Promise<{ active: boolean; url: string; state: string; error?: string }>;
  onPublicTunnelStatus: (
    callback: (status: { active: boolean; url: string; state: string; error?: string }) => void
  ) => () => void;
  getRemoteDebug: () => Promise<any>;
  getRemoteDiagnostics: () => Promise<{
    ok: boolean;
    serverRunning: boolean;
    serverUrl: string | null;
    port: number | null;
    selectedAddress: string;
    interfaces: Array<{ name: string; address: string; score: number }>;
    selfConnectTest: { tried: boolean; success: boolean; error?: string };
    firewallWarning: boolean;
    firewall?: import('./remoteDiagnostics').FirewallDiagnostic;
    checks: Array<{ label: string; pass: boolean; detail: string }>;
  }>;
  updateRemoteStatus: (status: any) => Promise<void>;
  quitApp: () => Promise<boolean>;
  updateAllSlidePreviews: (previews: (string | null)[]) => Promise<void>;
  updateSlidePreviewsDelta: (updates: { i: number; url: string }[]) => Promise<void>;
  sendSlidePreview: (dataUrl: string) => Promise<void>;
  sendRemoteNotice: (notice: { text: string; tone?: 'ok' | 'error' }) => Promise<boolean>;
  generateThumbnail: (slide: any) => Promise<string | null>;
  showConfirmDialog: (options: {
    message: string;
    title?: string;
    detail?: string;
    confirmLabel?: string;
    cancelLabel?: string;
  }) => Promise<boolean>;
  showAlertDialog: (options: { message: string; title?: string; detail?: string; okLabel?: string }) => Promise<void>;
  notifyProjectorReady: (displayId?: string) => void;
  onRemoteAction: (callback: (data: any) => void) => () => void;
  onProjectorUpdate: (callback: (data: any) => void) => () => void;
  onProjectorClosed: (callback: (data?: { displayId?: string }) => void) => () => void;
  onProjectorReady: (callback: (data?: { displayId?: string }) => void) => () => void;
  onDisplaysChanged: (callback: (displays: DisplayInfo[]) => void) => () => void;
  onProjectorOutputStatus: (callback: (outputs: ProjectorOutputStatus[]) => void) => () => void;
  onPptxImportProgress: (callback: (data: { current: number; total: number }) => void) => () => void;
  onPptxExportProgress: (callback: (data: { current: number; total: number }) => void) => () => void;

  selectMediaFolder?: () => Promise<string | null>;
  readMediaFolder?: (
    folderPath: string,
    options?: { recursive?: boolean; includeImages?: boolean; includeVideos?: boolean }
  ) => Promise<{ paths: string[]; missing: boolean } | null>;

  // Google Drive API
  driveSignIn: () => Promise<DriveStatus>;
  driveSignInCancel: () => Promise<void>;
  driveSignOut: () => Promise<void>;
  driveStatus: () => Promise<DriveStatus>;
  driveListFiles: () => Promise<DriveFile[]>;
  driveUpload: (name: string, content: string) => Promise<{ ok: boolean; id?: string; error?: string }>;
  driveSavePresentation: (content: string, name?: string) => Promise<{ ok: boolean; id?: string; error?: string }>;
  driveDownload: (fileId: string) => Promise<{ ok: boolean; data?: string; error?: string }>;
  driveDeleteFile: (fileId: string) => Promise<{ ok: boolean; error?: string }>;

  // Updater API
  getUpdaterInfo: () => Promise<{ version: string; updaterActive: boolean }>;
  checkForUpdates: () => Promise<{ ok: boolean; error?: string }>;
  downloadUpdate: () => Promise<{ ok: boolean; error?: string }>;
  installUpdate: () => Promise<boolean>;
  onUpdaterEvent: (callback: (event: { type: string; payload?: any }) => void) => () => void;

  // Soniox real-time STT + translation
  sttGetStatus: () => Promise<SttStatus>;
  sttDeleteApiKey: () => Promise<{ ok: boolean; code?: string }>;
  openSonioxWebsite: () => Promise<{ ok: boolean }>;
  sttSetApiKey: (key: string) => Promise<{ ok: boolean; code?: string; message?: string }>;
  sttStart: (config: SttConfig) => Promise<{ ok: boolean; code?: string; message?: string }>;
  sttSendAudio: (chunk: ArrayBuffer | Uint8Array) => void;
  sttStop: () => Promise<{ ok: boolean }>;
  sttClear: () => Promise<void>;
  onSttEvent: (callback: (event: any) => void) => () => void;

  // Phone captions/translation share (LAN broadcast to phone browsers)
  shareStart: (subdomain?: string) => Promise<{ ok: boolean; url?: string; error?: string; localOnly?: boolean }>;
  shareStop: () => Promise<{ ok: boolean }>;
  sharePublish: (snapshot: any) => void;
  shareGetStatus: () => Promise<{ active: boolean; url: string; clientCount: number }>;
  onShareClientCount: (callback: (count: number) => void) => () => void;
  onShareNetworkChanged: (callback: (data: { url: string }) => void) => () => void;
  onRemoteUrlChanged: (callback: (data: { url: string }) => void) => () => void;

  selectAudioFolder: () => Promise<string | null>;
  youtubeMusicSearch: (query: string, cursor?: string) => Promise<import('./youtubeMusic').YouTubeSearchResponse>;
  youtubeMusicPlay: (id: string) => Promise<import('./youtubeMusic').YouTubePlayResponse>;
  youtubeMusicPrepare: (id: string) => Promise<{ ok: boolean }>;
  youtubeMusicOfflineStatus: (id: string) => Promise<import('./youtubeMusic').OfflineMusicStatus>;
  youtubeMusicDownload: (id: string) => Promise<import('./youtubeMusic').OfflineMusicStatus>;
  youtubeMusicCancelDownload: (id: string) => Promise<void>;
  youtubeMusicStop: (streamId?: string) => Promise<void>;
  readAudioFolder: (folderPath: string, recursive?: boolean) => Promise<{ paths: string[]; missing: boolean } | null>;
  selectAudioFile: () => Promise<string | null>;

  // Live-screen phone broadcast (view the live screen fullscreen on a phone)
  screenShareStart: () => Promise<{ ok: boolean; url?: string; error?: string }>;
  screenShareStop: () => Promise<{ ok: boolean }>;
  screenShareFrame: (frame: string) => void;
  screenShareGetStatus: () => Promise<{ active: boolean; url: string; clientCount: number }>;
  onScreenShareClientCount: (callback: (count: number) => void) => () => void;
  onScreenShareNetworkChanged: (callback: (data: { url: string }) => void) => () => void;
}
