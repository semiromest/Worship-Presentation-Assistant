import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  // ... invoke işlemleri (saveFile, openFile vb.) aynı kalacak ...
  saveFile: (content: string) => ipcRenderer.invoke('save-file', content),
  openFile: () => ipcRenderer.invoke('open-file'),
  loadPresets: () => ipcRenderer.invoke('load-presets'),
  savePreset: (preset: { name: string; presentation: any }) => ipcRenderer.invoke('save-preset', preset),
  deletePreset: (name: string) => ipcRenderer.invoke('delete-preset', name),
  renamePreset: (oldName: string, newName: string) => ipcRenderer.invoke('rename-preset', oldName, newName),
  toggleProjector: (initialData?: any) => ipcRenderer.invoke('toggle-projector', initialData),
  updateProjector: (data: any) => ipcRenderer.invoke('update-projector', data),
  getProjectorStatus: () => ipcRenderer.invoke('get-projector-status'),
  importBibleXml: (filePath?: string) => ipcRenderer.invoke('import-bible-xml', filePath),
  selectMediaFile: (type: 'image' | 'video') => ipcRenderer.invoke('select-media-file', type),
  selectMediaFilesAll: () => ipcRenderer.invoke('select-media-files-all'),
  importHymnArchive: (dirPath?: string) => ipcRenderer.invoke('import-hymn-archive', dirPath),
  selectPptxFile: () => ipcRenderer.invoke('select-pptx-file'),
  importPptx: (filePath: string) => ipcRenderer.invoke('import-pptx', filePath),
  getRemoteUrl: () => ipcRenderer.invoke('get-remote-url'),
  getRemoteDebug: () => ipcRenderer.invoke('get-remote-debug'),
  updateRemoteStatus: (status: any) => ipcRenderer.invoke('update-remote-status', status),
  quitApp: () => ipcRenderer.invoke('quit-app'),
  updateAllSlidePreviews: (previews: any) => ipcRenderer.invoke('update-all-slide-previews', previews),
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
  readMediaFolder: (folderPath: string) => ipcRenderer.invoke('read-media-folder', folderPath),
  getScreenSources: () => ipcRenderer.invoke('get-screen-sources'),
  captureScreenSource: (sourceId: string) => ipcRenderer.invoke('capture-screen-source', sourceId),
  selectAudioFile: () => ipcRenderer.invoke('select-audio-file'),
  notifyProjectorReady: () => ipcRenderer.send('projector-ready'),
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

  onPptxImportProgress: (callback: (data: { current: number; total: number }) => void) => {
    const subscription = (_event: any, data: { current: number; total: number }) => callback(data);
    ipcRenderer.on('pptx-import-progress', subscription);
    return () => ipcRenderer.removeListener('pptx-import-progress', subscription);
  },
});