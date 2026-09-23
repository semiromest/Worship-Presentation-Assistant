import { memo, useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Menu } from '@base-ui/react/menu';
import type { GetResourcesItem } from '@gracious.tech/fetch-client';
import {
  BookMarked,
  BookOpen,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Download,
  FileUp,
  Globe2,
  Info,
  LoaderCircle,
  Radio,
  Search,
  Send,
  Settings2,
  Trash2,
  Wrench,
  X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { BibleBook, BibleData, Chapter, Verse } from './bibleParser';
import { parseBibleXMLAsync } from './bibleParser';
import { bibleRepository, type BibleSourceDescriptor } from './bibleRepository';
import { fixBibleBookNames, BOOK_NAMES_BY_LANGUAGE } from './bibleBookNames';
import { createBibleSearchIndexer, type BibleSearchIndex } from './bibleSearchIndex';
import {
  buildReferenceSuggestions,
  createScriptureSlides,
  filterBooksForReference,
  findBookForReference,
  formatVerseNumbers,
  getRecentScriptureReferences,
  parseScriptureReference,
  saveRecentScriptureReference,
  splitBibleTestaments,
  tokenizeScriptureText,
  type RecentScriptureReference,
  type ReferenceSuggestion,
} from './scriptureModel';
import { onlineBibleManager, type BibleInfo } from './onlineBibleManager';
import { helloAoApi, type HelloAoTranslation } from './helloAoApi';
import { fetchBibleApi } from './fetchBibleApi';
import { getBibleApi, GetBibleApiError, type GetBibleCatalog, type GetBibleTranslation } from './getBibleApi';
import { confirmDialog } from './dialogs';
import { cn, useDebounce } from './utils';
import Dialog from './components/Dialog';
import { useUiMotionEnabled } from './hooks/useUiMotionEnabled';

interface ScriptureBrowserProps {
  onSendToLive: (content: string | string[], options?: { groupTitle?: string; goLive?: boolean }) => void;
  active?: boolean;
}
type SearchMode = 'reference' | 'content';
type DirectorySource = 'github' | 'helloao' | 'fetchbible' | 'getbible';
type ProviderFilter = 'all' | DirectorySource;
interface DirectoryItem {
  id: string;
  name: string;
  language: string;
  languageCode?: string;
  detail: string;
  license?: string;
  versionDate?: string;
  source: DirectorySource;
  data: BibleInfo | HelloAoTranslation | GetResourcesItem | GetBibleTranslation;
}
const CHUNK_CONFIG = { maxVerses: 3, maxChars: 120, maxLines: 2 } as const;
const indexCache = new WeakMap<BibleData, BibleSearchIndex>();
const PROVIDERS: ProviderFilter[] = ['all', 'getbible', 'github', 'helloao', 'fetchbible'];
const PROVIDER_LABELS: Record<ProviderFilter, string> = {
  all: 'All',
  getbible: 'GetBible',
  github: 'GitHub',
  helloao: 'HelloAO',
  fetchbible: 'fetch.bible',
};
const LOCALE_LANGUAGE_NAMES: Record<string, string[]> = {
  tr: ['turkish', 'türkçe'],
  en: ['english'],
  de: ['german', 'deutsch'],
  es: ['spanish', 'español'],
  ko: ['korean', '한국어'],
};

const BookRow = memo(({ book, active, onClick }: { book: BibleBook; active: boolean; onClick: () => void }) => (
  <button
    type="button"
    onClick={onClick}
    aria-current={active ? 'true' : undefined}
    className={cn(
      'group flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-[13px] transition-colors',
      active ? 'bg-blue-500/15 font-semibold text-blue-300' : 'text-zinc-400 hover:bg-white/5 hover:text-white'
    )}
  >
    <span className="truncate">{book.name}</span>
    <ChevronRight className={cn('h-4 w-4', active ? 'opacity-100' : 'opacity-0 group-hover:opacity-60')} />
  </button>
));
BookRow.displayName = 'BookRow';

const VerseRow = memo(
  ({
    verse,
    selected,
    onToggle,
    label,
  }: {
    verse: Verse;
    selected: boolean;
    onToggle: (number: string, range: boolean) => void;
    label: string;
  }) => (
    <button
      id={`scripture-verse-${verse.number}`}
      type="button"
      aria-pressed={selected}
      aria-label={`${label} ${verse.number}: ${verse.text}`}
      onClick={(event) => onToggle(verse.number, event.shiftKey)}
      className={cn(
        'group flex w-full items-start gap-4 rounded-2xl border px-4 py-3.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/70',
        selected
          ? 'border-blue-500/30 bg-blue-500/10'
          : 'border-transparent bg-zinc-900/35 hover:border-zinc-700 hover:bg-zinc-800/55'
      )}
    >
      <span
        className={cn(
          'mt-0.5 flex h-7 min-w-7 shrink-0 items-center justify-center rounded-lg text-[11px] font-bold',
          selected ? 'bg-blue-500 text-white' : 'bg-zinc-800 text-zinc-400'
        )}
      >
        {selected ? <Check className="h-3.5 w-3.5" /> : verse.number}
      </span>
      <span className={cn('text-[14px] leading-6', selected ? 'font-medium text-zinc-100' : 'text-zinc-300')}>
        {verse.text}
      </span>
    </button>
  )
);
VerseRow.displayName = 'VerseRow';

export default function ScriptureBrowser({ onSendToLive, active = true }: ScriptureBrowserProps) {
  const { t, i18n } = useTranslation();
  const uiMotionEnabled = useUiMotionEnabled();
  const [bible, setBible] = useState<BibleData | null>(() => bibleRepository.currentBible);
  const [restoring, setRestoring] = useState(!bibleRepository.currentBible);
  const [source, setSource] = useState<BibleSourceDescriptor | null>(null);
  const [book, setBook] = useState<BibleBook | null>(null);
  const [chapter, setChapter] = useState<Chapter | null>(null);
  const [verses, setVerses] = useState<Set<string>>(new Set());
  const anchor = useRef<string | null>(null);
  const [scrollVerse, setScrollVerse] = useState<string | null>(null);
  const [mode, setMode] = useState<SearchMode>('reference');
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const deferredQuery = useDeferredValue(useDebounce(query));
  const [index, setIndex] = useState<BibleSearchIndex | null>(null);
  const [indexing, setIndexing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fixMessage, setFixMessage] = useState<string | null>(null);
  const [fixing, setFixing] = useState(false);
  const [recents, setRecents] = useState<RecentScriptureReference[]>([]);
  const [directoryOpen, setDirectoryOpen] = useState(false);
  const [directoryLoading, setDirectoryLoading] = useState(false);
  const [directoryErrors, setDirectoryErrors] = useState<string[]>([]);
  const [filter, setFilter] = useState('');
  const [githubBibles, setGithubBibles] = useState<BibleInfo[]>([]);
  const [helloBibles, setHelloBibles] = useState<HelloAoTranslation[]>([]);
  const [fetchBibles, setFetchBibles] = useState<GetResourcesItem[]>([]);
  const [getBibleCatalog, setGetBibleCatalog] = useState<GetBibleCatalog | null>(null);
  const [providerFilter, setProviderFilter] = useState<ProviderFilter>('all');
  const [downloading, setDownloading] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const automaticSelectionKey = useRef('');

  useEffect(() => {
    let mounted = true;
    void bibleRepository
      .restore()
      .then((value) => {
        if (mounted && value) {
          setBible(value);
          setSource(bibleRepository.currentSource);
        }
      })
      .catch(() => {
        if (mounted) setError(t('common.scriptureRestoreError'));
      })
      .finally(() => {
        if (mounted) setRestoring(false);
      });
    return () => {
      mounted = false;
    };
  }, [t]);
  const sourceId = source ? `${source.type}:${source.id}` : bible ? `${bible.format}:${bible.name}` : 'none';
  useEffect(() => setRecents(getRecentScriptureReferences(sourceId)), [sourceId]);

  useEffect(() => {
    if (!bible) {
      setIndex(null);
      setIndexing(false);
      return;
    }
    const cached = indexCache.get(bible);
    if (cached) {
      setIndex(cached);
      setIndexing(false);
      return;
    }
    const builder = createBibleSearchIndexer(bible, tokenizeScriptureText);
    let cancelled = false,
      idle: number | null = null,
      timer: number | null = null;
    setIndex(null);
    setIndexing(true);
    const run = () => {
      if (cancelled) return;
      if (builder.step(160)) {
        indexCache.set(bible, builder.index);
        setIndex(builder.index);
        setIndexing(false);
      } else schedule();
    };
    const schedule = () => {
      if (window.requestIdleCallback) idle = window.requestIdleCallback(run, { timeout: 400 });
      else timer = window.setTimeout(run, 0);
    };
    schedule();
    return () => {
      cancelled = true;
      if (idle != null) window.cancelIdleCallback?.(idle);
      if (timer != null) clearTimeout(timer);
    };
  }, [bible]);

  useEffect(() => {
    if (!scrollVerse || !chapter) return;
    const frame = requestAnimationFrame(() => {
      document
        .getElementById(`scripture-verse-${scrollVerse}`)
        ?.scrollIntoView({ block: 'center', behavior: uiMotionEnabled ? 'smooth' : 'auto' });
      setScrollVerse(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [chapter, scrollVerse, uiMotionEnabled]);
  useEffect(() => {
    if (!active) return;
    const key = (event: KeyboardEvent) => {
      const tag = (document.activeElement as HTMLElement | null)?.tagName;
      if (event.key === '/' && tag !== 'INPUT' && tag !== 'TEXTAREA') {
        event.preventDefault();
        inputRef.current?.focus();
      }
    };
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  }, [active]);

  const visibleBooks = useMemo(
    () => (mode === 'reference' ? filterBooksForReference(bible?.books ?? [], query) : (bible?.books ?? [])),
    [bible, mode, query]
  );
  const allTestaments = useMemo(() => splitBibleTestaments(bible?.books ?? []), [bible]);
  const testaments = useMemo(() => {
    const visibleNumbers = new Set(visibleBooks.map((item) => item.number));
    return {
      oldTestament: allTestaments.oldTestament.filter((item) => visibleNumbers.has(item.number)),
      newTestament: allTestaments.newTestament.filter((item) => visibleNumbers.has(item.number)),
    };
  }, [allTestaments, visibleBooks]);

  useLayoutEffect(() => {
    if (mode !== 'reference' || !bible || !query.trim()) {
      automaticSelectionKey.current = '';
      return;
    }
    const parsed = parseScriptureReference(query);
    if (!parsed) return;
    const nextBook = findBookForReference(bible.books, parsed.book);
    if (!nextBook) return;
    const requestedChapter =
      parsed.chapter == null
        ? (nextBook.chapters[0] ?? null)
        : (nextBook.chapters.find((item) => Number(item.number) === parsed.chapter) ?? null);
    const nextChapter = requestedChapter ?? nextBook.chapters[0] ?? null;
    const selected =
      requestedChapter && parsed.verse != null
        ? requestedChapter.verses
            .filter(
              (item) => Number(item.number) >= parsed.verse! && Number(item.number) <= (parsed.verseTo ?? parsed.verse!)
            )
            .map((item) => item.number)
        : [];
    const selectionKey = `${nextBook.number}:${nextChapter?.number ?? ''}:${selected.join(',')}`;
    if (automaticSelectionKey.current === selectionKey) return;
    automaticSelectionKey.current = selectionKey;
    setBook(nextBook);
    setChapter(nextChapter);
    setVerses(new Set(selected));
    anchor.current = selected.at(-1) ?? null;
    if (selected[0]) setScrollVerse(selected[0]);
  }, [bible, mode, query]);
  const results = useMemo(() => {
    if (mode !== 'content' || !bible || !index || deferredQuery.trim().length < 2) return [];
    const words = tokenizeScriptureText(deferredQuery).filter((word) => word.length > 1);
    const lists = words.map((word) => index.get(word) ?? []);
    if (!lists.length || lists.some((list) => !list.length)) return [];
    const sets = lists.map(
      (list) => new Set(list.map((item) => `${item.bookIndex}:${item.chapterIndex}:${item.verseIndex}`))
    );
    const smallest = lists.reduce((best, list, i) => (list.length < lists[best].length ? i : best), 0);
    const found: Array<{ book: BibleBook; chapter: Chapter; verse: Verse }> = [];
    for (const ref of lists[smallest]) {
      const key = `${ref.bookIndex}:${ref.chapterIndex}:${ref.verseIndex}`;
      if (!sets.every((set) => set.has(key))) continue;
      const b = bible.books[ref.bookIndex],
        c = b?.chapters[ref.chapterIndex],
        verse = c?.verses[ref.verseIndex];
      if (!b || !c || !verse) continue;
      found.push({ book: b, chapter: c, verse });
      if (found.length === 50) break;
    }
    return found;
  }, [bible, deferredQuery, index, mode]);
  const slides = useMemo(
    () => (book && chapter && verses.size ? createScriptureSlides(book, chapter, verses, CHUNK_CONFIG) : []),
    [book, chapter, verses]
  );
  const reference =
    book && chapter && verses.size ? `${book.name} ${chapter.number}:${formatVerseNumbers(verses)}` : '';

  const chooseBook = useCallback((next: BibleBook) => {
    setBook(next);
    setChapter(next.chapters[0] ?? null);
    setVerses(new Set());
    anchor.current = null;
  }, []);
  const chooseSuggestion = useCallback((item: ReferenceSuggestion) => {
    const nextChapter = item.chapter ?? item.book.chapters[0] ?? null;
    setBook(item.book);
    setChapter(nextChapter);
    setVerses(new Set(item.verseNumbers ?? []));
    anchor.current = item.verseNumbers?.at(-1) ?? null;
    setQuery(item.label);
    if (item.verseNumbers?.[0]) setScrollVerse(item.verseNumbers[0]);
  }, []);
  const chooseResult = useCallback((result: { book: BibleBook; chapter: Chapter; verse: Verse }) => {
    setMode('reference');
    setQuery('');
    setBook(result.book);
    setChapter(result.chapter);
    setVerses(new Set([result.verse.number]));
    anchor.current = result.verse.number;
    setScrollVerse(result.verse.number);
  }, []);
  const toggleVerse = useCallback(
    (number: string, range: boolean) => {
      if (!chapter) return;
      setVerses((previous) => {
        if (range && anchor.current) {
          const a = chapter.verses.findIndex((item) => item.number === anchor.current),
            b = chapter.verses.findIndex((item) => item.number === number);
          if (a >= 0 && b >= 0)
            return new Set(chapter.verses.slice(Math.min(a, b), Math.max(a, b) + 1).map((item) => item.number));
        }
        const next = new Set(previous);
        if (next.has(number)) next.delete(number);
        else next.add(number);
        anchor.current = number;
        return next;
      });
    },
    [chapter]
  );
  const send = useCallback(
    (goLive: boolean) => {
      if (!book || !chapter || !slides.length) return;
      onSendToLive(slides.length === 1 ? slides[0] : slides, { groupTitle: `${book.name} ${chapter.number}`, goLive });
      setRecents(saveRecentScriptureReference(sourceId, { book, chapter, verseNumbers: [...verses] }));
      setVerses(new Set());
      anchor.current = null;
    },
    [book, chapter, onSendToLive, slides, sourceId, verses]
  );

  const applyBible = useCallback((data: BibleData, descriptor: BibleSourceDescriptor) => {
    setIndex(null);
    setIndexing(true);
    setBible(data);
    setSource(descriptor);
    setBook(null);
    setChapter(null);
    setVerses(new Set());
    setQuery('');
    setError(null);
  }, []);
  const importXml = useCallback(async () => {
    try {
      const data = await bibleRepository.importLocal();
      if (data)
        applyBible(data, bibleRepository.currentSource ?? { type: 'local', id: data.name, format: data.format });
    } catch {
      setError(t('common.scriptureParseError'));
    }
  }, [applyBible, t]);
  const loadDirectory = useCallback(async () => {
    setDirectoryOpen(true);
    setDirectoryLoading(true);
    setDirectoryErrors([]);
    const loaded = await Promise.allSettled([
      onlineBibleManager.fetchBibleList(),
      helloAoApi.fetchTranslations(),
      fetchBibleApi.fetchTranslations(),
      getBibleApi.fetchCatalog(),
    ]);
    const errors: string[] = [];
    if (loaded[0].status === 'fulfilled') setGithubBibles(loaded[0].value.bibles);
    else errors.push(t('common.scriptureSourceGitHubError'));
    if (loaded[1].status === 'fulfilled') setHelloBibles(loaded[1].value);
    else errors.push(t('common.scriptureSourceHelloAoError'));
    if (loaded[2].status === 'fulfilled') setFetchBibles(loaded[2].value);
    else errors.push(t('common.scriptureSourceFetchBibleError'));
    if (loaded[3].status === 'fulfilled') setGetBibleCatalog(loaded[3].value);
    else errors.push(t('common.scriptureSourceGetBibleError'));
    setDirectoryErrors(errors);
    setDirectoryLoading(false);
  }, [t]);
  const directory = useMemo<DirectoryItem[]>(() => {
    const items: DirectoryItem[] = [
      ...githubBibles.map((item) => ({
        id: item.filename,
        name: item.name,
        language: item.language,
        detail: item.version,
        source: 'github' as const,
        data: item,
      })),
      ...helloBibles.map((item) => ({
        id: item.id,
        name: item.englishName || item.name,
        language: item.languageEnglishName || item.languageName,
        detail: t('common.scriptureBookCount', { count: item.numberOfBooks }),
        source: 'helloao' as const,
        data: item,
      })),
      ...fetchBibles.map((item) => ({
        id: item.id,
        name: item.name_bilingual || item.name || item.name_english || item.id,
        language: item.language || '',
        detail: '',
        source: 'fetchbible' as const,
        data: item,
      })),
      ...(getBibleCatalog?.translations ?? []).map((item) => ({
        id: item.abbreviation,
        name: item.translation,
        language: item.language,
        languageCode: item.lang,
        detail: item.distribution_abbreviation || item.description,
        license: item.distribution_license,
        versionDate: item.distribution_version_date,
        source: 'getbible' as const,
        data: item,
      })),
    ];
    const q = filter.trim().toLocaleLowerCase();
    const locale = (i18n.resolvedLanguage || i18n.language || 'en').split('-')[0].toLowerCase();
    const localeNames = LOCALE_LANGUAGE_NAMES[locale] ?? [];
    const languageScore = (item: DirectoryItem) => {
      const language = item.language.toLocaleLowerCase();
      return item.languageCode?.toLowerCase() === locale || localeNames.some((name) => language.includes(name)) ? 0 : 1;
    };
    return items
      .filter((item) => providerFilter === 'all' || item.source === providerFilter)
      .filter(
        (item) =>
          !q ||
          `${item.name} ${item.language} ${item.detail} ${item.source} ${PROVIDER_LABELS[item.source]}`
            .toLocaleLowerCase()
            .includes(q)
      )
      .sort(
        (a, b) =>
          languageScore(a) - languageScore(b) || a.language.localeCompare(b.language) || a.name.localeCompare(b.name)
      );
  }, [
    fetchBibles,
    filter,
    getBibleCatalog,
    githubBibles,
    helloBibles,
    i18n.language,
    i18n.resolvedLanguage,
    providerFilter,
    t,
  ]);
  const visibleDirectory = useMemo(() => directory.slice(0, 120), [directory]);
  const download = useCallback(
    async (item: DirectoryItem) => {
      const key = `${item.source}:${item.id}`;
      setDownloading(key);
      setProgress(null);
      setDirectoryErrors([]);
      try {
        let data: BibleData;
        let descriptor: BibleSourceDescriptor;
        if (item.source === 'github') {
          const info = item.data as BibleInfo;
          data = await parseBibleXMLAsync(await onlineBibleManager.downloadBibleXml(info.filename));
          descriptor = { type: 'online', id: info.filename, format: data.format };
        } else if (item.source === 'helloao') {
          const info = item.data as HelloAoTranslation;
          data = helloAoApi.helloAoToBibleData(await helloAoApi.fetchCompleteBible(info.id));
          descriptor = { type: 'helloao', id: info.id, format: data.format };
        } else if (item.source === 'fetchbible') {
          const info = item.data as GetResourcesItem;
          data = await fetchBibleApi.preloadBible(info.id, (done, total) => setProgress({ done, total }));
          descriptor = { type: 'fetchbible', id: info.id, format: data.format };
        } else {
          const info = item.data as GetBibleTranslation;
          data = await getBibleApi.downloadBible(info, ({ done, total }) => setProgress({ done, total }));
          descriptor = {
            type: 'getbible',
            id: info.abbreviation,
            format: data.format,
            providerName: 'GetBible',
            description: info.description,
            license: info.distribution_license,
            sourceUrl: info.url,
            versionDate: info.distribution_version_date,
            revision: info.sha,
          };
        }
        await bibleRepository.persistDownloaded(descriptor, data);
        applyBible(data, descriptor);
        setDirectoryOpen(false);
      } catch (downloadError) {
        if (downloadError instanceof GetBibleApiError && downloadError.status === 429) {
          setDirectoryErrors([
            t('common.scriptureGetBibleRateLimited', {
              retryAfter: downloadError.retryAfter || t('common.scriptureRetryLater'),
            }),
          ]);
        } else if (downloadError instanceof GetBibleApiError && downloadError.status === 503) {
          setDirectoryErrors([t('common.scriptureGetBibleUnavailable')]);
        } else {
          setDirectoryErrors([t('common.scriptureDownloadError')]);
        }
      } finally {
        setDownloading(null);
        setProgress(null);
      }
    },
    [applyBible, t]
  );
  const fixNames = useCallback(
    async (language: 'tr' | 'en') => {
      if (!bible) return;
      setFixing(true);
      try {
        const result = fixBibleBookNames(bible, BOOK_NAMES_BY_LANGUAGE[language]);
        if (!result.renamedCount) setFixMessage(t('common.scriptureFixBookNamesAlready'));
        else {
          applyBible(result.bible, source ?? { type: 'local', id: bibleRepository.sourceId, format: bible.format });
          await bibleRepository.persistCurrent(result.bible);
          setFixMessage(t('common.scriptureFixBookNamesDone', { count: result.renamedCount }));
        }
      } finally {
        setFixing(false);
      }
    },
    [applyBible, bible, source, t]
  );
  const clearBible = useCallback(async () => {
    if (!(await confirmDialog(t('common.scriptureConfirmClear')))) return;
    await bibleRepository.clear();
    getBibleApi.clearCache();
    setBible(null);
    setSource(null);
    setBook(null);
    setChapter(null);
    setVerses(new Set());
    setQuery('');
  }, [t]);

  const directoryDialog = (
    <Dialog
      open={directoryOpen}
      onClose={() => setDirectoryOpen(false)}
      labelledBy="bible-directory-title"
      className="w-[min(680px,calc(100vw-32px))] rounded-[28px] border border-white/10 bg-zinc-900 shadow-2xl shadow-black/50"
    >
      <div className="flex max-h-[82vh] flex-col p-6">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 id="bible-directory-title" className="flex items-center gap-2 text-xl font-semibold">
              <Globe2 className="h-5 w-5 text-blue-400" />
              {t('common.scriptureOnlineBibles')}
            </h2>
            <p className="mt-1 text-sm text-zinc-500">{t('common.scriptureOnlineBiblesDesc')}</p>
          </div>
          <button
            type="button"
            onClick={() => setDirectoryOpen(false)}
            aria-label={t('common.close')}
            className="rounded-lg p-2 text-zinc-500 hover:bg-white/5 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
          <input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder={t('common.scriptureLanguageFilter')}
            aria-label={t('common.scriptureLanguageFilter')}
            className="w-full rounded-xl border border-zinc-700 bg-zinc-950/60 py-2.5 pl-10 pr-3 text-sm outline-none focus:border-blue-500/60"
          />
        </div>
        <div className="mb-3 flex flex-wrap gap-1.5" aria-label={t('common.scriptureProviderFilter')}>
          {PROVIDERS.map((provider) => (
            <button
              key={provider}
              type="button"
              aria-pressed={providerFilter === provider}
              onClick={() => setProviderFilter(provider)}
              className={cn(
                'rounded-full border px-3 py-1.5 text-[11px] font-semibold transition-colors',
                providerFilter === provider
                  ? 'border-blue-500/40 bg-blue-500/15 text-blue-200'
                  : 'border-zinc-800 bg-zinc-950/50 text-zinc-500 hover:border-zinc-700 hover:text-zinc-300'
              )}
            >
              {provider === 'all' ? t('common.all') : PROVIDER_LABELS[provider]}
            </button>
          ))}
        </div>
        {providerFilter === 'getbible' && getBibleCatalog && (
          <p className="mb-3 flex items-start gap-2 rounded-xl border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-[11px] leading-5 text-zinc-400">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-400" />
            {t('common.scriptureGetBibleLicenseSummary', {
              total: getBibleCatalog.total,
            })}
          </p>
        )}
        {directoryErrors.length > 0 && (
          <div
            className="mb-3 flex justify-between gap-3 rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-200"
            role="alert"
          >
            <span>{directoryErrors.join(' · ')}</span>
            <button type="button" onClick={() => void loadDirectory()} className="font-semibold underline">
              {t('common.retry')}
            </button>
          </div>
        )}
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto custom-scrollbar">
          {directoryLoading ? (
            <div className="grid min-h-48 place-items-center text-sm text-zinc-500">
              <LoaderCircle className="h-5 w-5 animate-spin" />
            </div>
          ) : directory.length ? (
            <>
              {directory.length > visibleDirectory.length && (
                <p className="sticky top-0 z-10 mb-2 rounded-xl border border-blue-500/20 bg-blue-950/95 px-3 py-2 text-xs text-blue-200 backdrop-blur">
                  {t('common.scriptureRefineSourceSearch', {
                    visible: visibleDirectory.length,
                    total: directory.length,
                  })}
                </p>
              )}
              {visibleDirectory.map((item) => {
                const key = `${item.source}:${item.id}`,
                  busy = downloading === key;
                return (
                  <button
                    key={key}
                    type="button"
                    disabled={downloading != null}
                    onClick={() => void download(item)}
                    className="flex w-full items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-950/40 p-3 text-left hover:border-blue-500/30 disabled:opacity-60"
                  >
                    <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-zinc-800">
                      {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{item.name}</span>
                      <span className="block truncate text-xs text-zinc-500">
                        {item.language}
                        {item.detail ? ` · ${item.detail}` : ''}
                      </span>
                      {(item.versionDate || item.license) && (
                        <span className="mt-0.5 block truncate text-[10px] text-zinc-600">
                          {[item.versionDate, item.license].filter(Boolean).join(' · ')}
                        </span>
                      )}
                      {busy && progress && (
                        <span className="mt-2 block h-1.5 rounded-full bg-zinc-800">
                          <span
                            className="block h-full rounded-full bg-blue-500"
                            style={{ width: `${(progress.done / Math.max(progress.total, 1)) * 100}%` }}
                          />
                        </span>
                      )}
                    </span>
                    <span className="text-[9px] font-bold uppercase text-zinc-600">{PROVIDER_LABELS[item.source]}</span>
                  </button>
                );
              })}
            </>
          ) : (
            <div className="grid min-h-48 place-items-center text-sm text-zinc-500">
              {t('common.scriptureNoBibleMatch')}
            </div>
          )}
        </div>
      </div>
    </Dialog>
  );

  if (restoring)
    return (
      <div className="grid h-full place-items-center bg-[#09090b] text-sm text-zinc-500" role="status">
        <span className="flex items-center gap-2">
          <LoaderCircle className="h-4 w-4 animate-spin" />
          {t('common.scriptureRestoring')}
        </span>
      </div>
    );
  if (!bible)
    return (
      <div className="relative grid h-full place-items-center overflow-hidden bg-[#09090b] p-8">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_25%,rgba(59,130,246,0.1),transparent_42%)]" />
        <div className="relative w-full max-w-lg rounded-[32px] border border-white/10 bg-zinc-900/70 p-8 text-center shadow-2xl">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-500/10 text-blue-300">
            <BookOpen className="h-7 w-7" />
          </div>
          <h2 className="mt-5 text-2xl font-semibold">{t('common.scriptureSetupTitle')}</h2>
          <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-zinc-400">{t('common.scriptureSetupDesc')}</p>
          {error && <p className="mt-4 rounded-xl bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>}
          <div className="mt-7 grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => void loadDirectory()}
              className="flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold hover:bg-blue-500"
            >
              <Globe2 className="h-4 w-4" />
              {t('common.scriptureChooseOnline')}
            </button>
            <button
              type="button"
              onClick={() => void importXml()}
              className="flex items-center justify-center gap-2 rounded-xl border border-zinc-700 bg-zinc-800 px-4 py-3 text-sm font-semibold hover:bg-zinc-700"
            >
              <FileUp className="h-4 w-4" />
              {t('common.scriptureImportXml')}
            </button>
          </div>
        </div>
        {directoryDialog}
      </div>
    );

  const chapterIndex = book && chapter ? book.chapters.findIndex((item) => item.number === chapter.number) : -1;
  const previous = book && chapterIndex > 0 ? book.chapters[chapterIndex - 1] : null;
  const next =
    book && chapterIndex >= 0 && chapterIndex < book.chapters.length - 1 ? book.chapters[chapterIndex + 1] : null;
  const setCurrentChapter = (nextChapter: Chapter) => {
    setChapter(nextChapter);
    setVerses(new Set());
    anchor.current = null;
  };

  return (
    <div className="flex h-full overflow-hidden bg-[#09090b] text-white">
      <aside className="flex w-[300px] shrink-0 flex-col border-r border-white/10 bg-[#0c0c0f]">
        <div className="border-b border-white/10 p-4">
          <div className="mb-4 flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-500/10 text-blue-300">
              <BookOpen className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{bible.name}</p>
              <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-600">
                {t('common.scriptureTitle')}
              </p>
            </div>
            <Menu.Root>
              <Menu.Trigger
                aria-label={t('common.scriptureManage')}
                className="flex h-9 w-9 items-center justify-center rounded-xl text-zinc-500 hover:bg-white/5 hover:text-white"
              >
                <Settings2 className="h-4 w-4" />
              </Menu.Trigger>
              <Menu.Portal>
                <Menu.Positioner sideOffset={8} align="end" className="z-50">
                  <Menu.Popup className="w-72 rounded-2xl border border-zinc-700 bg-zinc-900 p-1.5 text-sm shadow-2xl outline-none">
                    <Menu.Item onClick={() => void loadDirectory()} className="menu-item">
                      <Globe2 className="h-4 w-4" />
                      {t('common.scriptureChooseOnline')}
                    </Menu.Item>
                    <Menu.Item onClick={() => void importXml()} className="menu-item">
                      <FileUp className="h-4 w-4" />
                      {t('common.scriptureImportXml')}
                    </Menu.Item>
                    <Menu.Separator className="my-1 h-px bg-white/10" />
                    {source?.providerName && (
                      <div className="mx-1 mb-1 rounded-xl bg-zinc-950/70 p-3 text-xs text-zinc-400">
                        <p className="flex items-center gap-2 font-semibold text-zinc-200">
                          <Info className="h-3.5 w-3.5 text-blue-400" />
                          {t('common.scriptureTranslationInfo')}
                        </p>
                        <dl className="mt-2 space-y-1.5">
                          <div className="flex justify-between gap-3">
                            <dt>{t('common.scriptureProvider')}</dt>
                            <dd className="text-right text-zinc-300">{source.providerName}</dd>
                          </div>
                          {source.versionDate && (
                            <div className="flex justify-between gap-3">
                              <dt>{t('common.scriptureVersionDate')}</dt>
                              <dd className="text-right text-zinc-300">{source.versionDate}</dd>
                            </div>
                          )}
                          {source.license && (
                            <div className="space-y-0.5">
                              <dt>{t('common.scriptureLicense')}</dt>
                              <dd className="leading-4 text-zinc-300">{source.license}</dd>
                            </div>
                          )}
                        </dl>
                      </div>
                    )}
                    <Menu.Item disabled={fixing} onClick={() => void fixNames('tr')} className="menu-item">
                      <Wrench className="h-4 w-4" />
                      {t('common.scriptureFixTurkish')}
                    </Menu.Item>
                    <Menu.Item disabled={fixing} onClick={() => void fixNames('en')} className="menu-item">
                      <Wrench className="h-4 w-4" />
                      {t('common.scriptureFixEnglish')}
                    </Menu.Item>
                    <Menu.Separator className="my-1 h-px bg-white/10" />
                    <Menu.Item
                      onClick={() => void clearBible()}
                      className="menu-item text-red-300 data-[highlighted]:bg-red-500/10"
                    >
                      <Trash2 className="h-4 w-4 shrink-0" />
                      <span>
                        <span className="block">{t('common.scriptureRemoveBible')}</span>
                        <span className="mt-0.5 block text-[10px] font-normal text-red-300/60">
                          {t('common.scriptureRemoveBibleDesc')}
                        </span>
                      </span>
                    </Menu.Item>
                  </Menu.Popup>
                </Menu.Positioner>
              </Menu.Portal>
            </Menu.Root>
          </div>
          <div className="mb-3 grid grid-cols-2 rounded-xl bg-zinc-900 p-1">
            <button
              type="button"
              onClick={() => {
                setMode('reference');
                setQuery('');
              }}
              aria-pressed={mode === 'reference'}
              className={cn(
                'rounded-lg px-2 py-1.5 text-xs font-semibold',
                mode === 'reference' ? 'bg-zinc-700 text-white' : 'text-zinc-500'
              )}
            >
              {t('common.scriptureReferenceSearch')}
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('content');
                setQuery('');
              }}
              aria-pressed={mode === 'content'}
              className={cn(
                'rounded-lg px-2 py-1.5 text-xs font-semibold',
                mode === 'content' ? 'bg-zinc-700 text-white' : 'text-zinc-500'
              )}
            >
              {t('common.scriptureContentSearch')}
            </button>
          </div>
          {mode === 'reference' ? (
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
              <input
                ref={inputRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' || event.nativeEvent.isComposing || verses.size === 0) return;
                  event.preventDefault();
                  send(false);
                }}
                placeholder={t('common.scriptureSearchPlaceholder')}
                aria-label={t('common.scriptureSearchLabel')}
                className="search-input"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  aria-label={t('common.scriptureClear')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-zinc-500 hover:text-zinc-200"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          ) : (
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
              <input
                ref={inputRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t('common.searchVerseContent')}
                aria-label={t('common.searchVerseContent')}
                className="search-input"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  aria-label={t('common.scriptureClear')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-zinc-500"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          )}
          {fixMessage && <p className="mt-2 text-[11px] text-emerald-400">{fixMessage}</p>}
          {error && (
            <p className="mt-2 text-[11px] text-red-300" role="alert">
              {error}
            </p>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3 custom-scrollbar">
          {mode === 'reference' && query.trim() && visibleBooks.length === 0 && (
            <p className="px-3 py-6 text-center text-xs text-zinc-600">{t('common.scriptureNoBookMatch')}</p>
          )}
          {testaments.oldTestament.length > 0 && (
            <div className="mb-5">
              <p className="book-heading">{t('common.scriptureOldTestament')}</p>
              {testaments.oldTestament.map((item) => (
                <BookRow
                  key={item.number}
                  book={item}
                  active={book?.number === item.number}
                  onClick={() => chooseBook(item)}
                />
              ))}
            </div>
          )}
          {testaments.newTestament.length > 0 && (
            <div>
              <p className="book-heading">{t('common.scriptureNewTestament')}</p>
              {testaments.newTestament.map((item) => (
                <BookRow
                  key={item.number}
                  book={item}
                  active={book?.number === item.number}
                  onClick={() => chooseBook(item)}
                />
              ))}
            </div>
          )}
        </div>
      </aside>
      {mode === 'reference' && book && (
        <aside className="flex w-[176px] shrink-0 flex-col border-r border-white/10 bg-[#0a0a0d]">
          <div className="border-b border-white/10 px-4 py-4">
            <p className="truncate text-sm font-semibold text-zinc-200">{book.name}</p>
            <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-zinc-600">
              {t('common.scriptureChapters', { count: book.chapters.length })}
            </p>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3 custom-scrollbar">
            <div className="grid grid-cols-3 gap-2">
              {book.chapters.map((item) => (
                <button
                  key={item.number}
                  type="button"
                  aria-current={chapter?.number === item.number ? 'true' : undefined}
                  aria-label={t('common.scriptureChapterNumber', { number: item.number })}
                  onClick={() => setCurrentChapter(item)}
                  className={cn(
                    'flex aspect-square items-center justify-center rounded-xl border text-sm font-semibold tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/70',
                    chapter?.number === item.number
                      ? 'border-blue-400/50 bg-blue-600 text-white shadow-lg shadow-blue-950/30'
                      : 'border-zinc-800 bg-zinc-900/70 text-zinc-400 hover:border-zinc-700 hover:bg-zinc-800 hover:text-white'
                  )}
                >
                  {item.number}
                </button>
              ))}
            </div>
          </div>
        </aside>
      )}
      <section className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
        {mode === 'content' && deferredQuery.trim().length >= 2 ? (
          <>
            <header className="section-header">
              <div>
                <h2 className="font-semibold">{t('common.scriptureSearchResults')}</h2>
                <p className="text-xs text-zinc-500">
                  {t('common.scriptureSearchResultsCount', { count: results.length })}
                </p>
              </div>
              {indexing && <LoaderCircle className="h-4 w-4 animate-spin text-zinc-500" />}
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto p-5 custom-scrollbar">
              {indexing ? (
                <div className="grid h-full place-items-center text-sm text-zinc-500">
                  {t('common.scripturePreparingSearch')}
                </div>
              ) : results.length ? (
                <div className="mx-auto max-w-4xl space-y-2">
                  {results.map((result) => (
                    <button
                      key={`${result.book.number}:${result.chapter.number}:${result.verse.number}`}
                      type="button"
                      onClick={() => chooseResult(result)}
                      className="flex w-full items-start gap-4 rounded-2xl bg-zinc-900/40 p-4 text-left hover:bg-zinc-800"
                    >
                      <span className="shrink-0 rounded-lg bg-blue-500/10 px-2 py-1 text-xs font-bold text-blue-300">
                        {result.book.name} {result.chapter.number}:{result.verse.number}
                      </span>
                      <span className="text-sm leading-6 text-zinc-300">{result.verse.text}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="grid h-full place-items-center text-sm text-zinc-500">
                  {t('common.scriptureNoVerseMatch')}
                </div>
              )}
            </div>
          </>
        ) : book && chapter ? (
          <>
            <header className="section-header gap-3">
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-lg font-semibold">
                  {book.name} <span className="text-zinc-500">{chapter.number}</span>
                </h2>
                <p className="text-xs text-zinc-500">{t('common.scriptureVerses', { count: chapter.verses.length })}</p>
              </div>
              <button
                type="button"
                disabled={!previous}
                onClick={() => previous && setCurrentChapter(previous)}
                aria-label={t('common.scripturePreviousChapter')}
                className="nav-button"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                disabled={!next}
                onClick={() => next && setCurrentChapter(next)}
                aria-label={t('common.scriptureNextChapter')}
                className="nav-button"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() =>
                  setVerses(
                    verses.size === chapter.verses.length
                      ? new Set()
                      : new Set(chapter.verses.map((item) => item.number))
                  )
                }
                className="rounded-xl border border-zinc-800 px-3 py-2 text-xs text-zinc-400 hover:bg-zinc-800"
              >
                {verses.size === chapter.verses.length ? t('common.scriptureClear') : t('common.scriptureSelectAll')}
              </button>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 pb-28 custom-scrollbar">
              <div className="mx-auto max-w-4xl space-y-2">
                {chapter.verses.map((item) => (
                  <VerseRow
                    key={item.number}
                    verse={item}
                    selected={verses.has(item.number)}
                    onToggle={toggleVerse}
                    label={t('common.scriptureVerseLabel')}
                  />
                ))}
              </div>
            </div>
            <div
              aria-hidden={verses.size === 0}
              className={cn(
                'absolute inset-x-0 bottom-0 border-t border-white/10 bg-zinc-950/95 px-5 py-4 backdrop-blur-xl transition-transform',
                uiMotionEnabled ? 'duration-200' : 'duration-0',
                verses.size ? 'translate-y-0' : 'translate-y-full'
              )}
            >
              <div className="mx-auto flex max-w-4xl items-center gap-4">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{reference}</p>
                  <p className="text-xs text-zinc-500">
                    {t('common.scriptureSelectionSummary', { verses: verses.size, slides: slides.length })}
                  </p>
                </div>
                <button type="button" disabled={!verses.size} onClick={() => send(false)} className="action-primary">
                  <Send className="h-4 w-4" />
                  {t('common.scriptureAddToPresentationShort')}
                </button>
                <button type="button" disabled={!verses.size} onClick={() => send(true)} className="action-live">
                  <Radio className="h-4 w-4" />
                  {t('common.scriptureGoLiveNow')}
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="flex h-full flex-col items-center justify-center p-8 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-zinc-900 text-zinc-600">
              <BookMarked className="h-7 w-7" />
            </div>
            <h2 className="mt-5 text-lg font-semibold text-zinc-200">{t('common.scriptureSelectBook')}</h2>
            <p className="mt-2 text-sm text-zinc-500">{t('common.scriptureBrowseHint')}</p>
            {recents.length > 0 && (
              <div className="mt-8 w-full max-w-xl text-left">
                <p className="book-heading">{t('common.scriptureRecent')}</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {buildReferenceSuggestions(bible.books, '', recents).map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => chooseSuggestion(item)}
                      className="flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900/50 px-3 py-3 hover:bg-zinc-800"
                    >
                      <Clock3 className="h-4 w-4 text-zinc-600" />
                      <span className="truncate text-sm">{item.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </section>
      {directoryDialog}
      <style>{`.custom-scrollbar::-webkit-scrollbar{width:6px}.custom-scrollbar::-webkit-scrollbar-thumb{background:#27272a;border-radius:10px}.menu-item{display:flex;cursor:default;align-items:center;gap:.5rem;border-radius:.75rem;padding:.625rem .75rem;color:#d4d4d8;outline:none}.menu-item[data-highlighted]{background:#27272a;color:white}.search-input{width:100%;border:1px solid #27272a;border-radius:.75rem;background:rgba(24,24,27,.65);padding:.625rem 2.25rem .625rem 2.5rem;font-size:.8125rem;outline:none}.search-input:focus{border-color:rgba(59,130,246,.5)}.book-heading{padding:.5rem .75rem;font-size:.625rem;font-weight:700;text-transform:uppercase;letter-spacing:.16em;color:#52525b}.section-header{display:flex;min-height:72px;flex-shrink:0;align-items:center;justify-content:space-between;border-bottom:1px solid rgba(255,255,255,.08);padding:0 1.25rem}.nav-button{display:flex;height:2.25rem;width:2.25rem;align-items:center;justify-content:center;border:1px solid #27272a;border-radius:.75rem;color:#a1a1aa}.nav-button:hover{background:#27272a}.nav-button:disabled{opacity:.25}.action-primary,.action-live{display:flex;align-items:center;gap:.5rem;border-radius:.75rem;padding:.625rem 1rem;font-size:.875rem;font-weight:600}.action-primary{background:#2563eb;color:white}.action-primary:hover{background:#3b82f6}.action-live{border:1px solid rgba(16,185,129,.3);background:rgba(16,185,129,.1);color:#6ee7b7}.action-live:hover{background:rgba(16,185,129,.2)}`}</style>
    </div>
  );
}
