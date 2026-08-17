import { contextBridge, ipcRenderer } from 'electron';
import { PerfBuffer, estimatePayloadBytes, defaultPerfEnabled } from '../shared/perf';

// ─── Phase 0 perf instrumentation ───────────────────────────────────────────
// Times every invoke round-trip from the renderer's point of view and
// estimates request + response payload sizes (dev-only).

const preloadPerf = new PerfBuffer('preload');
preloadPerf.enabled = defaultPerfEnabled();

type AnyFn = (...args: any[]) => any;

function wrapApi(api: Record<string, AnyFn>): Record<string, AnyFn> {
  const wrapped: Record<string, AnyFn> = {};
  for (const [name, fn] of Object.entries(api)) {
    if (name.startsWith('on')) {
      // Event subscriptions return an unsubscribe function, not a promise.
      wrapped[name] = fn;
      continue;
    }
    if (!preloadPerf.enabled) {
      wrapped[name] = fn;
      continue;
    }
    wrapped[name] = async (...args: any[]) => {
      const reqBytes = estimatePayloadBytes(args);
      const t0 = performance.now();
      try {
        const result = await fn(...args);
        preloadPerf.push({
          kind: 'ipc-invoke',
          label: name,
          ms: performance.now() - t0,
          bytes: reqBytes + estimatePayloadBytes(result),
          t: Date.now(),
        });
        return result;
      } catch (err) {
        preloadPerf.push({ kind: 'ipc-invoke', label: name, ms: performance.now() - t0, bytes: reqBytes, t: Date.now() });
        throw err;
      }
    };
  }
  wrapped.getPerfSnapshot = () => preloadPerf.snapshot();
  wrapped.resetPerf = () => preloadPerf.reset();
  return wrapped;
}

