import type { ElectronAPI } from '../shared/electronApi';
import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron';
import { PerfBuffer, estimatePayloadBytes, defaultPerfEnabled } from '../shared/perf';
import type { SttConfig } from '../shared/stt';
import type { SaveGradientLibraryInput } from '../shared/gradientLibrary';

// ─── Phase 0 perf instrumentation ───────────────────────────────────────────
// Times every invoke round-trip from the renderer's point of view and
// estimates request + response payload sizes (dev-only).

const preloadPerf = new PerfBuffer('preload');
preloadPerf.enabled = defaultPerfEnabled();

type AnyFn = (...args: any[]) => any;
type PerfMethods = Pick<ElectronAPI, 'getPerfSnapshot' | 'getPreloadPerfSnapshot' | 'resetPerf'>;

/** Promise döndürmeyen, `send` ile çalışan sık/ateşle-unut çağrılar: ölçülmez, sarılmaz. */
const FIRE_AND_FORGET: ReadonlySet<string> = new Set(['sttSendAudio', 'sharePublish', 'screenShareFrame', 'notifyProjectorReady']);
/** Abonelik fonksiyonları (`onXxx`) bir iptal fonksiyonu döndürür, Promise değil. */
const IS_SUBSCRIPTION = /^on[A-Z]/;
const DROPPABLE_IMAGE_RE = /\.(png|jpe?g|gif|webp|bmp)$/i;

function wrapApi<T extends Record<string, AnyFn>>(api: T): T & PerfMethods {
  const snapshot = () => preloadPerf.snapshot();
  const perfMethods: PerfMethods = {
    getPreloadPerfSnapshot: snapshot,
    getPerfSnapshot: snapshot,
    resetPerf: () => preloadPerf.reset(),
  };
  // Ölçüm kapalıyken (üretim) hiçbir çağrı sarılmaz: ek maliyet yok.
  if (!preloadPerf.enabled) return { ...api, ...perfMethods };

  const wrapped: Record<string, AnyFn> = {};
  for (const [name, fn] of Object.entries(api)) {
    if (IS_SUBSCRIPTION.test(name) || FIRE_AND_FORGET.has(name)) {
      wrapped[name] = fn;
      continue;
    }
    wrapped[name] = async (...args: any[]) => {
      const requestBytes = estimatePayloadBytes(args);
      const started = performance.now();
      let result: unknown;
      try {
        result = await fn(...args);
        return result;
      } finally {
        // Hata yolunda yalnızca istek boyutu sayılır (result tanımsız kalır).
        preloadPerf.push({
          kind: 'ipc-invoke',
          label: name,
          ms: performance.now() - started,
          bytes: requestBytes + (result === undefined ? 0 : estimatePayloadBytes(result)),
          t: Date.now(),
        });
      }
    };
  }
  return Object.assign(wrapped, perfMethods) as T & PerfMethods;
}

/** `ipcRenderer.on` aboneliği: geri çağırma yalnızca veriyi alır (Electron olayı renderer'a sızmaz). */
function subscribe<T = any>(channel: string) {
  return (callback: (data: T) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, data: T) => callback(data);
    ipcRenderer.on(channel, listener);
    return () => {
      ipcRenderer.removeListener(channel, listener);
    };
  };
}

