import DeferredSectionSlide from './DeferredSectionSlide';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, GripVertical, ListTree, MoreHorizontal, MoveRight, Plus, Pencil, X } from 'lucide-react';
import { useStore } from '../state/useStore';
import {
  createSectionFromSelection,
  insertEmptySection,
  UNASSIGNED_DESTINATION,
  getSectionBlocks,
  moveSectionTo,
  moveSlidesToSection,
  normalizeSections,
  removeSection,
  sectionInsertionPoints,
  selectedSlideIds,
  updateSection,
  SECTION_COLORS,
  SECTION_ICONS,
} from '../../shared/sectionModel';
import type { Presentation, PresentationSection, Slide } from '../types';
import Dialog from './Dialog';
import { DEFAULT_STYLES } from '../constants';
import { cn } from '../utils';

const PRESETS = ['welcome', 'worship', 'hymns', 'announcements', 'sermon', 'communion', 'closing', 'prayer'];
const button =
  'rounded-lg border border-white/10 px-3 py-2 text-xs hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 disabled:opacity-35 disabled:cursor-not-allowed';
const input =
  'w-full rounded-lg border border-white/15 bg-surface-overlay p-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400';
type Editor =
  | { kind: 'create'; slideIds: string[] }
  | { kind: 'edit'; sectionId: string }
  | { kind: 'move'; slideIds: string[] }
  | { kind: 'remove' | 'delete'; sectionId: string };
export interface SectionDragHandlers {
  onDragStart: (id: string) => void;
  onDragOver: (id: string) => void;
  onDragEnd: () => void;
  onDrop: () => void;
  isDragging: boolean;
  draggable: boolean;
}

