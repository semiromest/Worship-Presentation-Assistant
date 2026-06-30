import {
  useState, useEffect, useMemo, useCallback,
  useRef, memo, useDeferredValue,
} from 'react';
import {
  Search, Book, FileUp, ChevronRight,
  ArrowLeft, Send, Hash, X, Layers, Check,
  BookOpen, Download, Globe, Loader, Type,
} from 'lucide-react';
import { cn, useDebounce } from './utils';
import { confirmDialog } from './dialogs';
import { useTranslation } from 'react-i18next';
import { parseBibleXMLAsync, type BibleData } from './bibleParser';
import { onlineBibleManager, type BibleInfo } from './onlineBibleManager';
import { helloAoApi, type HelloAoTranslation } from './helloAoApi';
import { fetchBibleApi } from './fetchBibleApi';
import type { GetResourcesItem } from '@gracious.tech/fetch-client';
import { dbGet, dbSet, dbClear } from './indexedDbCache';
import Dialog from './components/Dialog';

// ─── Types ─────────────────────────────────────────────────────────────────

interface Verse { number: string; text: string }
interface Chapter { number: string; verses: Verse[] }
interface BibleBook { name: string; number: string; chapters: Chapter[] }
// BibleData interface imported from bibleParser.ts

interface ScriptureBrowserProps {
  onSendToLive: (content: string | string[], options?: { groupTitle?: string; goLive?: boolean }) => void;
}

interface ParsedRef {
  book: string;
  chapter: number | null;
  verse: number | null;
  verseTo: number | null;
}

// ─── Constants ─────────────────────────────────────────────────────────────

const VERSE_HEIGHT = 96;
const OVERSCAN = 5;
const CACHE_VERSION = 'v2';
const CHUNK_CONFIG = { maxVerses: 3, maxChars: 120, maxLines: 2 } as const;

// ─── Normalization & Parsing ────────────────────────────────────────────────

const TURKISH_CHARS_MAP: Record<string, string> = {
  'ı': 'i', 'ğ': 'g', 'ü': 'u', 'ş': 's', 'ö': 'o', 'ç': 'c',
  'İ': 'i', 'Ğ': 'g', 'Ü': 'u', 'Ş': 's', 'Ö': 'o', 'Ç': 'c',
};

function normalize(str: string): string {
  return str
    .toLowerCase()
    .replace(/[ığüşöçİĞÜŞÖÇ]/g, char => TURKISH_CHARS_MAP[char] || char);
}

function findMatthewIndex(books: BibleBook[]): number {
  return books.findIndex(b => normalize(b.name).startsWith('matta'));
}

function parseScriptureRef(input: string): ParsedRef | null {
  const s = input.trim();
  if (!s) return null;

  // Try each pattern: book chapter:verse, book chapter, book-only
  const patterns = [
    /^(.+?)\s+(\d+):(\d+)(?:-(\d+))?$/,
    /^(.+?)\s+(\d+)$/,
    /^(.+?)$/,
  ];

  for (const pattern of patterns) {
    const match = s.match(pattern);
    if (!match) continue;

    const book = normalize(match[1]);
    const chapter = match[2] ? parseInt(match[2]) : null;
    const verse = match[3] ? parseInt(match[3]) : null;
    const verseTo = match[4] ? parseInt(match[4]) : verse;

    return { book, chapter, verse, verseTo };
  }

  return null;
}

// ─── XML Parsing (Optimized) ───────────────────────────────────────────────

function parseZefaniaXML(xmlString: string): BibleData {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlString, 'text/xml');
  const name = doc.querySelector('XMLBIBLE')?.getAttribute('biblename') ?? 'Kutsal Kitap';

  const bookElements = doc.querySelectorAll('BIBLEBOOK, BibleBook');
  const books: BibleBook[] = Array.from(bookElements, (b, index) => {
    const bnumber = b.getAttribute('bnumber') ?? '';
    const bname = b.getAttribute('bname') ?? '';
    const isNumeric = /^\d+$/.test(bnumber.trim());
    
    const bookName = bname || (!isNumeric ? bnumber : `Kitap ${index + 1}`);
    const bookNumber = isNumeric ? bnumber : String(index + 1);

    const chapterElements = b.querySelectorAll('CHAPTER, Chapter');
    const chapters = Array.from(chapterElements, c => {
      const verseElements = c.querySelectorAll('VERS, vers, V');
      const verses = Array.from(verseElements, v => ({
        number: v.getAttribute('vnumber') ?? '',
        text: v.textContent ?? '',
      }));
      return {
        number: c.getAttribute('cnumber') ?? '',
        verses,
      };
    });

    return { number: bookNumber, name: bookName, chapters };
  });

  return { name, books, format: 'zefania' };
}

// ─── Cache Management (Improved) ───────────────────────────────────────────

const CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 1 week

class BibleCache {
  static getKey(path: string, format: string = 'zefania'): string {
    return `bible:${CACHE_VERSION}:${format}:${path}`;
  }

  static async set(path: string, data: BibleData): Promise<void> {
    try {
      await dbSet(this.getKey(path, data.format), data, CACHE_TTL);
    } catch {
      console.warn('Failed to cache Bible data');
    }
  }

  static async get(path: string, format: string = 'zefania'): Promise<BibleData | null> {
    try {
      return await dbGet<BibleData>(this.getKey(path, format));
    } catch {
      return null;
    }
  }

  static async clear(): Promise<void> {
    try {
      await dbClear();
    } catch {
      console.warn('Failed to clear Bible cache');
    }
  }

  static getStoredPath(): string | null {
    return localStorage.getItem('defaultBibleXmlPath');
  }

  static setStoredPath(path: string): void {
    localStorage.setItem('defaultBibleXmlPath', path);
  }

  static removeStoredPath(): void {
    localStorage.removeItem('defaultBibleXmlPath');
  }
}

// ─── Bible Source Persistence (survives tab switches) ─────────────────────

interface LastBibleSource {
  type: 'online' | 'helloao' | 'fetchbible';
  id: string;
}

const LAST_BIBLE_KEY = 'lastBibleSource';

function saveLastBibleSource(source: LastBibleSource): void {
  localStorage.setItem(LAST_BIBLE_KEY, JSON.stringify(source));
  BibleCache.removeStoredPath();
}

function getLastBibleSource(): LastBibleSource | null {
  try {
    const raw = localStorage.getItem(LAST_BIBLE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as LastBibleSource;
  } catch {
    return null;
  }
}

function clearLastBibleSource(): void {
  localStorage.removeItem(LAST_BIBLE_KEY);
}

// ─── Chunking Algorithm (Optimized) ─────────────────────────────────────────

function splitVersesIntoChunks(lines: string[]): string[] {
  const { maxVerses, maxChars, maxLines } = CHUNK_CONFIG;
  const chunks: string[] = [];
  let currentChunk: string[] = [];
  let currentChars = 0;

  for (const line of lines) {
    const separator = currentChunk.length > 0 ? '\n\n' : '';
    const estimatedChars = currentChars + separator.length + line.length;
    const wouldExceedVerses = currentChunk.length >= maxVerses;
    const wouldExceedChars = estimatedChars > maxChars;
    const wouldExceedLines = currentChunk.length + 1 > maxLines;

    if ((wouldExceedVerses || wouldExceedChars || wouldExceedLines) && currentChunk.length > 0) {
      chunks.push(currentChunk.join('\n\n'));
      currentChunk = [];
      currentChars = 0;
    }

    currentChunk.push(line);
    currentChars = (currentChunk.length > 1 ? currentChars + 2 : 0) + line.length;
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk.join('\n\n'));
  }

  return chunks;
}

