import { memo, useCallback, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Pencil, Trash2 } from 'lucide-react';
import type { Hymn } from '../hymnImport';
import { firstHymnLine } from '../hymnLibrary';

// The first click navigates immediately. Do not let the rest of that gesture
// activate a slide card that appears underneath the old library row.
function ignoreClickContinuation() {
  const cleanup = () => {
    clearTimeout(expiry);
    window.removeEventListener('mousedown', nextGesture, true);
    window.removeEventListener('click', suppress, true);
    window.removeEventListener('dblclick', suppress, true);
  };
  const nextGesture = (event: MouseEvent) => { if (event.detail <= 1) cleanup(); };
  const suppress = (event: MouseEvent) => {
    if (event.detail > 1) { event.preventDefault(); event.stopImmediatePropagation(); }
  };
  const expiry = setTimeout(cleanup, 500);
  window.addEventListener('mousedown', nextGesture, true);
  window.addEventListener('click', suppress, true);
  window.addEventListener('dblclick', suppress, true);
}

type Action = 'add' | 'edit' | 'remove';
export interface HymnFocus { id: string; action: Action; request: number }
interface Props {
  items: Hymn[];
  onSelect: (h: Hymn) => void;
  onEdit: (h: Hymn) => void;
  onRemove: (id: string) => void;
  resetKey: string;
  focusRequest: HymnFocus | null;
}

