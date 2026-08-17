/**
 * Preset store (Phase 5): one JSON file per preset under userData/presets/
 * (<base64url(name)>.json), so an autosave rewrites ONLY the changed preset
 * instead of the whole store. Atomic per-file writes (temp + rename).
 *
 * The legacy single-file userData/presets.json is migrated on first load and
 * then removed; a crash mid-migration is recovered by merging any entries
 * that never got their own file (never destructive).
 *
 * Pure Node module (no electron import) so it can be unit-tested with tsx.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { PerfBuffer, measureSync, measureAsync, defaultPerfEnabled } from '../shared/perf';

export type PresetItem = { name: string; presentation: unknown; createdAt: number };

export const DEFAULT_LIVE_SAVE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export function isLiveSavePresetName(name: string): boolean {
  return name === '__live_autosave__' || (name.startsWith('__live_autosave_') && name.endsWith('__'));
}

export function getLiveSaveBaseKey(name: string): string {
  if (!isLiveSavePresetName(name)) return name;
  return name.replace(/^__live_autosave_/, '').replace(/__$/, '');
}

export function prunePresetStore(
  list: PresetItem[],
  now = Date.now(),
  retentionMs = DEFAULT_LIVE_SAVE_RETENTION_MS,
): PresetItem[] {
  const regular: PresetItem[] = [];
  const latestLiveByEntry = new Map<string, PresetItem>();

  for (const item of list) {
    if (!isLiveSavePresetName(item.name)) {
      regular.push(item);
      continue;
    }

    // retentionMs <= 0 means "keep forever" — only age-prune when > 0.
    if (retentionMs > 0) {
      const age = now - item.createdAt;
      if (age > retentionMs) continue;
    }

    const key = getLiveSaveBaseKey(item.name);
    const current = latestLiveByEntry.get(key);
    if (!current || item.createdAt > current.createdAt) {
      latestLiveByEntry.set(key, item);
    }
  }

  return [...regular, ...Array.from(latestLiveByEntry.values())].sort((a, b) => b.createdAt - a.createdAt);
}

const presetFileName = (name: string): string =>
  Buffer.from(name, 'utf-8').toString('base64url') + '.json';

/** Inverse of presetFileName(); null when the file is not a preset payload. */
const presetNameFromFile = (file: string): string | null => {
  if (!file.endsWith('.json')) return null;
  try { return Buffer.from(file.slice(0, -'.json'.length), 'base64url').toString('utf-8'); }
  catch { return null; }
};

export interface PresetStore {
  readPresets: (retentionMs?: number) => Promise<PresetItem[]>;
  savePreset: (preset: { name: string; presentation: unknown; retentionMs?: number }) => Promise<PresetItem[]>;
  deletePreset: (name: string, retentionMs?: number) => Promise<PresetItem[]>;
  renamePreset: (oldName: string, newName: string, retentionMs?: number) => Promise<PresetItem[]>;
}