const api = {
  // ── Perf ──
  getMainPerfSnapshot: () => ipcRenderer.invoke('perf:snapshot'),
  resetMainPerf: () => ipcRenderer.invoke('perf:reset'),

  // ── Gradient ──
  generateGradient: (recipe: unknown, regions: unknown) => ipcRenderer.invoke('gradient:generate', recipe, regions),
  saveGradient: (token: string) => ipcRenderer.invoke('gradient:save', token),
  discardGradient: () => ipcRenderer.invoke('gradient:discard'),
  listGradientLibrary: () => ipcRenderer.invoke('gradient-library:list'),
  saveGradientLibrary: (input: SaveGradientLibraryInput) => ipcRenderer.invoke('gradient-library:save', input),
  deleteGradientLibrary: (id: string) => ipcRenderer.invoke('gradient-library:remove', id),

  // ── Practice / tour ──
  onPracticeWorkspaceChanged: subscribe('practice:workspace-changed'),
  controlPracticeGuide: (id: string, step: string, action: string, input: unknown, label: string, destination?: string) =>
    ipcRenderer.invoke('practice:guide', id, step, action, input, label, destination),
  resumePracticeExercise: (id: string, deck: unknown) => ipcRenderer.invoke('practice:workspace:resume', id, deck),
  readPracticeWorkspace: (deck: unknown) => ipcRenderer.invoke('practice:workspace:read', deck),
  startPracticeExercise: (exercise: string, deck: unknown, label: string) =>
    ipcRenderer.invoke('practice:workspace:start', exercise, deck, label),
  observePracticeWorkspace: (id: string | null, deck: unknown) => ipcRenderer.invoke('practice:workspace:observe', id, deck),
  pausePracticeExercise: (id: string, skip = false) => ipcRenderer.invoke('practice:workspace:pause', id, skip),
  getPracticeInfo: () => ipcRenderer.invoke('practice:info'),
  getPracticeProgress: () => ipcRenderer.invoke('practice:progress'),
  openPractice: () => ipcRenderer.invoke('practice:open'),
  closePractice: (id?: string) => ipcRenderer.invoke('practice:close', id),
  onPracticeCloseRequested: (callback: () => void) => {
    const unsubscribe = subscribe<void>('practice:close-request')(callback);
    // Ana süreç, kapatma isteğini ancak renderer hazır olduğunu bildirdikten sonra iletir. Normal modda yetkisiz sayılır; hata yutulur.
    void ipcRenderer.invoke('practice:ready').catch(() => {});
    return unsubscribe;
  },
  getTourProfileInfo: () => ipcRenderer.invoke('tour:profile'),

  // ── Files / presets ──
  saveFile: (content: string) => ipcRenderer.invoke('save-file', content),
  openFile: () => ipcRenderer.invoke('open-file'),
  loadPresets: (retentionMs?: number) => ipcRenderer.invoke('load-presets', retentionMs),
  savePreset: (preset: { name: string; presentation: any; retentionMs?: number }) => ipcRenderer.invoke('save-preset', preset),
  deletePreset: (name: string, retentionMs?: number) => ipcRenderer.invoke('delete-preset', name, retentionMs),
  renamePreset: (oldName: string, newName: string, retentionMs?: number) =>
    ipcRenderer.invoke('rename-preset', oldName, newName, retentionMs),

  // ── Displays / projector ──
  getDisplays: () => ipcRenderer.invoke('get-displays'),
  getProjectorOutputs: () => ipcRenderer.invoke('get-projector-outputs'),
  toggleProjector: (initialData?: any, displayId?: string) => ipcRenderer.invoke('toggle-projector', initialData, displayId),
  openProjector: (displayId: string, initialData?: any) => ipcRenderer.invoke('open-projector', displayId, initialData),
  closeProjector: (displayId: string) => ipcRenderer.invoke('close-projector', displayId),
  updateProjector: (data: any) => ipcRenderer.invoke('update-projector', data),
  getProjectorStatus: () => ipcRenderer.invoke('get-projector-status'),
  notifyProjectorReady: (displayId?: string) => ipcRenderer.send('projector-ready', displayId),

  // ── Media / import / export ──
  checkMediaResources: (urls: string[]) => ipcRenderer.invoke('check-media-resources', urls),
  cacheGoogleFont: (family: string) => ipcRenderer.invoke('cache-google-font', family),
  importBibleXml: (filePath?: string) => ipcRenderer.invoke('import-bible-xml', filePath),
  saveBibleData: (id: string, data: unknown) => ipcRenderer.invoke('save-bible-data', id, data),
  readBibleData: (filePath: string) => ipcRenderer.invoke('read-bible-data', filePath),
  deleteBibleData: (filePath: string) => ipcRenderer.invoke('delete-bible-data', filePath),
  selectMediaFile: (type: 'image' | 'video') => ipcRenderer.invoke('select-media-file', type),
  getDroppedImagePath: async (file: File) => {
    try {
      const filePath = webUtils.getPathForFile(file);
      return DROPPABLE_IMAGE_RE.test(filePath) ? filePath : null;
    } catch {
      return null; // File olmayan nesne ya da diskte karşılığı olmayan dosya
    }
  },
  selectMediaFilesAll: () => ipcRenderer.invoke('select-media-files-all'),
  importHymnArchive: (dirPath?: string) => ipcRenderer.invoke('import-hymn-archive', dirPath),
  selectPptxFile: () => ipcRenderer.invoke('select-pptx-file'),
  importPptx: (filePath: string) => ipcRenderer.invoke('import-pptx', filePath),
  exportPptx: (content: string) => ipcRenderer.invoke('export-pptx', content),
  selectMediaFolder: () => ipcRenderer.invoke('select-media-folder'),
  readMediaFolder: (folderPath: string, options?: { recursive?: boolean; includeImages?: boolean; includeVideos?: boolean }) =>
    ipcRenderer.invoke('read-media-folder', folderPath, options),
  getMediaThumbnail: (filePath: string, maxEdge: number) => ipcRenderer.invoke('media:getThumbnail', filePath, maxEdge),
  getScreenSources: () => ipcRenderer.invoke('get-screen-sources'),
  captureScreenSource: (sourceId: string) => ipcRenderer.invoke('capture-screen-source', sourceId),
  selectAudioFolder: () => ipcRenderer.invoke('select-audio-folder'),
  readAudioFolder: (folderPath: string, recursive = true) => ipcRenderer.invoke('read-audio-folder', folderPath, recursive),
  selectAudioFile: () => ipcRenderer.invoke('select-audio-file'),
  cleanupTempDir: () => ipcRenderer.invoke('cleanup-temp-dir'),
  generateThumbnail: (slide: any) => ipcRenderer.invoke('generate-thumbnail', slide),

  // ── Remote control / previews / tunnel / diagnostics ──
  getRemoteUrl: () => ipcRenderer.invoke('get-remote-url'),
  publicTunnelStart: () => ipcRenderer.invoke('public-tunnel:start'),
  publicTunnelStop: () => ipcRenderer.invoke('public-tunnel:stop'),
  publicTunnelStatus: () => ipcRenderer.invoke('public-tunnel:status'),
  getRemoteDebug: () => ipcRenderer.invoke('get-remote-debug'),
  getRemoteDiagnostics: () => ipcRenderer.invoke('get-remote-diagnostics'),
  updateRemoteStatus: (status: any) => ipcRenderer.invoke('update-remote-status', status),
  updateAllSlidePreviews: (previews: any) => ipcRenderer.invoke('update-all-slide-previews', previews),
  updateSlidePreviewsDelta: (updates: any) => ipcRenderer.invoke('update-slide-previews-delta', updates),
  sendSlidePreview: (dataUrl: string) => ipcRenderer.invoke('send-slide-preview', dataUrl),
  sendRemoteNotice: (notice: { text: string; tone?: 'ok' | 'error' }) => ipcRenderer.invoke('send-remote-notice', notice),

  // ── App / dialogs ──
  quitApp: () => ipcRenderer.invoke('quit-app'),
  showConfirmDialog: (options: { message: string; title?: string; detail?: string; confirmLabel?: string; cancelLabel?: string }) =>
    ipcRenderer.invoke('show-confirm-dialog', options),
  showAlertDialog: (options: { message: string; title?: string; detail?: string; okLabel?: string }) =>
    ipcRenderer.invoke('show-alert-dialog', options),

  // ── YouTube music ──
  youtubeMusicSearch: (query: string, cursor?: string) => ipcRenderer.invoke('youtube-music:search', query, cursor),
  youtubeMusicPlay: (id: string) => ipcRenderer.invoke('youtube-music:play', id),
  youtubeMusicPrepare: (id: string) => ipcRenderer.invoke('youtube-music:prepare', id),
  youtubeMusicOfflineStatus: (id: string) => ipcRenderer.invoke('youtube-music:offline-status', id),
  youtubeMusicDownload: (id: string) => ipcRenderer.invoke('youtube-music:download', id),
  youtubeMusicCancelDownload: (id: string) => ipcRenderer.invoke('youtube-music:cancel-download', id),
  youtubeMusicStop: (streamId?: string) => ipcRenderer.invoke('youtube-music:stop', streamId),

  // ── Events from the main process ──
  onRemoteAction: subscribe('remote-action'),
  onProjectorUpdate: subscribe('projector-update'),
  onProjectorClosed: subscribe<{ displayId?: string } | undefined>('projector-closed'),
  onProjectorReady: subscribe<{ displayId?: string } | undefined>('projector-ready-ack'),
  onDisplaysChanged: subscribe<any[]>('displays-changed'),
  onProjectorOutputStatus: subscribe<any[]>('projector-output-status'),
  onPublicTunnelStatus: subscribe('public-tunnel:status'),
  onRemoteUrlChanged: subscribe<{ url: string }>('remote-url-changed'),
  onPptxImportProgress: subscribe<{ current: number; total: number }>('pptx-import-progress'),
  onPptxExportProgress: subscribe<{ current: number; total: number }>('pptx-export-progress'),

  // ── Google Drive ──
  driveSignIn: () => ipcRenderer.invoke('drive-sign-in'),
  driveSignInCancel: () => ipcRenderer.invoke('drive-sign-in-cancel'),
  driveSignOut: () => ipcRenderer.invoke('drive-sign-out'),
  driveStatus: () => ipcRenderer.invoke('drive-status'),
  driveListFiles: () => ipcRenderer.invoke('drive-list-files'),
  driveUpload: (name: string, content: string) => ipcRenderer.invoke('drive-upload', name, content),
  driveSavePresentation: (content: string, name?: string) => ipcRenderer.invoke('drive-save-presentation', content, name),
  driveDownload: (fileId: string) => ipcRenderer.invoke('drive-download', fileId),
  driveDeleteFile: (fileId: string) => ipcRenderer.invoke('drive-delete-file', fileId),

  // ── Updater ──
  getUpdaterInfo: () => ipcRenderer.invoke('updater:get-info'),
  checkForUpdates: () => ipcRenderer.invoke('updater:check'),
  downloadUpdate: () => ipcRenderer.invoke('updater:download'),
  installUpdate: () => ipcRenderer.invoke('updater:install'),
  onUpdaterEvent: subscribe<{ type: string; payload?: any }>('updater-event'),

  // ── Soniox real-time STT + translation ──
  sttGetStatus: () => ipcRenderer.invoke('stt:get-status'),
  sttDeleteApiKey: () => ipcRenderer.invoke('stt:delete-api-key'),
  openSonioxWebsite: () => ipcRenderer.invoke('soniox:open-website'),
  sttSetApiKey: (key: string) => ipcRenderer.invoke('stt:set-api-key', key),
  sttStart: (config: SttConfig) => ipcRenderer.invoke('stt:start', config),
  sttSendAudio: (chunk: ArrayBuffer | Uint8Array) => ipcRenderer.send('stt:audio', chunk),
  sttStop: () => ipcRenderer.invoke('stt:stop'),
  sttClear: () => ipcRenderer.invoke('stt:clear'),
  onSttEvent: subscribe('stt:event'),

  // ── Phone captions/translation share ──
  shareStart: (subdomain?: string) => ipcRenderer.invoke('share:start', subdomain),
  shareStop: () => ipcRenderer.invoke('share:stop'),
  sharePublish: (snapshot: any) => ipcRenderer.send('share:publish', snapshot),
  shareGetStatus: () => ipcRenderer.invoke('share:get-status'),
  onShareClientCount: subscribe<number>('share:client-count'),
  onShareNetworkChanged: subscribe<{ url: string }>('share:network-changed'),

  // ── Live-screen phone broadcast ──
  screenShareStart: () => ipcRenderer.invoke('screen-share:start'),
  screenShareStop: () => ipcRenderer.invoke('screen-share:stop'),
  screenShareFrame: (frame: string) => ipcRenderer.send('screen-share:frame', frame),
  screenShareGetStatus: () => ipcRenderer.invoke('screen-share:get-status'),
  onScreenShareClientCount: subscribe<number>('screen-share:client-count'),
  onScreenShareNetworkChanged: subscribe<{ url: string }>('screen-share:network-changed'),
} satisfies Omit<ElectronAPI, keyof PerfMethods>;

contextBridge.exposeInMainWorld('electronAPI', wrapApi(api));