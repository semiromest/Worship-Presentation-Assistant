import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BookOpen, Image as ImageIcon, Music, Search, Video } from 'lucide-react';
import { useStore } from '../state/useStore';
import { bibleRepository } from '../bibleRepository';
import { createScriptureSlides, saveRecentScriptureReference } from '../scriptureModel';
import { loadLibraryHymns, readHymnAddPreferences } from '../hymnCache';
import { searchHymns, searchMedia, searchScripture } from '../quickSearchModel';
import type { Hymn } from '../hymnImport';
import type { MediaKind } from '../../shared/presentation';
import { playSfx } from '../sfx';
import { isHelpActive } from './Tour/tourController';
import { cn } from '../utils';

// Same chunking the Bible tab uses, so a verse added here looks identical.
const CHUNK_CONFIG = { maxVerses: 3, maxChars: 120, maxLines: 2 } as const;
const PANEL_WIDTH = 560;
const PANEL_MAX_HEIGHT = 460;
const EDGE = 12;

interface QuickSearchProps {
  onAddScripture: (content: string | string[], options?: { groupTitle?: string; goLive?: boolean }) => void;
  onAddHymn: (hymn: Hymn & { showAuthorOnSlides?: boolean }, partsMode?: boolean, goLive?: boolean) => void;
  onAddMedia: (type: MediaKind, path: string) => void;
}

interface Row {
  id: string;
  group: 'scripture' | 'hymns' | 'media';
  title: string;
  subtitle?: string;
  icon: typeof BookOpen;
  run: (goLive: boolean) => void;
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, Math.max(min, max)));

