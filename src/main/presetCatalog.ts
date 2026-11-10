import fs from 'node:fs/promises';
import { renameWithRetry } from './atomicFile';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Preset, Slide } from '../shared/presentation';
import type { PresetChange } from '../shared/presetCatalog';
import type { PresetItem } from './presetStore';
import { prunePresetStore, getLiveSaveBaseKey, DEFAULT_LIVE_SAVE_RETENTION_MS } from '../shared/presetRetention';

interface RecordInfo {
  name: string; createdAt: number; presentationId: string; presentationName: string; slideCount: number;
  size: number; mtime: number; version: string;
}
const fileName = (name: string) => Buffer.from(name).toString('base64url') + '.json';
function fromFile(file: string): string | undefined {
  if (!file.endsWith('.json')) return;
  const name = Buffer.from(file.slice(0, -5), 'base64url').toString();
  return fileName(name) === file ? name : undefined;
}
const summary = (item: RecordInfo): Preset => ({ name: item.name, createdAt: item.createdAt,
  presentation: { id: item.presentationId, name: item.presentationName, slides: [] },
  summary: { version: item.version, slideCount: item.slideCount } });
const info = (item: PresetItem, stat: { size: number; mtimeMs: number }): RecordInfo => {
  const deck = item.presentation as Record<string, any>;
  return { name: item.name, createdAt: item.createdAt, presentationId: String(deck?.id ?? ''),
    presentationName: String(deck?.name ?? item.name), slideCount: Array.isArray(deck?.slides) ? deck.slides.length : 0,
    size: stat.size, mtime: stat.mtimeMs, version: randomUUID() };
};
async function bounded<T, R>(items: T[], task: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length); let index = 0;
  await Promise.all(Array.from({ length: Math.min(8, items.length) }, async () => {
    for (;;) { const i = index++; if (i >= items.length) return; results[i] = await task(items[i]); }
  }));
  return results;
}

