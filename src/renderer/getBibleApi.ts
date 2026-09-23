import type { BibleData } from './bibleParser';
import { dbGet, dbSet } from './indexedDbCache';
import {
  normalizeGetBibleCatalog,
  parseGetBibleJson,
  type GetBibleCatalog,
  type GetBibleTranslation,
} from './getBibleModel';

const API_BASE = 'https://api.getbible.net/v2';
const CATALOG_CACHE_KEY = 'getbible:catalog:v2:all';
const CATALOG_TTL = 7 * 24 * 60 * 60 * 1000;
const BIBLE_TTL = 365 * 24 * 60 * 60 * 1000;
const TIMEOUT = 120_000;

export class GetBibleApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly retryAfter?: string | null
  ) {
    super(message);
    this.name = 'GetBibleApiError';
  }
}

export interface GetBibleDownloadProgress {
  done: number;
  total: number;
}

export class GetBibleApi {
  private catalog: GetBibleCatalog | null = null;
  private bibleCache = new Map<string, BibleData>();

  async fetchCatalog(): Promise<GetBibleCatalog> {
    if (this.catalog) return this.catalog;
    try {
      const cached = await dbGet<GetBibleCatalog>(CATALOG_CACHE_KEY);
      if (cached) return (this.catalog = cached);
    } catch {
      // IndexedDB is an optimization; the provider remains usable without it.
    }

    const response = await this.fetchWithTimeout(`${API_BASE}/translations.json`);
    const catalog = normalizeGetBibleCatalog(await response.json());
    this.catalog = catalog;
    void dbSet(CATALOG_CACHE_KEY, catalog, CATALOG_TTL).catch(() => {});
    return catalog;
  }

  async downloadBible(
    translation: GetBibleTranslation,
    onProgress?: (progress: GetBibleDownloadProgress) => void
  ): Promise<BibleData> {
    const cacheKey = `getbible:bible:${translation.abbreviation}:${translation.sha}`;
    const memory = this.bibleCache.get(cacheKey);
    if (memory) return memory;
    try {
      const cached = await dbGet<BibleData>(cacheKey);
      if (cached) {
        this.bibleCache.set(cacheKey, cached);
        return cached;
      }
    } catch {
      // Continue with the network when the local cache is unavailable.
    }

    const response = await this.fetchWithTimeout(translation.url || `${API_BASE}/${translation.abbreviation}.json`);
    const text = await this.readResponse(response, onProgress);
    const bible = await this.parseOffMainThread(text);
    this.bibleCache.set(cacheKey, bible);
    void dbSet(cacheKey, bible, BIBLE_TTL).catch(() => {});
    return bible;
  }

  clearCache(): void {
    this.catalog = null;
    this.bibleCache.clear();
  }

  private async fetchWithTimeout(url: string): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT);
    try {
      const response = await fetch(url, { signal: controller.signal, cache: 'default' });
      if (!response.ok) {
        throw new GetBibleApiError(
          `GetBible API error: ${response.status}`,
          response.status,
          response.headers.get('Retry-After')
        );
      }
      return response;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async readResponse(
    response: Response,
    onProgress?: (progress: GetBibleDownloadProgress) => void
  ): Promise<string> {
    const announcedTotal = Number(response.headers.get('Content-Length')) || 0;
    if (!response.body) {
      const text = await response.text();
      onProgress?.({ done: text.length, total: announcedTotal || text.length });
      return text;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const chunks: string[] = [];
    let done = 0;
    let complete = false;
    while (!complete) {
      const result = await reader.read();
      if (result.done) {
        complete = true;
        continue;
      }
      done += result.value.byteLength;
      chunks.push(decoder.decode(result.value, { stream: true }));
      onProgress?.({ done, total: announcedTotal || done });
    }
    chunks.push(decoder.decode());
    onProgress?.({ done, total: announcedTotal || done });
    return chunks.join('');
  }

  private parseOffMainThread(text: string): Promise<BibleData> {
    if (typeof Worker === 'undefined') return Promise.resolve(parseGetBibleJson(text));

    return new Promise((resolve, reject) => {
      const worker = new Worker(new URL('./getBibleWorker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (event: MessageEvent<{ ok: boolean; bible?: BibleData; error?: string }>) => {
        worker.terminate();
        if (event.data.ok && event.data.bible) resolve(event.data.bible);
        else reject(new Error(event.data.error || 'GetBible conversion failed'));
      };
      worker.onerror = () => {
        worker.terminate();
        reject(new Error('GetBible conversion worker failed'));
      };
      worker.postMessage({ text });
    });
  }
}

export const getBibleApi = new GetBibleApi();
export type { GetBibleCatalog, GetBibleTranslation } from './getBibleModel';
