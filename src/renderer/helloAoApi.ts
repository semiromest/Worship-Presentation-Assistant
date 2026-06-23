import type { BibleData, BibleBook, Chapter, Verse } from './bibleParser';
import { dbGet, dbSet } from './indexedDbCache';

const API_BASE = 'https://bible.helloao.org/api';

interface HelloAoTranslation {
  id: string;
  name: string;
  englishName: string;
  language: string;
  languageName: string;
  languageEnglishName: string;
  numberOfBooks: number;
  completeTranslationApiLink: string;
}

interface HelloAoVerseContentItem {
  type: 'verse' | 'heading' | 'line_break';
  number?: number;
  content?: (string | { noteId?: number; lineBreak?: boolean })[];
}

interface HelloAoChapterWrapper {
  numberOfVerses: number;
  chapter: {
    number: number;
    content: HelloAoVerseContentItem[];
  };
}

interface HelloAoBook {
  id: string;
  name: string;
  order: number;
  numberOfChapters: number;
  chapters: HelloAoChapterWrapper[];
}

interface HelloAoCompleteResponse {
  translation: HelloAoTranslation;
  books: HelloAoBook[];
}

interface HelloAoTranslationsResponse {
  translations: HelloAoTranslation[];
}

const TIMEOUT = 60000;
const DB_TTL_TRANSLATIONS = 7 * 24 * 60 * 60 * 1000;
const DB_TTL_COMPLETE = 30 * 24 * 60 * 60 * 1000;

class HelloAoApi {
  private memCache: Map<string, { data: unknown; expiresAt: number }> = new Map();

  async fetchTranslations(): Promise<HelloAoTranslation[]> {
    const cacheKey = 'translations';

    const memCached = this.getFromMemCache<HelloAoTranslation[]>(cacheKey);
    if (memCached) return memCached;

    const dbCached = await dbGet<HelloAoTranslation[]>(cacheKey);
    if (dbCached) {
      this.setMemCache(cacheKey, dbCached);
      return dbCached;
    }

    const response = await this.fetchWithTimeout(`${API_BASE}/available_translations.json`);
    if (!response.ok) throw new Error(`HelloAO API error: ${response.status}`);

    const data: HelloAoTranslationsResponse = await response.json();
    this.setMemCache(cacheKey, data.translations);
    dbSet(cacheKey, data.translations, DB_TTL_TRANSLATIONS).catch(() => {});
    return data.translations;
  }

  async fetchCompleteBible(id: string): Promise<HelloAoCompleteResponse> {
    const cacheKey = `complete:${id}`;

    const memCached = this.getFromMemCache<HelloAoCompleteResponse>(cacheKey);
    if (memCached) return memCached;

    const dbCached = await dbGet<HelloAoCompleteResponse>(cacheKey);
    if (dbCached) {
      this.setMemCache(cacheKey, dbCached);
      return dbCached;
    }

    const response = await this.fetchWithTimeout(`${API_BASE}/${id}/complete.json`);
    if (!response.ok) throw new Error(`HelloAO download error: ${response.status}`);

    const data: HelloAoCompleteResponse = await response.json();
    this.setMemCache(cacheKey, data);
    dbSet(cacheKey, data, DB_TTL_COMPLETE).catch(() => {});
    return data;
  }

  async searchByLanguage(language: string): Promise<HelloAoTranslation[]> {
    const all = await this.fetchTranslations();
    const lower = language.toLowerCase();
    return all.filter(
      t =>
        t.language.toLowerCase().includes(lower) ||
        t.languageEnglishName.toLowerCase().includes(lower) ||
        t.englishName.toLowerCase().includes(lower)
    );
  }

  helloAoToBibleData(data: HelloAoCompleteResponse): BibleData {
    const translation = data.translation;
    const books: BibleBook[] = data.books
      .sort((a, b) => a.order - b.order)
      .map(haBook => {
        const chapters: Chapter[] = haBook.chapters.map(cw => {
          const verses: Verse[] = [];
          let verseNumber = 0;

          for (const item of cw.chapter.content) {
            if (item.type === 'verse' && item.number != null) {
              verseNumber = item.number;
              const text = this.extractVerseText(item.content);
              verses.push({
                number: String(verseNumber),
                text,
              });
            }
          }

          return {
            number: String(cw.chapter.number),
            verses,
          };
        });

        return {
          number: String(haBook.order),
          name: haBook.name,
          chapters,
        };
      });

    return {
      name: translation.englishName || translation.name,
      books,
      format: 'helloAo',
    };
  }

  private extractVerseText(content?: (string | { noteId?: number; lineBreak?: boolean })[]): string {
    if (!content) return '';
    return content
      .filter((item): item is string => typeof item === 'string')
      .join('')
      .trim();
  }

  private async fetchWithTimeout(url: string): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT);

    try {
      return await fetch(url, { signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
  }

  private getFromMemCache<T>(key: string): T | null {
    const entry = this.memCache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.memCache.delete(key);
      return null;
    }
    return entry.data as T;
  }

  private setMemCache<T>(key: string, data: T): void {
    this.memCache.set(key, { data, expiresAt: Date.now() + 24 * 60 * 60 * 1000 });
  }

  clearCache(): void {
    this.memCache.clear();
  }
}

export const helloAoApi = new HelloAoApi();
export type { HelloAoTranslation, HelloAoCompleteResponse, HelloAoBook };
