import { create } from 'zustand';
import type { WatermarkConfig, Position } from '../types';
import {
  DEFAULT_WATERMARK_CONFIG,
  WATERMARK_STORAGE_KEY,
  WATERMARK_DEBOUNCE_MS,
} from '../constants';

const VALID_POSITIONS: Position[] = [
  'top-left',
  'top-center',
  'top-right',
  'bottom-left',
  'bottom-center',
  'bottom-right',
];

function isValidPosition(value: unknown): value is Position {
  return typeof value === 'string' && VALID_POSITIONS.includes(value as Position);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseWatermarkConfig(raw: string | null): WatermarkConfig {
  const fallback = { ...DEFAULT_WATERMARK_CONFIG };
  if (!raw) return fallback;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return fallback;
  }

  if (!isRecord(parsed)) return fallback;

  const logoDataUrl =
    typeof parsed.logoDataUrl === 'string' || parsed.logoDataUrl === null
      ? parsed.logoDataUrl
      : fallback.logoDataUrl;

  const position = isValidPosition(parsed.position) ? parsed.position : fallback.position;

  const size =
    typeof parsed.size === 'number' && Number.isFinite(parsed.size)
      ? Math.min(50, Math.max(1, Math.round(parsed.size)))
      : fallback.size;

  const opacity =
    typeof parsed.opacity === 'number' && Number.isFinite(parsed.opacity)
      ? Math.min(100, Math.max(0, Math.round(parsed.opacity)))
      : fallback.opacity;

  const applyToHymns =
    typeof parsed.applyToHymns === 'boolean' ? parsed.applyToHymns : fallback.applyToHymns;
  const applyToScriptures =
    typeof parsed.applyToScriptures === 'boolean'
      ? parsed.applyToScriptures
      : fallback.applyToScriptures;
  const enabled =
    typeof parsed.enabled === 'boolean' ? parsed.enabled : fallback.enabled;

  return {
    logoDataUrl,
    position,
    size,
    opacity,
    applyToHymns,
    applyToScriptures,
    enabled,
  };
}

function readStoredConfig(): WatermarkConfig {
  if (typeof localStorage === 'undefined') {
    return { ...DEFAULT_WATERMARK_CONFIG };
  }
  try {
    const raw = localStorage.getItem(WATERMARK_STORAGE_KEY);
    return parseWatermarkConfig(raw);
  } catch {
    return { ...DEFAULT_WATERMARK_CONFIG };
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let pendingConfig: WatermarkConfig | null = null;

function scheduleSave(config: WatermarkConfig) {
  pendingConfig = config;
  if (saveTimer) return;

  saveTimer = setTimeout(() => {
    const cfg = pendingConfig;
    saveTimer = null;
    pendingConfig = null;
    if (!cfg) return;
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(WATERMARK_STORAGE_KEY, JSON.stringify(cfg));
    } catch (err) {
      console.warn('Watermark: localStorage yazma başarısız', err);
    }
  }, WATERMARK_DEBOUNCE_MS);
}

interface WatermarkStore {
  config: WatermarkConfig;
  setWatermarkConfig: (patch: Partial<WatermarkConfig>) => void;
  setFullConfig: (config: WatermarkConfig) => void;
}

export const useWatermarkStore = create<WatermarkStore>((set, get) => {
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('storage', (event) => {
      if (event.key !== WATERMARK_STORAGE_KEY) return;
      const parsed = parseWatermarkConfig(event.newValue);
      const current = get().config;
      const changed =
        JSON.stringify(current) !== JSON.stringify(parsed);
      if (changed) {
        set({ config: parsed });
      }
    });
  }

  return {
    config: readStoredConfig(),
    setWatermarkConfig: (patch) => {
      const next: WatermarkConfig = { ...get().config, ...patch };
      set({ config: next });
      scheduleSave(next);
    },
    setFullConfig: (config) => {
      set({ config });
      scheduleSave(config);
    },
  };
});
