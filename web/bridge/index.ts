// Web implementation of `window.electronAPI` (src/shared/electronApi.ts). The
// desktop renderer runs unchanged on top of it; capabilities that still need a
// server or the Electron main process (PPTX import, captions, phone remote,
// music, updates) answer as unavailable for now.
import type { ElectronAPI } from '../../src/shared/electronApi';
import { emit, subscribe } from './events';
import { kvDelete, kvGet, kvSet } from './db';
import { chooseMedia, importFile, mediaAvailable, mediaKeyOf } from './media';
import { openProject, readTextFiles, saveProject } from './files';
import { confirmKey, confirmNative, alertNative, notify } from './dialogs';
import { deleteGradientLibrary, discardGradient, generateGradient, listGradientLibrary, saveGradient, saveGradientLibrary } from './gradients';
import { exportPptx } from './pptx';
import { readMediaFolder, selectMediaFolder, supportsFolders } from './folders';
import * as drive from './drive';
import * as storage from './storage';
import { IS_OUTPUT, closeOutput, downloadPolicyFile, defaultOutputOpen, getDisplays, notifyOutputReady, onOutputUpdate, openOutput, outputStatus, toggleOutput, updateOutputs } from './projector';
import { captureScreenFrame, getScreenSources, installScreenCaptureShim } from './screen';
import { prunePresetStore } from '../../src/shared/presetRetention';
import { supportAvailability, supportUrl, type SupportPlatform } from '../../src/shared/support';

const noop = () => {};
const none = async () => null;
const language = (): 'tr' | 'en' => (document.documentElement.lang || navigator.language).startsWith('tr') ? 'tr' : 'en';

// ─── presets (saved presentations inside the browser) ──────────────────────

type PresetItem = { name: string; presentation: unknown; createdAt: number };
const PRESETS = 'presets';
const readPresets = async (retentionMs?: number) => {
  const items = (await kvGet<PresetItem[]>(PRESETS)) ?? [];
  return prunePresetStore(items, Date.now(), typeof retentionMs === 'number' ? retentionMs : undefined);
};
// Writes are serialized so overlapping autosaves never drop each other's changes.
let presetQueue: Promise<unknown> = Promise.resolve();
function writePresets(update: (items: PresetItem[]) => PresetItem[], retentionMs?: number): Promise<PresetItem[]> {
  const task = presetQueue.then(async () => {
    const next = prunePresetStore(update((await kvGet<PresetItem[]>(PRESETS)) ?? []), Date.now(), typeof retentionMs === 'number' ? retentionMs : undefined);
    await kvSet(PRESETS, next);
    return next;
  });
  presetQueue = task.catch(() => {});
  return task;
}

// ─── imported libraries (Bible XML, hymn archives) ─────────────────────────

const bibleKey = (path: string) => `bible-xml:${path}`;
const hymnKey = (path: string) => `hymn-archive:${path}`;
const dataKey = (path: string) => `bible-data:${path}`;

