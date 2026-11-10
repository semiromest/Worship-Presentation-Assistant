// Web side of media storage housekeeping (see src/shared/mediaStorage.ts and
// src/renderer/mediaStorage.ts, which own the warning, the dialogs and the Settings card).
// Media lives in IndexedDB; the first save asks the browser for persistent storage.
import { analyzeMediaStorage, collectMediaNames, confirmRemovable, GB, type MediaStorageReport, type MediaStorageSettings, type StoredMedia } from '../../src/shared/mediaStorage';
import { kvEntries, kvGet, kvSet, mediaDelete, mediaList } from './db';
import { emit } from './events';

const SETTINGS = 'storage-settings';
const DEFAULT_LIMIT = 2 * GB;
/** kv entries that hold no media references (large text, or the folder file index). */
const SKIP_KV = /^(bible-xml:|bible-data:|hymn-archive:|media-folder-index$|storage-settings$)/;

let persistAsked = false;
/** Asks once per session; Chrome decides silently, Firefox may show a prompt. */
export async function ensurePersistentStorage(): Promise<boolean | null> {
  if (!navigator.storage?.persisted) return null;
  if (await navigator.storage.persisted()) return true;
  if (persistAsked) return false;
  persistAsked = true;
  try { return await navigator.storage.persist(); } catch { return false; }
}

/** Tells the renderer's storage monitor that new media was stored. */
export const mediaStored = () => emit('media-storage-changed');

async function storedMedia(): Promise<StoredMedia[]> {
  return (await mediaList()).map(record => ({ name: record.key, size: record.size, time: record.addedAt }));
}

async function referencedNames(rendererNames: unknown): Promise<Set<string>> {
  if (!Array.isArray(rendererNames) || rendererNames.some(name => typeof name !== 'string')) throw new Error('Invalid media references');
  const names = new Set<string>(rendererNames as string[]);
  for (const [, value] of await kvEntries(key => !SKIP_KV.test(key))) collectMediaNames(value, names);
  return names;
}

async function readSettings(): Promise<MediaStorageSettings> {
  return (await kvGet<MediaStorageSettings>(SETTINGS)) ?? {};
}

export async function mediaStorageSettings(patch: MediaStorageSettings): Promise<void> {
  const next = { ...(await readSettings()) };
  if ('limitBytes' in patch) { next.limitBytes = patch.limitBytes ?? null; next.snoozeUntilBytes = null; }
  if ('snoozeUntilBytes' in patch) next.snoozeUntilBytes = patch.snoozeUntilBytes ?? null;
  await kvSet(SETTINGS, next);
}

export async function mediaStorageReport(rendererNames: unknown): Promise<MediaStorageReport> {
  const [media, referenced, settings, presets, estimate, persisted] = await Promise.all([
    storedMedia(),
    referencedNames(rendererNames),
    readSettings(),
    kvGet<{ name: string; presentation: unknown }[]>('presets'),
    navigator.storage?.estimate?.().catch(() => null) ?? Promise.resolve(null),
    navigator.storage?.persisted?.().catch(() => null) ?? Promise.resolve(null),
  ]);
  const quota = estimate?.quota ?? null;
  const usage = estimate?.usage ?? null;
  return {
    ...analyzeMediaStorage({
      platform: 'web',
      media,
      referenced,
      presets: presets ?? [],
      settings,
      defaultLimit: quota ? Math.min(DEFAULT_LIMIT, Math.floor(quota * 0.7)) : DEFAULT_LIMIT,
      capacity: quota,
      nearCapacity: !!(quota && usage && usage > quota * 0.85),
    }),
    browser: { usage, quota, persisted },
  };
}

export async function mediaStorageRemove(names: unknown, rendererNames: unknown): Promise<{ count: number; bytes: number }> {
  if (!Array.isArray(names) || names.some(name => typeof name !== 'string')) throw new Error('Invalid media names');
  const [media, referenced] = await Promise.all([storedMedia(), referencedNames(rendererNames)]);
  const doomed = confirmRemovable(names as string[], media, referenced);
  await mediaDelete(doomed.map(item => item.name));
  // Folder scans recognise unchanged files by this index; forget entries whose media is gone.
  const index = await kvGet<Record<string, string>>('media-folder-index');
  if (index) {
    const gone = new Set(doomed.map(item => item.name));
    let changed = false;
    for (const [signature, url] of Object.entries(index)) {
      const [name] = collectMediaNames(url);
      if (name && gone.has(name)) { delete index[signature]; changed = true; }
    }
    if (changed) await kvSet('media-folder-index', index);
  }
  return { count: doomed.length, bytes: doomed.reduce((sum, item) => sum + item.size, 0) };
}
