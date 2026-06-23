import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, Search, Cloud, Loader2, Globe, AlertTriangle } from 'lucide-react';
import { cn, useDebounce } from '../utils';
import { listSongs, getSong, parseSongXml, WorshipSong } from '../worshipLeaderApi';

interface Hymn {
  id: string;
  title: string;
  lyrics: string;
}

interface OnlineHymnsPanelProps {
  onImport: (hymns: Hymn[]) => void;
}

interface FetchBatchResult {
  hymns: Hymn[];
  failedCount: number;
}

const BATCH_SIZE = 200;

// In-memory cache per language (Issue 5)
const songsCache = new Map<string, { songs: WorshipSong[]; total: number; fullyLoaded: boolean }>();

const LANGUAGES = [
  { code: 'tr', name: 'Türkçe', flag: '🇹🇷' },
  { code: 'en', name: 'English', flag: '🇬🇧' },
  { code: 'ru', name: 'Русский', flag: '🇷🇺' },
  { code: 'ar', name: 'العربية', flag: '🇸🇦' },
  { code: 'es', name: 'Español', flag: '🇪🇸' },
  { code: 'fr', name: 'Français', flag: '🇫🇷' },
  { code: 'de', name: 'Deutsch', flag: '🇩🇪' },
  { code: 'it', name: 'Italiano', flag: '🇮🇹' },
  { code: 'pt', name: 'Português', flag: '🇵🇹' },
  { code: 'ro', name: 'Română', flag: '🇷🇴' },
  { code: 'pl', name: 'Polski', flag: '🇵🇱' },
  { code: 'bg', name: 'Български', flag: '🇧🇬' },
  { code: 'zh', name: '中文', flag: '🇨🇳' },
  { code: 'ko', name: '한국어', flag: '🇰🇷' },
  { code: 'sk', name: 'Slovenčina', flag: '🇸🇰' },
  { code: 'hu', name: 'Magyar', flag: '🇭🇺' },
  { code: 'cs', name: 'Čeština', flag: '🇨🇿' },
  { code: 'uk', name: 'Українська', flag: '🇺🇦' },
];

