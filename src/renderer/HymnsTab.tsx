import { useState, useEffect, useMemo, useCallback, useRef, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Music, Plus, Search, Trash2, FolderUp, CheckSquare, Pencil, X, ListOrdered, Cloud } from 'lucide-react';
import OnlineHymnsPanel from './components/OnlineHymnsPanel';
import { cn, useDebounce } from './utils';
import { confirmDialog } from './dialogs';
import Dialog from './components/Dialog';

export interface Hymn {
  id: string;
  title: string;
  lyrics: string;
}

interface HymnsTabProps {
  onAddHymnToPresentation: (hymn: Hymn, partsMode?: boolean, goLive?: boolean) => void;
}

// ─── Saf yardımcı fonksiyonlar component dışında ───────────────────────────

// BG, TC, I gibi ID kodlarını sil (TY ve RT kodlarını KOR)
const TITLE_PATTERNS = [/(?:BG|TC)\d+/gi, /\s{2,}/g];

function cleanTitle(title: string): string {
  let t = title;
  t = t.replace(TITLE_PATTERNS[0], '').replace(TITLE_PATTERNS[1], ' ');
  return t.trim();
}

const CHORD_TOKEN_RE =
  /^(?:\d+|\.?[A-G](#|b)?(?:M(?:aj)?(?:7|9)?|maj(?:7|9)?|min(?:7|9)?|mn?|m(?:7|9)?|sus(?:2|4)?|dim7?|aug|add\d+|\d+)?[+o°]?(?:\/[A-G](#|b)?)?(?:\([A-GMmb#0-9\/+]+\))?)$/;

/** Satırdaki tüm token'lar akor mu? Öyleyse satırın tamamı silinir. */
function isPureChordLine(line: string): boolean {
  const tokens = line.trim().split(/\s+/);
  return tokens.length > 0 && tokens.every(t => CHORD_TOKEN_RE.test(t));
}

/** Karma satırdaki (söz + akor karışık) akor token'larını siler. */
function removeInlineChords(line: string): string {
  return line
    .split(/\s+/)
    .filter(token => !CHORD_TOKEN_RE.test(token))
    .join(' ')
    .trim();
}

// ─── cleanLyrics ──────────────────────────────────────────────────────────

const SECTION_TAG_RE = /\[(V|C|B|CHORUS|BRIDGE|VERSE|PRE|OUTRO|INTRO)?\d*\]/gi;
const MULTI_SPACE_RE  = /\s{2,}/g;
const SENTENCE_SPLIT_RE = /(!|\?|\.|,)/;
const HTML_ENTITIES: Record<string, string> = {
  '&quot;': '"', '&amp;': '&', '&lt;': '<', '&gt;': '>',
};

function cleanLyrics(lyrics: string): string {
  if (!lyrics) return '';

  let text = lyrics.replace(/\r\n/g, '\n');

  // HTML entity decode
  for (const [entity, char] of Object.entries(HTML_ENTITIES)) {
    text = text.split(entity).join(char);
  }

  // Bölüm etiketlerini temizle: [V1] [CHORUS] vb.
  text = text.replace(SECTION_TAG_RE, '');

  const lines = text.split('\n');
  const out: string[] = [];

  for (const raw of lines) {
    let line = raw.trim();

    // Boş satır — art arda birden fazla boş satır ekleme
    if (!line) {
      if (out.length > 0 && out[out.length - 1] !== '') out.push('');
      continue;
    }

    // 1) Tamamen akor olan satırı at (ör: "G F", "Am7 Dsus4", ".D .G")
    if (isPureChordLine(line)) continue;

    // 2) Karma satırlarda akor token'larını sil (ör: "Seni Am seviyorum G7")
    line = removeInlineChords(line);

    // 3) Nokta, tire, alt çizgi temizliği (tekrarlar dahil) + boşluk düzeltmesi
    line = line.replace(/[.\-_]+/g, ' ').replace(MULTI_SPACE_RE, ' ').trim();
    if (!line) continue;

    // 4) Virgül/noktalama ile aşırı bölünmüş tekrar eden parçaları birleştir
    const parts = line.split(SENTENCE_SPLIT_RE);
    if (parts.length > 3) {
      const seen = new Set<string>();
      const rebuilt: string[] = [];
      for (let i = 0; i < parts.length; i += 2) {
        const s = (parts[i] + (parts[i + 1] ?? '')).trim();
        if (!seen.has(s)) { seen.add(s); rebuilt.push(s); }
      }
      line = rebuilt.join(' ');
    }

    out.push(line);
  }

  while (out[0] === '') out.shift();
  while (out[out.length - 1] === '') out.pop();
  return out.join('\n');
}

// ─── Cache yardımcıları ───────────────────────────────────────────────────

function cacheHymns(path: string, list: Hymn[]) {
  try { localStorage.setItem(`hymnsCache:${path}`, JSON.stringify(list)); } catch {}
}

function loadCachedHymns(path: string): Hymn[] | null {
  try {
    const raw = localStorage.getItem(`hymnsCache:${path}`);
    return raw ? (JSON.parse(raw) as Hymn[]) : null;
  } catch { return null; }
}

// ─── XML parsing – chunk'lara bölerek main thread'i serbest bırak ──────────

async function parseXmlFiles(
  files: { name: string; content: string }[],
  onProgress?: (count: number) => void,
): Promise<{ hymns: Hymn[]; failedCount: number }> {
  const parser = new DOMParser();
  const titleMap = new Map<string, Hymn>();
  const results: Hymn[] = [];
  let failedCount = 0;
  const CHUNK = 50;

  for (let i = 0; i < files.length; i += CHUNK) {
    const chunk = files.slice(i, i + CHUNK);

    for (const file of chunk) {
      try {
        const doc = parser.parseFromString(file.content, 'text/xml');
        const songs = Array.from(doc.querySelectorAll('song'));
        const nodes = songs.length > 0 ? songs : [doc.documentElement];

        for (const node of nodes) {
          const rawTitle =
            node.querySelector?.('title')?.textContent ?? file.name.replace('.xml', '');
          const rawLyrics = node.querySelector?.('lyrics')?.textContent ?? '';
          const lyrics = cleanLyrics(rawLyrics);
          if (!lyrics.trim()) continue;

          const cleaned = cleanTitle(rawTitle);
          const key = cleaned.toLowerCase();

          if (!titleMap.has(key)) {
            const hymn = { id: crypto.randomUUID(), title: cleaned, lyrics };
            titleMap.set(key, hymn);
            results.push(hymn);
          }
        }
      } catch {
        failedCount += 1;
      }
    }

    onProgress?.(Math.min(i + CHUNK, files.length));
    await new Promise<void>(r => setTimeout(r, 0));
  }

  return { hymns: results, failedCount };
}

// ─── Sanal liste ──────────────────────────────────────────────────────────

const ITEM_H = 64;
const OVERSCAN = 5;

function useVirtualList(items: Hymn[], containerRef: React.RefObject<HTMLDivElement>) {
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(400);
  const [el, setEl] = useState<HTMLDivElement | null>(null);

  // Sync ref.current → state so useEffect re-fires when the DOM element changes
  // (e.g. after toggling showOnlinePanel off/on which unmounts and remounts the div)
  useEffect(() => {
    setEl(containerRef.current);
  });

  useEffect(() => {
    if (!el) return;
    const ro = new ResizeObserver(entries => setHeight(entries[0].contentRect.height));
    ro.observe(el);
    const onScroll = () => setScrollTop(el.scrollTop);
    el.addEventListener('scroll', onScroll, { passive: true });
    // Read initial dimensions
    setHeight(el.clientHeight || 400);
    return () => { ro.disconnect(); el.removeEventListener('scroll', onScroll); };
  }, [el]);

  const start = Math.max(0, Math.floor(scrollTop / ITEM_H) - OVERSCAN);
  const end   = Math.min(items.length, Math.ceil((scrollTop + height) / ITEM_H) + OVERSCAN);

  return { start, end, totalHeight: items.length * ITEM_H };
}

// ─── Ana bileşen ──────────────────────────────────────────────────────────

export default function HymnsTab({ onAddHymnToPresentation }: HymnsTabProps) {
  const { t } = useTranslation();
  const [hymns, setHymns]               = useState<Hymn[]>([]);
  const [searchTerm, setSearchTerm]     = useState('');
  const [searchInLyrics, setSearchInLyrics] = useState(false);
  const debouncedSearch                 = useDebounce(searchTerm, 200);
  const [isAddingNew, setIsAddingNew]   = useState(false);
  const [newHymn, setNewHymn]           = useState({ title: '', lyrics: '' });
  const [importProgress, setImportProgress] = useState<number | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [editingHymn, setEditingHymn] = useState<Hymn | null>(null);
  const [editForm, setEditForm] = useState({ title: '', lyrics: '' });
  const [partsModeEnabled, setPartsModeEnabled] = useState(true);
  const [showOnlinePanel, setShowOnlinePanel] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const filteredHymns = useMemo(() => {
    if (!debouncedSearch) return hymns;
    const q = debouncedSearch.toLowerCase();
    return hymns.filter(h => {
      if (h.title.toLowerCase().includes(q)) return true;
      if (searchInLyrics && h.lyrics.toLowerCase().includes(q)) return true;
      return false;
    });
  }, [hymns, debouncedSearch, searchInLyrics]);

  const { start, end, totalHeight } = useVirtualList(filteredHymns, listRef);

  // ─── Import ───────────────────────────────────────────────────────────

  const handleBulkImport = useCallback(async (initialPath?: string) => {
    // @ts-ignore
    if (!window.electronAPI?.importHymnArchive) return;
    // @ts-ignore
    const result = await window.electronAPI.importHymnArchive(initialPath);

    if (!result?.results?.length) {
      if (initialPath) localStorage.removeItem('defaultHymnArchivePath');
      return;
    }

    if (result.path) {
      const cached = loadCachedHymns(result.path);
      if (cached) {
        setHymns(cached);
        localStorage.setItem('defaultHymnArchivePath', result.path);
        return;
      }
    }

    setImportProgress(0);
    setImportError(null);
    const { hymns: imported, failedCount } = await parseXmlFiles(result.results, count => setImportProgress(count));
    setImportProgress(null);

    if (failedCount > 0) {
      setImportError(t('common.hymnsImportPartialError', { count: failedCount }));
    }

    setHymns(prev => {
      const existing = new Set(prev.map(h => h.title.toLowerCase()));
      const fresh    = imported.filter(h => !existing.has(h.title.toLowerCase()));
      const combined = [...prev, ...fresh];
      if (result.path) {
        localStorage.setItem('defaultHymnArchivePath', result.path);
        cacheHymns(result.path, combined);
      }
      return combined;
    });
  }, []);

  useEffect(() => {
    const path = localStorage.getItem('defaultHymnArchivePath');
    if (path) {
      handleBulkImport(path);
    } else {
      // No file archive path — try loading from fallback (online-only) cache
      const cached = loadCachedHymns('__online__');
      if (cached) setHymns(cached);
    }
  }, [handleBulkImport]);

  // ─── Yeni ilahi ekle ──────────────────────────────────────────────────

  const addNewHymn = useCallback(() => {
    const title = newHymn.title.trim();
    const lyrics = newHymn.lyrics.trim();
    if (!title || !lyrics) return;
    setHymns(prev => [
      ...prev,
      { id: crypto.randomUUID(), title: cleanTitle(title), lyrics: cleanLyrics(lyrics) },
    ]);
    setNewHymn({ title: '', lyrics: '' });
    setIsAddingNew(false);
  }, [newHymn]);

  const handleOnlineImport = useCallback((imported: Hymn[]) => {
    setHymns(prev => {
      const existing = new Set(prev.map(h => h.title.toLowerCase()));
      const fresh = imported
        .filter(h => !existing.has(h.title.toLowerCase()))
        .map(h => ({ ...h, lyrics: cleanLyrics(h.lyrics) }));
      return [...prev, ...fresh];
    });
  }, []);

  // Auto-persist hymns to cache whenever the list changes (covers all mutations:
  // bulk import, online import, add new, remove, edit)
  // Always caches — uses path-based key if available, otherwise a fallback key.
  useEffect(() => {
    if (hymns.length === 0) return;
    const savedPath = localStorage.getItem('defaultHymnArchivePath') || '__online__';
    cacheHymns(savedPath, hymns);
  }, [hymns]);

  const clearHymns = useCallback(async () => {
    const confirmed = await confirmDialog(t('common.hymnsConfirmClear'));
    if (!confirmed) return;
    const savedPath = localStorage.getItem('defaultHymnArchivePath');
    if (savedPath) {
      localStorage.removeItem(`hymnsCache:${savedPath}`);
      localStorage.removeItem('defaultHymnArchivePath');
    }
    localStorage.removeItem('hymnsCache:__online__');
    setHymns([]);
  }, [t]);

  const removeHymn = useCallback((id: string) => {
    setHymns(prev => prev.filter(h => h.id !== id));
  }, []);

  // ─── İlahi düzenleme ────────────────────────────────────────────────────

  const openEditModal = useCallback((hymn: Hymn) => {
    setEditingHymn(hymn);
    setEditForm({ title: hymn.title, lyrics: hymn.lyrics });
  }, []);

  const closeEditModal = useCallback(() => {
    setEditingHymn(null);
    setEditForm({ title: '', lyrics: '' });
  }, []);

  const saveEditedHymn = useCallback(() => {
    if (!editingHymn) return;
    const trimmedTitle = editForm.title.trim();
    const trimmedLyrics = editForm.lyrics.trim();
    if (!trimmedTitle || !trimmedLyrics) return;

    setHymns(prev => {
      const updated = prev.map(h =>
        h.id === editingHymn.id
          ? { ...h, title: cleanTitle(trimmedTitle), lyrics: cleanLyrics(trimmedLyrics) }
          : h
      );
      const savedPath = localStorage.getItem('defaultHymnArchivePath');
      if (savedPath) cacheHymns(savedPath, updated);
      return updated;
    });

    closeEditModal();
  }, [editingHymn, editForm, closeEditModal]);

  // ─── Render ───────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full bg-surface-raised">
      {/* Üst bar */}
      <div className="p-4 border-b border-white/10 space-y-4">
        <div className="flex items-center justify-end">
          <h2 className="font-bold text-xs uppercase tracking-widest text-white/40 flex items-center gap-2 mr-auto">
            <Music className="w-3.5 h-3.5" />
            {t('common.hymnsTitle')}
            {hymns.length > 0 && (
              <span className="font-mono text-[10px] px-1.5 py-0.5 rounded-full bg-white/5 text-white/45">
                {hymns.length}
              </span>
            )}
          </h2>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPartsModeEnabled(v => !v)}
              aria-pressed={partsModeEnabled}
              aria-label={partsModeEnabled ? t('common.hymnsPartsModeOn') : t('common.hymnsPartsModeOff')}
              className={cn(
                'p-1.5 rounded border transition-colors focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none',
                partsModeEnabled
                  ? 'bg-purple-600/20 border-purple-500/40 text-purple-300'
                  : 'bg-white/5 border-white/10 text-white/60 hover:bg-white/10'
              )}
              title={partsModeEnabled ? t('common.hymnsPartsModeOn') : t('common.hymnsPartsModeOff')}
            >
              <ListOrdered className="w-4 h-4" aria-hidden="true" />
            </button>

            <button
              onClick={() => handleBulkImport()}
              disabled={importProgress !== null}
              className="p-1.5 bg-green-600/20 hover:bg-green-600/40 text-green-400 rounded border border-green-500/30 disabled:opacity-50"
              title={t('common.hymnsImport')}
              aria-label={t('common.hymnsImport')}
            >
              <FolderUp className="w-4 h-4" aria-hidden="true" />
            </button>

            <button
              onClick={() => setShowOnlinePanel(v => !v)}
              className={cn(
                'p-1.5 rounded border transition-colors',
                showOnlinePanel
                  ? 'bg-sky-600/20 border-sky-500/40 text-sky-300'
                  : 'bg-white/5 border-white/10 text-white/60 hover:bg-white/10'
              )}
              title={t('common.hymnsOnline')}
              aria-label={t('common.hymnsOnline')}
            >
              <Cloud className="w-4 h-4" aria-hidden="true" />
            </button>

            <button
              onClick={clearHymns}
              className="p-1.5 bg-red-600/20 hover:bg-red-600/40 text-red-400 rounded border border-red-500/30"
              title={t('common.hymnsClearAll')}
              aria-label={t('common.hymnsClearAll')}
            >
              <Trash2 className="w-4 h-4" aria-hidden="true" />
            </button>

            <button
              onClick={() => setIsAddingNew(v => !v)}
              className="p-1.5 bg-blue-600 hover:bg-blue-700 rounded"
              aria-label={t('common.add')}
            >
              <Plus className={cn('w-4 h-4', isAddingNew && 'rotate-45')} aria-hidden="true" />
            </button>
          </div>
        </div>

        <div aria-live="polite" role="status">
          {importProgress !== null && (
            <div className="text-xs text-white/60">{t('common.hymnsImportProgress', { count: importProgress })}</div>
          )}
        </div>

        {importError && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200 flex items-center justify-between gap-2">
            <span>{importError}</span>
            <button type="button" onClick={() => setImportError(null)} className="text-amber-300 hover:text-amber-100" aria-label={t('common.close')}>
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {!isAddingNew && !showOnlinePanel && (
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/45" />
            <input
              type="text"
              placeholder={t('common.hymnsSearch')}
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              aria-label={t('common.hymnsSearch')}
              className="w-full bg-black/20 border border-white/10 rounded-md py-2 pl-10 pr-4 text-sm"
            />
            <button
              onClick={() => setSearchInLyrics(!searchInLyrics)}
              className={`absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded transition-colors ${
                searchInLyrics 
                  ? 'bg-blue-600 text-white' 
                  : 'bg-white/10 text-white/40 hover:bg-white/20'
              }`}
              title={t(searchInLyrics ? 'common.hymnsSearchLyricsOff' : 'common.hymnsSearchLyricsOn')}
              aria-label={t(searchInLyrics ? 'common.hymnsSearchLyricsOn' : 'common.hymnsSearchLyricsOff')}
            >
              <CheckSquare className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        )}
      </div>

      {/* İçerik */}
      {showOnlinePanel ? (
        <OnlineHymnsPanel onImport={handleOnlineImport} />
      ) : (
        <div ref={listRef} className="flex-1 overflow-y-auto">
          {isAddingNew ? (
          <form
            className="p-4 space-y-4"
            onSubmit={(e) => { e.preventDefault(); addNewHymn(); }}
          >
            <div className="space-y-1">
              <label htmlFor="new-hymn-title" className="block text-xs text-white/50 font-semibold">
                {t('common.hymnsAddTitle')}
              </label>
              <input
                id="new-hymn-title"
                type="text"
                placeholder={t('common.hymnsAddTitle')}
                value={newHymn.title}
                onChange={e => setNewHymn(p => ({ ...p, title: e.target.value }))}
                className="w-full bg-black/20 border border-white/10 rounded-md p-2 text-sm focus-visible:border-blue-500/60 focus-visible:outline-none"
                required
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="new-hymn-lyrics" className="block text-xs text-white/50 font-semibold">
                {t('common.hymnsAddLyrics')}
              </label>
              <textarea
                id="new-hymn-lyrics"
                placeholder={t('common.hymnsAddLyrics')}
                value={newHymn.lyrics}
                onChange={e => setNewHymn(p => ({ ...p, lyrics: e.target.value }))}
                className="w-full h-40 bg-black/20 border border-white/10 rounded-md p-2 text-sm resize-none focus-visible:border-blue-500/60 focus-visible:outline-none"
                required
              />
            </div>
            <button
              type="submit"
              disabled={!newHymn.title.trim() || !newHymn.lyrics.trim()}
              className="w-full py-2 bg-blue-600 hover:bg-blue-700 rounded disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-sm font-semibold"
            >
              {t('common.hymnsAddButton')}
            </button>
          </form>
        ) : filteredHymns.length === 0 ? (
          <div className="h-full flex items-center justify-center text-white/45 text-sm">
            {t('common.hymnsEmpty')}
          </div>
        ) : (
          <div style={{ height: totalHeight, position: 'relative' }}>
            {filteredHymns.slice(start, end).map((hymn, i) => (
              <HymnRow
                key={hymn.id}
                hymn={hymn}
                top={(start + i) * ITEM_H}
                onSelect={(h) => { onAddHymnToPresentation(h, partsModeEnabled); }}
                onDoubleClick={(h) => { onAddHymnToPresentation(h, partsModeEnabled, true); }}
                onEdit={openEditModal}
                onRemove={removeHymn}
              />
            ))}
          </div>
        )}
      </div>
        )}

      {/* Düzenleme modalı */}
      <Dialog
        open={!!editingHymn}
        onClose={closeEditModal}
        labelledBy="edit-hymn-dialog-title"
        className="bg-surface-overlay rounded-xl border border-white/10 w-full max-w-lg mx-4 shadow-2xl"
      >
          <div className="flex items-center justify-between p-4 border-b border-white/10">
            <h3 id="edit-hymn-dialog-title" className="text-sm font-semibold text-white/80">
              {t('common.hymnsEditTitle')}
            </h3>
            <button
              onClick={closeEditModal}
              aria-label={t('common.hymnsCancel')}
              className="text-white/45 hover:text-white/70 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none rounded"
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>

            <div className="p-4 space-y-4">
              <div>
                <label htmlFor="edit-hymn-title" className="block text-xs text-white/60 font-semibold mb-1">
                  {t('common.hymnsEditLabel')}
                </label>
                <input
                  id="edit-hymn-title"
                  type="text"
                  value={editForm.title}
                  onChange={e => setEditForm(p => ({ ...p, title: e.target.value }))}
                  className="w-full bg-black/30 border border-white/10 rounded-md p-2 text-sm text-white focus-visible:border-blue-500/60 focus-visible:outline-none"
                />
              </div>

              <div>
                <label htmlFor="edit-hymn-lyrics" className="block text-xs text-white/60 font-semibold mb-1">
                  {t('common.hymnsLyricsLabel')}
                </label>
                <textarea
                  id="edit-hymn-lyrics"
                  value={editForm.lyrics}
                  onChange={e => setEditForm(p => ({ ...p, lyrics: e.target.value }))}
                  className="w-full h-64 bg-black/30 border border-white/10 rounded-md p-2 text-sm text-white resize-none focus-visible:border-blue-500/60 focus-visible:outline-none"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 p-4 border-t border-white/10">
              <button
                onClick={closeEditModal}
                className="px-4 py-2 text-sm text-white/60 hover:text-white/80 rounded-md hover:bg-white/5"
              >
                {t('common.hymnsCancel')}
              </button>
              <button
                onClick={saveEditedHymn}
                disabled={!editForm.title.trim() || !editForm.lyrics.trim()}
                className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-md disabled:opacity-40"
              >
                {t('common.hymnsSave')}
              </button>
            </div>
      </Dialog>
    </div>
  );
}

// ─── Satır bileşeni ───────────────────────────────────────────────────────

interface HymnRowProps {
  hymn: Hymn;
  top: number;
  onSelect: (h: Hymn) => void;
  onDoubleClick?: (h: Hymn) => void;
  onEdit: (h: Hymn) => void;
  onRemove: (id: string) => void;
}

const HymnRow = memo(({ hymn, top, onSelect, onDoubleClick, onEdit, onRemove }: HymnRowProps) => {
  const { t } = useTranslation();
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${hymn.title}: ${hymn.lyrics?.substring(0, 60)}`}
      onClick={() => onSelect(hymn)}
      onDoubleClick={() => onDoubleClick?.(hymn)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(hymn);
        }
      }}
      style={{ position: 'absolute', top, left: 8, right: 8, height: ITEM_H - 8 }}
      className="p-3 bg-white/5 hover:bg-white/10 rounded-lg cursor-pointer flex justify-between items-center"
    >
      <div className="min-w-0 mr-2">
        <div className="text-sm font-semibold truncate">{hymn.title}</div>
        <div className="text-xs text-white/40 truncate">{hymn.lyrics.split('\n')[0]}</div>
      </div>

      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={e => { e.stopPropagation(); onEdit(hymn); }}
          className="text-white/40 hover:text-white/70"
          title={t('common.hymnsEdit')}
          aria-label={t('common.hymnsEdit')}
        >
          <Pencil className="w-4 h-4" aria-hidden="true" />
        </button>
        <button
          onClick={e => { e.stopPropagation(); onRemove(hymn.id); }}
          className="text-red-400 hover:text-red-300"
          aria-label={t('common.delete')}
        >
          <Trash2 className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
});

export { HymnRow };