import type { ElectronAPI } from '../src/shared/electronApi';
import { language, sampleHymns, sampleImage, tr } from './samples';

export const noop = () => {};
export const noopAsync = async () => {};
const cancelled = async () => null;
const urls = new Set<string>();
export function chooseMedia(kind: 'image' | 'video' | 'all' = 'all', multiple = false): Promise<string[] | null> {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = kind === 'all' ? 'image/*,video/*' : `${kind}/*`; input.multiple = multiple;
    input.hidden = true; document.body.append(input);
    const finish = (value: string[] | null) => { input.remove(); resolve(value); };
    input.addEventListener('cancel', () => finish(null), { once: true });
    input.addEventListener('change', () => {
      const files = [...(input.files ?? [])].filter(file => kind === 'all' ? /^(image|video)\//.test(file.type) : file.type.startsWith(`${kind}/`));
      finish(files.length ? files.map(file => {
        const url = URL.createObjectURL(file); urls.add(url);
        // Keep a filename extension for the desktop media list's format detection.
        const named = `${url}#${encodeURIComponent(file.name)}`;
        return named;
      }) : null);
    }, { once: true });
    input.click();
  });
}

// This bridge contains no IPC, authentication, external requests or file-system writes.
const methods: Record<string, unknown> = {
  getPracticeInfo: async () => ({ mode: 'normal' }),
  getTourProfileInfo: async () => ({ profileKind: 'existing' }),
  getUpdaterInfo: async () => ({ version: 'Browser demo', updaterActive: false }),
  getDisplays: async () => [], getProjectorOutputs: async () => [], getProjectorStatus: async () => false,
  toggleProjector: async () => false, openProjector: async () => false, closeProjector: async () => false,
  getScreenSources: async () => [], captureScreenSource: cancelled,
  loadPresets: async () => [], savePreset: async () => [], deletePreset: async () => [], renamePreset: async () => [],
  selectMediaFile: async (kind: 'image' | 'video') => (await chooseMedia(kind))?.[0] ?? null,
  selectMediaFiles: (kind: 'image' | 'video') => chooseMedia(kind, true), selectMediaFilesAll: () => chooseMedia('all', true),
  getDroppedImagePath: async (file: File) => { if (!file.type.startsWith('image/')) return null; const url = URL.createObjectURL(file); urls.add(url); return url; },
  getMediaThumbnail: async (source: string) => /^(data:image|blob:)/.test(source) ? source : null,
  checkMediaResources: async (sources: string[]) => Object.fromEntries(sources.map(source => [source, /^(data:|blob:)/.test(source)])),
  cacheGoogleFont: async () => '',
  listGradientLibrary: async () => [], saveGradientLibrary: async () => [], deleteGradientLibrary: async () => [],
  saveFile: async () => '', openFile: cancelled, importBibleXml: cancelled, importHymnArchive: cancelled,
  selectPptxFile: cancelled, importPptx: cancelled, exportPptx: async () => ({ success: false, canceled: true }),
  generateGradient: async () => { throw new Error('Desktop-only feature'); },
  driveStatus: async () => ({ connected: false }), driveListFiles: async () => [],
  sttGetStatus: async () => ({ hasKey: false, keyHint: null, sessionStatus: 'idle', sessionId: null, config: null }),
  openPractice: async () => ({ ok: false }),
  getRemoteUrl: async () => '', getRemoteDebug: async () => ({}),
  publicTunnelStatus: async () => ({ active: false, url: '', state: 'idle' }),
  getPreviewDemand: async () => ({ all: false, indices: [] }),
  checkForUpdates: async () => ({ ok: false }), downloadUpdate: async () => ({ ok: false }), installUpdate: async () => false,
  showConfirmDialog: async () => false, showAlertDialog: noopAsync,
};
const bridge = new Proxy(methods, {
  get(target, key) {
    if (key === 'then') return undefined;
    if (typeof key !== 'string') return undefined;
    if (key in target) return target[key];
    if (key.startsWith('on')) return () => noop;
    return cancelled;
  },
});
window.electronAPI = bridge as unknown as ElectronAPI;

localStorage.setItem('i18nextLng', language);
localStorage.setItem('hymnsCache:v3:__online__', JSON.stringify(sampleHymns));
localStorage.removeItem('defaultHymnArchivePath');
localStorage.removeItem('defaultBibleXmlPath');
localStorage.removeItem('lastBibleSource');
localStorage.setItem('liveSaveEnabled', '0');
localStorage.setItem('uiSfxEnabled', '0');

window.addEventListener('pagehide', event => { if (!event.persisted) { urls.forEach(url => URL.revokeObjectURL(url)); urls.clear(); } });
export const demoMessage = tr ? 'Tarayıcı demosu · Slayt ve görünüm düzenlemeleri · Örnek ayetler anlam aktarımlarıdır' : 'Browser demo · Slide and appearance editing · Sample scripture uses illustrative paraphrases';
export const demoMedia = { id: 'demo-media-sample', name: 'demo-landscape.svg', path: sampleImage, preview: sampleImage, type: 'image' as const, origin: 'manual' as const };