export default function HymnLibraryList({ items, resetKey, focusRequest, ...actions }: Props) {
  const { t } = useTranslation();
  const viewport = useRef<HTMLDivElement>(null);
  const probe = useRef<HTMLDivElement>(null);
  const header = useRef<HTMLDivElement>(null);
  const [metrics, setMetrics] = useState({ height: 400, row: 56, scroll: 0 });
  const [focused, setFocused] = useState<string | null>(null);
  const pending = useRef<{ id: string; action: Action } | null>(null);
  const resizedScroll = useRef<number | null>(null);
  const itemsRef = useRef(items); itemsRef.current = items;
  const rowRef = useRef(metrics.row); rowRef.current = metrics.row;
  const start = Math.max(0, Math.floor(metrics.scroll / metrics.row) - 5);
  const end = Math.min(items.length, Math.ceil((metrics.scroll + metrics.height) / metrics.row) + 5);
  const indices = Array.from({ length: Math.max(0, end - start) }, (_, i) => start + i);
  const itemIndices = useMemo(() => new Map(items.map((h, i) => [h.id, i])), [items]);
  const focusedIndex = focused ? itemIndices.get(focused) ?? -1 : -1;
  if (focusedIndex >= 0 && !indices.includes(focusedIndex)) indices.push(focusedIndex);
  indices.sort((a, b) => a - b);

  const reveal = useCallback((id: string, action: Action) => {
    const el = viewport.current;
    const index = itemsRef.current.findIndex(h => h.id === id);
    if (!el || index < 0) return;
    pending.current = { id, action };
    setFocused(id);
    const top = index * rowRef.current;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + rowRef.current > el.scrollTop + el.clientHeight) el.scrollTop = top + rowRef.current - el.clientHeight;
    setMetrics(m => ({ ...m, scroll: el.scrollTop }));
  }, []);

  useLayoutEffect(() => {
    const el = viewport.current, measure = probe.current;
    if (!el || !measure) return;
    const resize = () => {
      const row = measure.getBoundingClientRect().height;
      if (!row) return;
      const oldRow = rowRef.current;
      const anchor = Math.floor(el.scrollTop / oldRow);
      const fraction = (el.scrollTop % oldRow) / oldRow;
      rowRef.current = row;
      const scroll = Math.max(0, Math.min((anchor + fraction) * row, itemsRef.current.length * row - el.clientHeight));
      resizedScroll.current = scroll;
      if (header.current) header.current.style.paddingRight = `${el.offsetWidth - el.clientWidth}px`;
      setMetrics({ row, height: el.clientHeight, scroll });
    };
    const observer = new ResizeObserver(resize);
    observer.observe(el); observer.observe(measure); resize();
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    if (resizedScroll.current !== null && viewport.current) {
      viewport.current.scrollTop = resizedScroll.current;
      resizedScroll.current = null;
    }
  }, [metrics.row, metrics.height]);
  useLayoutEffect(() => {
    if (viewport.current) viewport.current.scrollTop = 0;
    setMetrics(m => ({ ...m, scroll: 0 }));
  }, [resetKey]);
  useLayoutEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const max = Math.max(0, items.length * metrics.row - el.clientHeight);
    if (el.scrollTop > max) el.scrollTop = max;
    if (el.scrollTop !== metrics.scroll) setMetrics(m => ({ ...m, scroll: el.scrollTop }));
  }, [items.length, metrics.row, metrics.scroll]);
  useLayoutEffect(() => { if (focusRequest) reveal(focusRequest.id, focusRequest.action); }, [focusRequest, reveal]);
  useLayoutEffect(() => {
    if (!pending.current || !viewport.current) return;
    const { id, action } = pending.current;
    const row = [...viewport.current.querySelectorAll<HTMLElement>('[data-hymn-id]')].find(el => el.dataset.hymnId === id);
    const button = row?.querySelector<HTMLButtonElement>(`[data-hymn-action="${action}"]`);
    if (button) { pending.current = null; button.focus({ preventScroll: true }); }
  });

  function tabAcrossRows(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (e.key !== 'Tab' || e.altKey || e.ctrlKey || e.metaKey) return;
    const button = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-hymn-action]');
    const row = button?.closest<HTMLElement>('[data-hymn-id]');
    if (!button || !row) return;
    const buttons = [...row.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
    if (e.shiftKey ? button !== buttons[0] : button !== buttons[buttons.length - 1]) return;
    const index = items.findIndex(h => h.id === row.dataset.hymnId) + (e.shiftKey ? -1 : 1);
    const next = items[index];
    if (!next) return;
    e.preventDefault();
    reveal(next.id, e.shiftKey && !next.id.startsWith('practice-hymn-') ? 'remove' : 'add');
  }

  return <div className="hymn-list-shell">
    <div ref={probe} className="hymn-row-probe" aria-hidden="true" />
    <div ref={header} className="hymn-column-header" aria-hidden="true"><div className="hymn-columns">
      <span>{t('hymnLibrary.hymn')}</span><span>{t('common.hymnsAuthorLabel')}</span><span>{t('common.hymnsSourceLabel')}</span><span>{t('hymnLibrary.actions')}</span>
    </div></div>
    <div ref={viewport} className="hymn-viewport" data-testid="hymn-list" role="list" aria-label={t('common.hymnsTitle')}
      onScroll={e => { const scroll = e.currentTarget.scrollTop; setMetrics(m => ({ ...m, scroll })); }}
      onKeyDown={tabAcrossRows}
      onFocusCapture={e => setFocused((e.target as HTMLElement).closest<HTMLElement>('[data-hymn-id]')?.dataset.hymnId ?? null)}
      onBlurCapture={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(null); }}>
      <div style={{ height: items.length * metrics.row, position: 'relative' }}>
        {indices.map(index => <HymnRow key={items[index].id} hymn={items[index]} top={index * metrics.row} index={index} count={items.length} {...actions} />)}
      </div>
    </div>
  </div>;
}

