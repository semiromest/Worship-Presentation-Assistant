import type { BibleData } from './bibleParser';
import { parseBibleXMLAsync } from './bibleParser';
import { dbClear, dbGet, dbSet } from './indexedDbCache';

export interface BibleSourceDescriptor {
  type: 'local' | 'online' | 'helloao' | 'fetchbible' | 'getbible';
  id: string;
  format?: string;
  providerName?: string;
  description?: string;
  license?: string;
  sourceUrl?: string;
  versionDate?: string;
  revision?: string;
}

type LastBibleSource = Omit<BibleSourceDescriptor, 'type'> & {
  type: Exclude<BibleSourceDescriptor['type'], 'local'>;
};

const CACHE_VERSION = 'v2';
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000;
const LAST_BIBLE_KEY = 'lastBibleSource';
const STORED_PATH_KEY = 'defaultBibleXmlPath';

class BibleRepository {
  private current: BibleData | null = null;
  private source: BibleSourceDescriptor | null = null;
  private restorePromise: Promise<BibleData | null> | null = null;

  get currentBible(): BibleData | null {
    return this.current;
  }

  get sourceId(): string {
    if (this.source) return `${this.source.type}:${this.source.id}`;
    return 'none';
  }

  get currentSource(): BibleSourceDescriptor | null {
    return this.source ? { ...this.source } : null;
  }

  private cacheKey(path: string, format = 'zefania'): string {
    return `bible:${CACHE_VERSION}:${format}:${path}`;
  }

  private async cacheGet(path: string, format = 'zefania'): Promise<BibleData | null> {
    try {
      return await dbGet<BibleData>(this.cacheKey(path, format));
    } catch {
      return null;
    }
  }

  private async cacheSet(path: string, data: BibleData): Promise<void> {
    try {
      await dbSet(this.cacheKey(path, data.format), data, CACHE_TTL);
    } catch {
      console.warn('Failed to cache Bible data');
    }
  }

  private setStoredPath(path: string, source?: LastBibleSource): void {
    localStorage.setItem(STORED_PATH_KEY, path);
    if (source) localStorage.setItem(LAST_BIBLE_KEY, JSON.stringify(source));
    else localStorage.removeItem(LAST_BIBLE_KEY);
  }

  private saveFallbackSource(source: LastBibleSource): void {
    localStorage.setItem(LAST_BIBLE_KEY, JSON.stringify(source));
    localStorage.removeItem(STORED_PATH_KEY);
  }

  private readFallbackSource(): LastBibleSource | null {
    try {
      return JSON.parse(localStorage.getItem(LAST_BIBLE_KEY) ?? 'null') as LastBibleSource | null;
    } catch {
      return null;
    }
  }

  remember(data: BibleData, source: BibleSourceDescriptor): BibleData {
    this.current = data;
    this.source = source;
    return data;
  }

  async importLocal(initialPath?: string): Promise<BibleData | null> {
    const result = await window.electronAPI?.importBibleXml?.(initialPath);
    if (!result) {
      if (initialPath) localStorage.removeItem(STORED_PATH_KEY);
      return null;
    }

    if (result.path) {
      const cached = (await this.cacheGet(result.path, 'zefania')) ?? (await this.cacheGet(result.path, 'holyBible'));
      if (cached) {
        this.setStoredPath(result.path);
        return this.remember(cached, { type: 'local', id: result.path, format: cached.format });
      }
    }

    const parsed = await parseBibleXMLAsync(result.content);
    if (result.path) {
      this.setStoredPath(result.path);
      await this.cacheSet(result.path, parsed);
    }
    return this.remember(parsed, { type: 'local', id: result.path ?? parsed.name, format: parsed.format });
  }

  async restore(): Promise<BibleData | null> {
    if (this.current) return this.current;
    if (this.restorePromise) return this.restorePromise;

    this.restorePromise = (async () => {
      const storedPath = localStorage.getItem(STORED_PATH_KEY);
      if (storedPath) {
        if (storedPath.toLowerCase().endsWith('.json')) {
          const result = await window.electronAPI?.readBibleData?.(storedPath);
          if (result) {
            try {
              const data = JSON.parse(result.content) as BibleData;
              if (Array.isArray(data?.books)) {
                const storedSource = this.readFallbackSource();
                return this.remember(data, storedSource ?? { type: 'online', id: storedPath, format: data.format });
              }
            } catch {
              // Corrupt JSON falls through to the legacy IndexedDB source.
            }
          }
          localStorage.removeItem(STORED_PATH_KEY);
        } else {
          return this.importLocal(storedPath);
        }
      }

      const last = this.readFallbackSource();
      if (!last) return null;

      const path = last.type === 'online' ? `online:${last.id}` : `${last.type}:${last.id}`;
      const formats = last.format
        ? [last.format]
        : last.type === 'online'
          ? ['zefania', 'holyBible']
          : last.type === 'helloao'
            ? ['helloAo']
            : last.type === 'getbible'
              ? ['getbible']
              : ['fetchbible'];
      for (const format of formats) {
        const cached = await this.cacheGet(path, format);
        if (cached) return this.remember(cached, { ...last });
      }
      return null;
    })().finally(() => {
      this.restorePromise = null;
    });
    return this.restorePromise;
  }

  async persistDownloaded(source: BibleSourceDescriptor, data: BibleData): Promise<void> {
    if (source.type === 'local') throw new Error('Local Bible sources are imported, not downloaded');
    const cachePath = source.type === 'online' ? `online:${source.id}` : `${source.type}:${source.id}`;
    await this.cacheSet(cachePath, data);
    let filePath: string | null | undefined;
    try {
      filePath = await window.electronAPI?.saveBibleData?.(source.id, data);
    } catch {
      filePath = null;
    }
    const persistedSource: LastBibleSource = { ...source, type: source.type, format: data.format };
    if (filePath) this.setStoredPath(filePath, persistedSource);
    else this.saveFallbackSource(persistedSource);
    this.remember(data, { ...source, format: data.format });
  }

  async persistCurrent(data: BibleData): Promise<void> {
    const storedPath = localStorage.getItem(STORED_PATH_KEY);
    if (storedPath) {
      if (storedPath.toLowerCase().endsWith('.json')) {
        const id =
          storedPath
            .split(/[\\/]/)
            .pop()
            ?.replace(/\.json$/, '') ?? 'bible';
        await window.electronAPI?.saveBibleData?.(id, data);
      }
      await this.cacheSet(storedPath, data);
    } else if (this.source && this.source.type !== 'local') {
      await this.persistDownloaded({ ...this.source, format: data.format }, data);
    }
    this.current = data;
  }

  async clear(): Promise<void> {
    const storedPath = localStorage.getItem(STORED_PATH_KEY);
    try {
      await dbClear();
    } catch {
      // IndexedDB cleanup is best-effort; the active source must still be removed.
    }
    localStorage.removeItem(LAST_BIBLE_KEY);
    localStorage.removeItem(STORED_PATH_KEY);
    if (storedPath?.toLowerCase().endsWith('.json')) {
      try {
        await window.electronAPI?.deleteBibleData?.(storedPath);
      } catch {
        // A stale managed file should not keep the Bible active in the UI.
      }
    }
    this.current = null;
    this.source = null;
    this.restorePromise = null;
  }
}

export const bibleRepository = new BibleRepository();