export default function OnlineHymnsPanel({ onImport }: OnlineHymnsPanelProps) {
  const { t } = useTranslation();
  const [lang, setLang] = useState('tr');
  const [songs, setSongs] = useState<WorshipSong[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [importing, setImporting] = useState(false);
  const [importAllProgress, setImportAllProgress] = useState<{ current: number; total: number } | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [searchTerm, setSearchTerm] = useState('');
  const debouncedSearch = useDebounce(searchTerm, 300);
  const [error, setError] = useState('');
  const [importWarning, setImportWarning] = useState('');
  const abortRef = useRef(false);
  const listRef = useRef<HTMLDivElement>(null);
  const langRef = useRef(lang);  // Language snapshot for race condition prevention

  useEffect(() => {
    loadSongs(lang);
  }, [lang]);

  // Update language reference for race condition prevention
  useEffect(() => {
    langRef.current = lang;
  }, [lang]);

  // Auto-dismiss import warning after 5 seconds
  useEffect(() => {
    if (!importWarning) return;
    const timer = setTimeout(() => setImportWarning(''), 5000);
    return () => clearTimeout(timer);
  }, [importWarning]);

  // Infinite scroll: load more pages when scrolling near bottom (Issue 4)
  const handleScroll = useCallback(() => {
    const el = listRef.current;
    if (!el || loadingMore || loading) return;
    const cached = songsCache.get(langRef.current);
    if (!cached || cached.fullyLoaded) return;
    // Trigger when within 100px of bottom
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 100) {
      loadMoreSongs(langRef.current);
    }
  }, [loadingMore, loading]);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.addEventListener('scroll', handleScroll);
    return () => el.removeEventListener('scroll', handleScroll);
  }, [handleScroll]);

  const filteredSongs = useMemo(() => {
    if (!debouncedSearch) return songs;
    const query = debouncedSearch.toLowerCase();
    return songs.filter(s => s.title.toLowerCase().includes(query));
  }, [songs, debouncedSearch]);

  // Load first page from cache or API (Issue 4 + 5)
  async function loadSongs(targetLang: string) {
    setError('');
    setImportWarning('');
    setSelected(new Set());
    abortRef.current = false;

    const cached = songsCache.get(targetLang);
    if (cached && cached.songs.length > 0) {
      setSongs(cached.songs);
      setTotal(cached.total);
      setLoadingProgress(cached.songs.length);
      return;
    }

    setLoading(true);
    setSongs([]);
    setTotal(0);
    setLoadingProgress(0);

    try {
      const result = await listSongs(targetLang, 0, BATCH_SIZE);
      if (abortRef.current) return;
      const entry = { songs: result.songs, total: result.total, fullyLoaded: result.songs.length >= result.total };
      songsCache.set(targetLang, entry);
      setSongs(result.songs);
      setTotal(result.total);
      setLoadingProgress(Math.min(result.songs.length, result.total));
    } catch (e: any) {
      if (!abortRef.current) {
        setError(e.message || 'Failed to load songs');
      }
    } finally {
      if (!abortRef.current) {
        setLoading(false);
      }
    }
  }

  // Load next page when scrolling near bottom (Issue 4)
  async function loadMoreSongs(targetLang: string) {
    const cached = songsCache.get(targetLang);
    if (!cached || cached.fullyLoaded) return;

    setLoadingMore(true);
    setError('');  // Clear previous errors
    try {
      const result = await listSongs(targetLang, cached.songs.length, BATCH_SIZE);
      if (abortRef.current) return;
      const merged = [...cached.songs, ...result.songs];
      const fullyLoaded = merged.length >= result.total;
      const entry = { songs: merged, total: result.total, fullyLoaded };
      songsCache.set(targetLang, entry);
      setSongs(merged);
      setTotal(result.total);
      setLoadingProgress(merged.length);
    } catch (e: any) {
      if (!abortRef.current) {
        setError(e.message || 'Failed to load more songs');
      }
      console.error('Failed to load more songs', e);
    } finally {
      setLoadingMore(false);
    }
  }

  // Ensure all songs are loaded before import-all (with race condition protection)
  async function ensureAllLoaded(targetLang: string): Promise<WorshipSong[]> {
    let cached = songsCache.get(targetLang);
    while (cached && !cached.fullyLoaded) {
      // Check if language changed during loading
      if (langRef.current !== targetLang) {
        throw new Error('Language changed during loading');
      }
      
      const result = await listSongs(targetLang, cached.songs.length, BATCH_SIZE);
      const merged = [...cached.songs, ...result.songs];
      const fullyLoaded = merged.length >= result.total;
      cached = { songs: merged, total: result.total, fullyLoaded };
      songsCache.set(targetLang, cached);
      setSongs(merged);
      setLoadingProgress(merged.length);
    }
    return cached?.songs ?? [];
  }

  const toggleSelect = (id: number) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selected.size === filteredSongs.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filteredSongs.map(s => s.id)));
    }
  };

  async function fetchSongBatch(ids: number[]): Promise<FetchBatchResult> {
    const results = await Promise.all(
      ids.map(id =>
        getSong(id).then(detail => {
          const lyrics = parseSongXml(detail.songxml);
          return lyrics.trim()
            ? { hymn: { id: crypto.randomUUID(), title: detail.title, lyrics } as Hymn, failed: false }
            : { hymn: null, failed: true };
        }).catch(e => {
          console.error(`Failed to import song #${id}`, e);
          return { hymn: null, failed: true };
        })
      )
    );
    const hymns = results.filter(r => r.hymn).map(r => r.hymn!);
    const failedCount = results.filter(r => r.failed).length;
    return { hymns, failedCount };
  }

  const handleImport = async () => {
    if (selected.size === 0) return;
    setImporting(true);
    setImportWarning('');
    const { hymns, failedCount } = await fetchSongBatch(Array.from(selected));
    setImporting(false);
    setSelected(new Set());
    if (failedCount > 0) {
      setImportWarning(t('common.onlineHymnsImportFailed', { count: failedCount }));
    }
    if (hymns.length > 0) {
      onImport(hymns);
    }
  };

  const handleImportAll = async () => {
    if (!window.confirm(t('common.onlineHymnsConfirmAll'))) return;
    setImportWarning('');
    setError('');

    // Capture current language to detect changes
    const confirmLang = langRef.current;

    // Ensure all pages are loaded first
    setLoading(true);
    try {
      const allSongs = await ensureAllLoaded(confirmLang);
      
      // Check if language changed during loading
      if (langRef.current !== confirmLang) {
        setLoading(false);
        setError(t('common.languageChangedDuringImport') || 'Language changed during import');
        return;
      }
      
      setLoading(false);

      setImportAllProgress({ current: 0, total: allSongs.length });
      const allImported: Hymn[] = [];
      let totalFailed = 0;
      const CONCURRENT = 100;
      
      for (let i = 0; i < allSongs.length; i += CONCURRENT) {
        // Check language again during import
        if (langRef.current !== confirmLang) {
          setImportAllProgress(null);
          setError(t('common.languageChangedDuringImport') || 'Language changed during import');
          return;
        }
        
        const batch = allSongs.slice(i, i + CONCURRENT).map(s => s.id);
        const { hymns, failedCount } = await fetchSongBatch(batch);
        allImported.push(...hymns);
        totalFailed += failedCount;
        setImportAllProgress({ current: Math.min(i + CONCURRENT, allSongs.length), total: allSongs.length });
      }
      
      setImportAllProgress(null);
      if (totalFailed > 0) {
        setImportWarning(t('common.onlineHymnsImportFailed', { count: totalFailed }));
      }
      if (allImported.length > 0) {
        onImport(allImported);
      }
    } catch (e: any) {
      setLoading(false);
      setImportAllProgress(null);
      setError(e.message || 'Failed to import songs');
    }
  };

  return (

      <div className="flex flex-col flex-1 min-h-0">
      <div className="p-4 border-b border-white/10 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold uppercase tracking-widest text-white/40 flex items-center gap-2">
            <Cloud className="w-3.5 h-3.5" />
            {t('common.onlineHymnsTitle')}
          </h3>
          <span className="text-xs text-white/45">{total} ilahi</span>
        </div>

        <div className="relative">
          <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/45 pointer-events-none z-10" />
          <label htmlFor="language-select" className="sr-only">
            {t('common.selectLanguage') || 'Select Language'}
          </label>
          <select
            id="language-select"
            value={lang}
            onChange={e => setLang(e.target.value)}
            aria-label={t('common.selectLanguage') || 'Select Language'}
            className="w-full h-10 bg-black/20 border border-white/10 rounded-xl pl-10 pr-4 text-sm outline-none focus:border-blue-500/50 focus:bg-white/[0.08] transition-[background-color,border-color] text-white appearance-none cursor-pointer"
          >
            {LANGUAGES.map(l => (
              <option key={l.code} value={l.code} className="bg-[#1e1e1e] text-white">
                {l.flag} {l.name}
              </option>
            ))}
          </select>
          <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-white/45">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/45" />
          <label htmlFor="search-hymns" className="sr-only">
            {t('common.onlineHymnsSearch')}
          </label>
          <input
            id="search-hymns"
            type="text"
            placeholder={t('common.onlineHymnsSearch')}
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            aria-label={t('common.onlineHymnsSearch')}
            className="w-full h-10 bg-black/20 border border-white/10 rounded-xl pl-10 pr-4 text-sm outline-none focus:border-blue-500/50 focus:bg-white/[0.08] transition-[background-color,border-color] placeholder:text-white/20"
          />
        </div>
      </div>

      {error && (
        <div className="mx-4 mt-4 p-3 bg-red-600/20 border border-red-500/30 rounded-xl text-xs text-red-400">
          {error}
        </div>
      )}

      {importWarning && (
        <div className="mx-4 mt-4 p-3 bg-amber-600/20 border border-amber-500/30 rounded-xl text-xs text-amber-300 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{importWarning}</span>
          <button onClick={() => setImportWarning('')} className="ml-auto text-amber-400 hover:text-amber-200" aria-label={t('common.close')}>✕</button>
        </div>
      )}

      {loading ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3">
          <Loader2 className="w-6 h-6 text-white/45 animate-spin" />
          <div className="text-xs text-white/45">
            {t('common.onlineHymnsLoading', { count: loadingProgress, total: total || '?' })}
          </div>
        </div>
      ) : filteredSongs.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-white/45 text-sm">
          {debouncedSearch ? t('common.noResults') : t('common.hymnsEmpty')}
        </div>
      ) : (
        <>
          <div ref={listRef} role="listbox" aria-label={t('common.hymnsList')} className="flex-1 overflow-y-auto">
            {filteredSongs.map(song => (
              <div
                key={song.id}
                onClick={() => toggleSelect(song.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    toggleSelect(song.id);
                  }
                }}
                role="option"
                aria-selected={selected.has(song.id)}
                tabIndex={0}
                className={cn(
                  'flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors',
                  selected.has(song.id)
                    ? 'bg-blue-600/20 hover:bg-blue-600/30'
                    : 'hover:bg-white/5'
                )}
              >
                <div
                  className={cn(
                    'w-5 h-5 rounded border flex items-center justify-center shrink-0 transition-colors',
                    selected.has(song.id)
                      ? 'bg-blue-600 border-blue-600'
                      : 'border-white/20'
                  )}
                  aria-hidden="true"
                >
                  {selected.has(song.id) && (
                    <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold truncate">{song.title}</div>
                  {song.songkey && (
                    <div className="text-xs text-white/45">Key: {song.songkey}</div>
                  )}
                </div>
              </div>
            ))}
            {loadingMore && (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="w-4 h-4 text-white/45 animate-spin" />
              </div>
            )}
          </div>

          <div className="border-t border-white/10 p-4 space-y-3">
            {importAllProgress ? (
              <div className="flex items-center justify-center gap-3 h-12">
                <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />
                <span className="text-sm text-white/50">
                  {t('common.onlineHymnsImportAllProgress', { count: importAllProgress.current, total: importAllProgress.total })}
                </span>
              </div>
            ) : (
              <>
                <button
                  onClick={handleImportAll}
                  disabled={importing}
                  className="w-full h-10 flex items-center justify-center gap-2 bg-amber-600/20 hover:bg-amber-600/30 text-amber-400 rounded-xl text-sm font-semibold border border-amber-500/30 transition-colors disabled:opacity-40"
                >
                  <Download className="w-4 h-4" />
                  {t('common.onlineHymnsImportAll')}
                </button>

                {selected.size > 0 && (
                  <div className="flex gap-2">
                    <button
                      onClick={toggleSelectAll}
                      className="flex-1 h-10 bg-white/5 hover:bg-white/10 rounded-xl text-sm text-white/50 transition-colors"
                    >
                      {selected.size === filteredSongs.length ? t('common.onlineHymnsClearSelection') : t('common.onlineHymnsSelectAll')}
                    </button>
                    <button
                      onClick={handleImport}
                      disabled={importing}
                      className="flex-1 h-12 flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 rounded-xl text-sm font-semibold transition-colors disabled:opacity-50"
                    >
                      {importing ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Download className="w-4 h-4" />
                      )}
                      {t('common.onlineHymnsImport', { count: selected.size })}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