contextBridge.exposeInMainWorld('electronAPI', wrapApi({
  // ... invoke calls (saveFile, openFile, etc.) unchanged ...
  saveFile: (content: string) => ipcRenderer.invoke('save-file', content),
  openFile: () => ipcRenderer.invoke('open-file'),
  loadPresets: (retentionMs?: number) => ipcRenderer.invoke('load-presets', retentionMs),
  savePreset: (preset: { name: string; presentation: any; retentionMs?: number }) => ipcRenderer.invoke('save-preset', preset),
  deletePreset: (name: string, retentionMs?: number) => ipcRenderer.invoke('delete-preset', name, retentionMs),
  renamePreset: (oldName: string, newName: string, retentionMs?: number) => ipcRenderer.invoke('rename-preset', oldName, newName, retentionMs),
  toggleProjector: (initialData?: any) => ipcRenderer.invoke('toggle-projector', initialData),
  updateProjector: (data: any) => ipcRenderer.invoke('update-projector', data),
  getProjectorStatus: () => ipcRenderer.invoke('get-projector-status'),
  importBibleXml: (filePath?: string) => ipcRenderer.invoke('import-bible-xml', filePath),
  saveBibleData: (id: string, data: unknown) => ipcRenderer.invoke('save-bible-data', id, data),
  readBibleData: (filePath: string) => ipcRenderer.invoke('read-bible-data', filePath),
  deleteBibleData: (filePath: string) => ipcRenderer.invoke('delete-bible-data', filePath),
  selectMediaFile: (type: 'image' | 'video') => ipcRenderer.invoke('select-media-file', type),
  selectMediaFilesAll: () => ipcRenderer.invoke('select-media-files-all'),
  importHymnArchive: (dirPath?: string) => ipcRenderer.invoke('import-hymn-archive', dirPath),
  selectPptxFile: () => ipcRenderer.invoke('select-pptx-file'),
  importPptx: (filePath: string) => ipcRenderer.invoke('import-pptx', filePath),
  exportPptx: (content: string) => ipcRenderer.invoke('export-pptx', content),
  getRemoteUrl: () => ipcRenderer.invoke('get-remote-url'),
  getRemoteDebug: () => ipcRenderer.invoke('get-remote-debug'),
  updateRemoteStatus: (status: any) => ipcRenderer.invoke('update-remote-status', status),
  quitApp: () => ipcRenderer.invoke('quit-app'),
  updateAllSlidePreviews: (previews: any) => ipcRenderer.invoke('update-all-slide-previews', previews),
  updateSlidePreviewsDelta: (updates: any) => ipcRenderer.invoke('update-slide-previews-delta', updates),
  sendSlidePreview: (dataUrl: string) => ipcRenderer.invoke('send-slide-preview', dataUrl),
  showConfirmDialog: (options: {
    message: string;
    title?: string;
    detail?: string;
    confirmLabel?: string;
    cancelLabel?: string;
  }) => ipcRenderer.invoke('show-confirm-dialog', options),
  showAlertDialog: (options: {
    message: string;
    title?: string;
    detail?: string;
    okLabel?: string;
  }) => ipcRenderer.invoke('show-alert-dialog', options),
  selectMediaFolder: () => ipcRenderer.invoke('select-media-folder'),
  readMediaFolder: (folderPath: string, options?: {
    recursive?: boolean;
    includeImages?: boolean;
    includeVideos?: boolean;
  }) => ipcRenderer.invoke('read-media-folder', folderPath, options),
  getScreenSources: () => ipcRenderer.invoke('get-screen-sources'),
  captureScreenSource: (sourceId: string) => ipcRenderer.invoke('capture-screen-source', sourceId),
  selectAudioFile: () => ipcRenderer.invoke('select-audio-file'),
  notifyProjectorReady: () => ipcRenderer.send('projector-ready'),
  cleanupTempDir: () => ipcRenderer.invoke('cleanup-temp-dir'),
  // ──────────────────────────────────────────────

  onRemoteAction: (callback: (data: any) => void) => {
    const subscription = (_event: any, data: any) => callback(data);
    ipcRenderer.on('remote-action', subscription);
    return () => ipcRenderer.removeListener('remote-action', subscription);
  },

  onProjectorUpdate: (callback: (data: any) => void) => {
    const subscription = (_event: any, data: any) => callback(data);
    ipcRenderer.on('projector-update', subscription);
    return () => ipcRenderer.removeListener('projector-update', subscription);
  },

  onProjectorClosed: (callback: () => void) => {
    const subscription = () => callback();
    ipcRenderer.on('projector-closed', subscription);
    return () => ipcRenderer.removeListener('projector-closed', subscription);
  },

  onProjectorReady: (callback: () => void) => {
    const subscription = () => callback();
    ipcRenderer.on('projector-ready-ack', subscription);
    return () => ipcRenderer.removeListener('projector-ready-ack', subscription);
  },

  onPptxImportProgress: (callback: (data: { current: number; total: number }) => void) => {
    const subscription = (_event: any, data: { current: number; total: number }) => callback(data);
    ipcRenderer.on('pptx-import-progress', subscription);
    return () => ipcRenderer.removeListener('pptx-import-progress', subscription);
  },

  onPptxExportProgress: (callback: (data: { current: number; total: number }) => void) => {
    const subscription = (_event: any, data: { current: number; total: number }) => callback(data);
    ipcRenderer.on('pptx-export-progress', subscription);
    return () => ipcRenderer.removeListener('pptx-export-progress', subscription);
  },

  // Google Drive

  driveSignIn: () => ipcRenderer.invoke('drive-sign-in'),
  driveSignOut: () => ipcRenderer.invoke('drive-sign-out'),
  driveStatus: () => ipcRenderer.invoke('drive-status'),
  driveListFiles: () => ipcRenderer.invoke('drive-list-files'),
  driveUpload: (name: string, content: string) => ipcRenderer.invoke('drive-upload', name, content),
  driveSavePresentation: (content: string, name?: string) => ipcRenderer.invoke('drive-save-presentation', content, name),
  driveDownload: (fileId: string) => ipcRenderer.invoke('drive-download', fileId),
  driveDeleteFile: (fileId: string) => ipcRenderer.invoke('drive-delete-file', fileId),

  // Updater

  getUpdaterInfo: () => ipcRenderer.invoke('updater:get-info'),
  checkForUpdates: () => ipcRenderer.invoke('updater:check'),
  downloadUpdate: () => ipcRenderer.invoke('updater:download'),
  installUpdate: () => ipcRenderer.invoke('updater:install'),

  onUpdaterEvent: (callback: (event: { type: string; payload?: any }) => void) => {
    const subscription = (_event: any, data: { type: string; payload?: any }) => callback(data);
    ipcRenderer.on('updater-event', subscription);
    return () => ipcRenderer.removeListener('updater-event', subscription);
  },
}));