export default function ServiceSections({
  slides,
  columns,
  renderSlide,
}: {
  slides: Slide[];
  columns: number;
  renderSlide: (slide: Slide, drag: SectionDragHandlers) => ReactNode;
}) {
  const { t } = useTranslation();
  const deck = useStore((s) => s.presentation);
  const selectedId = useStore((s) => s.selectedSlideId);
  const selectedIds = useStore((s) => s.selectedSlideIds);
  const isBroadcastOpen = useStore((s) => s.isProjectorWindowOpen);
  const liveId = useStore((s) => s.liveSlideId);
  const search = useStore((s) => s.searchQuery);
  const filter = useStore((s) => s.sectionFilterId);
  const setFilter = useStore((s) => s.setSectionFilterId);
  const [outline, setOutline] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<string | null>(null);
  const [context, setContext] = useState<string | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [name, setName] = useState('');
  const [color, setColor] = useState(SECTION_COLORS[0]);
  const [icon, setIcon] = useState('•');
  const [target, setTarget] = useState('');
  const [position, setPosition] = useState<'start' | 'end'>('end');
  const [dragIds, setDragIds] = useState<string[]>([]);
  const [dragSection, setDragSection] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ sectionId: string; beforeId?: string } | null>(null);
  const dragRef = useRef<string[]>([]);
  const targetRef = useRef<typeof dropTarget>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [toolbarHeight, setToolbarHeight] = useState(96);
  const rootRef = useRef<HTMLDivElement>(null);
  const blocks = useMemo(() => getSectionBlocks(deck), [deck]);
  const endPoint = useMemo(() => sectionInsertionPoints(deck).at(-1), [deck]);
  const visibleIds = useMemo(() => new Set(slides.map((s) => s.id)), [slides]);
  const slideIndex = useMemo(() => new Map(deck.slides.map((s, i) => [s.id, i])), [deck.slides]);
  const title = (section?: PresentationSection) =>
    !section || section.unassigned ? t('sections.none') : section.title;
  const selectedSection = blocks.find((b) => b.slides.some((s) => s.id === selectedId));
  const liveSection = blocks.find((b) => b.slides.some((s) => s.id === liveId));
  const restricted = !!search.trim() || !!filter;
  const activeSection = editor && 'sectionId' in editor ? blocks.find((b) => b.id === editor.sectionId) : undefined;
  const createsEmptySection = !!editor && editor.kind === 'create' && !editor.slideIds.length;
  const previewIds = useMemo(() => new Set(editor?.kind === 'create' ? editor.slideIds : []), [editor]);

  useEffect(() => {
    const el = toolbarRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setToolbarHeight(el.getBoundingClientRect().height));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    resetDrag();
  }, [deck]);
  useEffect(() => {
    setFilter('');
    setCollapsed(new Set());
    setEditor(null);
    setMenu(null);
  }, [deck.id, setFilter]);
  useEffect(() => {
    if (filter && !blocks.some((b) => b.id === filter)) setFilter('');
  }, [blocks, filter, setFilter]);
  const selectedSectionId = selectedSection?.id;
  useEffect(() => {
    if (!selectedSectionId) return;
    setCollapsed((old) => {
      if (!old.has(selectedSectionId)) return old;
      const next = new Set(old);
      next.delete(selectedSectionId);
      return next;
    });
  }, [selectedId, selectedSectionId]);
  useEffect(() => {
    const close = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMenu(null);
        setContext(null);
        setOutline(false);
        resetDrag();
      }
    };
    const outside = (e: PointerEvent) => {
      if (!(e.target as Element).closest('[data-section-menu]')) {
        setMenu(null);
        setContext(null);
        setOutline(false);
      }
    };
    window.addEventListener('keydown', close);
    window.addEventListener('pointerdown', outside);
    return () => {
      window.removeEventListener('keydown', close);
      window.removeEventListener('pointerdown', outside);
    };
  }, []);

  function commit(next: Presentation) {
    const state = useStore.getState();
    state.dispatchUndo({ type: 'SET', payload: next });
    const remaining = new Set(next.slides.map((s) => s.id));
    state.setSelectedSlideIds(new Set([...state.selectedSlideIds].filter((id) => remaining.has(id))));
    if (!remaining.has(state.selectedSlideId) && next.slides[0]) state.setSelectedSlideId(next.slides[0].id);
    setMenu(null);
    setContext(null);
  }
  function browse(sectionId: string, slideId?: string) {
    setOutline(false);
    setFilter('');
    useStore.getState().setSearchQuery('');
    setCollapsed((old) => {
      const next = new Set(old);
      next.delete(sectionId);
      return next;
    });
    if (slideId) {
      const state = useStore.getState();
      state.setSelectedSlideId(slideId);
      state.setSelectedSlideIds(new Set([slideId]));
      state.setLastSelectedIndex(slideIndex.get(slideId) ?? null);
    }
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        rootRef.current
          ?.querySelector<HTMLElement>(
            slideId
              ? '[data-section-slide="' + CSS.escape(slideId) + '"]'
              : '[data-section-id="' + CSS.escape(sectionId) + '"]'
          )
          ?.scrollIntoView({ block: 'start', behavior: 'auto' });
      })
    );
  }
  function openEditor(next: Editor) {
    setMenu(null);
    setContext(null);
    setOutline(false);
    if (next.kind === 'create') {
      setName('');
      setColor(SECTION_COLORS[blocks.length % SECTION_COLORS.length]);
      setIcon('•');
      setEditor(next);
      return;
    }
    const section = 'sectionId' in next ? blocks.find((b) => b.id === next.sectionId) : undefined;
    setName(section && !section.unassigned ? section.title : '');
    setColor(section?.color ?? SECTION_COLORS[blocks.length % SECTION_COLORS.length]);
    setIcon(section?.icon ?? '•');
    setTarget(next.kind === 'remove' ? UNASSIGNED_DESTINATION : (blocks.find((b) => b.id !== section?.id)?.id ?? ''));
    setPosition('end');
    setEditor(next);
  }
  // One entry point for "Bölüm Oluştur": the user's own selection decides which
  // slides are grouped. Nothing is implied from the slide they happen to sit on.
  function openCreate() {
    const current = useStore.getState();
    const ids = selectedSlideIds(current.presentation, [current.selectedSlideId, ...current.selectedSlideIds]);
    openEditor({ kind: 'create', slideIds: ids });
  }
  // Mirror of openCreate for "Bölüme Taşı": the same selected slides are the
  // ones that move, and the dialog only asks for the destination + position.
  function openMove() {
    const current = useStore.getState();
    const ids = selectedSlideIds(current.presentation, [current.selectedSlideId, ...current.selectedSlideIds]);
    if (!ids.length) return;
    openEditor({ kind: 'move', slideIds: ids });
  }
  function submit() {
    const current = useStore.getState().presentation;
    if (!editor) return;
    const section = { id: crypto.randomUUID(), title: name, color, icon };
    if (editor.kind === 'create') {
      if (editor.slideIds.length) commit(createSectionFromSelection(current, editor.slideIds, section));
      else commit(normalizeSections(insertEmptySection(current, undefined, section)));
    }
    if (editor.kind === 'edit') commit(updateSection(current, editor.sectionId, { title: name, color, icon }));
    if (editor.kind === 'move') commit(moveSlidesToSection(current, new Set(editor.slideIds), target, position));
    if (editor.kind === 'remove') commit(removeSection(current, editor.sectionId, target));
    if (editor.kind === 'delete') commit(removeSection(current, editor.sectionId, undefined, true));
    setEditor(null);
  }
  function resetDrag() {
    dragRef.current = [];
    targetRef.current = null;
    setDragIds([]);
    setDragSection(null);
    setDropTarget(null);
  }
  function markDrop(sectionId: string, beforeId?: string) {
    const next = { sectionId, beforeId };
    targetRef.current = next;
    setDropTarget(next);
  }
  function finishDrop() {
    const dest = targetRef.current;
    if (!restricted && dest && dragRef.current.length)
      commit(
        moveSlidesToSection(
          useStore.getState().presentation,
          new Set(dragRef.current),
          dest.sectionId,
          dest.beforeId ? { beforeId: dest.beforeId } : 'end'
        )
      );
    resetDrag();
  }
  function addSlide(sectionId: string) {
    const current = useStore.getState().presentation;
    const slide: Slide = {
      id: crypto.randomUUID(),
      type: 'text',
      content: t('common.newSlideContent'),
      styles: { ...DEFAULT_STYLES },
      sectionId,
    };
    const last = current.slides.map((s) => s.sectionId).lastIndexOf(sectionId);
    const nextSlides = [...current.slides];
    const blockIndex = blocks.findIndex((b) => b.id === sectionId);
    const index = last >= 0 ? last + 1 : blocks.slice(0, blockIndex).reduce((sum, b) => sum + b.slides.length, 0);
    nextSlides.splice(index, 0, slide);
    commit(normalizeSections({ ...current, slides: nextSlides }));
    browse(sectionId, slide.id);
  }
  const editorTitle =
    editor?.kind === 'create'
      ? t('sections.create')
      : editor?.kind === 'edit'
        ? t('sections.rename')
        : editor?.kind === 'move'
          ? t('sections.move')
          : editor?.kind === 'delete'
            ? t('sections.deleteWithSlides')
            : t('sections.remove');
  const deleteBlocked =
    !!activeSection &&
    (activeSection.slides.some((s) => s.locked) || activeSection.slides.length === deck.slides.length);
  const submitDisabled =
    !editor
      ? true
      : editor.kind === 'create'
        ? !name.trim()
        : editor.kind === 'edit'
          ? !activeSection || !name.trim()
          : editor.kind === 'delete'
            ? deleteBlocked || !activeSection
            : editor.kind === 'remove'
              ? !activeSection || (!!activeSection.slides.length && !target)
              : !target;

  return (
    <div
      ref={rootRef}
      className="space-y-3"
      data-testid="section-workspace"
      onKeyDown={(e) => {
        if ((e.target as Element).closest('button, summary, [data-section-menu]')) e.stopPropagation();
        if (e.key === 'Escape' && (menu || context || dragIds.length || dragSection)) {
          e.stopPropagation();
          setMenu(null);
          setContext(null);
          resetDrag();
        }
      }}
    >
      <div
        ref={toolbarRef}
        className="sticky top-0 z-30 rounded-xl border border-white/10 bg-surface-raised p-3 shadow-lg"
      >
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative" data-section-menu>
            <button
              className={button}
              aria-expanded={outline}
              onClick={() => {
                setMenu(null);
                setContext(null);
                setOutline(!outline);
              }}
            >
              <ListTree className="inline w-4 h-4 mr-1" />
              {t('sections.outline')}
              <ChevronDown
                className={cn('inline w-3 h-3 ml-1 transition-transform', outline && 'rotate-180')}
                aria-hidden="true"
              />
            </button>
            {outline && (
              <div
                aria-label={t('sections.outline')}
                className="absolute left-0 top-full z-40 mt-1 max-h-[60vh] w-72 overflow-y-auto rounded-xl border border-white/15 bg-surface-overlay p-2 shadow-xl"
              >
                <p className="px-2 py-1 text-sm font-semibold break-words">{deck.name}</p>
                {blocks.map((b) => (
                  <button
                    key={b.id}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
                    title={t('sections.goTo')}
                    onClick={() => browse(b.id)}
                  >
                    <span style={{ color: b.color }}>{b.icon ?? '•'}</span>
                    <span className="min-w-0 flex-1 truncate">{title(b)}</span>
                    <span className="text-white/40">{t('sections.slideCount', { count: b.slides.length })}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            className={cn(button, 'bg-blue-500/15 text-blue-200')}
            disabled={!selectedId}
            onClick={openCreate}
          >
            <Plus className="inline w-4 h-4 mr-1" />
            {t('sections.create')}
            {selectedIds.size > 1 && ' (' + selectedIds.size + ')'}
          </button>
          <button className={button} disabled={!selectedId} onClick={openMove}>
            <MoveRight className="inline w-4 h-4 mr-1" />
            {t('sections.move')}
            {selectedIds.size > 1 && ' (' + selectedIds.size + ')'}
          </button>
          <button
            className={button}
            onClick={() => {
              setMenu(null);
              setContext(null);
              setOutline(false);
              setCollapsed(
                collapsed.size && collapsed.size === blocks.length ? new Set() : new Set(blocks.map((b) => b.id))
              );
            }}
          >
            {t(collapsed.size && collapsed.size === blocks.length ? 'sections.expandAll' : 'sections.collapseAll')}
          </button>
          {dragIds.length > 0 && dropTarget && (
            <span
              role="status"
              className="rounded-lg border border-blue-400/30 bg-blue-500/15 px-2 py-1 text-[11px] text-blue-100"
            >
              {t(dropTarget.beforeId ? 'sections.dropBefore' : 'sections.dropEnd', {
                count: dragIds.length,
                name: title(blocks.find((b) => b.id === dropTarget.sectionId)),
                number: (slideIndex.get(dropTarget.beforeId ?? '') ?? -1) + 1,
              })}
            </span>
          )}
        </div>
      </div>
      <div className="min-w-0 space-y-3">
        {blocks
          .filter((b) => !filter || b.id === filter)
          .map((b) => {
            const index = blocks.findIndex((s) => s.id === b.id);
            const visible = b.slides.filter((s) => visibleIds.has(s.id));
            if (search.trim() && !visible.length) return null;
            return (
              <section
                key={b.id}
                data-section-id={b.id}
                className="scroll-mt-36 rounded-xl border border-white/15 bg-white/[0.015]"
                aria-label={title(b)}
              >
                <div
                  className={cn(
                    'group/header sticky z-20 flex items-center gap-1 rounded-t-xl bg-surface-raised p-2 border-b border-white/10',
                    dropTarget?.sectionId === b.id && !dropTarget.beforeId && 'ring-2 ring-blue-400'
                  )}
                  style={{ top: toolbarHeight + 8 }}
                  onDragOver={(e) => {
                    if (restricted || (!dragIds.length && !dragSection)) return;
                    e.preventDefault();
                    markDrop(b.id);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (dragSection && !restricted) {
                      commit(moveSectionTo(deck, dragSection, index));
                      resetDrag();
                    } else {
                      markDrop(b.id);
                      finishDrop();
                    }
                  }}
                >
                  <span
                    draggable={!restricted}
                    onDragStart={(e) => {
                      e.dataTransfer.setData('text/plain', b.id);
                      e.dataTransfer.effectAllowed = 'move';
                      setDragSection(b.id);
                    }}
                    onDragEnd={resetDrag}
                    title={t('sections.dragSection')}
                    className={cn('p-1 text-white/40', restricted ? 'opacity-30' : 'cursor-grab')}
                  >
                    <GripVertical className="w-4 h-4" />
                  </span>
                  <button
                    className={cn(button, 'p-1 border-0')}
                    aria-expanded={!collapsed.has(b.id)}
                    aria-label={t('sections.toggle', { name: title(b) })}
                    onClick={() =>
                      setCollapsed((old) => {
                        const next = new Set(old);
                        if (next.has(b.id)) next.delete(b.id);
                        else next.add(b.id);
                        return next;
                      })
                    }
                  >
                    {collapsed.has(b.id) ? (
                      <ChevronRight className="w-4 h-4" />
                    ) : (
                      <ChevronDown className="w-4 h-4" />
                    )}
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span style={{ color: b.color }}>{b.icon ?? '•'}</span>
                      <strong className="text-sm truncate">{title(b)}</strong>
                      <button
                        className={cn(button, 'p-1 border-0 opacity-0 group-hover/header:opacity-100 focus-visible:opacity-100')}
                        aria-label={t('sections.rename')}
                        onClick={() => openEditor({ kind: 'edit', sectionId: b.id })}
                      >
                        <Pencil className="w-3 h-3" />
                      </button>
                    </div>
                    <p className="text-[11px] text-white/50">
                      {b.slides.length
                        ? t('sections.slideCount', { count: b.slides.length })
                        : t('sections.empty')}
                      {restricted && ' · ' + t('sections.visible', { count: visible.length, total: b.slides.length })}
                    </p>
                  </div>
                  {isBroadcastOpen && b.id === liveSection?.id && (
                    <span className="text-[10px] text-red-300">{t('sections.live')}</span>
                  )}
                  <button
                    className={cn(button, 'p-1.5 border-0')}
                    aria-label={t('sections.addSlide')}
                    title={t('sections.addSlide')}
                    onClick={() => addSlide(b.id)}
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                  <div className="relative" data-section-menu>
                    <button
                      className={button}
                      aria-label={t('sections.actions', { name: title(b) })}
                      aria-expanded={menu === b.id}
                      onClick={() => {
                        setContext(null);
                        setMenu(menu === b.id ? null : b.id);
                      }}
                    >
                      <MoreHorizontal className="w-4 h-4" />
                    </button>
                    {menu === b.id && (
                      <div className="absolute right-0 top-full mt-1 z-40 w-60 p-2 rounded-xl border border-white/15 bg-surface-overlay shadow-xl flex flex-col gap-1">
                        <button className={button} onClick={() => openEditor({ kind: 'edit', sectionId: b.id })}>
                          {t('sections.rename')}
                        </button>
                        <button
                          className={button}
                          onClick={() => {
                            const state = useStore.getState();
                            state.setSelectedSlideIds(new Set(b.slides.map((s) => s.id)));
                            if (b.slides[0]) state.setSelectedSlideId(b.slides[0].id);
                            setMenu(null);
                          }}
                        >
                          {t('sections.selectAll')}
                        </button>
                        {([-1, 1] as const).map((d) => (
                          <button
                            key={d}
                            className={button}
                            disabled={restricted || index + d < 0 || index + d >= blocks.length}
                            onClick={() => commit(moveSectionTo(deck, b.id, index + d))}
                          >
                            {t(d < 0 ? 'common.moveUp' : 'common.moveDown')}
                          </button>
                        ))}
                        <div className="my-1 h-px bg-white/10" aria-hidden="true" />
                        <button className={button} onClick={() => openEditor({ kind: 'remove', sectionId: b.id })}>
                          {t('sections.remove')}
                        </button>
                        <button
                          className={cn(button, 'text-red-300')}
                          onClick={() => openEditor({ kind: 'delete', sectionId: b.id })}
                        >
                          {t('sections.deleteWithSlides')}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
                {!collapsed.has(b.id) && (
                  <div
                    className="space-y-3 p-3"
                    onDragOver={(e) => {
                      if (restricted || !dragRef.current.length) return;
                      e.preventDefault();
                      markDrop(b.id);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      markDrop(b.id);
                      finishDrop();
                    }}
                  >
                    <div
                      className="grid gap-3"
                      style={{ gridTemplateColumns: 'repeat(' + columns + ', minmax(0, 1fr))' }}
                    >
                      {visible.map((s) => {
                        return (
                          <div
                            key={s.id}
                            data-section-slide={s.id}
                            className={cn(
                              'relative min-w-0 scroll-mt-36 rounded-xl',
                              previewIds.has(s.id) && 'ring-2 ring-amber-300',
                              dropTarget?.beforeId === s.id && 'ring-2 ring-blue-400'
                            )}
                            onContextMenu={(e) => {
                              e.preventDefault();
                              setMenu(null);
                              setContext(s.id);
                            }}
                          >
                            <DeferredSectionSlide
                              render={() =>
                                renderSlide(s, {
                                  onDragStart: (id) => {
                                    if (restricted) return;
                                    const ids = selectedIds.has(id) ? [...selectedIds] : [id];
                                    dragRef.current = ids;
                                    setDragIds(ids);
                                  },
                                  onDragOver: () => {
                                    if (!restricted && dragRef.current.length) markDrop(b.id, s.id);
                                  },
                                  onDragEnd: resetDrag,
                                  onDrop: () => {
                                    markDrop(b.id, s.id);
                                    finishDrop();
                                  },
                                  draggable: !restricted,
                                  isDragging: dragIds.includes(s.id),
                                })
                              }
                            />
                            {context === s.id && (
                              <div
                                data-section-menu
                                className="absolute right-1 top-1 z-40 min-w-52 p-2 rounded-xl border border-white/15 bg-surface-overlay shadow-xl flex flex-col gap-1"
                              >
                                <button
                                  className={button}
                                  onClick={() =>
                                    openEditor({
                                      kind: 'move',
                                      slideIds: selectedIds.has(s.id) ? [...selectedIds] : [s.id],
                                    })
                                  }
                                >
                                  {t('sections.move')}
                                </button>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    {!b.slides.length && <p className="text-xs text-white/40">{t('sections.emptyHint')}</p>}
                  </div>
                )}
              </section>
            );
          })}
        {!filter && !search.trim() && endPoint && (
          <div className="group/end">
            <button
              className="flex h-7 w-full items-center justify-center gap-1 rounded-lg border border-dashed border-transparent text-[11px] text-white/45 opacity-0 transition-colors hover:border-white/15 hover:bg-blue-500/10 hover:text-blue-200 focus-visible:opacity-100 group-hover/end:opacity-100"
              aria-label={t('sections.create')}
              onClick={() => openEditor({ kind: 'create', slideIds: [] })}
            >
              <Plus className="w-3 h-3" aria-hidden="true" />
              {t('sections.create')}
            </button>
          </div>
        )}
        {!blocks.some(
          (b) => (!filter || b.id === filter) && (!search.trim() || b.slides.some((s) => visibleIds.has(s.id)))
        ) && <p className="p-8 text-center text-white/50">{t('common.noResults')}</p>}
      </div>
      <Dialog
        open={!!editor}
        onClose={() => setEditor(null)}
        labelledBy="section-dialog-title"
        className="w-[min(92vw,520px)] rounded-2xl border border-white/15 bg-surface-raised p-5 shadow-2xl"
      >
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!submitDisabled) submit();
          }}
        >
          <div className="flex items-center justify-between">
            <h2 id="section-dialog-title" className="text-lg font-semibold">
              {editorTitle}
            </h2>
            <button type="button" className={button} aria-label={t('common.close')} onClick={() => setEditor(null)}>
              <X className="w-4 h-4" />
            </button>
          </div>
          {(editor?.kind === 'create' || editor?.kind === 'edit') && (
            <>
              <label className="block text-xs space-y-2">
                <span>{t('sections.name')}</span>
                <input
                  autoFocus
                  maxLength={100}
                  className={input}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </label>
              <div className="flex flex-wrap gap-1">
                {PRESETS.map((p) => (
                  <button type="button" className={button} key={p} onClick={() => setName(t('sections.' + p))}>
                    {t('sections.' + p)}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap gap-2" aria-label={t('sections.color')}>
                {SECTION_COLORS.map((c, i) => (
                  <button
                    type="button"
                    key={c}
                    aria-label={t('sections.colorNumber', { number: i + 1 })}
                    aria-pressed={color === c}
                    onClick={() => setColor(c)}
                    className={cn('w-7 h-7 rounded-full border-2', color === c ? 'border-white' : 'border-transparent')}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
              <div className="flex gap-1" aria-label={t('sections.icon')}>
                {SECTION_ICONS.map((i) => (
                  <button
                    type="button"
                    key={i}
                    aria-pressed={icon === i}
                    className={cn(button, icon === i && 'bg-blue-500/25')}
                    onClick={() => setIcon(i)}
                  >
                    {i}
                  </button>
                ))}
              </div>
            </>
          )}
          {editor?.kind === 'create' && (
            <>
              {createsEmptySection ? (
                <p className="text-sm text-white/60">
                  {t('sections.emptyScope')}
                </p>
              ) : (
                <div className="rounded-xl border border-blue-400/20 bg-blue-500/10 p-3 text-sm space-y-2">
                  <p>{t('sections.scope', { count: editor.slideIds.length })}</p>
                  <p className="text-xs text-white/60">{t('sections.scopeHint')}</p>
                </div>
              )}
            </>
          )}
          {(editor?.kind === 'move' || editor?.kind === 'remove') && (
            <>
              <p className="text-sm text-white/70">
                {editor.kind === 'move'
                  ? t('sections.moveCount', { count: editor.slideIds.length })
                  : t('sections.removeHint', { name: title(activeSection), count: activeSection?.slides.length ?? 0 })}
              </p>
              <label className="block text-xs space-y-2">
                <span>{t('sections.destination')}</span>
                <select className={input} value={target} onChange={(e) => setTarget(e.target.value)}>
                  {editor.kind === 'remove' && <option value={UNASSIGNED_DESTINATION}>{t('sections.none')}</option>}
                  {blocks
                    .filter((b) => editor.kind !== 'remove' || b.id !== editor.sectionId)
                    .map((b) => (
                      <option key={b.id} value={b.id}>
                        {title(b)} · {t('sections.slideCount', { count: b.slides.length })}
                      </option>
                    ))}
                </select>
              </label>
              {editor.kind === 'move' && (
                <label className="block text-xs space-y-2">
                  <span>{t('sections.position')}</span>
                  <select
                    className={input}
                    value={position}
                    onChange={(e) => setPosition(e.target.value as 'start' | 'end')}
                  >
                    <option value="start">{t('sections.atStart')}</option>
                    <option value="end">{t('sections.atEnd')}</option>
                  </select>
                </label>
              )}
            </>
          )}
          {editor?.kind === 'delete' && (
            <p className="text-sm text-red-200">
              {deleteBlocked
                ? t('sections.deleteBlocked')
                : t('sections.deleteConfirm', { name: title(activeSection), count: activeSection?.slides.length ?? 0 })}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" className={button} onClick={() => setEditor(null)}>
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              disabled={submitDisabled}
              className={cn(
                button,
                editor?.kind === 'delete' ? 'bg-red-500/20 text-red-200' : 'bg-blue-500/25 text-blue-100'
              )}
            >
              {editor?.kind === 'create' ? t('sections.createSubmit') : t('sections.apply')}
            </button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