export function createPresetStore(userDataDir: string, perf?: PerfBuffer): PresetStore {
  const PRESETS_FILE = path.join(userDataDir, 'presets.json');
  const PRESETS_DIR = path.join(userDataDir, 'presets');
  const buf = perf ?? (() => { const b = new PerfBuffer('main'); b.enabled = defaultPerfEnabled(); return b; })();

  let cache: PresetItem[] | null = null;

  /** Atomic single-preset write (temp + rename preserves crash safety). */
  async function persistPresetFile(item: PresetItem): Promise<void> {
    await fs.mkdir(PRESETS_DIR, { recursive: true });
    const file = path.join(PRESETS_DIR, presetFileName(item.name));
    const tempFile = `${file}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
    const serialized = measureSync(buf, 'stringify', 'preset-file', () => JSON.stringify(item));
    await measureAsync(buf, 'fs', 'writePreset-temp', () => fs.writeFile(tempFile, serialized, 'utf-8'));
    await measureAsync(buf, 'fs', 'writePreset-rename', () => fs.rename(tempFile, file));
  }

  /** Deletes per-preset files whose entries are no longer in the store (prune GC). */
  async function deleteStalePresetFiles(store: PresetItem[]): Promise<void> {
    let files: string[];
    try { files = await fs.readdir(PRESETS_DIR); } catch { return; }
    const keep = new Set(store.map((p) => presetFileName(p.name)));
    await Promise.all(files.map(async (f) => {
      if (!keep.has(f)) {
        try { await fs.rm(path.join(PRESETS_DIR, f), { force: true }); } catch { /* best-effort */ }
      }
    }));
  }

  async function readPresetFiles(): Promise<PresetItem[]> {
    let files: string[];
    try { files = await fs.readdir(PRESETS_DIR); } catch { return []; }
    const items: PresetItem[] = [];
    await Promise.all(files.map(async (f) => {
      const name = presetNameFromFile(f);
      if (!name) return;
      try {
        const parsed = JSON.parse(await fs.readFile(path.join(PRESETS_DIR, f), 'utf-8'));
        if (parsed && typeof parsed.name === 'string' && parsed.presentation) {
          items.push({
            name: parsed.name,
            presentation: parsed.presentation,
            createdAt: typeof parsed.createdAt === 'number' ? parsed.createdAt : Date.now(),
          });
        }
      } catch { /* corrupt single file — skip; the other presets stay intact */ }
    }));
    return items;
  }

  /**
   * Loads the store from per-preset files, migrating the legacy presets.json
   * exactly once. A crash mid-migration is recovered by merging any entries
   * that never got their own file; on name collisions the newer createdAt wins
   * (a downgrade→upgrade cycle may leave a fresher entry in the legacy file).
   */
  async function loadPresetsFromDisk(): Promise<PresetItem[]> {
    let perFile: PresetItem[] = [];
    try { perFile = await readPresetFiles(); } catch { perFile = []; }

    let legacy: PresetItem[] = [];
    try {
      const parsed = JSON.parse(await fs.readFile(PRESETS_FILE, 'utf-8'));
      if (Array.isArray(parsed)) legacy = parsed;
    } catch { /* no legacy store */ }

    if (perFile.length === 0 && legacy.length === 0) return [];

    if (legacy.length > 0) {
      const byName = new Map(perFile.map((p) => [p.name, p]));
      const missing: PresetItem[] = [];
      for (const item of legacy) {
        if (!item || typeof item.name !== 'string' || !item.presentation) continue;
        const cur = byName.get(item.name);
        if (!cur) {
          byName.set(item.name, item);
          missing.push(item);
        } else if ((item.createdAt ?? 0) > (cur.createdAt ?? 0)) {
          byName.set(item.name, item);
          missing.push(item);
        }
      }
      if (missing.length > 0 || perFile.length === 0) {
        await fs.mkdir(PRESETS_DIR, { recursive: true });
        await Promise.all(missing.map(persistPresetFile));
        perFile = [...byName.values()];
      }
      // Commit point: the legacy file is removed only once every entry has its
      // own file, so an interrupted migration is never destructive.
      await fs.rm(PRESETS_FILE, { force: true });
    }

    return perFile;
  }

  async function readPresets(retentionMs = DEFAULT_LIVE_SAVE_RETENTION_MS): Promise<PresetItem[]> {
    if (cache) return cache;
    const list = await loadPresetsFromDisk();
    cache = prunePresetStore(list, Date.now(), retentionMs);
    // Lazy GC (first load only): remove files whose entries were pruned
    // (expired autosaves). Awaited so it never races a subsequent save.
    await deleteStalePresetFiles(cache);
    return cache;
  }

  async function savePreset(preset: { name: string; presentation: unknown; retentionMs?: number }): Promise<PresetItem[]> {
    const retentionMs = typeof preset.retentionMs === 'number' ? preset.retentionMs : DEFAULT_LIVE_SAVE_RETENTION_MS;
    const list = prunePresetStore(await readPresets(retentionMs), Date.now(), retentionMs);
    const entry: PresetItem = { name: preset.name, presentation: preset.presentation, createdAt: Date.now() };

    // Replace any existing entry with the same name (regular-preset upsert)
    // and, for live-saves, drop the previous backup(s) of the same
    // presentation — the renderer always writes the newest one.
    const baseKey = getLiveSaveBaseKey(preset.name);
    const filtered = list.filter(
      (item) => item.name !== preset.name && getLiveSaveBaseKey(item.name) !== baseKey,
    );
    filtered.push(entry);

    cache = prunePresetStore(filtered, Date.now(), retentionMs);
    // Write ONLY the changed preset's file (atomic), then GC any files left
    // behind by the filter above (e.g. older autosaves of the same deck).
    await persistPresetFile(entry);
    await deleteStalePresetFiles(cache);
    return cache;
  }

  async function deletePreset(name: string, retentionMs?: number): Promise<PresetItem[]> {
    const filtered = (await readPresets(retentionMs)).filter((p) => p.name !== name);
    cache = prunePresetStore(filtered, Date.now(), retentionMs ?? DEFAULT_LIVE_SAVE_RETENTION_MS);
    try { await fs.rm(path.join(PRESETS_DIR, presetFileName(name)), { force: true }); } catch { /* best-effort */ }
    return cache;
  }

  async function renamePreset(oldName: string, newName: string, retentionMs?: number): Promise<PresetItem[]> {
    const list = await readPresets(retentionMs);
    const idx = list.findIndex((p) => p.name === oldName);
    if (idx >= 0) {
      const updated: PresetItem = { ...list[idx], name: newName };
      list[idx] = updated;
      cache = prunePresetStore(list, Date.now(), retentionMs ?? DEFAULT_LIVE_SAVE_RETENTION_MS);
      // New file first, then remove the old one: a crash in between leaves a
      // duplicate entry (recoverable) rather than losing the preset.
      await persistPresetFile(updated);
      try { await fs.rm(path.join(PRESETS_DIR, presetFileName(oldName)), { force: true }); } catch { /* best-effort */ }
    }
    return cache ?? list;
  }

  return { readPresets, savePreset, deletePreset, renamePreset };
}
