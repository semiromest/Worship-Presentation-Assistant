import { FetchClient } from '@gracious.tech/fetch-client';
import type { GetResourcesItem, GetBooksItem, IndividualVerse } from '@gracious.tech/fetch-client';
import type { BibleData, BibleBook, Chapter, Verse } from './bibleParser';
import { dbGet, dbSet } from './indexedDbCache';

const DB_TTL_TRANSLATIONS = 7 * 24 * 60 * 60 * 1000;
const DB_TTL_COMPLETE = 30 * 24 * 60 * 60 * 1000;
const CONCURRENCY = 10;

const USX_BOOK_ORDER = [
  'gen','exo','lev','num','deu','jos','jdg','rut','1sa','2sa','1ki','2ki','1ch','2ch','ezr','neh','est','job','psa','pro','ecc','sng','isa','jer','lam','ezk','dan','hos','jol','amo','oba','jon','mic','nam','hab','zep','hag','zec','mal',
  'mat','mrk','luk','jhn','act','rom','1co','2co','gal','eph','php','col','1th','2th','1ti','2ti','tit','phm','heb','jas','1pe','2pe','1jn','2jn','3jn','jud','rev',
];

function htmlToText(html: string): string {
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  return doc.body.textContent?.trim() ?? '';
}

class FetchBibleApi {
  private client = new FetchClient();
  private loadedCollection: any = null;
  private memCache: Map<string, { data: unknown; expiresAt: number }> = new Map();

  async fetchTranslations(): Promise<GetResourcesItem[]> {
    const cacheKey = 'fetchbible:translations';

    const mem = this.getFromMemCache<GetResourcesItem[]>(cacheKey);
    if (mem) return mem;

    const db = await dbGet<GetResourcesItem[]>(cacheKey);
    if (db) { this.setMemCache(cacheKey, db); return db; }

    const collection = await this.client.fetch_collection();
    this.loadedCollection = collection;
    const resources = collection.bibles.get_resources() as GetResourcesItem[];

    this.setMemCache(cacheKey, resources);
    dbSet(cacheKey, resources, DB_TTL_TRANSLATIONS).catch(() => {});
    return resources;
  }

  async searchByLanguage(language: string): Promise<GetResourcesItem[]> {
    const all = await this.fetchTranslations();
    const lower = language.toLowerCase();
    return all.filter(t =>
      t.language?.toLowerCase().includes(lower) ||
      t.name?.toLowerCase().includes(lower) ||
      t.name_local?.toLowerCase().includes(lower) ||
      t.name_english?.toLowerCase().includes(lower)
    );
  }

  async preloadBible(
    resourceId: string,
    onProgress?: (done: number, total: number) => void
  ): Promise<BibleData> {
    if (!this.loadedCollection) {
      this.loadedCollection = await this.client.fetch_collection();
    }

    const books = this.loadedCollection.bibles.get_books(resourceId) as GetBooksItem[];
    const available = books.filter((b: GetBooksItem) => b.available);
    const total = available.length;
    const result: BibleBook[] = [];

    for (let i = 0; i < available.length; i += CONCURRENCY) {
      const batch = available.slice(i, i + CONCURRENCY);
      const settled = await Promise.allSettled(
        batch.map((b: GetBooksItem) => this.convertBook(resourceId, b))
      );
      for (const r of settled) {
        if (r.status === 'fulfilled' && r.value) result.push(r.value);
      }
      onProgress?.(Math.min(i + CONCURRENCY, total), total);
    }

    const resources = this.loadedCollection.bibles.get_resources({ object: true }) as Record<string, GetResourcesItem>;
    const tr = resources[resourceId];
    return {
      name: tr?.name_bilingual || tr?.name || resourceId,
      books: result.sort((a, b) => parseInt(a.number) - parseInt(b.number)),
      format: 'fetchbible',
    };
  }

  private async convertBook(resourceId: string, info: GetBooksItem): Promise<BibleBook | null> {
    try {
      const book = await this.client.fetch_book(resourceId, info.id, 'html');
      const verses: IndividualVerse<string>[] = book.get_list();
      if (!verses?.length) return null;

      const map = new Map<number, Verse[]>();
      for (const v of verses) {
        if (!map.has(v.chapter)) map.set(v.chapter, []);
        map.get(v.chapter)!.push({ number: String(v.verse), text: htmlToText(v.content) });
      }

      const chapters: Chapter[] = Array.from(map.entries())
        .sort(([a], [b]) => a - b)
        .map(([n, vv]) => ({ number: String(n), verses: vv }));

      const orderIdx = USX_BOOK_ORDER.indexOf(info.id);
      const number = orderIdx >= 0 ? String(orderIdx + 1) : String(USX_BOOK_ORDER.length + 1);

      return {
        number,
        name: info.name_bilingual || info.name_local || info.name_english || info.name,
        chapters,
      };
    } catch (e) {
      console.warn(`fetch.bible: failed to fetch ${info.id}`, e);
      return null;
    }
  }

  clearCache(): void {
    this.memCache.clear();
  }

  private getFromMemCache<T>(key: string): T | null {
    const entry = this.memCache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) { this.memCache.delete(key); return null; }
    return entry.data as T;
  }

  private setMemCache<T>(key: string, data: T): void {
    this.memCache.set(key, { data, expiresAt: Date.now() + 24 * 60 * 60 * 1000 });
  }
}

export const fetchBibleApi = new FetchBibleApi();
export type { GetResourcesItem, GetBooksItem };