/** Ctrl/Cmd+K palette that opens at the pointer and adds verses, hymns and media to the service. */
export default function QuickSearch({ onAddScripture, onAddHymn, onAddMedia }: QuickSearchProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [position, setPosition] = useState({ left: EDGE, top: EDGE });
  const [hymns, setHymns] = useState<Hymn[]>([]);
  const [bibleVersion, setBibleVersion] = useState(0);
  const mediaItems = useStore((s) => s.mediaItems);
  const pointer = useRef({ x: 0, y: 0 });
  const openRef = useRef(false);
  const returnFocus = useRef<HTMLElement | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const baseId = useId();

  const close = useCallback(() => {
    openRef.current = false;
    setOpen(false);
    const target = returnFocus.current;
    returnFocus.current = null;
    if (target && document.contains(target)) target.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const onMove = (e: MouseEvent) => { pointer.current = { x: e.clientX, y: e.clientY }; };
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== 'k') return;
      // The central Tour boundary owns the keyboard while a guide or tour runs.
      if (isHelpActive()) return;
      e.preventDefault();
      e.stopPropagation();
      if (openRef.current) { close(); return; }
      const { x, y } = pointer.current;
      const width = Math.min(PANEL_WIDTH, window.innerWidth - EDGE * 2);
      returnFocus.current = document.activeElement as HTMLElement | null;
      openRef.current = true;
      setPosition({
        left: clamp(x - width / 2, EDGE, window.innerWidth - width - EDGE),
        top: clamp(y - 28, EDGE, window.innerHeight - PANEL_MAX_HEIGHT - EDGE),
      });
      setQuery('');
      setActive(0);
      setHymns(loadLibraryHymns());
      setOpen(true);
    };
    window.addEventListener('mousemove', onMove, { passive: true });
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [close]);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    if (!bibleRepository.currentBible) {
      void bibleRepository.restore().then((bible) => { if (bible) setBibleVersion((v) => v + 1); }).catch(() => undefined);
    }
  }, [open]);

  const rows = useMemo<Row[]>(() => {
    if (!open || !query.trim()) return [];
    const bible = bibleRepository.currentBible;
    const source = bibleRepository.currentSource;
    const out: Row[] = [];
    for (const hit of searchScripture(bible, source, query)) {
      out.push({
        id: `s:${hit.id}`, group: 'scripture', title: hit.label, subtitle: hit.preview, icon: BookOpen,
        run: (goLive) => {
          const slides = createScriptureSlides(hit.book, hit.chapter, hit.verseNumbers, CHUNK_CONFIG, source);
          if (!slides.length) return;
          onAddScripture(slides.length === 1 ? slides[0] : slides, { groupTitle: `${hit.book.name} ${hit.chapter.number}`, goLive });
          saveRecentScriptureReference(bibleRepository.sourceId, { book: hit.book, chapter: hit.chapter, verseNumbers: hit.verseNumbers });
        },
      });
    }
    for (const hymn of searchHymns(hymns, query)) {
      out.push({
        id: `h:${hymn.id}`, group: 'hymns', title: hymn.title, subtitle: hymn.author, icon: Music,
        run: (goLive) => {
          const prefs = readHymnAddPreferences();
          onAddHymn({ ...hymn, showAuthorOnSlides: prefs.showAuthor }, prefs.partsMode, goLive);
        },
      });
    }
    for (const item of searchMedia(mediaItems, query)) {
      out.push({
        id: `m:${item.id}`, group: 'media', title: item.name,
        subtitle: item.type === 'video' ? t('common.quickSearch.video') : t('common.quickSearch.image'),
        icon: item.type === 'video' ? Video : ImageIcon,
        run: () => onAddMedia(item.type, item.path),
      });
    }
    return out;
    // bibleVersion re-runs the search once an asynchronous Bible restore finishes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, query, hymns, mediaItems, onAddScripture, onAddHymn, onAddMedia, t, bibleVersion]);

  useEffect(() => { setActive(0); }, [query]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active, rows]);

  const choose = useCallback((row: Row | undefined, goLive: boolean) => {
    if (!row) return;
    row.run(goLive);
    playSfx('select');
    close();
  }, [close]);

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!rows.length) return;
      setActive((i) => (i + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length);
      return;
    }
    if (e.key === 'Enter') { e.preventDefault(); choose(rows[active], e.shiftKey); }
  };

  if (!open) return null;
  const width = Math.min(PANEL_WIDTH, window.innerWidth - EDGE * 2);
  const groupLabel = {
    scripture: t('common.quickSearch.scripture'),
    hymns: t('common.quickSearch.hymns'),
    media: t('common.quickSearch.media'),
  };
  const noBible = !bibleRepository.currentBible;

  return (
    <div className="fixed inset-0 z-[100]" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('common.quickSearch.title')}
        data-testid="quick-search"
        className="absolute flex flex-col overflow-hidden rounded-xl border border-white/15 bg-surface-raised text-white shadow-2xl"
        style={{ left: position.left, top: position.top, width, maxHeight: PANEL_MAX_HEIGHT }}
      >
        <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2.5">
          <Search className="h-4 w-4 shrink-0 text-white/50" aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onInputKeyDown}
            role="combobox"
            aria-expanded={rows.length > 0}
            aria-controls={`${baseId}-list`}
            aria-activedescendant={rows[active] ? `${baseId}-${active}` : undefined}
            aria-autocomplete="list"
            placeholder={t('common.quickSearch.placeholder')}
            autoComplete="off"
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent text-sm text-white placeholder:text-white/40 focus:outline-none"
          />
          <kbd className="rounded border border-white/15 px-1.5 py-0.5 text-[10px] text-white/50">Esc</kbd>
        </div>
        <ul id={`${baseId}-list`} ref={listRef} role="listbox" className="min-h-0 flex-1 overflow-y-auto py-1">
          {rows.map((row, index) => {
            const Icon = row.icon;
            return (
              <li key={row.id} role="presentation">
                {(index === 0 || rows[index - 1].group !== row.group) && (
                  <div className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-white/40">
                    {groupLabel[row.group]}
                  </div>
                )}
                <div
                  id={`${baseId}-${index}`}
                  role="option"
                  aria-selected={index === active}
                  onMouseMove={() => { if (index !== active) setActive(index); }}
                  onClick={(e) => choose(row, e.shiftKey)}
                  className={cn(
                    'mx-1 flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2',
                    index === active ? 'bg-blue-600' : 'hover:bg-white/5'
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0 text-white/70" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{row.title}</div>
                    {row.subtitle && <div className="truncate text-xs text-white/60">{row.subtitle}</div>}
                  </div>
                </div>
              </li>
            );
          })}
          {!rows.length && (
            <li role="presentation" className="px-4 py-6 text-center text-xs text-white/50">
              {query.trim() ? t('common.quickSearch.noResults') : t('common.quickSearch.hint')}
              {!query.trim() && noBible && <div className="mt-1 text-white/35">{t('common.quickSearch.noBible')}</div>}
            </li>
          )}
        </ul>
        <div className="flex items-center gap-4 border-t border-white/10 px-3 py-1.5 text-[11px] text-white/50">
          <span><kbd className="font-sans">↑↓</kbd> {t('common.quickSearch.navigate')}</span>
          <span><kbd className="font-sans">Enter</kbd> {t('common.quickSearch.add')}</span>
          <span><kbd className="font-sans">Shift+Enter</kbd> {t('common.quickSearch.addLive')}</span>
        </div>
      </div>
    </div>
  );
}
