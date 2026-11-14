import { create } from 'zustand';
import {
  DEFAULT_LIVE_OVERLAYS,
  LIVE_OVERLAY_STORAGE_KEY,
  parseLiveOverlays,
  type LiveOverlayState,
  type SpeakerOverlay,
  type TickerOverlay,
} from '../liveOverlays';

function readStored(): LiveOverlayState {
  try {
    return typeof localStorage === 'undefined'
      ? structuredClone(DEFAULT_LIVE_OVERLAYS)
      : parseLiveOverlays(localStorage.getItem(LIVE_OVERLAY_STORAGE_KEY));
  } catch {
    return structuredClone(DEFAULT_LIVE_OVERLAYS);
  }
}

// Written immediately (no debounce): going on/off air must reach the output at once.
function save(state: LiveOverlayState) {
  try { localStorage.setItem(LIVE_OVERLAY_STORAGE_KEY, JSON.stringify(state)); } catch { /* storage unavailable */ }
}

interface LiveOverlayStore extends LiveOverlayState {
  setTicker: (patch: Partial<TickerOverlay>) => void;
  setSpeaker: (patch: Partial<SpeakerOverlay>) => void;
  clearAll: () => void;
  /** Main window start-up: nothing stays on air from a previous run. */
  takeAllOffAir: () => void;
}

export const useLiveOverlayStore = create<LiveOverlayStore>((set, get) => {
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('storage', (event) => {
      if (event.key !== LIVE_OVERLAY_STORAGE_KEY) return;
      const next = parseLiveOverlays(event.newValue);
      const { ticker, speaker } = get();
      if (JSON.stringify(next) !== JSON.stringify({ ticker, speaker })) set(next);
    });
  }
  const commit = (next: LiveOverlayState) => { set(next); save(next); };
  return {
    ...readStored(),
    setTicker: (patch) => { const { ticker, speaker } = get(); commit({ ticker: { ...ticker, ...patch }, speaker }); },
    setSpeaker: (patch) => { const { ticker, speaker } = get(); commit({ ticker, speaker: { ...speaker, ...patch } }); },
    clearAll: () => { const { ticker, speaker } = get(); commit({ ticker: { ...ticker, onAir: false }, speaker: { ...speaker, onAir: false } }); },
    takeAllOffAir: () => {
      const { ticker, speaker } = get();
      if (ticker.onAir || speaker.onAir) commit({ ticker: { ...ticker, onAir: false }, speaker: { ...speaker, onAir: false } });
    },
  };
});