interface RowProps {
  hymn: Hymn; top: number; index: number; count: number;
  onSelect: Props['onSelect']; onEdit: Props['onEdit']; onRemove: Props['onRemove'];
}
export const HymnRow = memo(function HymnRow({ hymn, top, index, count, onSelect, onEdit, onRemove }: RowProps) {
  const { t } = useTranslation();
  const tooltipId = useId();
  const addButton = useRef<HTMLButtonElement>(null);
  const pointerInside = useRef(false);
  const focusInside = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const [tip, setTip] = useState<{ x: number; y: number; below: boolean } | null>(null);
  const firstLine = firstHymnLine(hymn.lyrics);
  const meta = [hymn.author, hymn.source].filter(Boolean).join(' · ') || '—';
  const show = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const el = addButton.current;
      if (!el || ![...el.querySelectorAll<HTMLElement>('[data-truncate]')].some(node => node.scrollWidth > node.clientWidth)) return;
      const r = el.getBoundingClientRect();
      setTip({ x: Math.max(8, Math.min(r.left, window.innerWidth - 368)), y: r.bottom < window.innerHeight / 2 ? r.bottom + 6 : r.top - 6, below: r.bottom < window.innerHeight / 2 });
    }, 350);
  };
  const hide = () => { clearTimeout(timer.current); setTip(null); };
  const leave = () => { clearTimeout(timer.current); timer.current = setTimeout(() => { if (!pointerInside.current && !focusInside.current) setTip(null); }, 150); };
  useLayoutEffect(() => () => { clearTimeout(timer.current); }, []);
  useLayoutEffect(() => {
    if (!tip) return;
    const dismiss = (e: Event) => {
      if (e.type === 'scroll' && e.target instanceof Element && e.target.closest('.hymn-tooltip')) return;
      if (e instanceof KeyboardEvent) { if (e.key !== 'Escape') return; e.preventDefault(); e.stopPropagation(); }
      setTip(null);
    };
    window.addEventListener('scroll', dismiss, true); window.addEventListener('resize', dismiss); window.addEventListener('keydown', dismiss, true);
    return () => { window.removeEventListener('scroll', dismiss, true); window.removeEventListener('resize', dismiss); window.removeEventListener('keydown', dismiss, true); };
  }, [tip]);
  return <div role="listitem" aria-posinset={index + 1} aria-setsize={count} data-hymn-id={hymn.id} className="hymn-row" style={{ position: 'absolute', top, left: 0, right: 0 }}
    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') e.stopPropagation(); }}>
    <button ref={addButton} type="button" data-hymn-action="add" className="hymn-add"
      aria-label={t('hymnLibrary.addNamed', { title: hymn.title })} aria-describedby={tip ? tooltipId : undefined}
      data-guide-anchor={hymn.id.startsWith('practice-hymn-') ? 'hymns-add' : undefined}
      onClick={event => { hide(); if (event.detail === 1) ignoreClickContinuation(); onSelect(hymn); }}
      onMouseEnter={() => { pointerInside.current = true; show(); }} onMouseLeave={() => { pointerInside.current = false; leave(); }}
      onFocus={() => { focusInside.current = true; show(); }} onBlur={() => { focusInside.current = false; leave(); }}>
      <span className="hymn-title-block"><span data-truncate className="hymn-title">{hymn.title}</span><span data-truncate className="hymn-first-line">{firstLine}</span><span data-truncate className="hymn-mobile-meta">{meta}</span></span>
      <span data-truncate className="hymn-author">{hymn.author || '—'}</span><span data-truncate className="hymn-source">{hymn.source || '—'}</span>
    </button>
    <div className="hymn-row-actions">
      <button type="button" data-hymn-action="edit" disabled={hymn.id.startsWith('practice-hymn-')} onClick={() => { onEdit(hymn); }} aria-label={t('hymnLibrary.editNamed', { title: hymn.title })} title={t('common.hymnsEdit')}><Pencil size={16} aria-hidden="true" /></button>
      <button type="button" data-hymn-action="remove" disabled={hymn.id.startsWith('practice-hymn-')} onClick={() => { onRemove(hymn.id); }} aria-label={t('hymnLibrary.deleteNamed', { title: hymn.title })} title={t('common.delete')}><Trash2 size={16} aria-hidden="true" /></button>
    </div>
    {tip && createPortal(<div id={tooltipId} role="tooltip" className="hymn-tooltip" style={{ left: tip.x, top: tip.y, maxHeight: Math.max(0, Math.min(window.innerHeight * .7, tip.below ? window.innerHeight - tip.y - 8 : tip.y - 8)), transform: tip.below ? undefined : 'translateY(-100%)' }} onMouseEnter={() => { clearTimeout(timer.current); pointerInside.current = true; }} onMouseLeave={() => { pointerInside.current = false; leave(); }}><strong>{hymn.title}</strong><div>{firstLine}</div><div>{t('common.hymnsAuthorLabel')}: {hymn.author || '—'}</div><div>{t('common.hymnsSourceLabel')}: {hymn.source || '—'}</div></div>, document.body)}
  </div>;
});
