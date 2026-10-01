import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from 'react';
import {
  X,
  Trash2,
  Move,
  Copy,
  Lock,
  Unlock,
  Layers,
  Image,
  Type,
  Palette,
  Save,
  RotateCw,
  LayoutTemplate,
  Group,
  Ungroup,
  Undo2,
  Redo2,
  ChevronRight,
  ClipboardCheck,
  Paintbrush,
  Layers2,
  PanelLeftOpen,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Presentation, Slide, SlideItem } from '../types';
import { cn } from '../utils';
import { confirmDialog } from '../dialogs';
import Dialog from '../components/Dialog';
import {
  makeItemId,
  normalizeItems,
  deleteItems,
  duplicateItems,
  swapLayer,
  toggleVisibility,
  toggleLock,
  clamp,
  deleteItemAt,
  duplicateItem,
  DEFAULT_TEXT_STYLE,
} from './editorUtils';
import { useKeyboardShortcuts } from './keyboardShortcuts';
import { CanvasStage } from './CanvasStage';
import { TextStyleEditor } from './styleEditors/TextStyleEditor';
import { ImageStyleEditor } from './styleEditors/ImageStyleEditor';
import { LayerPanel } from './panels/LayerPanel';
import { SlideSettingsPanel } from './panels/SlideSettingsPanel';
import { AlignmentTools } from './AlignmentTools';
import { SlideTemplates } from './SlideTemplates';
import { applyTemplate } from './templates';
import { createGroup, ungroupGroup } from './groupUtils';
import EditorSlideRail, { RAIL_COLLAPSED_WIDTH, RAIL_WIDTH } from './EditorSlideRail';
import EditorPasteMenu, { type PasteMenuContext } from './EditorPasteMenu';
import { useEditorDeck, type EditScope, type EditorClipboard, type EditorNotice } from './useEditorDeck';
import { makeClipboard, type SlideDraft } from './slideDraft';
import { isEditableTarget } from './editorUtils';
import { writeElementDrag } from './elementDrag';

interface SlideEditorProps {
  /** Slide the editor opens on. */
  slide: Slide;
  /** Whole deck, in order. Read-only source of truth while editing. */
  deck: Presentation;
  /** Called with only the slides that changed. */
  onSave: (slides: Slide[]) => void;
  onClose: () => void;
}

type InspectorTab = 'item' | 'slide' | 'layers';

const RAIL_STORAGE_KEY = 'editorRailCollapsed';