// ─── Custom Hooks ──────────────────────────────────────────────────────────

function useVirtualList(itemCount: number, resetDependency: unknown) {
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(500);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Reset scroll position
    container.scrollTop = 0;
    setScrollTop(0);

    const resizeObserver = new ResizeObserver(entries => {
      const entry = entries[0];
      if (entry) {
        setContainerHeight(entry.contentRect.height);
      }
    });

    resizeObserver.observe(container);

    const handleScroll = () => {
      setScrollTop(container.scrollTop);
    };

    container.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      resizeObserver.disconnect();
      container.removeEventListener('scroll', handleScroll);
    };
  }, [resetDependency]);

  const startIndex = Math.max(0, Math.floor(scrollTop / VERSE_HEIGHT) - OVERSCAN);
  const endIndex = Math.min(itemCount, Math.ceil((scrollTop + containerHeight) / VERSE_HEIGHT) + OVERSCAN);
  const totalHeight = itemCount * VERSE_HEIGHT;

  return { startIndex, endIndex, totalHeight, containerRef };
}

// ─── Memoized Components ───────────────────────────────────────────────────

const BookRow = memo(({ book, isActive, onClick }: {
  book: BibleBook;
  isActive: boolean;
  onClick: () => void;
}) => (
  <button
    onClick={onClick}
    className={cn(
      'w-full flex items-center justify-between px-4 py-2.5 rounded-xl text-left transition-all duration-200 group',
      isActive
        ? 'bg-blue-500/10 text-blue-400 font-medium'
        : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50',
    )}
  >
    <span className="text-[13px] truncate">{book.name}</span>
    <ChevronRight className={cn(
      'w-4 h-4 shrink-0 transition-all duration-200',
      isActive
        ? 'text-blue-400 opacity-100'
        : 'text-zinc-600 opacity-0 group-hover:opacity-100 -translate-x-2 group-hover:translate-x-0',
    )} />
  </button>
));

const VerseRow = memo(({ verse, top, isSelected, onToggle, onDoubleClick }: {
  verse: Verse;
  top: number;
  isSelected: boolean;
  onToggle: (number: string) => void;
  onDoubleClick?: (verse: Verse) => void;
}) => {
  const { t } = useTranslation();
  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={isSelected}
      aria-label={`${t('common.scriptureVerseLabel')} ${verse.number}: ${verse.text.substring(0, 80)}`}
      onClick={() => onToggle(verse.number)}
      onDoubleClick={() => onDoubleClick?.(verse)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onToggle(verse.number);
        }
      }}
      style={{ position: 'absolute', top, left: 0, right: 0, height: VERSE_HEIGHT - 12 }}
      className={cn(
        'mx-6 rounded-2xl cursor-pointer transition-all duration-200 flex gap-4 p-4 group border',
        isSelected
          ? 'bg-blue-500/10 border-blue-500/20 shadow-sm shadow-blue-900/10'
          : 'bg-zinc-900/30 border-transparent hover:bg-zinc-800/50 hover:border-zinc-700/50',
      )}
    >
      <div className="shrink-0 pt-0.5">
        <div className={cn(
          'min-w-[28px] h-6 rounded-md flex items-center justify-center text-[11px] font-semibold transition-colors',
          isSelected
            ? 'bg-blue-500 text-white shadow-md shadow-blue-500/20'
            : 'bg-zinc-800 text-zinc-400 group-hover:bg-zinc-700 group-hover:text-zinc-300',
        )}>
          {verse.number}
        </div>
      </div>
      <p className={cn(
        'text-[13.5px] leading-relaxed line-clamp-2 transition-colors',
        isSelected ? 'text-zinc-100 font-medium' : 'text-zinc-400 group-hover:text-zinc-300',
      )}>
        {verse.text}
      </p>
    </div>
  );
});

// ─── Main Component ────────────────────────────────────────────────────────

