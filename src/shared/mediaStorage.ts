// Media storage housekeeping shared by the desktop app (userData/media on disk) and the
// web app (IndexedDB). Platforms list their stored files and the references they know of;
// this module decides what is unused. Pure: no Node, DOM or Electron imports.
import { isLiveSavePresetName } from './presetRetention';

export const GB = 1024 ** 3;
/** Media stored this recently is never removed: it may be about to be referenced. */
export const MEDIA_STORAGE_GRACE_MS = 10 * 60 * 1000;
export const MEDIA_LIMIT_OPTIONS = [0.5, 1, 2, 5, 10, 20, 50].map(gb => gb * GB);

export interface MediaStorageSettings {
  /** null/undefined: platform default. */
  limitBytes?: number | null;
  /** After "Not now", warn again only once stored media exceeds this. */
  snoozeUntilBytes?: number | null;
}

export interface MediaStorageReport {
  platform: 'desktop' | 'web';
  mediaBytes: number;
  mediaCount: number;
  limitBytes: number;
  limitIsDefault: boolean;
  limitOptions: number[];
  snoozeUntilBytes: number | null;
  /** The browser quota (web) or the disk (desktop) is nearly full. */
  nearCapacity: boolean;
  unused: { names: string[]; bytes: number };
  largest: { name: string; bytes: number; autosave: boolean }[];
  /** Desktop: free space on the disk that holds the media folder. */
  diskFree?: number | null;
  /** Web: browser storage estimate and whether it is persistent. */
  browser?: { usage: number | null; quota: number | null; persisted: boolean | null };
}

export interface StoredMedia { name: string; size: number; /** ms since epoch: stored or last touched. */ time: number }

const REF_RE = /(?:local-resource:\/\/media\/|wpa-media\/)([A-Za-z0-9_-]+\.[A-Za-z0-9]{1,10})/g;

/** Stored media names referenced by any string inside `value` (objects, arrays, Maps, Sets; cycles skipped). Never throws. */
export function collectMediaNames(value: unknown, into: Set<string> = new Set()): Set<string> {
  const seen = new WeakSet<object>();
  const pending: unknown[] = [value];
  while (pending.length) {
    const item = pending.pop();
    if (typeof item === 'string') {
      if (item.includes('local-resource://media/') || item.includes('wpa-media/')) for (const match of item.matchAll(REF_RE)) into.add(match[1]);
      continue;
    }
    if (!item || typeof item !== 'object' || seen.has(item)) continue;
    seen.add(item);
    if (item instanceof Map) { pending.push(...item.keys(), ...item.values()); continue; }
    if (item instanceof Set || Array.isArray(item)) { pending.push(...item); continue; }
    if (ArrayBuffer.isView(item) || item instanceof ArrayBuffer) continue;
    if (typeof Blob !== 'undefined' && item instanceof Blob) continue;
    for (const key of Object.keys(item)) pending.push((item as Record<string, unknown>)[key]);
  }
  return into;
}

export interface AnalyzeInput {
  platform: 'desktop' | 'web';
  media: StoredMedia[];
  referenced: Set<string>;
  presets: { name: string; presentation: unknown }[];
  settings: MediaStorageSettings;
  defaultLimit: number;
  /** Upper bound for the limit choices (quota or disk size), if known. */
  capacity?: number | null;
  nearCapacity: boolean;
  now?: number;
}

export function analyzeMediaStorage(input: AnalyzeInput): MediaStorageReport {
  const now = input.now ?? Date.now();
  const sizes = new Map(input.media.map(item => [item.name, item.size]));
  const unused = input.media
    .filter(item => !input.referenced.has(item.name) && now - item.time > MEDIA_STORAGE_GRACE_MS)
    .sort((a, b) => a.time - b.time);
  const largest = input.presets.map(preset => {
    const bytes = [...collectMediaNames(preset.presentation)].reduce((sum, name) => sum + (sizes.get(name) ?? 0), 0);
    const autosave = isLiveSavePresetName(preset.name);
    const title = autosave ? (preset.presentation as { name?: unknown } | null)?.name : preset.name;
    return { name: typeof title === 'string' && title ? title : preset.name, bytes, autosave };
  }).filter(item => item.bytes > 0).sort((a, b) => b.bytes - a.bytes).slice(0, 5);
  const limitBytes = input.settings.limitBytes || input.defaultLimit;
  const limitOptions = [...new Set([...MEDIA_LIMIT_OPTIONS, limitBytes])]
    .filter(value => value === limitBytes || !input.capacity || value <= input.capacity)
    .sort((a, b) => a - b);
  return {
    platform: input.platform,
    mediaBytes: input.media.reduce((sum, item) => sum + item.size, 0),
    mediaCount: input.media.length,
    limitBytes,
    limitIsDefault: !input.settings.limitBytes,
    limitOptions,
    snoozeUntilBytes: input.settings.snoozeUntilBytes ?? null,
    nearCapacity: input.nearCapacity,
    unused: { names: unused.map(item => item.name), bytes: unused.reduce((sum, item) => sum + item.size, 0) },
    largest,
  };
}

/** Names that may be deleted now: requested, still stored, and still unreferenced after a fresh scan. */
export function confirmRemovable(requested: string[], media: StoredMedia[], referenced: Set<string>, now = Date.now()): StoredMedia[] {
  const wanted = new Set(requested);
  return media.filter(item => wanted.has(item.name) && !referenced.has(item.name) && now - item.time > MEDIA_STORAGE_GRACE_MS);
}