const PanelShell = memo(function PanelShell({
  title,
  icon: Icon,
  children,
  className,
  actions,
}: {
  title: string;
  icon: ComponentType<{ className?: string }>;
  children: ReactNode;
  className?: string;
  actions?: ReactNode;
}) {
  return (
    <div
      className={cn(
        'space-y-3 rounded-2xl border border-white/10 bg-[#1a1a1a] p-4 shadow-sm',
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2 text-sm font-semibold text-white/80">
          <Icon className="h-4 w-4 shrink-0" />
          <span className="truncate">{title}</span>
        </div>
        {actions}
      </div>
      {children}
    </div>
  );
});

/**
 * Scope control: the single place that decides whether an edit lands on the
 * working slide only or on every selected slide. It only appears when there is
 * more than one slide selected, and it always defaults to the safe option.
 */
const ScopeSelector = memo(function ScopeSelector({
  scope,
  selectedCount,
  slideCount,
  onChange,
}: {
  scope: EditScope;
  selectedCount: number;
  slideCount: number;
  onChange: (scope: EditScope) => void;
}) {
  const { t } = useTranslation();
  if (selectedCount <= 1) return null;
  return (
    <div className="space-y-1">
      <div
        role="radiogroup"
        aria-label={t('common.editorScopeLabel')}
        className="grid grid-cols-2 gap-1 rounded-xl border border-white/10 bg-black/25 p-1"
      >
        {([
          { value: 'active' as const, label: t('common.editorScopeActive') },
          { value: 'selected' as const, label: t('common.editorScopeSelected', { count: selectedCount }) },
        ]).map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={scope === option.value}
            onClick={() => onChange(option.value)}
            className={cn(
              'rounded-lg px-2 py-1.5 text-[11px] font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500',
              scope === option.value
                ? 'bg-blue-600/30 text-blue-100'
                : 'text-white/55 hover:bg-white/5 hover:text-white/80',
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
      {scope === 'selected' && (
        <p role="status" className="rounded-lg border border-amber-400/30 bg-amber-500/10 px-2 py-1 text-[10px] text-amber-100">
          {t('common.editorScopeNotice', { count: Math.min(selectedCount, slideCount) })}
        </p>
      )}
    </div>
  );
});

/** Clipboard status + the one-click "apply to the other selected slides". */
const ClipboardChip = memo(function ClipboardChip({
  clipboard,
  targetCount,
  onApply,
  onClear,
}: {
  clipboard: EditorClipboard;
  targetCount: number;
  onApply: () => void;
  onClear: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-white/70">
      <ClipboardCheck className="h-3.5 w-3.5 text-blue-300" aria-hidden="true" />
      <span className="truncate">
        {t('common.editorClipboardLabel')}: <strong className="font-medium text-white/85">{t(clipboard.labelKey)}</strong>
        {clipboard.items.length > 1 && ` · ${clipboard.items.length}`}
      </span>
      {targetCount > 0 && (
        <button
          type="button"
          onClick={onApply}
          className="rounded-lg border border-blue-500/30 bg-blue-600/25 px-2 py-1 text-[11px] font-medium text-blue-100 transition hover:bg-blue-600/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
        >
          {t('common.editorApplyToSelected', { count: targetCount })}
        </button>
      )}
      <button
        type="button"
        onClick={onClear}
        aria-label={t('common.editorClearClipboard')}
        title={t('common.editorClearClipboard')}
        className="rounded p-0.5 text-white/40 transition hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
      >
        <X className="h-3 w-3" aria-hidden="true" />
      </button>
    </div>
  );
});

export default function SlideEditor({ slide, deck, onSave, onClose }: SlideEditorProps) {
  const { t } = useTranslation();
  const session = useEditorDeck({ deck, initialSlide: slide });

  const activeSlide = session.activeSlide;
  const activeDraft: SlideDraft | null = session.activeDraft;
  const items = session.activeItems;

  const [tab, setTab] = useState<InspectorTab>('item');
  const [showTemplates, setShowTemplates] = useState(false);
  const [clipboard, setClipboard] = useState<EditorClipboard | null>(null);
  const [pasteMenu, setPasteMenu] = useState<PasteMenuContext | null>(null);
  const [scope, setScope] = useState<EditScope>('active');
  const [railCollapsed, setRailCollapsed] = useState(() => {
    try {
      return localStorage.getItem(RAIL_STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  });

  const slideOrder = session.order;
  const selectedSlideIds = session.selection.selectedIds;
  const multiSlide = selectedSlideIds.length > 1;
  const effectiveScope: EditScope = multiSlide ? scope : 'active';

  // A bulk scope left over from a wider selection must never silently persist.
  useEffect(() => {
    if (!multiSlide && scope !== 'active') setScope('active');
  }, [multiSlide, scope]);

  useEffect(() => {
    try {
      localStorage.setItem(RAIL_STORAGE_KEY, railCollapsed ? '1' : '0');
    } catch {
      /* storage unavailable */
    }
  }, [railCollapsed]);

  const selectedIds = session.selectedItemIds;
  const selectedItems = session.selectedItems;
  const primarySelected = useMemo(
    () => selectedItems[selectedItems.length - 1] ?? null,
    [selectedItems],
  );

  const activeIndex = Math.max(0, slideOrder.indexOf(session.activeId));
  const liveSlideId = deck.liveSlideId ?? null;

  // ── Notices ────────────────────────────────────────────────────────────────

  const notice: EditorNotice | null = session.notice;
  const clearNotice = session.setNotice;
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => clearNotice(null), 4000);
    return () => clearTimeout(timer);
  }, [notice, clearNotice]);

  const noticeText = notice
    ? t(notice.key, { count: notice.count ?? 0, skipped: notice.skipped ?? 0 })
    : null;

  // ── Editing ────────────────────────────────────────────────────────────────

  const updateItem = useCallback(
    (id: string, updates: Partial<SlideItem>) => {
      session.applyItemUpdate(id, updates, selectedSlideIds, effectiveScope);
    },
    [session, selectedSlideIds, effectiveScope],
  );

  const updateItemStyle = useCallback(
    (id: string, patch: Partial<SlideItem>) => {
      session.applyItemUpdate(id, patch, selectedSlideIds, effectiveScope);
    },
    [session, selectedSlideIds, effectiveScope],
  );

  const updateSlideStyles = useCallback(
    (updates: Record<string, unknown>) => {
      session.applySlideStylePatch(updates, selectedSlideIds, effectiveScope);
    },
    [session, selectedSlideIds, effectiveScope],
  );

  // Live drag frames skip history; the session records one entry per gesture,
  // and only once the gesture actually changes something.
  const gestureActiveRef = useRef(false);
  const beginGesture = useCallback(() => {
    if (gestureActiveRef.current) return;
    gestureActiveRef.current = true;
    session.gestureStart();
  }, [session]);
  const endGesture = useCallback(() => {
    gestureActiveRef.current = false;
    session.gestureEnd();
  }, [session]);

  const handleDrag = useCallback(
    (id: string, x: number, y: number) => {
      beginGesture();
      session.updateItems((prev) => prev.map((item) => (item.id === id ? { ...item, x, y } : item)), {
        history: false,
      });
    },
    [beginGesture, session],
  );

  const handleResize = useCallback(
    (id: string, width: number, height: number) => {
      beginGesture();
      session.updateItems(
        (prev) => prev.map((item) => (item.id === id ? { ...item, width, height } : item)),
        { history: false },
      );
    },
    [beginGesture, session],
  );

  const handleRotate = useCallback(
    (id: string, rotation: number) => {
      beginGesture();
      session.updateItems(
        (prev) => prev.map((item) => (item.id === id ? { ...item, rotation } : item)),
        { history: false },
      );
    },
    [beginGesture, session],
  );

  const handleDragEnd = useCallback(() => {
    // Normalising stays inside the gesture, otherwise it would record a second,
    // redundant undo entry right after the drag's own entry.
    session.normalizeActiveItems({ history: false });
    endGesture();
  }, [endGesture, session]);

  const handleSelect = useCallback(
    (id: string | null, multi?: boolean) => {
      if (id === null) {
        session.setItemSelection(new Set());
        return;
      }
      const next = new Set(selectedIds);
      if (multi) {
        if (next.has(id)) next.delete(id);
        else next.add(id);
      } else {
        next.clear();
        next.add(id);
      }
      session.setItemSelection(next);
    },
    [session, selectedIds],
  );

  const handleSelectMany = useCallback(
    (ids: Set<string>) => session.setItemSelection(ids),
    [session],
  );

  const addItem = useCallback(
    (type: 'text' | 'image') => {
      const maxZ = items.reduce((max, item) => Math.max(max, item.zIndex ?? 0), -1);
      const created: SlideItem = {
        id: makeItemId(),
        type,
        content: type === 'text' ? t('common.editorNewText') : undefined,
        x: type === 'text' ? 12 : 15,
        y: type === 'text' ? 12 : 15,
        width: type === 'text' ? 30 : 40,
        height: type === 'text' ? 12 : 30,
        zIndex: maxZ + 1,
        visible: true,
        locked: false,
        styles: {},
        textStyles: type === 'text' ? { ...DEFAULT_TEXT_STYLE } : undefined,
      };
      session.updateItems(normalizeItems([...items, created]));
      session.setItemSelection(new Set([created.id]));
      setTab('item');
    },
    [items, session, t],
  );

  const deleteSelected = useCallback(() => {
    if (selectedIds.size === 0) return;
    session.updateItems((prev) => deleteItems(prev, selectedIds));
    session.setItemSelection(new Set());
  }, [session, selectedIds]);

  const duplicateSelected = useCallback(() => {
    if (selectedIds.size === 0) return;
    const next = duplicateItems(items, selectedIds);
    const created = next.filter((item) => !items.some((previous) => previous.id === item.id));
    session.updateItems(next);
    if (created.length > 0) session.setItemSelection(new Set(created.map((item) => item.id)));
  }, [items, session, selectedIds]);

  const duplicateItemById = useCallback(
    (id: string) => session.updateItems((prev) => duplicateItem(prev, id)),
    [session],
  );

  const moveItem = useCallback(
    (id: string, direction: 'up' | 'down') =>
      session.updateItems((prev) => swapLayer(prev, id, direction)),
    [session],
  );

  const toggleItemVisibility = useCallback(
    (id: string) => session.updateItems((prev) => toggleVisibility(prev, id)),
    [session],
  );

  const toggleItemLock = useCallback(
    (id: string) => session.updateItems((prev) => toggleLock(prev, id)),
    [session],
  );

  const deleteItemById = useCallback(
    (id: string) => session.updateItems((prev) => deleteItemAt(prev, id)),
    [session],
  );

  const handleGroup = useCallback(() => {
    if (selectedIds.size < 2) return;
    const next = createGroup(items, selectedIds);
    const groupId = next.find((candidate) => !items.some((item) => item.id === candidate.id))?.id;
    session.updateItems(next);
    if (groupId) session.setItemSelection(new Set([groupId]));
  }, [items, session, selectedIds]);

  const handleUngroup = useCallback(() => {
    const groups = items.filter((item) => selectedIds.has(item.id) && item.type === 'group');
    if (groups.length === 0) return;
    session.updateItems((prev) =>
      groups.reduce((result, group) => ungroupGroup(result, group.id), prev),
    );
    session.setItemSelection(new Set());
  }, [session, items, selectedIds]);

  const handleSelectAllItems = useCallback(() => {
    session.setItemSelection(new Set(items.map((item) => item.id)));
  }, [session, items]);

  const updateItemsBatch = useCallback(
    (next: SlideItem[]) => session.updateItems(next),
    [session],
  );

  const handleTemplateSelect = useCallback(
    (templateId: string) => {
      const templateItems = applyTemplate(templateId);
      if (templateItems.length === 0) return;
      session.updateItems(normalizeItems([...items, ...templateItems]));
      session.setItemSelection(new Set(templateItems.map((item) => item.id)));
      setShowTemplates(false);
    },
    [items, session],
  );

  // ── Clipboard ──────────────────────────────────────────────────────────────

  const handleCopy = useCallback(() => {
    const entry = session.copyItems(session.selectedItems);
    if (entry) setClipboard(entry);
  }, [session]);

  const handlePaste = useCallback(() => {
    if (!clipboard || !activeSlide) return;
    session.pasteIntoActive(clipboard);
    setTab('item');
  }, [clipboard, activeSlide, session]);

  const otherSelectedCount = Math.max(0, selectedSlideIds.length - 1);

  const handleApplyToOtherSelected = useCallback(() => {
    if (!clipboard) return;
    session.pasteIntoSelectedSlides(clipboard, selectedSlideIds);
  }, [clipboard, selectedSlideIds, session]);

  const handleApplyClipboardToAll = useCallback(() => {
    if (!clipboard) return;
    session.pasteIntoSlides(clipboard, slideOrder);
  }, [clipboard, session, slideOrder]);

  const handlePasteExact = useCallback(() => {
    if (!clipboard) return;
    session.pasteIntoActive(clipboard, { exact: true });
  }, [clipboard, session]);

  const handlePasteSelectedFlow = useCallback(() => {
    if (!clipboard) return;
    session.pasteIntoSlides(clipboard, selectedSlideIds);
  }, [clipboard, selectedSlideIds, session]);

  const handlePasteStyle = useCallback(() => {
    if (!clipboard) return;
    session.pasteStyleFromClipboard(clipboard, selectedSlideIds);
  }, [clipboard, selectedSlideIds, session]);

  /**
   * "Elementi seç → hedef slaytları seç → uygula": copies the working selection
   * and inserts it on every other selected slide in one undo step.
   */
  const handleApplySelectionToOtherSlides = useCallback(() => {
    if (selectedItems.length === 0 || !activeSlide) return;
    const entry = makeClipboard(selectedItems, activeSlide.id);
    if (!entry) return;
    setClipboard(entry);
    session.pasteIntoSelectedSlides(entry, selectedSlideIds);
  }, [activeSlide, selectedItems, selectedSlideIds, session]);

  const handleApplySameTypeStyle = useCallback(() => {
    session.applySelectionStyleToSlides(selectedSlideIds);
  }, [selectedSlideIds, session]);

  // ── Element drag & drop ────────────────────────────────────────────────────

  const handleItemDragStart = useCallback(
    (event: React.DragEvent, itemIds: string[]) => {
      if (!activeSlide) return;
      const dragged = items.filter((item) => itemIds.includes(item.id));
      if (dragged.length === 0) return;
      writeElementDrag(event.dataTransfer, { items: dragged, sourceSlideId: activeSlide.id });
    },
    [activeSlide, items],
  );

  const handleRailDrop = useCallback(
    (targetSlideId: string, payload: { items: SlideItem[]; sourceSlideId: string }) => {
      const entry = makeClipboard(payload.items, payload.sourceSlideId);
      if (!entry) return;
      setClipboard(entry);
      // Dropping onto one of several selected slides applies to all of them;
      // dropping outside the selection only touches the target.
      const targets = selectedSlideIds.includes(targetSlideId) && multiSlide
        ? selectedSlideIds
        : [targetSlideId];
      session.pasteIntoSlides(entry, targets);
      const target = session.slideById.get(targetSlideId);
      if (target && targetSlideId !== session.activeId) session.activateSlide(target);
      setTab('item');
    },
    [multiSlide, selectedSlideIds, session],
  );

  // ── Save / close ───────────────────────────────────────────────────────────

  const handleClose = useCallback(async () => {
    if (session.isDirty) {
      const discard = await confirmDialog(
        t('common.editorUnsavedSlides', { count: session.touchedCount }),
        {
          title: t('common.editorUnsavedTitle'),
          confirmLabel: t('common.editorDiscard'),
          cancelLabel: t('common.cancel'),
        },
      );
      if (!discard) return;
    }
    onClose();
  }, [onClose, session.isDirty, session.touchedCount, t]);

  const handleSave = useCallback(() => {
    const payload = session.buildSavePayload();
    if (!payload) {
      onClose();
      return;
    }
    const changed = [...session.touchedIds]
      .map((id) => payload.slides.find((candidate) => candidate.id === id))
      .filter((candidate): candidate is Slide => !!candidate);
    onSave(changed);
    onClose();
  }, [onClose, onSave, session]);

  // ── Keyboard ───────────────────────────────────────────────────────────────

  // Esc chain: drop the item selection, then the slide multi-selection, then
  // close through the unsaved-changes guard.
  const handleEscape = useCallback(() => {
    if (selectedIds.size > 0) {
      session.setItemSelection(new Set());
      return;
    }
    if (multiSlide) {
      session.collapseSlideSelection();
      return;
    }
    void handleClose();
  }, [handleClose, multiSlide, selectedIds.size, session]);

  useKeyboardShortcuts({
    selectedIds,
    setSelectedIds: session.setItemSelection,
    onDeleteSelected: deleteSelected,
    onDuplicateSelected: duplicateSelected,
    onSelectAll: handleSelectAllItems,
    onGroup: handleGroup,
    onUngroup: handleUngroup,
    onCopy: handleCopy,
    onPaste: handlePaste,
    onPasteVariant: () => setPasteMenu({ x: window.innerWidth / 2 - 130, y: 140 }),
    onUndo: session.undo,
    onRedo: session.redo,
    onEscape: handleEscape,
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;
      const key = event.key;

      if (event.altKey && (key === 'ArrowLeft' || key === 'ArrowRight')) {
        event.preventDefault();
        session.navigate(key === 'ArrowRight' ? 1 : -1, event.shiftKey);
        return;
      }
      if (key === 'PageDown' || key === 'ArrowDown' || key === 'ArrowRight') {
        if (event.ctrlKey || event.metaKey) return;
        event.preventDefault();
        session.navigate(1, event.shiftKey);
        return;
      }
      if (key === 'PageUp' || key === 'ArrowUp' || key === 'ArrowLeft') {
        if (event.ctrlKey || event.metaKey) return;
        event.preventDefault();
        session.navigate(-1, event.shiftKey);
        return;
      }
      if (key === 'Home') {
        event.preventDefault();
        session.jumpToEdge('start', event.shiftKey);
        return;
      }
      if (key === 'End') {
        event.preventDefault();
        session.jumpToEdge('end', event.shiftKey);
        return;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [session]);

  // ── Derived ────────────────────────────────────────────────────────────────

  const canMoveUp = useMemo(() => {
    if (!primarySelected) return false;
    const index = items.findIndex((item) => item.id === primarySelected.id);
    return index >= 0 && index < items.length - 1;
  }, [items, primarySelected]);

  const canMoveDown = useMemo(() => {
    if (!primarySelected) return false;
    return items.findIndex((item) => item.id === primarySelected.id) > 0;
  }, [items, primarySelected]);

  const gridEnabled = activeDraft?.gridEnabled ?? false;
  const gridSize = activeDraft?.gridSize ?? 10;
  const gridColor = activeDraft?.gridColor ?? 'rgba(255,255,255,0.06)';
  const snapEnabled = activeDraft?.snapEnabled ?? false;

  const inspectorTabs: Array<{ id: InspectorTab; label: string; icon: ComponentType<{ className?: string }> }> = [
    { id: 'item', label: t('common.editorTabItem'), icon: Move },
    { id: 'slide', label: t('common.editorTabSlide'), icon: Palette },
    { id: 'layers', label: t('common.editorTabLayers'), icon: Layers },
  ];

  if (!activeSlide || !activeDraft) return null;

  return (
    <Dialog
      open
      onClose={handleClose}
      labelledBy="slide-editor-title"
      overlayClassName="fixed inset-0 z-50 flex bg-black/90"
      className="flex h-full w-full max-w-none flex-col overflow-hidden rounded-none border-0 bg-surface-base"
      closeOnOverlayClick={false}
      closeOnEscape={false}
    >
      {/* Header */}
      <header className="flex h-14 items-center justify-between border-b border-white/10 bg-surface-raised px-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="min-w-0">
            <h2 id="slide-editor-title" className="truncate text-lg font-semibold text-blue-400">
              {t('common.editorTitle')}
            </h2>
            <div className="flex items-center gap-2 text-xs text-white/45">
              <span>
                {t('common.editorSlideCounter', { number: activeIndex + 1, count: slideOrder.length })}
              </span>
              {session.touchedCount > 0 && (
                <span className="text-amber-200/80">
                  · {t('common.editorUnsavedSlideCount', { count: session.touchedCount })}
                </span>
              )}
              {selectedIds.size > 0 && (
                <span>· {t('common.editorItemsSelected', { count: selectedIds.size })}</span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {!railCollapsed && (
            <button
              type="button"
              onClick={() => setRailCollapsed(true)}
              aria-label={t('common.editorRailCollapse')}
              title={t('common.editorRailCollapse')}
              className="hidden rounded-xl p-2 text-white/50 transition hover:bg-white/5 hover:text-white lg:inline-flex focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              <PanelLeftOpen className="h-4 w-4" aria-hidden="true" />
            </button>
          )}

          <button
            type="button"
            onClick={() => addItem('text')}
            className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/80 transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            <Type className="h-4 w-4" aria-hidden="true" />
            {t('common.editorText')}
          </button>

          <button
            type="button"
            onClick={() => addItem('image')}
            className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/80 transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            <Image className="h-4 w-4" aria-hidden="true" />
            {t('common.editorImage')}
          </button>

          <div className="relative">
            <button
              type="button"
              onClick={() => setShowTemplates(!showTemplates)}
              aria-expanded={showTemplates}
              className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/80 transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              <LayoutTemplate className="h-4 w-4" aria-hidden="true" />
              {t('common.editorTemplates')}
            </button>
            {showTemplates && (
              <div className="absolute right-0 top-full z-50 mt-2 w-72 rounded-2xl border border-white/10 bg-[#1a1a1a] p-3 shadow-2xl">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-semibold text-white/80">
                    {t('common.editorTemplateTitle')}
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowTemplates(false)}
                    className="text-white/40 hover:text-white"
                    aria-label={t('common.close')}
                  >
                    <X className="h-3 w-3" aria-hidden="true" />
                  </button>
                </div>
                <SlideTemplates onSelect={handleTemplateSelect} />
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={session.undo}
            disabled={!session.canUndo}
            title={t('common.undo')}
            aria-label={t('common.undo')}
            className="rounded-xl p-2 text-white/60 transition hover:bg-white/5 hover:text-white disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            <Undo2 className="h-5 w-5" aria-hidden="true" />
          </button>

          <button
            type="button"
            onClick={session.redo}
            disabled={!session.canRedo}
            title={t('common.redo')}
            aria-label={t('common.redo')}
            className="rounded-xl p-2 text-white/60 transition hover:bg-white/5 hover:text-white disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            <Redo2 className="h-5 w-5" aria-hidden="true" />
          </button>

          <button
            type="button"
            onClick={handleClose}
            aria-label={t('common.close')}
            className="rounded-xl p-2 text-white/60 transition hover:bg-white/5 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
      </header>

      {/* Body */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {railCollapsed ? (
          <div
            className="flex h-full shrink-0 flex-col items-center gap-2 border-r border-white/10 bg-[#151515] py-2"
            style={{ width: RAIL_COLLAPSED_WIDTH }}
          >
            <button
              type="button"
              onClick={() => setRailCollapsed(false)}
              aria-label={t('common.editorRailExpand')}
              title={t('common.editorRailExpand')}
              className="rounded-lg p-1.5 text-white/50 transition hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </button>
            <span className="text-[10px] tabular-nums text-white/40 [writing-mode:vertical-rl]">
              {activeIndex + 1} / {slideOrder.length}
            </span>
          </div>
        ) : (
          <div className="hidden lg:flex" style={{ width: RAIL_WIDTH }}>
            <EditorSlideRail
              slides={deck.slides}
              drafts={session.drafts}
              activeId={session.activeId}
              selectedIds={selectedSlideIds}
              liveSlideId={liveSlideId}
              onActivate={(target, modifiers) => session.activateSlide(target, modifiers)}
              onSelectAll={session.selectEverySlide}
              onClearSelection={session.collapseSlideSelection}
              onOpenPasteMenu={(position, slideId) => setPasteMenu({ ...position, slideId })}
              onDropElements={handleRailDrop}
              onCollapse={() => setRailCollapsed(true)}
            />
          </div>
        )}

        {/* Canvas */}
        <CanvasStage
          slideStyles={activeDraft.styles}
          items={items}
          selectedIds={selectedIds}
          onSelect={handleSelect}
          onSelectMany={handleSelectMany}
          onDrag={handleDrag}
          onDragEnd={handleDragEnd}
          onResize={handleResize}
          onRotate={handleRotate}
          gridEnabled={gridEnabled}
          gridSize={gridSize}
          gridColor={gridColor}
          snapEnabled={snapEnabled}
          onItemDragStart={handleItemDragStart}
          onContextMenu={(event) => {
            event.preventDefault();
            setPasteMenu({ x: event.clientX, y: event.clientY });
          }}
        />

        {/* Inspector */}
        <aside className="flex w-80 shrink-0 flex-col overflow-hidden border-l border-white/10 bg-[#181818]">
          <div className="flex items-center gap-1 border-b border-white/10 p-2" role="tablist" aria-label={t('common.editorInspector')}>
            {inspectorTabs.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                onClick={() => setTab(id)}
                className={cn(
                  'flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-[11px] font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500',
                  tab === id
                    ? 'bg-blue-600/25 text-blue-100'
                    : 'text-white/55 hover:bg-white/5 hover:text-white/80',
                )}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="truncate">{label}</span>
              </button>
            ))}
          </div>

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3" role="tabpanel">
            {tab === 'slide' && (
              <>
                <ScopeSelector
                  scope={effectiveScope}
                  selectedCount={selectedSlideIds.length}
                  slideCount={slideOrder.length}
                  onChange={setScope}
                />
                <SlideSettingsPanel
                  styles={activeDraft.styles}
                  onChange={updateSlideStyles}
                  gridEnabled={gridEnabled}
                  gridSize={gridSize}
                  gridColor={gridColor}
                  snapEnabled={snapEnabled}
                  onGridToggle={(value) => session.setGridField('gridEnabled', value)}
                  onGridSizeChange={(value) => session.setGridField('gridSize', value)}
                  onGridColorChange={(value) => session.setGridField('gridColor', value)}
                  onSnapToggle={(value) => session.setGridField('snapEnabled', value)}
                />
              </>
            )}

            {tab === 'layers' && (
              <LayerPanel
                items={items}
                selectedIds={selectedIds}
                onSelect={(id) => session.setItemSelection(new Set([id]))}
                onMove={moveItem}
                onDelete={deleteItemById}
                onToggleVisibility={toggleItemVisibility}
                onDuplicate={duplicateItemById}
                onToggleLock={toggleItemLock}
                onDragItemStart={(event, itemId) => handleItemDragStart(event, [itemId])}
              />
            )}

            {tab === 'item' && (
              <>
                <ScopeSelector
                  scope={effectiveScope}
                  selectedCount={selectedSlideIds.length}
                  slideCount={slideOrder.length}
                  onChange={setScope}
                />

                {primarySelected ? (
                  <>
                    <PanelShell title={t('common.editorSelectedItem')} icon={Palette}>
                      <div className="grid grid-cols-2 gap-3">
                        {([
                          { key: 'x', label: 'X %' },
                          { key: 'y', label: 'Y %' },
                        ] as const).map(({ key, label }) => (
                          <label key={key} className="space-y-1">
                            <span className="text-[10px] uppercase tracking-wide text-white/40">{label}</span>
                            <input
                              type="number"
                              value={Math.round(primarySelected[key])}
                              onChange={(event) => {
                                const value = parseInt(event.target.value);
                                if (Number.isNaN(value)) return;
                                const max = key === 'x'
                                  ? 100 - primarySelected.width
                                  : 100 - primarySelected.height;
                                updateItem(primarySelected.id, { [key]: clamp(value, 0, max) });
                              }}
                              className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs outline-none transition focus:border-blue-500"
                            />
                          </label>
                        ))}

                        <label className="space-y-1">
                          <span className="text-[10px] uppercase tracking-wide text-white/40">
                            {t('common.editorWidth')}
                          </span>
                          <input
                            type="number"
                            min={4}
                            max={100}
                            value={Math.round(primarySelected.width)}
                            onChange={(event) => {
                              const value = parseInt(event.target.value);
                              if (!Number.isNaN(value)) {
                                updateItem(primarySelected.id, { width: clamp(value, 4, 100) });
                              }
                            }}
                            className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs outline-none transition focus:border-blue-500"
                          />
                        </label>

                        <label className="space-y-1">
                          <span className="text-[10px] uppercase tracking-wide text-white/40">
                            {t('common.editorHeight')}
                          </span>
                          <input
                            type="number"
                            min={4}
                            max={100}
                            value={Math.round(primarySelected.height)}
                            onChange={(event) => {
                              const value = parseInt(event.target.value);
                              if (!Number.isNaN(value)) {
                                updateItem(primarySelected.id, { height: clamp(value, 4, 100) });
                              }
                            }}
                            className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs outline-none transition focus:border-blue-500"
                          />
                        </label>

                        <label className="col-span-2 space-y-1">
                          <span className="text-[10px] uppercase tracking-wide text-white/40">
                            {t('common.editorRotation')}
                          </span>
                          <input
                            type="number"
                            value={primarySelected.rotation || 0}
                            onChange={(event) => {
                              const value = parseInt(event.target.value || '0', 10);
                              if (!Number.isNaN(value)) updateItem(primarySelected.id, { rotation: value });
                            }}
                            className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs outline-none transition focus:border-blue-500"
                          />
                        </label>
                      </div>

                      <div className="grid grid-cols-3 gap-2 pt-1">
                        <label className="space-y-1">
                          <span className="text-[10px] uppercase tracking-wide text-white/40">
                            {t('common.editorBorder')}
                          </span>
                          <input
                            type="number"
                            min={0}
                            max={20}
                            value={primarySelected.borderWidth || 0}
                            onChange={(event) => {
                              const value = parseInt(event.target.value);
                              if (!Number.isNaN(value)) {
                                updateItem(primarySelected.id, { borderWidth: clamp(value, 0, 20) });
                              }
                            }}
                            className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs outline-none transition focus:border-blue-500"
                          />
                        </label>
                        <label className="space-y-1">
                          <span className="text-[10px] uppercase tracking-wide text-white/40">
                            {t('common.editorBorderColor')}
                          </span>
                          <input
                            type="color"
                            value={primarySelected.borderColor || '#ffffff'}
                            onChange={(event) => updateItem(primarySelected.id, { borderColor: event.target.value })}
                            className="h-8 w-full cursor-pointer rounded-lg border border-white/10 bg-transparent"
                          />
                        </label>
                        <label className="space-y-1">
                          <span className="text-[10px] uppercase tracking-wide text-white/40">
                            {t('common.editorCornerRadius')}
                          </span>
                          <input
                            type="number"
                            min={0}
                            max={50}
                            value={primarySelected.borderRadius || 0}
                            onChange={(event) => {
                              const value = parseInt(event.target.value);
                              if (!Number.isNaN(value)) {
                                updateItem(primarySelected.id, { borderRadius: clamp(value, 0, 50) });
                              }
                            }}
                            className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs outline-none transition focus:border-blue-500"
                          />
                        </label>
                      </div>

                      <div className="flex gap-2 pt-2">
                        <button
                          type="button"
                          disabled={!canMoveUp}
                          onClick={() => moveItem(primarySelected.id, 'up')}
                          className="flex-1 rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white/70 transition hover:bg-black/30 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          {t('common.editorBringForward')}
                        </button>
                        <button
                          type="button"
                          disabled={!canMoveDown}
                          onClick={() => moveItem(primarySelected.id, 'down')}
                          className="flex-1 rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white/70 transition hover:bg-black/30 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          {t('common.editorSendBackward')}
                        </button>
                      </div>

                      <button
                        type="button"
                        onClick={() => toggleItemLock(primarySelected.id)}
                        className={cn(
                          'inline-flex w-full items-center justify-center gap-2 rounded-xl border px-3 py-2 text-sm transition',
                          primarySelected.locked
                            ? 'border-yellow-500/20 bg-yellow-500/10 text-yellow-300'
                            : 'border-white/10 bg-black/20 text-white/70 hover:bg-black/30',
                        )}
                      >
                        {primarySelected.locked ? <Lock className="h-4 w-4" /> : <Unlock className="h-4 w-4" />}
                        {primarySelected.locked ? t('common.editorUnlock') : t('common.editorLock')}
                      </button>
                    </PanelShell>

                    {/* Cross-slide transfer, exactly where the element is edited. */}
                    {multiSlide && (
                      <PanelShell title={t('common.editorTransfer')} icon={Layers2}>
                        <div className="space-y-2">
                          <p className="text-xs text-white/55">
                            {t('common.editorTransferHint', { count: selectedSlideIds.length })}
                          </p>
                          <button
                            type="button"
                            onClick={handleApplySelectionToOtherSlides}
                            className="w-full rounded-xl bg-blue-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
                          >
                            {t('common.editorApplyToSelected', { count: otherSelectedCount })}
                          </button>
                          <button
                            type="button"
                            onClick={handleApplySameTypeStyle}
                            className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white/70 transition hover:bg-black/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                          >
                            <Paintbrush className="h-4 w-4" aria-hidden="true" />
                            {t('common.editorApplySameType')}
                          </button>
                        </div>
                      </PanelShell>
                    )}

                    <PanelShell title={t('common.editorSelectedItemProperties')} icon={Palette}>
                      {primarySelected.type === 'text' ? (
                        <label className="block space-y-1">
                          <span className="block text-[10px] uppercase tracking-wide text-white/40">
                            {t('common.editorContent')}
                          </span>
                          <textarea
                            value={primarySelected.content || ''}
                            onFocus={beginGesture}
                            onBlur={endGesture}
                            onChange={(event) => {
                              const content = event.target.value;
                              if (effectiveScope === 'selected' && multiSlide) {
                                // Bulk scope mirrors the text onto the counter-parts;
                                // the focus gesture keeps it to one undo entry.
                                session.applyItemUpdate(
                                  primarySelected.id,
                                  { content },
                                  selectedSlideIds,
                                  'selected',
                                  { history: false },
                                );
                                return;
                              }
                              session.updateItems(
                                (prev) =>
                                  prev.map((item) =>
                                    item.id === primarySelected.id ? { ...item, content } : item,
                                  ),
                                { history: false },
                              );
                            }}
                            className="max-h-60 min-h-[7rem] w-full resize-y rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-xs outline-none transition focus:border-blue-500"
                          />
                          {effectiveScope === 'selected' && multiSlide && (
                            <span className="block text-[10px] text-amber-200/80">
                              {t('common.editorScopeTextBulk', { count: selectedSlideIds.length })}
                            </span>
                          )}
                        </label>
                      ) : (
                        <div className="space-y-3">
                          <button
                            type="button"
                            onClick={async () => {
                              const file = await window.electronAPI?.selectMediaFile?.('image');
                              if (!file) return;
                              updateItem(primarySelected.id, { mediaUrl: `file://${file.replace(/\\/g, '/')}` });
                            }}
                            className="w-full rounded-xl bg-blue-600 px-4 py-3 text-sm font-medium text-white transition hover:bg-blue-500"
                          >
                            {t('common.editorSelectImage')}
                          </button>

                          <button
                            type="button"
                            onClick={() => updateItem(primarySelected.id, { mediaUrl: undefined })}
                            className="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white/70 transition hover:bg-black/30"
                          >
                            {t('common.removeImage')}
                          </button>
                        </div>
                      )}
                    </PanelShell>

                    {primarySelected.type === 'text' && (
                      <TextStyleEditor
                        item={primarySelected}
                        onChange={(styles) => updateItemStyle(primarySelected.id, { textStyles: styles })}
                      />
                    )}

                    {primarySelected.type === 'image' && (
                      <ImageStyleEditor
                        item={primarySelected}
                        onChange={(styles) => updateItemStyle(primarySelected.id, { imageStyles: styles })}
                      />
                    )}

                    <PanelShell title={t('common.editorItemOperations')} icon={RotateCw}>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => deleteItemById(primarySelected.id)}
                          className="inline-flex items-center justify-center gap-2 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-300 transition hover:bg-red-500/15"
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" /> {t('common.editorDelete')}
                        </button>

                        <button
                          type="button"
                          onClick={duplicateSelected}
                          className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white/70 transition hover:bg-black/30"
                        >
                          <Copy className="h-4 w-4" aria-hidden="true" /> {t('common.editorDuplicate')}
                        </button>
                      </div>
                    </PanelShell>
                  </>
                ) : (
                  <PanelShell title={t('common.editorNoSelection')} icon={Palette}>
                    <div className="text-sm text-white/55">{t('common.editorNoSelectionHint')}</div>
                  </PanelShell>
                )}

                {selectedItems.length > 1 && (
                  <AlignmentTools
                    selectedItems={selectedItems}
                    items={items}
                    onUpdateItems={updateItemsBatch}
                  />
                )}

                {selectedIds.size > 1 && (
                  <PanelShell title={t('common.editorMultiSelection')} icon={Copy}>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={handleGroup}
                        className="flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white/70 transition hover:bg-black/30"
                      >
                        <Group className="h-4 w-4" aria-hidden="true" /> {t('common.editorGroup')}
                      </button>
                      <button
                        type="button"
                        onClick={handleUngroup}
                        className="flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white/70 transition hover:bg-black/30"
                      >
                        <Ungroup className="h-4 w-4" aria-hidden="true" /> {t('common.editorUngroup')}
                      </button>
                    </div>
                  </PanelShell>
                )}
              </>
            )}
          </div>
        </aside>
      </div>

      {/* Footer */}
      <footer className="flex min-h-14 items-center justify-between gap-3 border-t border-white/10 bg-[#1e1e1e] px-4 py-2">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span className="hidden shrink-0 items-center gap-2 text-xs text-white/40 xl:flex">
            <span>{t('common.editorRailHint')}</span>
            <span>·</span>
            <span>{t('common.editorMultiSelect')}</span>
          </span>
          {noticeText && (
            <span
              role="status"
              className={cn(
                'truncate rounded-lg px-2 py-1 text-xs',
                notice?.tone === 'warn'
                  ? 'border border-amber-400/30 bg-amber-500/10 text-amber-100'
                  : 'border border-blue-400/25 bg-blue-500/10 text-blue-100',
              )}
            >
              {noticeText}
            </span>
          )}
          {clipboard && (
            <ClipboardChip
              clipboard={clipboard}
              targetCount={otherSelectedCount}
              onApply={handleApplyToOtherSelected}
              onClear={() => setClipboard(null)}
            />
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <div className="flex items-center gap-1 rounded-xl border border-white/10 bg-black/20 px-1 py-1">
            <button
              type="button"
              onClick={() => session.navigate(-1)}
              disabled={activeIndex <= 0}
              aria-label={t('common.editorPreviousSlide')}
              title={t('common.editorPreviousSlide')}
              className="rounded-lg p-1.5 text-white/60 transition hover:bg-white/10 hover:text-white disabled:opacity-25 disabled:hover:bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              <ChevronRight className="h-4 w-4 rotate-180" aria-hidden="true" />
            </button>
            <span className="px-1 text-xs tabular-nums text-white/60">
              {activeIndex + 1} / {slideOrder.length}
            </span>
            <button
              type="button"
              onClick={() => session.navigate(1)}
              disabled={activeIndex >= slideOrder.length - 1}
              aria-label={t('common.editorNextSlide')}
              title={t('common.editorNextSlide')}
              className="rounded-lg p-1.5 text-white/60 transition hover:bg-white/10 hover:text-white disabled:opacity-25 disabled:hover:bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>

          <button
            type="button"
            onClick={handleClose}
            className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/80 transition hover:bg-white/10"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="inline-flex items-center gap-2 rounded-xl bg-green-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-green-500"
          >
            <Save className="h-4 w-4" aria-hidden="true" />
            {t('common.save')}
          </button>
        </div>
      </footer>

      <EditorPasteMenu
        context={pasteMenu}
        hasClipboard={!!clipboard}
        selectedTargetCount={otherSelectedCount}
        totalCount={slideOrder.length}
        hasItemSelection={selectedIds.size > 0 || otherSelectedCount > 0}
        onClose={() => setPasteMenu(null)}
        onPasteHere={handlePaste}
        onPasteSamePosition={handlePasteExact}
        onPasteSelected={handlePasteSelectedFlow}
        onPasteAll={handleApplyClipboardToAll}
        onPasteStyle={handlePasteStyle}
      />
    </Dialog>
  );
}