export default function ScriptureBrowser({ onSendToLive }: ScriptureBrowserProps) {
  const { t } = useTranslation();

  // State management
  const [bible, setBible] = useState<BibleData | null>(null);
  const [selectedBook, setSelectedBook] = useState<BibleBook | null>(null);
  const [selectedChapter, setSelectedChapter] = useState<Chapter | null>(null);
  const [selectedVerses, setSelectedVerses] = useState<Set<string>>(new Set());
  const [searchTerm, setSearchTerm] = useState('');
  const [contentSearch, setContentSearch] = useState(false);
  const [selectedContentResults, setSelectedContentResults] = useState<Set<string>>(new Set());
  const [parseError, setParseError] = useState<string | null>(null);
  
  // Online Bible states
  const [bibleSource, setBibleSource] = useState<'offline' | 'online'>('offline');
  const [onlineBibles, setOnlineBibles] = useState<BibleInfo[]>([]);
  const [isLoadingOnline, setIsLoadingOnline] = useState(false);
  const [onlineError, setOnlineError] = useState<string | null>(null);
  const [showOnlineBibleDialog, setShowOnlineBibleDialog] = useState(false);
  const [isLoadingUnified, setIsLoadingUnified] = useState(false);
  const [languageFilter, setLanguageFilter] = useState('');

  // HelloAO states
  const [helloAoTranslations, setHelloAoTranslations] = useState<HelloAoTranslation[]>([]);
  const [isLoadingHelloAo, setIsLoadingHelloAo] = useState(false);
  const [helloAoError, setHelloAoError] = useState<string | null>(null);

  // fetch.bible states
  const [fetchBibleTranslations, setFetchBibleTranslations] = useState<GetResourcesItem[]>([]);
  const [isLoadingFetchBible, setIsLoadingFetchBible] = useState(false);
  const [fetchBibleProgress, setFetchBibleProgress] = useState<{ done: number; total: number } | null>(null);

  const filteredOnlineBibles = useMemo(() => {
    if (!languageFilter) return onlineBibles;
    const lower = languageFilter.toLowerCase();
    return onlineBibles.filter(
      b => b.language.toLowerCase().includes(lower) || b.name.toLowerCase().includes(lower)
    );
  }, [onlineBibles, languageFilter]);

  const filteredHelloAoTranslations = useMemo(() => {
    if (!languageFilter) return helloAoTranslations;
    const lower = languageFilter.toLowerCase();
    return helloAoTranslations.filter(
      t => t.language.toLowerCase().includes(lower) ||
           t.languageEnglishName.toLowerCase().includes(lower) ||
           t.englishName.toLowerCase().includes(lower) ||
           t.name.toLowerCase().includes(lower)
    );
  }, [helloAoTranslations, languageFilter]);

  const filteredFetchBibleTranslations = useMemo(() => {
    if (!languageFilter) return fetchBibleTranslations;
    const lower = languageFilter.toLowerCase();
    return fetchBibleTranslations.filter(t =>
      t.language?.toLowerCase().includes(lower) ||
      t.name?.toLowerCase().includes(lower) ||
      t.name_local?.toLowerCase().includes(lower) ||
      t.name_english?.toLowerCase().includes(lower)
    );
  }, [fetchBibleTranslations, languageFilter]);

  const unifiedBibleList = useMemo(() => {
    const items: Array<{
      id: string;
      name: string;
      language: string;
      detail: string;
      source: 'github' | 'helloao' | 'fetchbible';
      data: unknown;
    }> = [];

    for (const b of filteredOnlineBibles) {
      items.push({ id: b.filename, name: b.name, language: b.language, detail: b.version, source: 'github', data: b });
    }
    for (const t of filteredHelloAoTranslations) {
      items.push({
        id: t.id, name: t.englishName || t.name, language: t.languageEnglishName || t.languageName,
        detail: `${t.numberOfBooks} books`, source: 'helloao', data: t,
      });
    }
    for (const t of filteredFetchBibleTranslations) {
      items.push({
        id: t.id, name: t.name_bilingual || t.name || t.name_english || t.id,
        language: t.language || '', detail: '', source: 'fetchbible', data: t,
      });
    }

    items.sort((a, b) => a.language.localeCompare(b.language) || a.name.localeCompare(b.name));
    return items;
  }, [filteredOnlineBibles, filteredHelloAoTranslations, filteredFetchBibleTranslations]);
  
  const debouncedSearch = useDebounce(searchTerm);
  const deferredSearch = useDeferredValue(debouncedSearch);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Clear content search selections when search term or mode changes
  useEffect(() => {
    setSelectedContentResults(new Set());
  }, [deferredSearch, contentSearch]);

  // Virtual list hook
  const { startIndex, endIndex, totalHeight, containerRef } = useVirtualList(
    selectedChapter?.verses.length ?? 0,
    selectedChapter
  );

  // Parse search reference
  const parsedRef = useMemo(
    () => parseScriptureRef(deferredSearch),
    [deferredSearch]
  );

  // Pre-compute normalized book names + testament split (single pass)
  const { bookNameCache, oldTestament, newTestament } = useMemo(() => {
    if (!bible) return { bookNameCache: null, oldTestament: [], newTestament: [] };

    const norms = new Map<BibleBook, string>();
    const byExact = new Map<string, BibleBook>();
    for (const book of bible.books) {
      const n = normalize(book.name);
      norms.set(book, n);
      if (!byExact.has(n)) byExact.set(n, book);
    }

    const filteredBooks = parsedRef?.book
      ? bible.books.filter(b => norms.get(b)!.includes(parsedRef.book))
      : bible.books;

    const matthewIndex = filteredBooks.findIndex(b => norms.get(b)!.startsWith('matta'));

    return {
      bookNameCache: { norms, byExact },
      oldTestament: matthewIndex !== -1
        ? filteredBooks.slice(0, matthewIndex)
        : filteredBooks,
      newTestament: matthewIndex !== -1
        ? filteredBooks.slice(matthewIndex)
        : [],
    };
  }, [bible, parsedRef?.book]);

  // Inverted index for fast content search (built once per bible load)
  const searchIndex = useMemo(() => {
    if (!bible) return null;
    const index = new Map<string, Array<{ bookIndex: number; chapterIndex: number; verseIndex: number }>>();
    for (let bi = 0; bi < bible.books.length; bi++) {
      const book = bible.books[bi];
      for (let ci = 0; ci < book.chapters.length; ci++) {
        const chapter = book.chapters[ci];
        for (let vi = 0; vi < chapter.verses.length; vi++) {
          const words = new Set(normalize(chapter.verses[vi].text).split(/\s+/));
          for (const word of words) {
            if (word.length < 2) continue;
            if (!index.has(word)) index.set(word, []);
            index.get(word)!.push({ bookIndex: bi, chapterIndex: ci, verseIndex: vi });
          }
        }
      }
    }
    return index;
  }, [bible]);

  // Content search results across all verses (using inverted index)
  const contentSearchResults = useMemo(() => {
    if (!contentSearch || !bible || !searchIndex || !deferredSearch || deferredSearch.length < 2) return null;

    const query = normalize(deferredSearch);
    const words = query.split(/\s+/).filter(w => w.length >= 2);
    if (words.length === 0) return null;

    const sets = words.map(word => searchIndex.get(word) ?? []);
    if (sets.some(s => s.length === 0)) return null;

    const smallestIdx = sets.reduce((best, set, i) => set.length < sets[best].length ? i : best, 0);
    const smallest = sets[smallestIdx];
    const others = sets.filter((_, i) => i !== smallestIdx);

    const seen = new Set<string>();
    const results: Array<{ book: BibleBook; chapter: Chapter; verse: Verse }> = [];

    for (const ref of smallest) {
      const key = `${ref.bookIndex}:${ref.chapterIndex}:${ref.verseIndex}`;
      if (seen.has(key)) continue;

      const allMatch = others.every(set =>
        set.some(r => r.bookIndex === ref.bookIndex && r.chapterIndex === ref.chapterIndex && r.verseIndex === ref.verseIndex)
      );

      if (allMatch) {
        const verse = bible.books[ref.bookIndex].chapters[ref.chapterIndex].verses[ref.verseIndex];
        results.push({ book: bible.books[ref.bookIndex], chapter: bible.books[ref.bookIndex].chapters[ref.chapterIndex], verse });
        seen.add(key);
        if (results.length >= 50) break;
      }
    }

    return results;
  }, [bible, searchIndex, contentSearch, deferredSearch]);

  // Import XML handler
  const handleImportXML = useCallback(async (initialPath?: string) => {
    if (!(window as any).electronAPI?.importBibleXml) return;

    const result = await (window as any).electronAPI.importBibleXml(initialPath);
    if (!result) {
      if (initialPath) BibleCache.removeStoredPath();
      return;
    }

    try {
      // Try cache first
      if (result.path) {
        const cached = await BibleCache.get(result.path, 'zefania');
        if (cached) {
          setBible(cached);
          BibleCache.setStoredPath(result.path);
          clearLastBibleSource();
          return;
        }
      }

      const parsed = await parseBibleXMLAsync(result.content);
      setBible(parsed);
      setBibleSource('offline');

      if (result.path) {
        BibleCache.setStoredPath(result.path);
        await BibleCache.set(result.path, parsed);
        clearLastBibleSource();
      }
    } catch (err) {
      console.error('Failed to parse XML:', err);
      setParseError(t('common.scriptureParseError'));
    }
  }, []);

  // Fetch all Bibles from GitHub
  const handleFetchOnlineBibles = useCallback(async () => {
    setIsLoadingOnline(true);
    setOnlineError(null);

    try {
      const result = await onlineBibleManager.fetchBibleList();
      setOnlineBibles(result.bibles);
    } catch (error) {
      console.error('Failed to fetch online bibles:', error);
      setOnlineError(
        error instanceof Error ? error.message : 'Failed to fetch Bible list'
      );
    } finally {
      setIsLoadingOnline(false);
    }
  }, []);

  // Download and parse online Bible
  const handleDownloadOnlineBible = useCallback(async (bibleInfo: BibleInfo) => {
    setIsLoadingOnline(true);
    setOnlineError(null);

    try {
      const content = await onlineBibleManager.downloadBibleXml(bibleInfo.filename);
      const parsed = await parseBibleXMLAsync(content);

      setBible(parsed);
      setBibleSource('online');
      setShowOnlineBibleDialog(false);

      await BibleCache.set(`online:${bibleInfo.filename}`, parsed);
      saveLastBibleSource({ type: 'online', id: bibleInfo.filename });
      setParseError(null);
    } catch (error) {
      console.error('Failed to download and parse Bible:', error);
      setOnlineError(
        error instanceof Error ? error.message : 'Failed to download Bible'
      );
    } finally {
      setIsLoadingOnline(false);
    }
  }, []);

  // Fetch HelloAO translations
  const handleFetchHelloAo = useCallback(async () => {
    setIsLoadingHelloAo(true);
    setHelloAoError(null);

    try {
      const translations = await helloAoApi.fetchTranslations();
      setHelloAoTranslations(translations);
    } catch (error) {
      console.error('Failed to fetch HelloAO translations:', error);
      setHelloAoError(
        error instanceof Error ? error.message : 'Failed to fetch Bible list'
      );
    } finally {
      setIsLoadingHelloAo(false);
    }
  }, []);

  // Download and parse HelloAO Bible
  const handleDownloadHelloAo = useCallback(async (translation: HelloAoTranslation) => {
    setIsLoadingHelloAo(true);
    setHelloAoError(null);

    try {
      const data = await helloAoApi.fetchCompleteBible(translation.id);
      const parsed = helloAoApi.helloAoToBibleData(data);

      setBible(parsed);
      setBibleSource('online');
      setShowOnlineBibleDialog(false);

      await BibleCache.set(`helloao:${translation.id}`, parsed);
      saveLastBibleSource({ type: 'helloao', id: translation.id });
      setParseError(null);
    } catch (error) {
      console.error('Failed to download HelloAO Bible:', error);
      setHelloAoError(
        error instanceof Error ? error.message : 'Failed to download Bible'
      );
    } finally {
      setIsLoadingHelloAo(false);
    }
  }, []);

  // Unified browse: fetch all sources and open dialog
  const handleBrowseOnline = useCallback(async () => {
    setIsLoadingUnified(true);
    setShowOnlineBibleDialog(true);

    await Promise.allSettled([
      handleFetchOnlineBibles(),
      handleFetchHelloAo(),
      fetchBibleApi.fetchTranslations().then(setFetchBibleTranslations).catch(() => {}),
    ]);

    setIsLoadingUnified(false);
  }, [handleFetchOnlineBibles, handleFetchHelloAo]);

  // Download fetch.bible translation (preloads all books)
  const handleDownloadFetchBible = useCallback(async (resource: GetResourcesItem) => {
    setIsLoadingFetchBible(true);
    setFetchBibleProgress(null);

    try {
      const parsed = await fetchBibleApi.preloadBible(resource.id, (done, total) => {
        setFetchBibleProgress({ done, total });
      });

      setBible(parsed);
      setBibleSource('online');
      setShowOnlineBibleDialog(false);

      await BibleCache.set(`fetchbible:${resource.id}`, parsed);
      saveLastBibleSource({ type: 'fetchbible', id: resource.id });
      setFetchBibleProgress(null);
      setParseError(null);
    } catch (error) {
      console.error('Failed to download fetch.bible:', error);
      setParseError(
        error instanceof Error ? error.message : 'Failed to download Bible'
      );
    } finally {
      setIsLoadingFetchBible(false);
    }
  }, []);

  // Load stored Bible on mount (survives tab switches)
  useEffect(() => {
    const restoreBible = async () => {
      const storedPath = BibleCache.getStoredPath();
      if (storedPath) {
        handleImportXML(storedPath);
        return;
      }

      const last = getLastBibleSource();
      if (!last) return;

      const path = last.type === 'online'
        ? `online:${last.id}`
        : `${last.type}:${last.id}`;

      const format = last.type === 'online'
        ? 'zefania'
        : last.type === 'helloao'
          ? 'helloAo'
          : 'fetchbible';

      const cached = await BibleCache.get(path, format);
      if (cached) {
        setBible(cached);
        setBibleSource('online');
      }
    };

    restoreBible();
  }, [handleImportXML]);

  // Auto-select book/chapter/verses from search ref; only reset on book change
  useEffect(() => {
    if (!bible || !parsedRef || !bookNameCache) return;

    const matchedBook = bible.books.find(
      b => bookNameCache.norms.get(b)!.includes(parsedRef.book)
    );
    if (!matchedBook) return;

    // Only change book (and clear downstream) if it's genuinely a different book
    const bookChanged = selectedBook?.number !== matchedBook.number;
    if (bookChanged) {
      setSelectedBook(matchedBook);
      setSelectedChapter(null);
      setSelectedVerses(new Set());
    }

    // Select chapter if specified
    if (parsedRef.chapter != null) {
      const chapter = matchedBook.chapters.find(
        c => parseInt(c.number) === parsedRef.chapter
      );

      const chapterChanged = chapter && selectedChapter?.number !== chapter.number;
      if (chapterChanged) {
        setSelectedChapter(chapter!);
        // Only clear verses when chapter changes
        setSelectedVerses(new Set());
      }

      // Select verse range
      if (parsedRef.verse != null && parsedRef.verseTo != null) {
        const targetChapter = chapter ?? selectedChapter;
        if (targetChapter) {
          const verseNumbers = new Set(
            targetChapter.verses
              .filter(v => {
                const num = parseInt(v.number);
                return num >= parsedRef.verse! && num <= parsedRef.verseTo!;
              })
              .map(v => v.number)
          );
          setSelectedVerses(verseNumbers);
        }
      }
    }
  }, [parsedRef, bible, bookNameCache]);

  // Toggle verse selection
  const toggleVerse = useCallback((verseNumber: string) => {
    setSelectedVerses(prev => {
      const next = new Set(prev);
      if (next.has(verseNumber)) {
        next.delete(verseNumber);
      } else {
        next.add(verseNumber);
      }
      return next;
    });
  }, []);

  // Calculate slide count
  const slideCount = useMemo(() => {
    if (!selectedChapter || selectedVerses.size === 0) return 0;
    
    const selectedVerseList = selectedChapter.verses
      .filter(v => selectedVerses.has(v.number))
      .sort((a, b) => parseInt(a.number) - parseInt(b.number))
      .map(v => `${v.number}. ${v.text}`);

    return splitVersesIntoChunks(selectedVerseList).length;
  }, [selectedChapter, selectedVerses]);

  // Send verses to live
  const handleSendToLive = useCallback(() => {
    if (!selectedBook || !selectedChapter || selectedVerses.size === 0) return;

    const sortedVerses = selectedChapter.verses
      .filter(v => selectedVerses.has(v.number))
      .sort((a, b) => parseInt(a.number) - parseInt(b.number));

    const verseNumbers = sortedVerses.map(v => v.number);
    const firstVerse = verseNumbers[0];
    const lastVerse = verseNumbers[verseNumbers.length - 1];
    
    const title = `${selectedBook.name} ${selectedChapter.number}:${
      verseNumbers.length > 1 ? `${firstVerse}–${lastVerse}` : firstVerse
    }`;
    
    const lines = sortedVerses.map(v => `${v.number}. ${v.text}`);
    const chunks = splitVersesIntoChunks(lines).map(chunk => `${title}\n\n${chunk}`);
    const group = `${selectedBook.name} ${selectedChapter.number}`;

    if (chunks.length > 1) {
      onSendToLive(chunks, { groupTitle: group });
    } else {
      onSendToLive(chunks[0]);
    }

    setSelectedVerses(new Set());
  }, [selectedBook, selectedChapter, selectedVerses, onSendToLive]);

  // Double-click a verse to send directly to live
  const handleDoubleClickVerse = useCallback((verse: Verse) => {
    if (!selectedBook || !selectedChapter) return;

    const title = `${selectedBook.name} ${selectedChapter.number}:${verse.number}`;
    const content = `${title}\n\n${verse.number}. ${verse.text}`;
    const group = `${selectedBook.name} ${selectedChapter.number}`;

    onSendToLive(content, { groupTitle: group, goLive: true });
  }, [selectedBook, selectedChapter, onSendToLive]);

  // Navigate to a content search result
  const navigateToResult = useCallback((result: { book: BibleBook; chapter: Chapter; verse: Verse }) => {
    setSelectedBook(result.book);
    setSelectedChapter(result.chapter);
    setSelectedVerses(new Set([result.verse.number]));
  }, []);

  // Send selected content search results as slides
  const handleSendContentResults = useCallback(() => {
    if (!contentSearchResults || selectedContentResults.size === 0) return;

    const selected = contentSearchResults.filter(r => {
      const key = `${r.book.number}:${r.chapter.number}:${r.verse.number}`;
      return selectedContentResults.has(key);
    });

    const group = `${t('common.scriptureTitle')}: ${deferredSearch}`;
    const slides = selected.map(r => {
      const title = `${r.book.name} ${r.chapter.number}:${r.verse.number}`;
      return `${title}\n\n${r.verse.number}. ${r.verse.text}`;
    });

    if (slides.length > 1) {
      onSendToLive(slides, { groupTitle: group });
    } else {
      onSendToLive(slides[0]);
    }

    setSelectedContentResults(new Set());
  }, [contentSearchResults, selectedContentResults, onSendToLive, deferredSearch, t]);

  // Clear cache handler
  const handleClearCache = useCallback(async () => {
    const confirmed = await confirmDialog(t('common.scriptureConfirmClear'));
    if (!confirmed) return;

    BibleCache.clear();
    clearLastBibleSource();
    BibleCache.removeStoredPath();
    setBible(null);
    setSelectedBook(null);
    setSelectedChapter(null);
    setSelectedVerses(new Set());
    setSearchTerm('');
    setParseError(null);
  }, [t]);

  // Keyboard shortcut handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeTag = (document.activeElement as HTMLElement)?.tagName;
      if (e.key === '/' && activeTag !== 'INPUT' && activeTag !== 'TEXTAREA') {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // ─── Render Helpers ──────────────────────────────────────────────────────

  const renderBookList = () => {
    if (!bible) {
      return (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 p-6 text-center">
          <div aria-live="polite" aria-atomic="true">
            {parseError && (
              <div className="w-full rounded-xl bg-red-500/10 border border-red-500/20 p-3 text-left mb-2">
                <p className="text-xs text-red-300 font-semibold">{parseError}</p>
                <button
                  onClick={() => setParseError(null)}
                  className="text-[11px] text-red-400 hover:text-red-300 mt-1 underline"
                >
                  {t('common.scriptureClear')}
                </button>
              </div>
            )}
          </div>
          <div className="w-16 h-16 rounded-2xl bg-zinc-900 flex items-center justify-center">
            <Book className="w-6 h-6 text-zinc-700" aria-hidden="true" />
          </div>
          <p className="text-[13px] text-zinc-500 leading-relaxed">
            {t('common.scriptureEmptyDesc')}
          </p>
        </div>
      );
    }

    if (oldTestament.length === 0 && newTestament.length === 0) {
      return (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-[13px] text-zinc-600">{t('common.scriptureNoMatch')}</p>
        </div>
      );
    }

    return (
      <div className="flex-1 overflow-y-auto px-3 pb-4 space-y-6 custom-scrollbar">
        {oldTestament.length > 0 && (
          <div>
            <div className="px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-zinc-600">
              {t('common.scriptureOldTestament')}
            </div>
            <div className="space-y-0.5">
              {oldTestament.map(book => (
                <BookRow
                  key={book.number}
                  book={book}
                  isActive={selectedBook?.number === book.number}
                  onClick={() => {
                    setSelectedBook(book);
                    setSelectedChapter(null);
                    setSelectedVerses(new Set());
                  }}
                />
              ))}
            </div>
          </div>
        )}
        {newTestament.length > 0 && (
          <div>
            <div className="px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-zinc-600">
              {t('common.scriptureNewTestament')}
            </div>
            <div className="space-y-0.5">
              {newTestament.map(book => (
                <BookRow
                  key={book.number}
                  book={book}
                  isActive={selectedBook?.number === book.number}
                  onClick={() => {
                    setSelectedBook(book);
                    setSelectedChapter(null);
                    setSelectedVerses(new Set());
                  }}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderChapterSelector = () => {
    if (!selectedBook) return null;

    return (
      <div className="w-[280px] shrink-0 flex flex-col border-r border-zinc-800/50 bg-[#0c0c0e]">
        <div className="px-6 pt-6 pb-4">
          <button
            onClick={() => setSelectedBook(null)}
            className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-zinc-500 hover:text-zinc-300 transition-colors mb-4"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            {t('common.scriptureBackToBooks')}
          </button>
          <h3 className="text-xl font-bold text-zinc-100 truncate tracking-tight">
            {selectedBook.name}
          </h3>
          <p className="text-[12px] text-zinc-500 mt-1">
            {t('common.scriptureChapters', { count: selectedBook.chapters.length })}
          </p>
        </div>
        <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
          <div className="grid grid-cols-4 gap-2">
            {selectedBook.chapters.map(ch => (
              <button
                key={ch.number}
                onClick={() => {
                  setSelectedChapter(ch);
                  setSelectedVerses(new Set());
                }}
                className={cn(
                  'aspect-square rounded-xl text-[14px] font-semibold transition-[background-color,border-color,box-shadow,transform] duration-200 border tabular-nums',
                  parsedRef?.chapter === parseInt(ch.number)
                    ? 'bg-blue-500 border-blue-400 text-white shadow-lg shadow-blue-500/20 scale-105'
                    : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 hover:border-zinc-700',
                )}
              >
                {ch.number}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  };

  const renderVerseList = () => {
    if (!selectedChapter || !selectedBook) return null;

    const currentIndex = selectedBook.chapters.findIndex(
      c => c.number === selectedChapter.number
    );
    const prevChapter = currentIndex > 0 ? selectedBook.chapters[currentIndex - 1] : null;
    const nextChapter = currentIndex < selectedBook.chapters.length - 1
      ? selectedBook.chapters[currentIndex + 1]
      : null;

    return (
      <div className="flex-1 flex flex-col overflow-hidden bg-[#0a0a0b] relative">
        {/* Header */}
        <div className="px-6 py-4 border-b border-zinc-800/60 bg-[#0a0a0b]/80 backdrop-blur-md z-10 flex items-center justify-between gap-4 sticky top-0">
          <div className="flex items-center gap-4 min-w-0">
            <button
              onClick={() => {
                setSelectedChapter(null);
                setSelectedVerses(new Set());
              }}
              className="w-8 h-8 rounded-full bg-zinc-900 hover:bg-zinc-800 flex items-center justify-center text-zinc-400 hover:text-zinc-200 transition-colors shrink-0"
              aria-label={t('common.scriptureBackToChapters')}
            >
              <ArrowLeft className="w-4 h-4" aria-hidden="true" />
            </button>
            <div className="min-w-0">
              <h3 className="text-lg font-bold text-zinc-100 truncate tracking-tight">
                {selectedBook.name}{' '}
                <span className="text-zinc-500">{selectedChapter.number}</span>
              </h3>
              <p className="text-[12px] text-zinc-500 mt-0.5">
                {t('common.scriptureVerses', { count: selectedChapter.verses.length })}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0 bg-zinc-900/50 p-1 rounded-lg border border-zinc-800/50">
            {selectedVerses.size > 0 && (
              <button
                onClick={() => setSelectedVerses(new Set())}
                className="text-[12px] font-medium text-zinc-400 hover:text-zinc-200 transition-colors px-3 py-1.5 rounded-md hover:bg-zinc-800"
              >
                {t('common.scriptureClear')}
              </button>
            )}
            <button
              onClick={() =>
                setSelectedVerses(new Set(selectedChapter.verses.map(v => v.number)))
              }
              className="px-3 py-1.5 rounded-md bg-zinc-800 text-[12px] font-medium text-zinc-200 hover:bg-zinc-700 hover:text-white transition-[background-color] active:scale-[0.96]"
            >
              {t('common.scriptureSelectAll')}
            </button>
          </div>
        </div>

        {/* Chapter Navigation */}
        <div className="flex border-b border-zinc-800/50 bg-[#0d0d0f]">
          <button
            onClick={() => {
              if (prevChapter) {
                setSelectedChapter(prevChapter);
                setSelectedVerses(new Set());
              }
            }}
            disabled={!prevChapter}
            className="flex-1 py-2 text-[11px] font-bold tracking-widest uppercase text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/50 disabled:opacity-20 transition-[color,background-color] active:scale-[0.98] disabled:active:scale-100"
          >
            {prevChapter ? t('common.scripturePrevChapter', { number: prevChapter.number }) : ''}
          </button>
          <div className="px-6 flex items-center text-[12px] font-semibold text-zinc-600 bg-zinc-900/30">
            {selectedChapter.number}{' '}
            <span className="mx-1 text-zinc-700">/</span>{' '}
            {selectedBook.chapters.length}
          </div>
          <button
            onClick={() => {
              if (nextChapter) {
                setSelectedChapter(nextChapter);
                setSelectedVerses(new Set());
              }
            }}
            disabled={!nextChapter}
            className="flex-1 py-2 text-[11px] font-bold tracking-widest uppercase text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/50 disabled:opacity-20 transition-[color,background-color] active:scale-[0.98] disabled:active:scale-100"
          >
            {nextChapter ? t('common.scriptureNextChapter', { number: nextChapter.number }) : ''}
          </button>
        </div>

        {/* Virtual Verse List */}
        <div
          ref={containerRef}
          className="flex-1 overflow-y-auto py-4 custom-scrollbar"
        >
          <div style={{ height: totalHeight, position: 'relative' }}>
            {selectedChapter.verses
              .slice(startIndex, endIndex)
              .map((verse, index) => (
                <VerseRow
                  key={verse.number}
                  verse={verse}
                  top={(startIndex + index) * VERSE_HEIGHT}
                  isSelected={selectedVerses.has(verse.number)}
                  onToggle={toggleVerse}
                  onDoubleClick={handleDoubleClickVerse}
                />
              ))}
          </div>
        </div>

        {/* Send Bar */}
        <div
          className={cn(
            'border-t border-zinc-800 bg-[#0a0a0b]/90 backdrop-blur-md transition-all duration-300 ease-in-out overflow-hidden absolute bottom-0 left-0 right-0',
            selectedVerses.size > 0
              ? 'translate-y-0 opacity-100 p-6'
              : 'translate-y-full opacity-0 p-0'
          )}
        >
          {selectedVerses.size > 0 && (
            <div className="max-w-2xl mx-auto space-y-3">
              <div className="flex items-center justify-between text-[12px] font-medium text-zinc-400 px-1">
                <span>{t('common.scriptureVersesSelected', { count: selectedVerses.size })}</span>
                {slideCount > 1 && (
                  <span className="flex items-center gap-1.5 text-blue-400">
                    <Layers className="w-3.5 h-3.5" />
                    {t('common.scriptureSplitInto', { count: slideCount })}
                  </span>
                )}
              </div>
              <button
                onClick={handleSendToLive}
                className="w-full flex items-center justify-center gap-2.5 py-3.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-[15px] transition-all shadow-lg shadow-blue-500/25 active:scale-[0.99]"
              >
                <Send className="w-4 h-4" />
                {(() => {
                  const nums = [...selectedVerses]
                    .map(Number)
                    .sort((a, b) => a - b);
                  const ref = `${selectedBook.name} ${selectedChapter.number}:${
                    nums.length === 1 ? nums[0] : `${nums[0]}–${nums[nums.length - 1]}`
                  }`;
                  return t('common.scriptureAddToPresentation', { ref });
                })()}
              </button>
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderEmptyState = () => (
    <div className="flex-1 flex flex-col items-center justify-center gap-5 text-zinc-500 select-none bg-[#0a0a0b]">
      <div className="w-20 h-20 rounded-3xl bg-zinc-900/50 border border-zinc-800 flex items-center justify-center shadow-inner">
        <BookOpen className="w-8 h-8 opacity-40 text-zinc-400" />
      </div>
      <div className="text-center">
        <p className="text-base font-semibold text-zinc-300">
          {t('common.scriptureSelectBook')}
        </p>
        <p className="text-[13px] mt-2 text-zinc-600">
          {t('common.scriptureSearchHint')}{' '}
          <span className="bg-zinc-800 px-1.5 py-0.5 rounded text-zinc-400">
            {t('common.scriptureSearchExample')}
          </span>{' '}
          {t('common.scriptureSearchSuffix')}
        </p>
      </div>
    </div>
  );

  const renderContentSearchResults = () => {
    if (!contentSearch || !deferredSearch || deferredSearch.length < 2) return null;

    const results = contentSearchResults;
    if (!results || results.length === 0) {
      return (
        <div className="flex-1 flex items-center justify-center bg-[#0a0a0b]">
          <p className="text-[13px] text-zinc-600">No matching verses found</p>
        </div>
      );
    }

    const toggleContentResult = (key: string) => {
      setSelectedContentResults(prev => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      });
    };

    const resultKey = (r: typeof results[number]) => `${r.book.number}:${r.chapter.number}:${r.verse.number}`;

    return (
      <div className="flex-1 flex flex-col overflow-hidden bg-[#0a0a0b]">
        <div className="px-6 py-4 border-b border-zinc-800/60 bg-[#0a0a0b]/80 backdrop-blur-md z-10 sticky top-0">
          <h3 className="text-sm font-bold text-zinc-300">
            Search results ({results.length})
          </h3>
        </div>
        <div className="flex-1 overflow-y-auto py-4 custom-scrollbar">
          <div className="space-y-1 px-4">
            {results.map((result, idx) => {
              const ref = `${result.book.name} ${result.chapter.number}:${result.verse.number}`;
              const normalizedText = normalize(result.verse.text);
              const query = normalize(deferredSearch);
              const matchIdx = normalizedText.indexOf(query);
              let before = '', match = '', after = '';
              if (matchIdx !== -1) {
                const originalMatch = result.verse.text.slice(matchIdx, matchIdx + query.length);
                before = result.verse.text.slice(0, matchIdx);
                match = originalMatch;
                after = result.verse.text.slice(matchIdx + query.length);
              }
              const key = resultKey(result);
              const isSelected = selectedContentResults.has(key);

              return (
                <div
                  key={key}
                  className="flex items-start gap-3 p-4 rounded-xl bg-zinc-900/30 border border-transparent hover:bg-zinc-800/50 hover:border-zinc-700/50 transition-all group"
                >
                  <button
                    onClick={(e) => { e.stopPropagation(); toggleContentResult(key); }}
                    className={cn(
                      'mt-0.5 w-5 h-5 rounded-lg border-2 flex items-center justify-center shrink-0 transition-all',
                      isSelected
                        ? 'bg-blue-600 border-blue-600'
                        : 'border-zinc-600 hover:border-zinc-500'
                    )}
                  >
                    {isSelected && <Check className="w-3.5 h-3.5 text-white" strokeWidth={3} />}
                  </button>
                  <button
                    onClick={() => navigateToResult(result)}
                    className="flex-1 text-left min-w-0"
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[12px] font-bold text-blue-400/80">{ref}</span>
                      <ChevronRight className="w-3 h-3 text-zinc-600 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                    <p className="text-[13px] leading-relaxed text-zinc-400 group-hover:text-zinc-300 transition-colors line-clamp-2">
                      {matchIdx !== -1 ? (
                        <>{before}<span className="text-blue-300 bg-blue-500/10 rounded px-0.5">{match}</span>{after}</>
                      ) : (
                        result.verse.text
                      )}
                    </p>
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {/* Content Search Send Bar */}
        <div
          className={cn(
            'border-t border-zinc-800 bg-[#0a0a0b]/90 backdrop-blur-md transition-all duration-300 ease-in-out overflow-hidden',
            selectedContentResults.size > 0
              ? 'max-h-20 p-6'
              : 'max-h-0 p-0'
          )}
        >
          {selectedContentResults.size > 0 && (
            <div className="max-w-2xl mx-auto space-y-3">
              <div className="flex items-center justify-between text-[12px] font-medium text-zinc-400 px-1">
                <span>{selectedContentResults.size} ayet seçildi</span>
              </div>
              <button
                onClick={handleSendContentResults}
                className="w-full flex items-center justify-center gap-2.5 py-3.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-[15px] transition-all shadow-lg shadow-blue-500/25 active:scale-[0.99]"
              >
                <Send className="w-4 h-4" />
                Sunuma Ekle ({selectedContentResults.size})
              </button>
            </div>
          )}
        </div>
      </div>
    );
  };

  // ─── Main Render ─────────────────────────────────────────────────────────

  return (
    <div className="flex h-full bg-surface-base overflow-hidden text-zinc-100 font-sans selection:bg-blue-500/30">
      {/* Left Panel - Book List */}
      <div className="w-[280px] shrink-0 flex flex-col border-r border-zinc-800/50 bg-[#0f0f11]">
        <div className="px-5 pt-6 pb-4">
          <div className="flex items-center justify-between mb-5">            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-blue-500/10 flex items-center justify-center">
                <BookOpen className="w-4 h-4 text-blue-400" />
              </div>
              <span className="text-[12px] font-bold uppercase tracking-widest text-zinc-300">
                {t('common.scriptureTitle')}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleImportXML()}
                className="w-8 h-8 flex items-center justify-center rounded-xl bg-zinc-800/50 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 transition-all"
                title={t('common.scriptureImportXml')}
                aria-label={t('common.scriptureImportXml')}
              >
                <FileUp className="w-4 h-4" aria-hidden="true" />
              </button>
              <button
                onClick={handleBrowseOnline}
                disabled={isLoadingUnified}
                className="w-8 h-8 flex items-center justify-center rounded-xl bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 hover:text-blue-300 transition-all disabled:opacity-50"
                title={t('common.scriptureBrowseOnline')}
                aria-label={t('common.scriptureBrowseOnline')}
              >
                {isLoadingUnified ? (
                  <Loader className="w-4 h-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Globe className="w-4 h-4" aria-hidden="true" />
                )}
              </button>
              <button
                onClick={handleClearCache}
                className="w-8 h-8 flex items-center justify-center rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-400 hover:text-red-300 transition-all"
                title={t('common.scriptureClearCache')}
                aria-label={t('common.scriptureClearCache')}
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>
          </div>

          {/* Search Input */}
          <div className="relative group">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 group-focus-within:text-blue-400 transition-colors pointer-events-none" />
            <input
              ref={searchInputRef}
              type="text"
              placeholder={contentSearch ? 'Search verse content…' : t('common.scriptureSearchPlaceholder')}
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') handleSendToLive();
              }}
              aria-label={t('common.scriptureSearchLabel')}
              className="w-full bg-zinc-900/50 border border-zinc-800 focus:border-blue-500/50 focus:bg-zinc-900 rounded-xl py-2.5 pl-10 pr-16 text-[13px] outline-none text-zinc-200 placeholder:text-zinc-600 transition-all shadow-sm"
            />
            <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
              <button
                onClick={() => setContentSearch(v => !v)}
                title={contentSearch ? 'Search by reference' : 'Search verse content'}
                aria-label={contentSearch ? 'Search by reference' : 'Search verse content'}
                className={cn(
                  'w-7 h-7 flex items-center justify-center rounded-lg transition-all',
                  contentSearch
                    ? 'bg-blue-500/20 text-blue-400'
                    : 'text-zinc-600 hover:text-zinc-400 hover:bg-zinc-800',
                )}
              >
                <Type className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
              {searchTerm && (
                <button
                  onClick={() => {
                    setSearchTerm('');
                    if (!contentSearch) {
                      setSelectedBook(null);
                      setSelectedChapter(null);
                      setSelectedVerses(new Set());
                    }
                  }}
                  className="text-zinc-500 hover:text-zinc-300 transition-colors bg-zinc-800 rounded-full p-0.5"
                  aria-label={t('common.scriptureClear')}
                >
                  <X className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              )}
            </div>
          </div>

          {/* Reference Hint */}
          {parsedRef?.chapter && (
            <div className="mt-3 px-3 py-2 bg-blue-500/5 border border-blue-500/10 rounded-xl flex items-center gap-2">
              <Hash className="w-3.5 h-3.5 text-blue-400/80 shrink-0" />
              <span className="text-[12px] text-blue-300/90 truncate font-medium">
                {parsedRef.book && bookNameCache &&
                  bible?.books.find(b =>
                    bookNameCache.norms.get(b)!.includes(parsedRef.book)
                  )?.name}
                {parsedRef.chapter != null && ` ${parsedRef.chapter}`}
                {parsedRef.verse != null && `:${parsedRef.verse}`}
                {parsedRef.verseTo != null &&
                  parsedRef.verseTo !== parsedRef.verse &&
                  `–${parsedRef.verseTo}`}
              </span>
            </div>
          )}
        </div>

        {renderBookList()}
      </div>

      {/* Content Search Results or Chapter Selector / Verse List */}
      {contentSearch && deferredSearch?.length >= 2
        ? renderContentSearchResults()
        : selectedBook && !selectedChapter
          ? renderChapterSelector()
          : selectedChapter
            ? renderVerseList()
            : renderEmptyState()}

      {/* Online Bible Dialog (unified) */}
      <Dialog
        open={showOnlineBibleDialog}
        onClose={() => setShowOnlineBibleDialog(false)}
        labelledBy="online-bible-dialog-title"
        className="w-full max-w-lg rounded-[32px] border border-white/10 bg-zinc-900 shadow-2xl shadow-black/40 overflow-hidden"
      >
        <div className="p-6 max-h-[80vh] flex flex-col">
          <h2 id="online-bible-dialog-title" className="text-xl font-semibold mb-4 flex items-center gap-2">
            <Globe className="w-5 h-5 text-blue-400" aria-hidden="true" />
            {t('common.scriptureOnlineBibles')}
          </h2>

          {(onlineError || helloAoError) && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 mb-4 text-red-400 text-sm">
              {[onlineError, helloAoError].filter(Boolean).join('; ')}
            </div>
          )}

          <div className="relative mb-3">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 pointer-events-none" />
            <input
              type="text"
              placeholder={t('common.scriptureLanguageFilter')}
              value={languageFilter}
              onChange={e => setLanguageFilter(e.target.value)}
              aria-label={t('common.scriptureLanguageFilter')}
              className="w-full bg-zinc-900/50 border border-zinc-800 focus:border-blue-500/50 rounded-xl py-2 pl-10 pr-3 text-[13px] outline-none text-zinc-200 placeholder:text-zinc-600 transition-all"
            />
          </div>

          <div className="overflow-y-auto flex-1 mb-4 space-y-2">
            {isLoadingUnified ? (
              <div className="flex items-center justify-center gap-3 py-12">
                <Loader className="w-5 h-5 animate-spin text-blue-400" aria-hidden="true" />
                <span className="text-[13px] text-zinc-400">Loading Bibles…</span>
              </div>
            ) : unifiedBibleList.length === 0 ? (
              <p className="text-zinc-400 text-center py-8">
                {t('common.scriptureNoMatch')}
              </p>
            ) : (
              unifiedBibleList.map((item) => {
                const isGitHub = item.source === 'github';
                const isHelloAo = item.source === 'helloao';
                const isFetchBible = item.source === 'fetchbible';
                const isLoading = (isGitHub && isLoadingOnline) || (isHelloAo && isLoadingHelloAo) || (isFetchBible && isLoadingFetchBible);
                const handleDownload = isGitHub
                  ? () => handleDownloadOnlineBible(item.data as BibleInfo)
                  : isHelloAo
                    ? () => handleDownloadHelloAo(item.data as HelloAoTranslation)
                    : () => handleDownloadFetchBible(item.data as GetResourcesItem);

                return (
                  <button
                    key={`${item.source}:${item.id}`}
                    onClick={handleDownload}
                    disabled={isLoading}
                    className="w-full text-left p-3 rounded-lg bg-zinc-800/50 hover:bg-zinc-700/50 border border-zinc-700 hover:border-blue-500 transition-all disabled:opacity-50 group"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-medium text-zinc-100 truncate">{item.name}</p>
                          <span className={cn(
                            'text-[10px] font-semibold px-1.5 py-0.5 rounded shrink-0',
                            isGitHub && 'bg-blue-500/10 text-blue-400',
                            isHelloAo && 'bg-emerald-500/10 text-emerald-400',
                            isFetchBible && 'bg-violet-500/10 text-violet-400',
                          )}>
                            {isGitHub ? 'GitHub XML' : isHelloAo ? 'HelloAO' : 'fetch.bible'}
                          </span>
                        </div>
                        <p className="text-xs text-zinc-400 mt-0.5">
                          {item.language}
                          {item.detail && <> &middot; {item.detail}</>}
                        </p>
                      </div>
                      <div className="shrink-0 ml-2">
                        {isLoading ? (
                          <Loader className="w-4 h-4 animate-spin text-blue-400" aria-hidden="true" />
                        ) : (
                          <Download className="w-4 h-4 text-zinc-400 group-hover:text-blue-400 transition-colors" aria-hidden="true" />
                        )}
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>

          <button
            onClick={() => setShowOnlineBibleDialog(false)}
            className="w-full px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-all"
          >
            {t('common.scriptureClose')}
          </button>
        </div>
      </Dialog>

    <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 6px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #27272a; border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #3f3f46; }
      `}</style>
    </div>
  );
}
