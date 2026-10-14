import { isHelpActive } from '../components/Tour/tourController';
import { newVideoOverlay } from '../videoOverlays';
import VideoEditor from './VideoEditor';
import { editorFilterTarget, filteredEditorSlides, isEditorEditableSlide, isVideoEditableSlide } from './slideCapabilities';
import { SlidePreviewAny } from '../components/SlidePreview';
import { isItemEditableSlide } from './slideDraft';
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from 'react';
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
  PanelRightOpen,
  Keyboard,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Presentation, Slide, SlideItem } from '../types';
import { cn } from '../utils';
import { confirmDialog, alertDialog } from '../dialogs';
import { getLiveSaveRetention } from '../hooks/useLiveSave';
import { choiceDialog } from '../choiceDialogState';
import { useStore } from '../state/useStore';
import { registerEditorGuard } from './editorSessionGuard';
import { findEditorConflicts } from './editorConflicts';
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
import { sizeFromCenter, type ItemBounds } from './canvasGeometry';
import { ImageCropDialog } from './ImageCropDialog';
import { useImageSize } from '../hooks/useImageSize';
import { replaceImage, restoreImageRatio } from './imageOperations';
import { finishEditorGesture } from './usePointerGesture';

interface SlideEditorProps {
  /** Slide the editor opens on. */
  slide?: Slide;
  active: boolean;
  /** Whole deck, in order. Read-only source of truth while editing. */
  deck: Presentation;
  /** Called with only the slides that changed. */
  onSave: (slides: Slide[]) => void;
  onClose: () => void;
  onOpenInSlides?: (slideId: string) => void;
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
    <div className={cn('space-y-3 rounded-2xl border border-white/10 bg-[#1a1a1a] p-4 shadow-sm', className)}>
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
        {[
          { value: 'active' as const, label: t('common.editorScopeActive') },
          { value: 'selected' as const, label: t('common.editorScopeSelected', { count: selectedCount }) },
        ].map((option) => (
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
                : 'text-white/55 hover:bg-white/5 hover:text-white/80'
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
      {scope === 'selected' && (
        <p
          role="status"
          className="rounded-lg border border-amber-400/30 bg-amber-500/10 px-2 py-1 text-[10px] text-amber-100"
        >
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
        {t('common.editorClipboardLabel')}:{' '}
        <strong className="font-medium text-white/85">{t(clipboard.labelKey)}</strong>
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

export default function SlideEditor({ slide, deck, active, onSave, onClose, onOpenInSlides }: SlideEditorProps) {
  const { t } = useTranslation();
  const [editableOnly, setEditableOnly] = useState(false);
  const [videoRangeValid, setVideoRangeValid] = useState(true);
  const session = useEditorDeck({ deck, initialSlide: slide, editableOnly });
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const savePendingRef = useRef(false);

  const activeSlide = session.activeSlide;
  const editable = !!activeSlide && isItemEditableSlide(activeSlide);
  const videoEditable = !!activeSlide && isVideoEditableSlide(activeSlide);
  const visibleSlides = useMemo(() => filteredEditorSlides(deck.slides, editableOnly), [deck.slides, editableOnly]);
  const changeFilter = (value: boolean) => {
    finishInteraction();
    setEditableOnly(value);
    if (value && activeSlide && !isEditorEditableSlide(activeSlide)) {
      const target = editorFilterTarget(deck.slides, activeSlide.id, true);
      if (target) session.activateSlide(target);
    }
  };
  const activeDraft: SlideDraft | null = session.activeDraft;
  const addVideoText = () => {
    if (!videoEditable) return;
    finishInteraction();
    const overlays = session.activeDraft?.videoOverlays ?? [];
    const item = newVideoOverlay(makeItemId(), t('common.editorNewText'), Math.max(-1, ...overlays.map(item => item.zIndex)) + 1);
    session.updateVideoOverlays([...overlays, item]);
    session.setItemSelection(new Set([item.id]));
  };
  const items = session.activeItems;

  const [tab, setTab] = useState<InspectorTab>('item');
  const [showTemplates, setShowTemplates] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [cropTarget, setCropTarget] = useState<{ slideId: string; itemId: string } | null>(null);
  const [lockedRatioKeys, setLockedRatioKeys] = useState<Set<string>>(new Set());
  const [safeAreaEnabled, setSafeAreaEnabled] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const confirmingRef = useRef(false);
  const inspectorToggleRef = useRef<HTMLButtonElement>(null);
  const inspectorRef = useRef<HTMLElement>(null);
  const [clipboard, setClipboard] = useState<EditorClipboard | null>(null);
  const [pasteMenu, setPasteMenu] = useState<PasteMenuContext | null>(null);
  const shortcutsEnabled = active && !showTemplates && !showHelp && !pasteMenu && !confirming && !cropTarget;
  const [scope, setScope] = useState<EditScope>('active');
  const [railCollapsed, setRailCollapsed] = useState(() => {
    try {
      return localStorage.getItem(RAIL_STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    if (!active || (!showHelp && !showTemplates)) return;
    const keydown = (event: KeyboardEvent) => {
      if (isHelpActive()) return;
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setShowHelp(false);
      setShowTemplates(false);
    };
    const outside = (event: PointerEvent) => {
      if (!(event.target as Element).closest('[data-editor-popover]')) {
        setShowHelp(false);
        setShowTemplates(false);
      }
    };
    window.addEventListener('keydown', keydown, true);
    window.addEventListener('pointerdown', outside);
    return () => {
      window.removeEventListener('keydown', keydown, true);
      window.removeEventListener('pointerdown', outside);
    };
  }, [active, showHelp, showTemplates]);
  useEffect(() => {
    if (!active || !inspectorOpen) return;
    inspectorRef.current?.querySelector<HTMLElement>('[role=tab][aria-selected=true]')?.focus();
  }, [active, inspectorOpen]);
  const closeInspector = () => {
    setInspectorOpen(false);
    inspectorToggleRef.current?.focus();
  };

  const slideOrder = session.order;
  const selectedSlideIds = session.selection.selectedIds.filter(id => { const candidate = session.slideById.get(id); return !!candidate && isItemEditableSlide(candidate); });
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
  const primarySelected = useMemo(() => selectedItems[selectedItems.length - 1] ?? null, [selectedItems]);

  const imageSize = useImageSize(primarySelected?.type === 'image' ? primarySelected.mediaUrl : undefined);
  const ratioKey = primarySelected ? `${session.activeId}:${primarySelected.id}` : '';
  const ratioLocked = lockedRatioKeys.has(ratioKey);
  const lockedRatioIds = useMemo(
    () => new Set(items.filter((item) => lockedRatioKeys.has(`${session.activeId}:${item.id}`)).map((item) => item.id)),
    [items, lockedRatioKeys, session.activeId]
  );
  const cropItem =
    cropTarget?.slideId === session.activeId
      ? items.find((item) => item.id === cropTarget.itemId && item.type === 'image' && !item.locked)
      : undefined;
  useEffect(() => {
    if (cropTarget && !cropItem) setCropTarget(null);
  }, [cropTarget, cropItem]);

  const activeIndex = Math.max(0, deck.slides.findIndex(candidate => candidate.id === session.activeId));
  const liveSlideId = deck.liveSlideId ?? null;

  // ── Notices ────────────────────────────────────────────────────────────────

  const notice: EditorNotice | null = session.notice;
  const clearNotice = session.setNotice;
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => clearNotice(null), 4000);
    return () => clearTimeout(timer);
  }, [notice, clearNotice]);

  const noticeText = notice ? t(notice.key, { count: notice.count ?? 0, skipped: notice.skipped ?? 0 }) : null;

  // ── Editing ────────────────────────────────────────────────────────────────

  const updateItem = useCallback(
    (id: string, updates: Partial<SlideItem> | ((item: SlideItem) => Partial<SlideItem>)) => {
      session.applyItemUpdate(id, updates, selectedSlideIds, effectiveScope);
    },
    [session, selectedSlideIds, effectiveScope]
  );

  const updateItemStyle = useCallback(
    (id: string, patch: Partial<SlideItem>) => {
      session.applyItemUpdate(id, patch, selectedSlideIds, effectiveScope);
    },
    [session, selectedSlideIds, effectiveScope]
  );

  const updateSlideStyles = useCallback(
    (updates: Record<string, unknown>) => {
      session.applySlideStylePatch(updates, selectedSlideIds, effectiveScope);
    },
    [session, selectedSlideIds, effectiveScope]
  );

  // Live drag frames skip history; the session records one entry per gesture,
  // and only once the gesture actually changes something.
  const editorRootRef = useRef<HTMLElement | null>(null);
  const gestureActiveRef = useRef(false);
  const beginGesture = useCallback(() => {
    if (gestureActiveRef.current) return;
    gestureActiveRef.current = true;
    if (editorRootRef.current) editorRootRef.current.dataset.editorInteracting = 'true';
    session.gestureStart();
  }, [session]);
  const endGesture = useCallback(() => {
    if (!gestureActiveRef.current) return;
    gestureActiveRef.current = false;
    if (editorRootRef.current) delete editorRootRef.current.dataset.editorInteracting;
    session.gestureEnd();
  }, [session]);

  const finishInteraction = useCallback(() => {
    finishEditorGesture();
    endGesture();
  }, [endGesture]);
  const navigate = useCallback(
    (delta: number, extend = false) => {
      finishInteraction();
      session.navigate(delta, extend);
    },
    [finishInteraction, session]
  );
  const activateSlide = useCallback(
    (target: Slide, modifiers?: { ctrl?: boolean; shift?: boolean }) => {
      finishInteraction();
      session.activateSlide(target, modifiers);
    },
    [finishInteraction, session]
  );

  const handleDrag = useCallback(
    (id: string, x: number, y: number) => {
      beginGesture();
      session.updateItems(
        (prev) => {
          const target = prev.find((item) => item.id === id);
          if (!target || (target.x === x && target.y === y)) return prev;
          return prev.map((item) => (item.id === id ? { ...item, x, y } : item));
        },
        {
          history: false,
        }
      );
    },
    [beginGesture, session]
  );

  const handleTransform = useCallback(
    (id: string, bounds: ItemBounds) => {
      beginGesture();
      session.updateItems(
        (prev) => {
          const target = prev.find((item) => item.id === id);
          if (
            !target ||
            (target.x === bounds.x &&
              target.y === bounds.y &&
              target.width === bounds.width &&
              target.height === bounds.height)
          )
            return prev;
          return prev.map((item) => (item.id === id ? { ...item, ...bounds } : item));
        },
        { history: false }
      );
    },
    [beginGesture, session]
  );

  const handleRotate = useCallback(
    (id: string, rotation: number) => {
      beginGesture();
      session.updateItems(
        (prev) => {
          const target = prev.find((item) => item.id === id);
          if (!target || (target.rotation ?? 0) === rotation) return prev;
          return prev.map((item) => (item.id === id ? { ...item, rotation } : item));
        },
        { history: false }
      );
    },
    [beginGesture, session]
  );

  const handleDragEnd = useCallback(() => endGesture(), [endGesture]);

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
    [session, selectedIds]
  );

  const handleSelectMany = useCallback((ids: Set<string>) => session.setItemSelection(ids), [session]);

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
    [items, session, t]
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
    [session]
  );

  const moveItem = useCallback(
    (id: string, direction: 'up' | 'down') => session.updateItems((prev) => swapLayer(prev, id, direction)),
    [session]
  );

  const toggleItemVisibility = useCallback(
    (id: string) => session.updateItems((prev) => toggleVisibility(prev, id)),
    [session]
  );

  const toggleItemLock = useCallback((id: string) => session.updateItems((prev) => toggleLock(prev, id)), [session]);

  const deleteItemById = useCallback((id: string) => session.updateItems((prev) => deleteItemAt(prev, id)), [session]);

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
    session.updateItems((prev) => groups.reduce((result, group) => ungroupGroup(result, group.id), prev));
    session.setItemSelection(new Set());
  }, [session, items, selectedIds]);

  const handleSelectAllItems = useCallback(() => {
    session.setItemSelection(new Set(items.map((item) => item.id)));
  }, [session, items]);

  const updateItemsBatch = useCallback(
    (next: SlideItem[]) => {
      finishInteraction();
      session.updateItems(next);
    },
    [session, finishInteraction]
  );

  const handleTemplateSelect = useCallback(
    (templateId: string) => {
      const templateItems = applyTemplate(templateId);
      if (templateItems.length === 0) return;
      session.updateItems(normalizeItems([...items, ...templateItems]));
      session.setItemSelection(new Set(templateItems.map((item) => item.id)));
      setShowTemplates(false);
    },
    [items, session]
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
    [activeSlide, items]
  );

  const handleRailDrop = useCallback(
    (targetSlideId: string, payload: { items: SlideItem[]; sourceSlideId: string }) => {
      const entry = makeClipboard(payload.items, payload.sourceSlideId);
      if (!entry) return;
      setClipboard(entry);
      // Dropping onto one of several selected slides applies to all of them;
      // dropping outside the selection only touches the target.
      const targets = selectedSlideIds.includes(targetSlideId) && multiSlide ? selectedSlideIds : [targetSlideId];
      session.pasteIntoSlides(entry, targets);
      const target = session.slideById.get(targetSlideId);
      if (target && targetSlideId !== session.activeId) activateSlide(target);
      setTab('item');
    },
    [multiSlide, selectedSlideIds, session, activateSlide]
  );

  // ── Save / close ───────────────────────────────────────────────────────────

  const handleClose = useCallback(async () => {
    if (confirmingRef.current || savePendingRef.current) return;
    confirmingRef.current = true;
    setConfirming(true);
    finishInteraction();
    try {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const current = sessionRef.current;
      if (current.isDirty && !(await confirmDialog(t('common.editorUnsavedSlides', { count: current.touchedCount }), {
        title: t('common.editorUnsavedTitle'), confirmLabel: t('common.editorDiscard'), cancelLabel: t('common.cancel'),
      }))) return;
      current.reset(useStore.getState().presentation, current.activeId);
      useStore.getState().setEditorDirty(false);
    } finally {
      confirmingRef.current = false;
      setConfirming(false);
    }
  }, [t, finishInteraction]);

  const handleSave = useCallback(async (): Promise<boolean> => {
    if (!videoRangeValid || confirmingRef.current || savePendingRef.current) return false;
    savePendingRef.current = true;
    setConfirming(true);
    finishInteraction();
    try {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const current = sessionRef.current;
      let latest = useStore.getState().presentation;
      let conflicts = findEditorConflicts(latest, current.bases, current.touchedIds);
      const skipped = new Set<string>();
      // Recheck after each dialog: external changes can arrive while it is open.
      while (conflicts.length) {
        const checked = new Map(latest.slides.map((candidate) => [candidate.id, JSON.stringify(candidate)]));
        const decision = await choiceDialog({
          title: t('common.editorConflictTitle'),
          message: t('common.editorConflictMessage', { count: conflicts.length }),
          choices: [
            { value: 'apply', label: t('common.editorApplyDraft') },
            { value: 'current', label: t('common.editorUseCurrent') },
            { value: 'cancel', label: t('common.cancel') },
          ],
        });
        if (!decision || decision === 'cancel') return false;
        if (decision === 'current') conflicts.forEach((id) => skipped.add(id));
        latest = useStore.getState().presentation;
        conflicts = findEditorConflicts(latest, current.bases, current.touchedIds).filter((id) =>
          !skipped.has(id) && checked.get(id) !== JSON.stringify(latest.slides.find((candidate) => candidate.id === id)));
      }
      const payload = current.buildSavePayload(latest);
      if (payload) onSave(payload.slides.filter((candidate) => current.touchedIds.has(candidate.id) && !skipped.has(candidate.id)));
      current.reset(useStore.getState().presentation, current.activeId);
      useStore.getState().setEditorDirty(false);
      return true;
    } finally {
      savePendingRef.current = false;
      setConfirming(false);
    }
  }, [onSave, t, finishInteraction, videoRangeValid]);

  const saveRef = useRef(handleSave);
  saveRef.current = handleSave;
  useEffect(() => registerEditorGuard(async () => {
    if (confirmingRef.current || savePendingRef.current) return false;
    finishInteraction();
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    if (!sessionRef.current.isDirty) return true;
    confirmingRef.current = true;
    setConfirming(true);
    try {
      const decision = await choiceDialog({
        title: t('common.editorUnsavedTitle'), message: t('common.editorBeforeReplace'),
        choices: [
          { value: 'save', label: t('common.save') },
          { value: 'discard', label: t('common.editorDiscard') },
          { value: 'cancel', label: t('common.cancel') },
        ],
      });
      if (decision === 'save') {
        const state = useStore.getState();
        const name = state.presentation.name.trim() || t('common.newPresentation');
        const existing = state.presets.find((preset) => preset.name === name);
        if (existing && existing.presentation.id !== state.presentation.id &&
          !(await confirmDialog(t('library.confirmOverwrite', { name })))) return false;
        confirmingRef.current = false;
        if (!(await saveRef.current())) return false;
        confirmingRef.current = true;
        setConfirming(true);
        try {
          // Applying a draft only to memory before RESET would lose the saved
          // work. Keep the outgoing deck in the normal presentation library.
          const current = useStore.getState();
          const updated = await window.electronAPI?.savePreset?.({
            name, presentation: { ...current.presentation, name }, retentionMs: getLiveSaveRetention(),
          });
          if (!Array.isArray(updated)) throw new Error(t('library.saveFailed'));
          current.setPresets(updated);
          current.setSelectedPresetName(name);
          return true;
        } catch (error) {
          await alertDialog(error instanceof Error ? error.message : t('library.saveFailed'));
          return false;
        }
      }
      return decision === 'discard';
    } finally {
      confirmingRef.current = false;
      setConfirming(false);
    }
  }), [finishInteraction, t]);

  useEffect(() => { useStore.getState().setEditorDirty(session.isDirty); }, [session.isDirty]);
  const targetId = useStore((state) => state.editorTargetId);
  useEffect(() => {
    if (!targetId) return;
    const target = sessionRef.current.slideById.get(targetId);
    if (target) sessionRef.current.activateSlide(target);
    useStore.setState({ editorTargetId: null });
  }, [targetId]);
  useEffect(() => {
    if (active) return;
    finishInteraction();
    setShowTemplates(false);
    setShowHelp(false);
    setPasteMenu(null);
    setCropTarget(null);
    setInspectorOpen(false);
  }, [active, finishInteraction]);

  // ── Keyboard ───────────────────────────────────────────────────────────────

  // Escape clears selections; leaving the page never discards the session.
  const handleEscape = useCallback(() => {
    if (selectedIds.size > 0) {
      session.setItemSelection(new Set());
      return;
    }
    if (multiSlide) {
      session.collapseSlideSelection();
      return;
    }
  }, [multiSlide, selectedIds.size, session]);

  const handleEditorShortcuts = useKeyboardShortcuts({
    enabled: shortcutsEnabled && editable,
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
    onUndo: () => {
      finishInteraction();
      session.undo();
    },
    onRedo: () => {
      finishInteraction();
      session.redo();
    },
    onEscape: handleEscape,
  });

  const handleNavigationKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (!shortcutsEnabled || event.defaultPrevented || isEditableTarget(event.target)) return;
      if ((event.target as Element)?.closest?.('[role=tablist], [role=menu]')) return;
      const key = event.key;
      if ((event.ctrlKey || event.metaKey) && key.toLowerCase() === 'a' && (!editable || (event.target as Element).closest('[data-editor-rail]'))) {
        event.preventDefault();
        session.selectEverySlide();
        return;
      }
      if (videoEditable && (event.ctrlKey || event.metaKey) && (key.toLowerCase() === 'z' || key.toLowerCase() === 'y')) {
        event.preventDefault(); finishInteraction();
        if (key.toLowerCase() === 'y' || event.shiftKey) session.redo(); else session.undo();
        return;
      }
      if (!editable && key === 'Escape') { handleEscape(); return; }

      if (event.altKey && (key === 'ArrowLeft' || key === 'ArrowRight')) {
        event.preventDefault();
        navigate(key === 'ArrowRight' ? 1 : -1, event.shiftKey);
        return;
      }
      if (key === 'PageDown' || key === 'ArrowDown' || key === 'ArrowRight') {
        if (event.ctrlKey || event.metaKey) return;
        event.preventDefault();
        navigate(1, event.shiftKey);
        return;
      }
      if (key === 'PageUp' || key === 'ArrowUp' || key === 'ArrowLeft') {
        if (event.ctrlKey || event.metaKey) return;
        event.preventDefault();
        navigate(-1, event.shiftKey);
        return;
      }
      if (key === 'Home') {
        event.preventDefault();
        finishInteraction();
        session.jumpToEdge('start', event.shiftKey);
        return;
      }
      if (key === 'End') {
        event.preventDefault();
        finishInteraction();
        session.jumpToEdge('end', event.shiftKey);
        return;
      }
    },
    [session, shortcutsEnabled, navigate, finishInteraction, editable, videoEditable, handleEscape]
  );

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

  if (!activeSlide || !activeDraft) return (
    <section className="flex h-full flex-col items-center justify-center gap-4" aria-label={t('nav.editor')}>
      <p className="text-white/60">{t('common.editorEmpty')}</p>
      <button type="button" onClick={onClose} className="rounded-lg bg-blue-600 px-4 py-2">{t('nav.slides')}</button>
    </section>
  );

  return (
    <section ref={editorRootRef} aria-labelledby="slide-editor-title" className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-surface-base">
      <div
        className="flex h-full min-h-0 w-full flex-col"
        onKeyDown={(event) => {
          if (!((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a' && (event.target as Element).closest('[data-editor-rail]'))) handleEditorShortcuts(event.nativeEvent);
          handleNavigationKeyDown(event.nativeEvent);
          event.stopPropagation();
        }}
      >
        {/* Header */}
        <header className="flex min-h-14 shrink-0 flex-wrap items-center justify-between gap-2 border-b border-white/10 bg-surface-raised px-3 py-2">
          <div className="flex min-w-0 items-center gap-3">
            <div className="min-w-0">
              <h2 id="slide-editor-title" className="truncate text-lg font-semibold text-blue-400">
                {t('common.editorTitle')}
                {session.isDirty && <span className="ml-2 text-xs text-amber-400">{t('common.editorPendingDraft')}</span>}
              </h2>
              <div className="flex items-center gap-2 text-xs text-white/45">
                <span>{t('common.editorSlideCounter', { number: activeIndex + 1, count: deck.slides.length })}</span>
                {session.touchedCount > 0 && (
                  <span className="text-amber-200/80">
                    · {t('common.editorUnsavedSlideCount', { count: session.touchedCount })}
                  </span>
                )}
                {selectedIds.size > 0 && <span>· {t('common.editorItemsSelected', { count: selectedIds.size })}</span>}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              ref={inspectorToggleRef}
              type="button"
              className="rounded-xl p-2 text-white/70 lg:hidden focus-visible:ring-2 focus-visible:ring-blue-500"
              aria-label={t('common.editorInspector')}
              aria-expanded={inspectorOpen}
              aria-controls="editor-inspector"
              onClick={() => setInspectorOpen(!inspectorOpen)}
            >
              <PanelRightOpen className="h-5 w-5" aria-hidden="true" />
            </button>
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
              disabled={!editable && !videoEditable}
              onClick={() => videoEditable ? addVideoText() : addItem('text')}
              className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/80 transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              <Type className="h-4 w-4" aria-hidden="true" />
              {t('common.editorText')}
            </button>

            <button
              type="button"
              disabled={!editable}
              onClick={() => addItem('image')}
              className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/80 transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              <Image className="h-4 w-4" aria-hidden="true" />
              {t('common.editorImage')}
            </button>

            <div className="relative" data-editor-popover>
              <button
                type="button"
                onClick={() => {
                  setShowHelp(false);
                  setShowTemplates(!showTemplates);
                }}
                disabled={!editable}
                aria-expanded={showTemplates}
                className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/80 transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              >
                <LayoutTemplate className="h-4 w-4" aria-hidden="true" />
                {t('common.editorTemplates')}
              </button>
              {showTemplates && (
                <div className="absolute right-0 top-full z-50 mt-2 max-h-[70vh] w-72 max-w-[calc(100vw-24px)] overflow-y-auto rounded-2xl border border-white/10 bg-[#1a1a1a] p-3 shadow-2xl">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-semibold text-white/80">{t('common.editorTemplateTitle')}</span>
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

            <div className="relative" data-editor-popover>
              <button
                type="button"
                onClick={() => {
                  setShowTemplates(false);
                  setShowHelp(!showHelp);
                }}
                aria-expanded={showHelp}
                aria-controls="editor-shortcut-help"
                aria-label={t('common.editorShortcuts')}
                title={t('common.editorShortcuts')}
                className="rounded-xl p-2 text-white/60 hover:bg-white/5 focus-visible:ring-2 focus-visible:ring-blue-500"
              >
                <Keyboard className="h-5 w-5" aria-hidden="true" />
              </button>
              {showHelp && (
                <div
                  id="editor-shortcut-help"
                  role="region"
                  aria-label={t('common.editorShortcuts')}
                  className="absolute right-0 top-full z-50 mt-2 w-72 max-w-[calc(100vw-24px)] rounded-xl border border-white/15 bg-surface-overlay p-3 text-xs text-white/80 shadow-xl"
                >
                  <p className="font-semibold">{t('common.editorShortcuts')}</p>
                  <p className="mt-2">{t('common.editorGestureHelp')}</p>
                  <p className="mt-2">{t('common.editorNavigationHelp')}</p>
                  <p className="mt-2">{t('common.editorHistoryHelp')}</p>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => {
                finishInteraction();
                session.undo();
              }}
              disabled={!session.canUndo}
              title={t('common.undo')}
              aria-label={t('common.undo')}
              className="rounded-xl p-2 text-white/60 transition hover:bg-white/5 hover:text-white disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              <Undo2 className="h-5 w-5" aria-hidden="true" />
            </button>

            <button
              type="button"
              onClick={() => {
                finishInteraction();
                session.redo();
              }}
              disabled={!session.canRedo}
              title={t('common.redo')}
              aria-label={t('common.redo')}
              className="rounded-xl p-2 text-white/60 transition hover:bg-white/5 hover:text-white disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              <Redo2 className="h-5 w-5" aria-hidden="true" />
            </button>

            <button
              type="button"
              onClick={onClose}
              aria-label={t('nav.slides')}
              className="rounded-xl p-2 text-white/60 transition hover:bg-white/5 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
        </header>

        {/* Body */}
        <div className="relative flex min-h-0 flex-1 overflow-hidden">
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
                {activeIndex + 1} / {deck.slides.length}
              </span>
            </div>
          ) : (
            <div className="flex" style={{ width: RAIL_WIDTH }}>
              <EditorSlideRail
                slides={visibleSlides}
                allSlides={deck.slides}
                enabled={active}
                editableOnly={editableOnly}
                onFilterChange={changeFilter}
                drafts={session.drafts}
                activeId={session.activeId}
                selectedIds={selectedSlideIds}
                liveSlideId={liveSlideId}
                onActivate={activateSlide}
                onSelectAll={session.selectEverySlide}
                onClearSelection={session.collapseSlideSelection}
                onOpenPasteMenu={(position, slideId) => setPasteMenu({ ...position, slideId })}
                onDropElements={handleRailDrop}
                onCollapse={() => setRailCollapsed(true)}
              />
            </div>
          )}

          {/* Canvas */}
          {videoEditable ? <VideoEditor key={activeSlide.id + ':' + activeSlide.mediaUrl} slide={activeSlide} playback={activeDraft.videoPlayback} active={active} onChange={session.updateVideoPlayback} onValidityChange={setVideoRangeValid}
            overlays={activeDraft.videoOverlays ?? []} selectedOverlayId={[...selectedIds][0]}
            onSelectOverlay={id => session.setItemSelection(new Set(id ? [id] : []))} onAddOverlay={addVideoText}
            onOverlaysChange={session.updateVideoOverlays} onGestureStart={beginGesture} onGestureEnd={endGesture} /> : !editable ? <div className="flex min-w-0 flex-1 flex-col items-center justify-center gap-4 overflow-auto p-4">
            <div className="aspect-video w-full max-w-5xl overflow-hidden rounded-xl border border-white/15 bg-black">
              <SlidePreviewAny slide={activeSlide} cardWidth={800} enabled={active} />
            </div>
            <p className="text-sm font-semibold text-white/90">{t('common.editorRailReadOnly')}</p>
            <p className="max-w-xl text-center text-sm text-white/60">{t('common.editorReadOnlyExplanation')}</p>
            <button type="button" onClick={() => onOpenInSlides?.(activeSlide.id)} className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white">{t('common.editorOpenInSlides')}</button>
          </div> : <CanvasStage
            slideStyles={activeDraft.styles}
            items={items}
            selectedIds={selectedIds}
            onSelect={handleSelect}
            onSelectMany={handleSelectMany}
            keyboardEnabled={shortcutsEnabled && editable}
            onDrag={handleDrag}
            onDragEnd={handleDragEnd}
            onTransform={handleTransform}
            onRotate={handleRotate}
            gridEnabled={gridEnabled}
            gridSize={gridSize}
            gridColor={gridColor}
            snapEnabled={snapEnabled}
            lockedRatioIds={lockedRatioIds}
            safeAreaEnabled={safeAreaEnabled}
            onItemDragStart={handleItemDragStart}
            onContextMenu={(event) => {
              event.preventDefault();
              setPasteMenu({ x: event.clientX, y: event.clientY });
            }}
          />

          }

          {/* Inspector */}
          {inspectorOpen && (
            <button
              type="button"
              className="absolute inset-0 z-30 bg-black/50 lg:hidden"
              aria-label={t('common.editorCloseInspector')}
              onClick={closeInspector}
            />
          )}
          {editable && <aside
            id="editor-inspector"
            ref={inspectorRef}
            aria-label={t('common.editorInspector')}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && inspectorOpen) {
                event.stopPropagation();
                closeInspector();
              }
            }}
            className={cn(
              'absolute inset-y-0 right-0 z-40 w-80 max-w-[calc(100%_-_40px)] shrink-0 flex-col overflow-hidden border-l border-white/10 bg-[#181818] lg:static lg:flex lg:max-w-none',
              inspectorOpen ? 'flex' : 'hidden'
            )}
          >
            <button
              type="button"
              onClick={closeInspector}
              className="self-end rounded-lg p-2 text-white/70 lg:hidden focus-visible:ring-2 focus-visible:ring-blue-500"
              aria-label={t('common.editorCloseInspector')}
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
            <div
              className="flex items-center gap-1 border-b border-white/10 p-2"
              role="tablist"
              aria-label={t('common.editorInspector')}
            >
              {inspectorTabs.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  id={'editor-tab-' + id}
                  aria-controls="editor-inspector-panel"
                  tabIndex={tab === id ? 0 : -1}
                  onKeyDown={(event) => {
                    const index = inspectorTabs.findIndex((entry) => entry.id === id);
                    const next =
                      event.key === 'Home'
                        ? 0
                        : event.key === 'End'
                          ? inspectorTabs.length - 1
                          : event.key === 'ArrowRight'
                            ? (index + 1) % inspectorTabs.length
                            : event.key === 'ArrowLeft'
                              ? (index + inspectorTabs.length - 1) % inspectorTabs.length
                              : -1;
                    if (next < 0) return;
                    event.preventDefault();
                    event.stopPropagation();
                    setTab(inspectorTabs[next].id);
                    document.getElementById('editor-tab-' + inspectorTabs[next].id)?.focus();
                  }}
                  aria-selected={tab === id}
                  onClick={() => setTab(id)}
                  className={cn(
                    'flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-[11px] font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500',
                    tab === id ? 'bg-blue-600/25 text-blue-100' : 'text-white/55 hover:bg-white/5 hover:text-white/80'
                  )}
                >
                  <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                  <span className="truncate">{label}</span>
                </button>
              ))}
            </div>

            <div
              className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3"
              id="editor-inspector-panel"
              role="tabpanel"
              aria-labelledby={'editor-tab-' + tab}
              tabIndex={0}
            >
              {tab === 'slide' && (
                <>
                  <ScopeSelector
                    scope={effectiveScope}
                    selectedCount={selectedSlideIds.length}
                    slideCount={slideOrder.length}
                    onChange={setScope}
                  />
                  <label className="flex items-center gap-2 rounded-xl border border-white/10 p-3 text-xs text-white/70">
                    <input
                      type="checkbox"
                      checked={safeAreaEnabled}
                      onChange={(event) => setSafeAreaEnabled(event.target.checked)}
                    />
                    {t('common.editorSafeArea')}
                  </label>
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
                          {(
                            [
                              { key: 'x', label: 'X %' },
                              { key: 'y', label: 'Y %' },
                            ] as const
                          ).map(({ key, label }) => (
                            <label key={key} className="space-y-1">
                              <span className="text-[10px] uppercase tracking-wide text-white/40">{label}</span>
                              <input
                                type="number"
                                value={Math.round(primarySelected[key])}
                                onChange={(event) => {
                                  const value = parseInt(event.target.value);
                                  if (Number.isNaN(value)) return;
                                  const max = key === 'x' ? 100 - primarySelected.width : 100 - primarySelected.height;
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
                                  updateItem(primarySelected.id, (target) =>
                                    target.locked
                                      ? {}
                                      : target.type === 'image'
                                        ? sizeFromCenter(target, 'width', value, ratioLocked)
                                        : { width: clamp(value, 4, 100) }
                                  );
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
                                  updateItem(primarySelected.id, (target) =>
                                    target.locked
                                      ? {}
                                      : target.type === 'image'
                                        ? sizeFromCenter(target, 'height', value, ratioLocked)
                                        : { height: clamp(value, 4, 100) }
                                  );
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
                              : 'border-white/10 bg-black/20 text-white/70 hover:bg-black/30'
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

                      {primarySelected.type === 'image' && (
                        <PanelShell title={t('common.editorImageGeometry')} icon={Image}>
                          <label className="flex items-center gap-2 text-xs">
                            <input
                              type="checkbox"
                              disabled={primarySelected.locked}
                              checked={ratioLocked}
                              onChange={(event) => {
                                const checked = event.target.checked;
                                setLockedRatioKeys((prev) => {
                                  const next = new Set(prev);
                                  if (checked) next.add(ratioKey);
                                  else next.delete(ratioKey);
                                  return next;
                                });
                              }}
                            />
                            {t('common.editorLockRatio')}
                          </label>
                          <button
                            className="w-full rounded-lg border border-white/10 p-2 text-xs disabled:opacity-40"
                            disabled={primarySelected.locked || !imageSize.width}
                            onClick={() => {
                              finishInteraction();
                              session.updateItems((prev) =>
                                prev.map((item) =>
                                  item.id === primarySelected.id
                                    ? { ...item, ...restoreImageRatio(item, imageSize.width / imageSize.height) }
                                    : item
                                )
                              );
                            }}
                          >
                            {t('common.editorRestoreImageRatio')}
                          </button>
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
                                    { history: false }
                                  );
                                  return;
                                }
                                session.updateItems(
                                  (prev) =>
                                    prev.map((item) => (item.id === primarySelected.id ? { ...item, content } : item)),
                                  { history: false }
                                );
                              }}
                              rows={10}
                              className="max-h-[50vh] min-h-[14rem] w-full resize-y rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm leading-relaxed outline-none transition focus:border-blue-500"
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
                              disabled={primarySelected.locked}
                              onClick={async () => {
                                const slideId = session.activeId,
                                  itemId = primarySelected.id;
                                finishInteraction();
                                const file = await window.electronAPI?.selectMediaFile?.('image');
                                if (!file || sessionRef.current.activeId !== slideId) return;
                                sessionRef.current.applyItemUpdate(
                                  itemId,
                                  (target) =>
                                    target.locked ? {} : replaceImage(target, 'file://' + file.replace(/\\/g, '/')),
                                  selectedSlideIds,
                                  effectiveScope
                                );
                              }}
                              className="w-full rounded-xl bg-blue-600 px-4 py-3 text-sm font-medium text-white transition hover:bg-blue-500"
                            >
                              {t(primarySelected.mediaUrl ? 'common.editorReplaceImage' : 'common.editorSelectImage')}
                            </button>

                            <button
                              type="button"
                              disabled={primarySelected.locked}
                              onClick={() => {
                                finishInteraction();
                                updateItem(primarySelected.id, (target) =>
                                  target.locked ? {} : replaceImage(target, undefined)
                                );
                              }}
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
                          key={primarySelected.id}
                          item={primarySelected}
                          canCrop={selectedItems.length === 1 && !primarySelected.locked && !!primarySelected.mediaUrl}
                          onCrop={() => {
                            finishInteraction();
                            setCropTarget({ slideId: session.activeId, itemId: primarySelected.id });
                          }}
                          onChange={(styles) => {
                            finishInteraction();
                            updateItemStyle(primarySelected.id, { imageStyles: styles });
                          }}
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

                  {selectedItems.length > 0 && (
                    <AlignmentTools selectedItems={selectedItems} items={items} onUpdateItems={updateItemsBatch} />
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
          </aside>}
        </div>

        <span className="sr-only" role="status" aria-live="polite">
          {t('common.editorSlideCounter', { number: activeIndex + 1, count: deck.slides.length })}.{' '}
          {t('common.editorSelectedSlidesStatus', { count: selectedSlideIds.length })}
        </span>
        {/* Footer */}
        <footer className="flex min-h-14 shrink-0 flex-wrap items-center justify-between gap-3 border-t border-white/10 bg-[#1e1e1e] px-4 py-2">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3">
            <span className="hidden shrink-0 items-center gap-2 text-xs text-white/40 xl:flex">
              <span>{t('common.editorRailHint')}</span>
              <span>·</span>
              <span>{t('common.editorMultiSelect')}</span>
            </span>
            {noticeText && (
              <span
                role="status"
                className={cn(
                  'rounded-lg px-2 py-1 text-xs',
                  notice?.tone === 'warn'
                    ? 'border border-amber-400/30 bg-amber-500/10 text-amber-100'
                    : 'border border-blue-400/25 bg-blue-500/10 text-blue-100'
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

          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 rounded-xl border border-white/10 bg-black/20 px-1 py-1">
              <button
                type="button"
                onClick={() => navigate(-1)}
                disabled={session.order.indexOf(session.activeId) <= 0}
                aria-label={t('common.editorPreviousSlide')}
                title={t('common.editorPreviousSlide')}
                className="rounded-lg p-1.5 text-white/60 transition hover:bg-white/10 hover:text-white disabled:opacity-25 disabled:hover:bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              >
                <ChevronRight className="h-4 w-4 rotate-180" aria-hidden="true" />
              </button>
              <span className="px-1 text-xs tabular-nums text-white/60">
                {activeIndex + 1} / {deck.slides.length}
              </span>
              <button
                type="button"
                onClick={() => navigate(1)}
                disabled={session.order.length === 0 || session.order.indexOf(session.activeId) >= session.order.length - 1}
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
              {t('common.editorDiscard')}
            </button>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={confirming || !session.isDirty || !videoRangeValid}
              className="inline-flex items-center gap-2 rounded-xl bg-green-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-green-500 disabled:opacity-40 disabled:hover:bg-green-600"
            >
              <Save className="h-4 w-4" aria-hidden="true" />
              {t('common.save')}
            </button>
          </div>
        </footer>

        {active && cropItem && (
          <ImageCropDialog
            key={cropItem.id + cropItem.mediaUrl}
            item={cropItem}
            onClose={() => setCropTarget(null)}
            onApply={(crop) => {
              finishInteraction();
              session.updateItems((prev) =>
                prev.map((item) =>
                  item.id === cropItem.id && !item.locked
                    ? { ...item, imageStyles: { ...item.imageStyles, crop, cropMode: 'source' } }
                    : item
                )
              );
              setCropTarget(null);
            }}
          />
        )}
        <EditorPasteMenu
          context={active ? pasteMenu : null}
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
      </div>
    </section>
  );
}
