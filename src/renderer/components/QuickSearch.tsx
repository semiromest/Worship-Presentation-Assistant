import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BookOpen, Image as ImageIcon, Link2, Loader2, Music, Search, Video } from 'lucide-react';
import { useStore } from '../state/useStore';
import { bibleRepository } from '../bibleRepository';
import { loadLibraryHymns } from '../hymnCache';
import type { Hymn } from '../hymnImport';
import { buildQuickSearch, runQuickEntry, type QuickEntry, type QuickRunOutcome } from '../quickSearch/quickSearchEngine';
import { getQuickSearchActions, goLiveWithSlide } from '../quickSearch/quickSearchBridge';
import { playSfx } from '../sfx';
import { isHelpActive } from './Tour/tourController';
import { cn } from '../utils';

const PANEL_WIDTH = 560;
const PANEL_MAX_HEIGHT = 460;
const EDGE = 12;

type Group = 'scripture' | 'hymns' | 'media' | 'setLink';

const GROUP_OF: Record<QuickEntry['kind'], Group> = {
  scripture: 'scripture',
  hymn: 'hymns',
  media: 'media',
  setLink: 'setLink',
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, Math.max(min, max)));

/** Ctrl/Cmd+K palette that opens at the pointer and adds verses, hymns, media and set links to the service. */
export default function QuickSearch() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [position, setPosition] = useState({ left: EDGE, top: EDGE });
  const [hymns, setHymns] = useState<Hymn[]>([]);
  const [bibleVersion, setBibleVersion] = useState(0);
  const [busy, setBusy] = useState<{ fetched: number; total: number } | null>(null);
  const [status, setStatus] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null);
  const mediaItems = useStore((s) => s.mediaItems);
  const pointer = useRef({ x: 0, y: 0 });
  const openRef = useRef(false);
  const busyRef = useRef(false);
  const returnFocus = useRef<HTMLElement | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const baseId = useId();

  const close = useCallback(() => {
    if (busyRef.current) return;
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
      setStatus(null);
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

  const entries = useMemo<QuickEntry[]>(() => {
    if (!open || !query.trim()) return [];
    return buildQuickSearch(query, {
      bible: bibleRepository.currentBible,
      source: bibleRepository.currentSource,
      hymns,
      media: mediaItems,
    });
    // bibleVersion re-runs the search once an asynchronous Bible restore finishes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, query, hymns, mediaItems, bibleVersion]);

  useEffect(() => { setActive(0); setStatus(null); }, [query]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active, entries]);

  const describeFailure = useCallback((outcome: QuickRunOutcome) => {
    switch (outcome.error) {
      case 'set-id-only': return t('quickSearchSet.setIdOnly');
      case 'set-empty': return t('quickSearchSet.empty');
      case 'set-fetch': return t('quickSearchSet.fetchError');
      default: return t('common.quickSearch.noResults');
    }
  }, [t]);

  const choose = useCallback(async (entry: QuickEntry | undefined, goLive: boolean) => {
    if (!entry || busyRef.current) return;
    const actions = getQuickSearchActions();
    if (!actions) return;
    if (entry.kind === 'setLink' && entry.result.error) {
      setStatus({ text: t('quickSearchSet.setIdOnly'), tone: 'error' });
      playSfx('error');
      return;
    }
    const isSet = entry.kind === 'setLink';
    if (isSet) {
      busyRef.current = true;
      setBusy({ fetched: 0, total: entry.result.songCount ?? 0 });
    }
    let outcome: QuickRunOutcome;
    try {
      outcome = await runQuickEntry(
        entry,
        actions,
        { source: bibleRepository.currentSource, sourceId: bibleRepository.sourceId },
        (fetched, total) => setBusy({ fetched, total }),
      );
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
    if (!outcome.ok) {
      setStatus({ text: describeFailure(outcome), tone: 'error' });
      playSfx('error');
      return;
    }
    if (goLive) await goLiveWithSlide(outcome.firstSlideId);
    playSfx('select');
    if (isSet && outcome.failed > 0) {
      // Keep the palette open so the partial result stays visible.
      setStatus({ text: t('quickSearchSet.partial', { added: outcome.added, failed: outcome.failed }), tone: 'error' });
      return;
    }
    close();
  }, [close, describeFailure, t]);

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!entries.length) return;
      setActive((i) => (i + (e.key === 'ArrowDown' ? 1 : -1) + entries.length) % entries.length);
      return;
    }
    if (e.key === 'Enter') { e.preventDefault(); void choose(entries[active], e.shiftKey); }
  };

  if (!open) return null;
  const width = Math.min(PANEL_WIDTH, window.innerWidth - EDGE * 2);
  const groupLabel: Record<Group, string> = {
    scripture: t('common.quickSearch.scripture'),
    hymns: t('common.quickSearch.hymns'),
    media: t('common.quickSearch.media'),
    setLink: t('quickSearchSet.group'),
  };
  const noBible = !bibleRepository.currentBible;

  const rowView = (entry: QuickEntry): { icon: typeof BookOpen; title: string; subtitle?: string; badge?: string } => {
    const r = entry.result;
    switch (entry.kind) {
      case 'scripture':
        return { icon: BookOpen, title: r.title, subtitle: r.subtitle };
      case 'hymn':
        return { icon: Music, title: r.title, subtitle: r.subtitle, badge: r.hasChords ? '♪' : undefined };
      case 'media':
        return {
          icon: r.mediaType === 'video' ? Video : ImageIcon,
          title: r.title,
          subtitle: r.mediaType === 'video' ? t('common.quickSearch.video') : t('common.quickSearch.image'),
        };
      case 'setLink':
        return {
          icon: Link2,
          title: r.error ? t('quickSearchSet.setIdOnlyTitle') : r.title || t('quickSearchSet.title'),
          subtitle: r.error
            ? t('quickSearchSet.setIdOnly')
            : busy
              ? t('quickSearchSet.fetching', { fetched: busy.fetched, total: busy.total })
              : t('quickSearchSet.songs', { count: r.songCount ?? 0 }),
        };
    }
  };

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
          {busy ? (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-white/50" aria-hidden="true" />
          ) : (
            <Search className="h-4 w-4 shrink-0 text-white/50" aria-hidden="true" />
          )}
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onInputKeyDown}
            readOnly={!!busy}
            role="combobox"
            aria-expanded={entries.length > 0}
            aria-controls={`${baseId}-list`}
            aria-activedescendant={entries[active] ? `${baseId}-${active}` : undefined}
            aria-autocomplete="list"
            placeholder={t('quickSearchSet.placeholder')}
            autoComplete="off"
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent text-sm text-white placeholder:text-white/40 focus:outline-none"
          />
          <kbd className="rounded border border-white/15 px-1.5 py-0.5 text-[10px] text-white/50">Esc</kbd>
        </div>
        <ul id={`${baseId}-list`} ref={listRef} role="listbox" className="min-h-0 flex-1 overflow-y-auto py-1">
          {entries.map((entry, index) => {
            const view = rowView(entry);
            const Icon = view.icon;
            const group = GROUP_OF[entry.kind];
            return (
              <li key={entry.result.id} role="presentation">
                {(index === 0 || GROUP_OF[entries[index - 1].kind] !== group) && (
                  <div className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-white/40">
                    {groupLabel[group]}
                  </div>
                )}
                <div
                  id={`${baseId}-${index}`}
                  role="option"
                  aria-selected={index === active}
                  aria-disabled={entry.kind === 'setLink' && !!entry.result.error}
                  onMouseMove={() => { if (index !== active) setActive(index); }}
                  onClick={(e) => void choose(entry, e.shiftKey)}
                  className={cn(
                    'mx-1 flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2',
                    index === active ? 'bg-blue-600' : 'hover:bg-white/5'
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0 text-white/70" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">
                      {view.title}
                      {view.badge && (
                        <span className="ml-1.5 text-xs text-violet-300" title={t('hymnChords.badgeTitle')}>{view.badge}</span>
                      )}
                    </div>
                    {view.subtitle && <div className="truncate text-xs text-white/60">{view.subtitle}</div>}
                  </div>
                </div>
              </li>
            );
          })}
          {!entries.length && (
            <li role="presentation" className="px-4 py-6 text-center text-xs text-white/50">
              {query.trim() ? t('common.quickSearch.noResults') : t('quickSearchSet.hint')}
              {!query.trim() && noBible && <div className="mt-1 text-white/35">{t('common.quickSearch.noBible')}</div>}
            </li>
          )}
        </ul>
        {status && (
          <div role="status" className={cn('border-t border-white/10 px-3 py-1.5 text-xs', status.tone === 'error' ? 'text-amber-300' : 'text-green-300')}>
            {status.text}
          </div>
        )}
        <div className="flex items-center gap-4 border-t border-white/10 px-3 py-1.5 text-[11px] text-white/50">
          <span><kbd className="font-sans">↑↓</kbd> {t('common.quickSearch.navigate')}</span>
          <span><kbd className="font-sans">Enter</kbd> {t('common.quickSearch.add')}</span>
          <span><kbd className="font-sans">Shift+Enter</kbd> {t('common.quickSearch.addLive')}</span>
        </div>
      </div>
    </div>
  );
}
