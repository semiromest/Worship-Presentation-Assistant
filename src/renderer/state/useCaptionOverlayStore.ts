import { create } from 'zustand';
import {
  CAPTION_OVERLAY_STORAGE_KEY,
  DEFAULT_CAPTION_OVERLAY_CONFIG,
  parseCaptionOverlayConfig,
  type CaptionOverlayConfig,
} from '../captionOverlay';

function readStoredConfig(): CaptionOverlayConfig {
  try {
    return typeof localStorage === 'undefined'
      ? { ...DEFAULT_CAPTION_OVERLAY_CONFIG }
      : parseCaptionOverlayConfig(localStorage.getItem(CAPTION_OVERLAY_STORAGE_KEY));
  } catch {
    return { ...DEFAULT_CAPTION_OVERLAY_CONFIG };
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let pending: CaptionOverlayConfig | null = null;

/** Debounced so dragging a slider does not write storage (and wake the
 * projector window's storage listener) on every pixel. */
function scheduleSave(config: CaptionOverlayConfig) {
  pending = config;
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    const cfg = pending;
    saveTimer = null;
    pending = null;
    if (!cfg) return;
    try { localStorage.setItem(CAPTION_OVERLAY_STORAGE_KEY, JSON.stringify(cfg)); } catch { /* storage unavailable */ }
  }, 150);
}

interface CaptionOverlayStore {
  config: CaptionOverlayConfig;
  setCaptionOverlayConfig: (patch: Partial<CaptionOverlayConfig>) => void;
  resetCaptionOverlayStyle: () => void;
}

export const useCaptionOverlayStore = create<CaptionOverlayStore>((set, get) => {
  // The projector window shares this origin's storage: the `storage` event
  // carries settings changes from the main window to the live output.
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('storage', (event) => {
      if (event.key !== CAPTION_OVERLAY_STORAGE_KEY) return;
      const next = parseCaptionOverlayConfig(event.newValue);
      if (JSON.stringify(next) !== JSON.stringify(get().config)) set({ config: next });
    });
  }
  return {
    config: readStoredConfig(),
    setCaptionOverlayConfig: (patch) => {
      const next = { ...get().config, ...patch };
      set({ config: next });
      scheduleSave(next);
    },
    resetCaptionOverlayStyle: () => {
      const { enabled, source } = get().config;
      const next = { ...DEFAULT_CAPTION_OVERLAY_CONFIG, enabled, source };
      set({ config: next });
      scheduleSave(next);
    },
  };
});