/** Payload files remain authoritative. The small index is a disposable, stat-validated accelerator. */
export function createPresetCatalog(root: string, migrate: (retention: number) => Promise<unknown>, changed: () => void) {
  const directory = path.join(root, 'presets'), indexFile = path.join(root, 'preset-index.json');
  const previews = path.join(root, 'preset-previews');
  let records: RecordInfo[] = [], loaded = false;
  let tail: Promise<unknown> = Promise.resolve();
  const diagnostics = { payloadReads: 0, payloadBytes: 0 };
  const exclusive = <T>(run: () => Promise<T>): Promise<T> => {
    const next = tail.then(run); tail = next.catch(() => {}); return next;
  };
  async function atomic(file: string, value: unknown) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const temporary = file + '.' + randomUUID() + '.tmp';
    try { await fs.writeFile(temporary, JSON.stringify(value)); await renameWithRetry(temporary, file); }
    finally { await fs.rm(temporary, { force: true }).catch(() => {}); }
  }
  async function persistIndex() {
    // A failed acceleration-file write cannot undo a committed presentation.
    await atomic(indexFile, { schema: 1, records }).catch(() => {});
  }
  async function readPayload(name: string): Promise<PresetItem> {
    const raw = await fs.readFile(path.join(directory, fileName(name)), 'utf8');
    diagnostics.payloadReads++; diagnostics.payloadBytes += Buffer.byteLength(raw);
    const item = JSON.parse(raw);
    if (!item || item.name !== name || !item.presentation || typeof item.presentation !== 'object') throw Error('Invalid preset');
    return { name, presentation: item.presentation, createdAt: Number.isFinite(item.createdAt) ? item.createdAt : 0 };
  }
  async function writePreview(record: RecordInfo, item: PresetItem) {
    const slide = (item.presentation as any)?.slides?.[0] ?? null;
    await atomic(path.join(previews, fileName(record.name)), { version: record.version, slide }).catch(() => {});
  }
  async function refresh(retention = DEFAULT_LIVE_SAVE_RETENTION_MS): Promise<string[]> {
    if (!loaded) {
      // Existing single-file libraries retain their original migration/recovery rules.
      try { await fs.access(path.join(root, 'presets.json')); await migrate(retention); } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      try {
        const index = JSON.parse(await fs.readFile(indexFile, 'utf8'));
        if (index.schema === 1 && Array.isArray(index.records)) records = index.records.filter((r: RecordInfo) =>
          typeof r?.name === 'string' && typeof r.version === 'string' && typeof r.presentationId === 'string' &&
          typeof r.presentationName === 'string' && Number.isFinite(r.createdAt) && Number.isFinite(r.slideCount) && Number.isFinite(r.size) && Number.isFinite(r.mtime));
      } catch { /* Missing/corrupt index is rebuilt from the payloads. */ }
      loaded = true;
    }
    let files: string[];
    try { files = await fs.readdir(directory); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      files = [];
    }
    const old = new Map(records.map(record => [record.name, record]));
    const scanned = await bounded(files, async file => {
      const name = fromFile(file); if (name === undefined) return undefined;
      try {
        const stat = await fs.stat(path.join(directory, file)), cached = old.get(name);
        if (cached && cached.size === stat.size && cached.mtime === stat.mtimeMs) return cached;
        const item = await readPayload(name), record = info(item, stat);
        await writePreview(record, item); return record;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof SyntaxError || (error as Error).message === 'Invalid preset') return undefined;
        throw error;
      }
    });
    const valid = scanned.filter((record): record is RecordInfo => !!record);
    const keep = prunePresetStore(valid.map(summary), Date.now(), retention), kept = new Set(keep.map(p => p.name));
    const expired = valid.filter(record => !kept.has(record.name)).map(record => record.name);
    for (const name of expired) { await fs.rm(path.join(directory, fileName(name)), { force: true }); await fs.rm(path.join(previews, fileName(name)), { force: true }).catch(() => {}); }
    const byName = new Map(valid.map(record => [record.name, record]));
    records = keep.map(item => byName.get(item.name)!);
    const removed = [...old.keys()].filter(name => !kept.has(name));
    if (removed.length || records.some(record => old.get(record.name) !== record)) { await persistIndex(); changed(); }
    return [...new Set([...removed, ...expired])];
  }
  async function commit(item: PresetItem) {
    await atomic(path.join(directory, fileName(item.name)), item);
    const record = info(item, await fs.stat(path.join(directory, fileName(item.name))));
    records = [record, ...records.filter(r => r.name !== item.name)];
    changed(); await writePreview(record, item); await persistIndex(); return summary(record);
  }
  async function removeFiles(names: string[]) {
    for (const name of names) { await fs.rm(path.join(directory, fileName(name)), { force: true }); await fs.rm(path.join(previews, fileName(name)), { force: true }).catch(() => {}); }
    records = records.filter(record => !names.includes(record.name)); changed(); await persistIndex();
  }
  return {
    exclusive,
    diagnostics: () => ({ ...diagnostics }),
    list: (retention?: number) => exclusive(async () => { await refresh(retention); return records.map(summary); }),
    get: (name: string) => exclusive(async () => {
      try {
        const item = await readPayload(name), record = info(item, await fs.stat(path.join(directory, fileName(name))));
        const cached = records.find(r => r.name === name);
        if (cached && cached.size === record.size && cached.mtime === record.mtime) record.version = cached.version;
        return { ...item, summary: { version: record.version, slideCount: record.slideCount, resolved: true } } as Preset;
      } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
    }),
    preview: (name: string, version: string) => exclusive(async (): Promise<Slide | null> => {
      if (!loaded) await refresh(0);
      let record = records.find(r => r.name === name); if (!record || record.version !== version) return null;
      try {
        const stat = await fs.stat(path.join(directory, fileName(name)));
        if (stat.size !== record.size || stat.mtimeMs !== record.mtime) { await refresh(0); record = records.find(r => r.name === name); }
      } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
      if (!record || record.version !== version) return null;
      try { const cached = JSON.parse(await fs.readFile(path.join(previews, fileName(name)), 'utf8')); if (cached.version === version) return cached.slide ?? null; } catch { /* Rebuild only the requested cover. */ }
      const item = await readPayload(name); await writePreview(record, item); return (item.presentation as any).slides?.[0] ?? null;
    }),
    save: (preset: { name: string; presentation: unknown; retentionMs?: number }) => exclusive(async (): Promise<PresetChange> => {
      const removed = await refresh(preset.retentionMs), base = getLiveSaveBaseKey(preset.name);
      const replaced = records.filter(r => r.name !== preset.name && getLiveSaveBaseKey(r.name) === base).map(r => r.name);
      const upsert = await commit({ name: preset.name, presentation: preset.presentation, createdAt: Date.now() });
      await removeFiles(replaced); return { upsert, removed: [...removed, ...replaced] };
    }),
    remove: (name: string, retention?: number) => exclusive(async (): Promise<PresetChange> => {
      const removed = await refresh(retention); await removeFiles([name]); return { removed: [...removed, name] };
    }),
    rename: (oldName: string, name: string, retention?: number) => exclusive(async (): Promise<PresetChange> => {
      const removed = await refresh(retention);
      if (oldName === name) return { removed };
      if (records.some(r => r.name === name)) throw Error('Preset name already exists');
      const original = await readPayload(oldName), upsert = await commit({ ...original, name });
      await removeFiles([oldName]); return { upsert, removed: [...removed, oldName] };
    }),
  };
}