const methods: Partial<Record<keyof ElectronAPI, unknown>> & Record<string, unknown> = {
  // app shell
  getPracticeInfo: async () => ({ mode: 'normal' }),
  getTourProfileInfo: async () => ({ profileKind: 'existing' }),
  getSupportAvailability: async () => supportAvailability(),
  openSupport: async (platform: SupportPlatform) => {
    const url = supportUrl(platform);
    if (!url) return false;
    window.open(url, '_blank', 'noopener,noreferrer');
    return true;
  },
  getOptimizationFlags: async () => ({ screenFrameCache: false }),
  getUpdaterInfo: async () => ({ version: 'Web', updaterActive: false }),
  checkForUpdates: async () => ({ ok: false }), downloadUpdate: async () => ({ ok: false }), installUpdate: async () => false,
  quitApp: async () => false,
  openPractice: async () => ({ ok: false }),
  showConfirmDialog: (options: Parameters<ElectronAPI['showConfirmDialog']>[0]) => confirmNative(options),
  showAlertDialog: (options: Parameters<ElectronAPI['showAlertDialog']>[0]) => alertNative(options),
  desktopReplaceChoice: async () => (await confirmKey('unsaved')) ? 'discard' : 'cancel',

  // projector outputs
  getDisplays,
  getProjectorOutputs: async () => outputStatus(),
  getProjectorStatus: async () => defaultOutputOpen(),
  toggleProjector: async (initialData?: unknown, displayId?: string) => toggleOutput(initialData, displayId),
  openProjector: async (displayId: string, initialData?: unknown) => openOutput(displayId, initialData),
  closeProjector: async (displayId: string) => closeOutput(displayId),
  updateProjector: async (data: unknown) => updateOutputs(data),
  notifyProjectorReady: IS_OUTPUT ? notifyOutputReady : noop,
  onProjectorUpdate: IS_OUTPUT ? onOutputUpdate : subscribe('projector-update'),
  onProjectorClosed: subscribe('projector-closed'),
  onProjectorReady: subscribe('projector-ready-ack'),
  onDisplaysChanged: subscribe('displays-changed'),
  onProjectorOutputStatus: subscribe('projector-output-status'),
  onRemoteAction: subscribe('remote-action'),

  // Settings > Presentation: Automatic Fullscreen setup file (web only)
  downloadFullscreenSetup: async () => { downloadPolicyFile(); return true; },

  // screen capture
  getScreenSources: async () => getScreenSources(language()),
  captureScreenSource: async () => captureScreenFrame(),

  // media
  selectMediaFile: async (kind: 'image' | 'video') => (await chooseMedia(kind))?.[0] ?? null,
  selectMediaFiles: (kind: 'image' | 'video') => chooseMedia(kind, true),
  selectMediaFilesAll: () => chooseMedia('all', true),
  selectAudioFile: async () => (await chooseMedia('audio'))?.[0] ?? null,
  getDroppedImagePath: async (file: File) => file?.type?.startsWith('image/') ? importFile(file) : null,
  getMediaThumbnail: async (source: string) => {
    if (/^data:image\//.test(source)) return source;
    const key = mediaKeyOf(source);
    return key && /\.(png|jpe?g|webp|gif|bmp|svg)$/.test(key) ? source : null;
  },
  checkMediaResources: async (urls: string[]) =>
    Object.fromEntries(await Promise.all((urls ?? []).map(async url => [url, await mediaAvailable(url)] as const))),
  cacheGoogleFont: async () => '',
  cleanupTempDir: async () => true,

  // projects
  saveFile: (content: string) => saveProject(content),
  openFile: () => openProject(),
  loadPresets: (retentionMs?: number) => readPresets(retentionMs),
  savePreset: (preset: { name: string; presentation: unknown; retentionMs?: number }) =>
    writePresets(items => [...items.filter(item => item.name !== preset.name), { name: preset.name, presentation: preset.presentation, createdAt: Date.now() }], preset.retentionMs),
  deletePreset: (name: string, retentionMs?: number) => writePresets(items => items.filter(item => item.name !== name), retentionMs),
  renamePreset: (oldName: string, newName: string, retentionMs?: number) =>
    writePresets(items => items.filter(item => item.name !== newName).map(item => item.name === oldName ? { ...item, name: newName } : item), retentionMs),
  // Leave the per-entry catalog API undefined so the renderer uses the list API above.
  listPresetEntries: undefined, getPresetEntry: undefined, getPresetPreview: undefined,
  savePresetEntry: undefined, deletePresetEntry: undefined, renamePresetEntry: undefined,

  // Bible and hymn libraries
  importBibleXml: async (filePath?: string) => {
    if (typeof filePath === 'string' && filePath) return (await kvGet<{ content: string; path: string }>(bibleKey(filePath))) ?? null;
    const [file] = await readTextFiles('.xml', false);
    if (!file) return null;
    const record = { content: file.content, path: file.name };
    await kvSet(bibleKey(file.name), record);
    return record;
  },
  saveBibleData: async (id: string, data: unknown) => {
    const path = `${String(id).replace(/[^a-zA-Z0-9_.-]/g, '_') || 'bible'}.json`;
    await kvSet(dataKey(path), JSON.stringify(data));
    return path;
  },
  readBibleData: async (path: string) => {
    const content = await kvGet<string>(dataKey(path));
    return typeof content === 'string' ? { content } : null;
  },
  deleteBibleData: async (path: string) => { await kvDelete(dataKey(path)); return true; },
  importHymnArchive: async (dirPath?: string) => {
    if (typeof dirPath === 'string' && dirPath) return (await kvGet<unknown>(hymnKey(dirPath))) ?? null;
    const files = await readTextFiles('.xml', true, true);
    if (!files.length) return null;
    const path = files[0].path.split('/')[0] || 'hymns';
    const record = { results: files.map(({ name, content }) => ({ name, content })), path };
    await kvSet(hymnKey(path), record);
    return record;
  },

  // generated backgrounds
  generateGradient, saveGradient, discardGradient,
  listGradientLibrary, saveGradientLibrary, deleteGradientLibrary,

  // PowerPoint (export only)
  exportPptx,
  selectPptxFile: async () => { await notify('pptxImport'); return null; },
  importPptx: none,

  // media folders (File System Access API; left undefined elsewhere so the UI hides them)
  ...(supportsFolders() ? { selectMediaFolder, readMediaFolder } : { selectMediaFolder: undefined, readMediaFolder: undefined }),

  // media storage housekeeping (warnings, dialogs and the Settings card live in the renderer)
  mediaStorageReport: storage.mediaStorageReport,
  mediaStorageRemove: storage.mediaStorageRemove,
  mediaStorageSettings: storage.mediaStorageSettings,
  mediaStorageRequestPersistence: storage.ensurePersistentStorage,
  onMediaStorageChanged: subscribe('media-storage-changed'),

  // Google Drive
  driveStatus: drive.driveStatus, driveSignIn: drive.driveSignIn, driveSignInCancel: drive.driveSignInCancel,
  driveSignOut: drive.driveSignOut, driveListFiles: drive.driveListFiles, driveUpload: drive.driveUpload,
  driveSavePresentation: drive.driveSavePresentation, driveDownload: drive.driveDownload, driveDeleteFile: drive.driveDeleteFile,
  warmOptionalService: async (service: string) => { if (service === 'drive') await drive.prepareDrive().catch(() => {}); },

  // still desktop-only (left undefined where the renderer checks for the capability)
  remoteStart: undefined, remoteResetPairing: undefined, remoteGetSettings: undefined, remoteSetAutoStart: undefined,
  sttGetStatus: async () => ({ hasKey: false, keyHint: null, sessionStatus: 'idle', sessionId: null, config: null }),
  getRemoteUrl: async () => '', getRemoteDebug: async () => ({}),
  publicTunnelStatus: async () => ({ active: false, url: '', state: 'idle' }),
  shareGetStatus: async () => ({ active: false, url: '', clientCount: 0 }),
  screenShareGetStatus: async () => ({ active: false, url: '', clientCount: 0 }),
  getPreviewDemand: async () => ({ all: false, indices: [] }),
  sharePublish: noop, screenShareFrame: noop, sttSendAudio: noop, appDialogsReady: noop, respondAppDialog: noop,
};

const bridge = new Proxy(methods, {
  get(target, key) {
    if (key === 'then' || typeof key !== 'string') return undefined;
    if (key in target) return target[key];
    if (key.startsWith('on')) return () => noop;
    return none;
  },
});

window.electronAPI = bridge as unknown as ElectronAPI;
installScreenCaptureShim();
// Load Google sign-in ahead of the click so its popup is not blocked.
if (!IS_OUTPUT && drive.driveConfigured()) void drive.prepareDrive().catch(() => {});
export { emit };
