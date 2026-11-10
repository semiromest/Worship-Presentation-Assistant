/**
 * Desktop media storage housekeeping. userData/media holds the app's own copies:
 * media extracted from opened .gpres files, generated gradients, PowerPoint imports
 * and externalized inline images. The user's own picked files are referenced in place
 * and never live here, so they are never touched.
 *
 * Only files that nothing refers to are deleted, and only after the user agreed in the
 * renderer: saved presentations and autosaves (presets/), the gradient library and the
 * renderer's own state (sent with each call) are all checked again right before deletion.
 *
 * Pure Node (no electron import) so it can be tested with tsx.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { analyzeMediaStorage, collectMediaNames, confirmRemovable, GB, type MediaStorageReport, type MediaStorageSettings, type StoredMedia } from '../shared/mediaStorage';

/** Content-addressed library names written by mediaLibrary.ts / gpresReader.ts. */
const LIBRARY_NAME = /^[A-Za-z0-9_-]+\.[A-Za-z0-9]{1,10}$/;
const DEFAULT_LIMIT = 5 * GB;
const LOW_DISK = 1 * GB;
const MAX_REFERENCES = 200_000;

export interface MediaStorageDeps {
  mediaDir: string;
  userData: string;
  /** Every saved presentation and autosave, without pruning. */
  readPresets: () => Promise<{ name: string; presentation: unknown }[]>;
}

const settingsFile = (deps: MediaStorageDeps) => path.join(deps.userData, 'media-storage.json');

async function readSettings(deps: MediaStorageDeps): Promise<MediaStorageSettings> {
  try {
    const value = JSON.parse(await fs.readFile(settingsFile(deps), 'utf8'));
    return {
      limitBytes: Number.isFinite(value?.limitBytes) && value.limitBytes > 0 ? value.limitBytes : null,
      snoozeUntilBytes: Number.isFinite(value?.snoozeUntilBytes) && value.snoozeUntilBytes > 0 ? value.snoozeUntilBytes : null,
    };
  } catch {
    return {};
  }
}

export async function updateMediaStorageSettings(deps: MediaStorageDeps, patch: MediaStorageSettings): Promise<void> {
  const next = { ...(await readSettings(deps)) };
  if ('limitBytes' in patch) { next.limitBytes = patch.limitBytes ?? null; next.snoozeUntilBytes = null; }
  if ('snoozeUntilBytes' in patch) next.snoozeUntilBytes = patch.snoozeUntilBytes ?? null;
  const target = settingsFile(deps);
  const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temp, JSON.stringify(next));
  await fs.rename(temp, target);
}

/** Files directly in the media folder (staging subfolders and temp files are skipped). */
async function listMedia(mediaDir: string): Promise<StoredMedia[]> {
  let entries: import('node:fs').Dirent[];
  try { entries = await fs.readdir(mediaDir, { withFileTypes: true }); } catch { return []; }
  const files = entries.filter(entry => entry.isFile() && LIBRARY_NAME.test(entry.name));
  const stats = await Promise.all(files.map(async entry => {
    try {
      const stat = await fs.stat(path.join(mediaDir, entry.name));
      // Every way a file enters the library (write, hard link, rename) sets a fresh mtime, and
      // gpresReader refreshes it when an opened document reuses an existing file.
      return { name: entry.name, size: stat.size, time: stat.mtimeMs };
    } catch { return null; }
  }));
  return stats.filter((item): item is StoredMedia => !!item);
}

async function readJson(file: string): Promise<unknown> {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return null; }
}

/** References known to the main process plus those the renderer sent. Throws if presets cannot be read. */
async function referencedNames(deps: MediaStorageDeps, rendererNames: unknown): Promise<{ names: Set<string>; presets: { name: string; presentation: unknown }[] }> {
  if (!Array.isArray(rendererNames) || rendererNames.length > MAX_REFERENCES || rendererNames.some(name => typeof name !== 'string')) {
    throw new Error('Invalid media references');
  }
  const names = new Set<string>(rendererNames as string[]);
  const presets = await deps.readPresets();
  collectMediaNames(presets, names);
  collectMediaNames(await readJson(path.join(deps.userData, 'gradient-library.json')), names);
  return { names, presets };
}

async function diskFree(dir: string): Promise<{ free: number | null; total: number | null }> {
  try {
    await fs.mkdir(dir, { recursive: true });
    const stat = await fs.statfs(dir);
    return { free: stat.bavail * stat.bsize, total: stat.blocks * stat.bsize };
  } catch {
    return { free: null, total: null };
  }
}

export async function mediaStorageReport(deps: MediaStorageDeps, rendererNames: unknown): Promise<MediaStorageReport> {
  const [media, references, settings, disk] = await Promise.all([
    listMedia(deps.mediaDir),
    referencedNames(deps, rendererNames),
    readSettings(deps),
    diskFree(deps.mediaDir),
  ]);
  return {
    ...analyzeMediaStorage({
      platform: 'desktop',
      media,
      referenced: references.names,
      presets: references.presets,
      settings,
      defaultLimit: DEFAULT_LIMIT,
      capacity: disk.total,
      nearCapacity: disk.free !== null && disk.free < LOW_DISK,
    }),
    diskFree: disk.free,
  };
}

export async function removeUnusedMedia(deps: MediaStorageDeps, requested: unknown, rendererNames: unknown): Promise<{ count: number; bytes: number }> {
  if (!Array.isArray(requested) || requested.some(name => typeof name !== 'string' || !LIBRARY_NAME.test(name))) throw new Error('Invalid media names');
  const [media, references] = await Promise.all([listMedia(deps.mediaDir), referencedNames(deps, rendererNames)]);
  let count = 0, bytes = 0;
  for (const item of confirmRemovable(requested as string[], media, references.names)) {
    try {
      await fs.rm(path.join(deps.mediaDir, item.name));
      count++;
      bytes += item.size;
    } catch { /* locked or already gone: leave it */ }
  }
  return { count, bytes };
}
