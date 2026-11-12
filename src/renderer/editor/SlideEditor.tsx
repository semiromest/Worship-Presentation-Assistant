import { saveLibraryPreset } from '../presetLibrary';
import ControlTooltip from '../components/ControlTooltip';
import {
AlignCenter,
AlignLeft,
AlignRight,
Bold,
Boxes,
BringToFront,
ChevronLeft,
ChevronRight,
Copy,
Crop,
Grid3x3,
Group,
Image,
ImagePlus,
Italic,
Layers,
LayoutTemplate,
Link2,
Link2Off,
Lock,
Magnet,
Minus,
MousePointer2,
Paintbrush,
PanelRightOpen,
PencilLine,
Plus,
RectangleHorizontal,
Redo2,
RotateCcw,
Save,
Scan,
SendToBack,
Trash2,
Type,
Undo2,
Ungroup,
Unlock,
X
} from 'lucide-react';
import * as m from 'motion/react-m';
import { useCallback,useEffect,useLayoutEffect,useMemo,useRef,useState,type ComponentType } from 'react';
import { useTranslation } from 'react-i18next';
import { choiceDialog } from '../choiceDialogState';
import { GradientDesigner, type GradientPreview } from '../components/GradientDesigner';
import { consumeGradientEditorRequest } from '../gradientEditorRequest';
import { LivePreview } from '../LivePreview';
import { SlidePreviewAny } from '../components/SlidePreview';
import { isHelpActive } from '../components/Tour/tourController';
import { setComponentInert } from '../components/Tour/guideBoundary';
import { alertDialog,confirmDialog } from '../dialogs';
import { generatedStyles } from '../gradientBackground';
import { useContentMotion } from '../hooks/useContentMotion';
import { useImageSize } from '../hooks/useImageSize';
import { getLiveSaveRetention } from '../hooks/useLiveSave';
import { usePractice } from '../hooks/usePractice';
import { useUiMotionEnabled } from '../hooks/useUiMotionEnabled';
import { playSfx } from '../sfx';
import { useStore } from '../state/useStore';
import type { Presentation,Slide,SlideItem,TextStyle } from '../types';
import { uiMotion } from '../uiMotion';
import { cn } from '../utils';
import { newVideoOverlay } from '../videoOverlays';
import { AlignmentTools } from './AlignmentTools';
import { sizeFromCenter,type ItemBounds } from './canvasGeometry';
import { CanvasStage } from './CanvasStage';
import { findEditorConflicts } from './editorConflicts';
import { ClipboardChip,NumberField,ScopeSelector,Section,ToolButton,ToolDivider } from './EditorControls';
import EditorPasteMenu,{ type PasteMenuContext } from './EditorPasteMenu';
import { registerEditorGuard } from './editorSessionGuard';
import EditorSlideRail,{ RAIL_COLLAPSED_WIDTH,RAIL_WIDTH } from './EditorSlideRail';
import {
DEFAULT_TEXT_STYLE,
clamp,
deleteItemAt,
deleteItems,
duplicateItem,
duplicateItems,
isEditableTarget,
makeItemId,
normalizeItems,
swapLayer,
toggleLock,
toggleVisibility,
} from './editorUtils';
import { writeElementDrag } from './elementDrag';
import { createGroup,ungroupGroup } from './groupUtils';
import { ImageCropDialog } from './ImageCropDialog';
import { replaceImage,restoreImageRatio } from './imageOperations';
import { useKeyboardShortcuts } from './keyboardShortcuts';
import { LayerPanel } from './panels/LayerPanel';
import { SlideSettingsPanel } from './panels/SlideSettingsPanel';
import { editorFilterTarget,filteredEditorSlides,isEditorEditableSlide,isVideoEditableSlide } from './slideCapabilities';
import { isItemEditableSlide,makeClipboard,type SlideDraft } from './slideDraft';
import { SlideTemplates } from './SlideTemplates';
import { ImageStyleEditor } from './styleEditors/ImageStyleEditor';
import { TextStyleEditor } from './styleEditors/TextStyleEditor';
import { applyTemplate } from './templates';
import { useEditorDeck,type EditScope,type EditorClipboard,type EditorNotice } from './useEditorDeck';
import { finishEditorGesture } from './usePointerGesture';
import VideoEditor from './VideoEditor';

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

export default function SlideEditor({ slide, deck, active, onSave, onClose, onOpenInSlides }: SlideEditorProps) {
  const { t } = useTranslation();
  const practice = usePractice();
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
  const gradientOnly = activeSlide?.type === 'text' && !editable;
  const [gradientPreview, setGradientPreview] = useState<GradientPreview | null>(null);
  const canvasStyles = useMemo(() => ({ ...activeDraft?.styles, ...(gradientPreview?.slideId === activeSlide?.id ? gradientPreview?.styles : {}) }), [activeDraft?.styles, gradientPreview, activeSlide?.id]);
  const applyGradient = useCallback((ids: string[], image: string, recipe: import('../../shared/generatedBackground').GeneratedBackground) => {
    sessionRef.current.applyBackground(generatedStyles(image, recipe), ids);
    setGradientPreview(null);
  }, []);
  const addVideoText = () => {
    if (!videoEditable) return;
    finishInteraction();
    const overlays = session.activeDraft?.videoOverlays ?? [];
    const item = newVideoOverlay(makeItemId(), t('common.editorNewText'), Math.max(-1, ...overlays.map(item => item.zIndex)) + 1);
    session.updateVideoOverlays([...overlays, item]);
    session.setItemSelection(new Set([item.id]));
  };
  const items = session.activeItems;

  // Nothing is selected when the editor opens, so it starts on the slide settings.
  const [tab, setTab] = useState<InspectorTab>('slide');
  /** Text item currently being edited in place on the canvas. */
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [showTemplates, setShowTemplates] = useState(false);
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
  const shortcutsEnabled = active && !showTemplates && !pasteMenu && !confirming && !cropTarget;
  const [scope, setScope] = useState<EditScope>('active');
  useEffect(() => {
    if (active && activeSlide && consumeGradientEditorRequest(activeSlide.id)) { setTab('slide'); setInspectorOpen(true); }
  }, [active, activeSlide?.id]);
  useEffect(() => { if (gradientOnly) setTab('slide'); }, [gradientOnly]);
  const [railCollapsed, setRailCollapsed] = useState(() => {
    try {
      return localStorage.getItem(RAIL_STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    if (!active || !showTemplates) return;
    const keydown = (event: KeyboardEvent) => {
      if (isHelpActive()) return;
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setShowTemplates(false);
    };
    const outside = (event: PointerEvent) => {
      if (!(event.target as Element).closest('[data-editor-popover]')) {
        setShowTemplates(false);
      }
    };
    window.addEventListener('keydown', keydown, true);
    window.addEventListener('pointerdown', outside);
    return () => {
      window.removeEventListener('keydown', keydown, true);
      window.removeEventListener('pointerdown', outside);
    };
  }, [active, showTemplates]);
  useEffect(() => {
    if (!active || !inspectorOpen) return;
    inspectorRef.current?.querySelector<HTMLElement>('[role=tab][aria-selected=true]')?.focus();
  }, [active, inspectorOpen]);
  const inspectorContentRef = useRef<HTMLDivElement>(null);
  const motionEnabled = useUiMotionEnabled();
  const [desktopInspector, setDesktopInspector] = useState(() => window.matchMedia('(min-width: 1024px)').matches);
  useEffect(() => {
    const query = window.matchMedia('(min-width: 1024px)');
    const update = () => setDesktopInspector(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  const inspectorVisible = inspectorOpen || desktopInspector;
  useLayoutEffect(() => { if (inspectorRef.current) setComponentInert(inspectorRef.current, !active || !inspectorVisible); }, [active, inspectorVisible, editable]);
  useContentMotion(inspectorContentRef, tab);
  const closeInspector = () => {
    setInspectorOpen(false);
    inspectorToggleRef.current?.focus();
  };

  const slideOrder = session.order;
  const selectedSlideIds = session.selection.selectedIds.filter(id => { const candidate = session.slideById.get(id); return !!candidate && isItemEditableSlide(candidate); });
  const gradientSelection = session.selection.selectedIds.filter(id => { const slide = session.slideById.get(id); return !!slide && (slide.type === 'text' || isItemEditableSlide(slide)); });
  const gradientIds = (scope === 'selected' && gradientSelection.length > 1 ? gradientSelection : [activeSlide?.id]).filter((id): id is string => !!id && !!session.slideById.get(id) && (session.slideById.get(id)!.type === 'text' || isItemEditableSlide(session.slideById.get(id)!)));
  const multiSlide = selectedSlideIds.length > 1;
  const effectiveScope: EditScope = multiSlide ? scope : 'active';

  // A bulk scope left over from a wider selection must never silently persist.
  const bulkAvailable = multiSlide || (tab === 'slide' && gradientSelection.length > 1);
  const wasBulkAvailable = useRef(false);
  useEffect(() => {
    // Picking several slides means "edit these": start in the selected scope instead of
    // silently changing only the last-clicked slide.
    if (bulkAvailable && !wasBulkAvailable.current) setScope('selected');
    wasBulkAvailable.current = bulkAvailable;
    if (!bulkAvailable && scope !== 'active') setScope('active');
  }, [bulkAvailable, scope]);

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

  useEffect(() => {
    if (practice && active && slide?.items?.some(item => item.id.startsWith('practice-editor-')) && session.activeId !== slide.id) session.activateSlide(slide);
  }, [practice, active, slide, session.activeId, session.activateSlide]);
  useEffect(() => {
    if (practice && active && primarySelected?.id.startsWith('practice-editor-')) { setInspectorOpen(true); setTab('item'); }
  }, [practice, active, primarySelected?.id]);

  // The inspector follows the selection: something selected → its properties,
  // nothing selected → the slide. The layers tab is left alone while in use.
  const hasItemSelection = selectedIds.size > 0;
  const hadItemSelection = useRef(hasItemSelection);
  useEffect(() => {
    if (hadItemSelection.current === hasItemSelection) return;
    hadItemSelection.current = hasItemSelection;
    if (gradientOnly) return;
    setTab((current) => (current === 'layers' ? current : hasItemSelection ? 'item' : 'slide'));
  }, [hasItemSelection, gradientOnly]);
  useEffect(() => {
    if (editingItemId && (!selectedIds.has(editingItemId) || !items.some((item) => item.id === editingItemId && !item.locked)))
      setEditingItemId(null);
  }, [editingItemId, selectedIds, items]);

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

  /** Text edits from the inspector or the canvas; the focus gesture keeps them to one undo entry. */
  const changeText = useCallback(
    (itemId: string, content: string) => {
      if (effectiveScope === 'selected' && multiSlide) {
        // Bulk scope mirrors the text onto the counterparts.
        session.applyItemUpdate(itemId, { content }, selectedSlideIds, 'selected', { history: false });
        return;
      }
      session.updateItems(
        (prev) => prev.map((item) => (item.id === itemId ? { ...item, content } : item)),
        { history: false }
      );
    },
    [effectiveScope, multiSlide, selectedSlideIds, session]
  );

  const chooseImageFor = useCallback(
    async (itemId: string) => {
      const slideId = session.activeId;
      finishInteraction();
      const file = await window.electronAPI?.selectMediaFile?.('image');
      if (!file || sessionRef.current.activeId !== slideId) return;
      sessionRef.current.applyItemUpdate(
        itemId,
        (target) => (target.locked ? {} : replaceImage(target, 'file://' + file.replace(/\\/g, '/'))),
        selectedSlideIds,
        effectiveScope
      );
    },
    [effectiveScope, finishInteraction, selectedSlideIds, session.activeId]
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
      playSfx('success');
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
      if (payload) {
        const changed = payload.slides.filter(candidate => current.touchedIds.has(candidate.id) && !skipped.has(candidate.id));
        if (changed.length) { onSave(changed); playSfx('success'); }
      }
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
          const updated = await saveLibraryPreset({
            name, presentation: { ...current.presentation, name }, retentionMs: getLiveSaveRetention(),
          });
          if (!Array.isArray(updated)) throw new Error(t('library.saveFailed'));
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
    ...(!gradientOnly ? [{ id: 'item' as const, label: t('common.editorTabItem'), icon: MousePointer2 }] : []),
    { id: 'slide', label: t('common.editorTabSlide'), icon: RectangleHorizontal },
    ...(!gradientOnly ? [{ id: 'layers' as const, label: t('common.editorTabLayers'), icon: Layers }] : []),
  ];

  const selectedTextStyles = primarySelected?.type === 'text' ? (primarySelected.textStyles ?? DEFAULT_TEXT_STYLE) : null;
  const patchSelectedText = (patch: Partial<TextStyle>) => {
    if (!primarySelected || !selectedTextStyles) return;
    finishInteraction();
    updateItemStyle(primarySelected.id, { textStyles: { ...selectedTextStyles, ...patch } });
  };
  const hasGroupSelected = selectedItems.some((item) => item.type === 'group');
  const itemTypeIcon = primarySelected?.type === 'image' ? Image : primarySelected?.type === 'group' ? Boxes : Type;
  const itemLabel = !primarySelected
    ? ''
    : selectedIds.size > 1
      ? t('common.editorItemsSelected', { count: selectedIds.size })
      : primarySelected.type === 'text'
        ? primarySelected.content?.split('\n')[0]?.trim() || t('common.editorText')
        : primarySelected.type === 'group'
          ? t('common.editorGroup')
          : t('common.editorImage');

  const toolbarShell =
    'flex items-center gap-0.5 rounded-lg border border-white/10 bg-surface-overlay/95 p-1 text-white shadow-[0_12px_32px_-12px_rgba(0,0,0,0.9)] backdrop-blur';

  // Floating toolbar next to the selection: the few things people reach for most.
  const selectionToolbar =
    editable && primarySelected ? (
      <div
        role="toolbar"
        aria-label={t('common.editorSelectionToolbar')}
        className={toolbarShell}
        // Keep focus (and an open inline text edit) where it is.
        onPointerDown={(event) => {
          if (!(event.target as Element).closest('input')) event.preventDefault();
        }}
      >
        {primarySelected.locked ? (
          <ToolButton label={t('common.editorUnlock')} icon={Unlock} onClick={() => toggleItemLock(primarySelected.id)}>
            <span className="pr-1">{t('common.editorUnlock')}</span>
          </ToolButton>
        ) : selectedIds.size > 1 ? (
          <>
            <ToolButton label={t('common.editorGroup')} icon={Group} onClick={handleGroup} />
            {hasGroupSelected && <ToolButton label={t('common.editorUngroup')} icon={Ungroup} onClick={handleUngroup} />}
            <ToolDivider />
            <ToolButton label={t('common.editorDuplicate')} icon={Copy} onClick={duplicateSelected} />
            <ToolButton label={t('common.editorDelete')} icon={Trash2} tone="danger" onClick={deleteSelected} />
          </>
        ) : (
          <>
            {selectedTextStyles && (
              <>
                <ToolButton
                  label={t('common.editorEditText')}
                  icon={PencilLine}
                  active={editingItemId === primarySelected.id}
                  onClick={() => setEditingItemId(primarySelected.id)}
                />
                <ToolDivider />
                <ToolButton
                  label={t('common.editorFontSmaller')}
                  onClick={() => patchSelectedText({ fontSize: clamp((selectedTextStyles.fontSize ?? 32) - 4, 8, 240) })}
                >
                  <Minus className="h-3.5 w-3.5" aria-hidden="true" />
                </ToolButton>
                <span className="min-w-[2rem] text-center text-xs tabular-nums text-white/80" title={t('common.editorFontSize')}>
                  {selectedTextStyles.fontSize ?? 32}
                </span>
                <ToolButton
                  label={t('common.editorFontLarger')}
                  onClick={() => patchSelectedText({ fontSize: clamp((selectedTextStyles.fontSize ?? 32) + 4, 8, 240) })}
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                </ToolButton>
                <ToolDivider />
                <ToolButton
                  label={t('common.editorBold')}
                  icon={Bold}
                  active={selectedTextStyles.fontWeight === 'bold'}
                  onClick={() => patchSelectedText({ fontWeight: selectedTextStyles.fontWeight === 'bold' ? 'normal' : 'bold' })}
                />
                <ToolButton
                  label={t('common.editorItalic')}
                  icon={Italic}
                  active={selectedTextStyles.fontStyle === 'italic'}
                  onClick={() => patchSelectedText({ fontStyle: selectedTextStyles.fontStyle === 'italic' ? 'normal' : 'italic' })}
                />
                <ToolButton
                  label={t('common.editorTextAlign')}
                  icon={selectedTextStyles.textAlign === 'left' ? AlignLeft : selectedTextStyles.textAlign === 'right' ? AlignRight : AlignCenter}
                  onClick={() =>
                    patchSelectedText({
                      textAlign: selectedTextStyles.textAlign === 'left' ? 'center' : selectedTextStyles.textAlign === 'right' ? 'left' : 'right',
                    })
                  }
                />
                <label className="relative grid h-7 w-7 cursor-pointer place-items-center rounded-md hover:bg-white/[0.07]" title={t('common.editorColor')}>
                  <span className="sr-only">{t('common.editorColor')}</span>
                  <span
                    aria-hidden="true"
                    className="h-4 w-4 rounded-full border border-white/30"
                    style={{ backgroundColor: selectedTextStyles.textColor || '#ffffff' }}
                  />
                  <input
                    type="color"
                    value={/^#[0-9a-f]{6}$/i.test(selectedTextStyles.textColor || '') ? selectedTextStyles.textColor : '#ffffff'}
                    onChange={(event) => patchSelectedText({ textColor: event.target.value })}
                    className="absolute inset-0 cursor-pointer opacity-0"
                  />
                </label>
              </>
            )}
            {primarySelected.type === 'image' && (
              <>
                <ToolButton
                  label={t(primarySelected.mediaUrl ? 'common.editorReplaceImage' : 'common.editorSelectImage')}
                  icon={ImagePlus}
                  onClick={() => void chooseImageFor(primarySelected.id)}
                />
                <ToolButton
                  label={t('common.editorVisualCrop')}
                  icon={Crop}
                  disabled={selectedItems.length !== 1 || !primarySelected.mediaUrl}
                  onClick={() => {
                    finishInteraction();
                    setCropTarget({ slideId: session.activeId, itemId: primarySelected.id });
                  }}
                />
              </>
            )}
            <ToolDivider />
            <ToolButton label={t('common.editorDuplicate')} icon={Copy} onClick={duplicateSelected} />
            <ToolButton label={t('common.editorDelete')} icon={Trash2} tone="danger" onClick={() => deleteItemById(primarySelected.id)} />
          </>
        )}
      </div>
    ) : null;

  const viewControls = editable ? (
    <>
      <ToolButton
        label={t('common.editorGridShow')}
        icon={Grid3x3}
        active={gridEnabled}
        pressed={gridEnabled}
        className="h-6 min-w-6"
        onClick={() => session.setGridField('gridEnabled', !gridEnabled, selectedSlideIds, effectiveScope)}
      />
      {gridEnabled && (
        <label className="flex h-6 items-center gap-1 rounded-md px-1 text-[11px] text-white/55" title={t('common.editorGridSize')}>
          <span className="sr-only">{t('common.editorGridSize')}</span>
          <input
            type="number"
            min={2}
            max={25}
            value={gridSize}
            onChange={(event) => {
              const value = parseInt(event.target.value);
              if (!Number.isNaN(value)) session.setGridField('gridSize', clamp(value, 2, 25), selectedSlideIds, effectiveScope);
            }}
            className="h-5 w-9 rounded bg-black/30 px-1 text-center text-[11px] tabular-nums text-white/85 outline-none focus:ring-1 focus:ring-blue-500 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
          />
          <input
            type="color"
            aria-label={t('common.editorGridColor')}
            value={/^#[0-9a-f]{6}$/i.test(gridColor) ? gridColor : '#ffffff'}
            onChange={(event) => session.setGridField('gridColor', event.target.value, selectedSlideIds, effectiveScope)}
            className="h-4 w-4 cursor-pointer rounded border-0 bg-transparent p-0 [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded-sm [&::-webkit-color-swatch]:border-white/20"
          />
        </label>
      )}
      <ToolButton
        label={t('common.editorSnapEnable')}
        icon={Magnet}
        active={snapEnabled}
        pressed={snapEnabled}
        className="h-6 min-w-6"
        onClick={() => session.setGridField('snapEnabled', !snapEnabled, selectedSlideIds, effectiveScope)}
      />
      <ToolButton
        label={t('common.editorSafeArea')}
        icon={Scan}
        active={safeAreaEnabled}
        pressed={safeAreaEnabled}
        className="h-6 min-w-6"
        onClick={() => setSafeAreaEnabled(!safeAreaEnabled)}
      />
    </>
  ) : null;

  const emptyCanvas = (
    <div className="pointer-events-auto flex flex-col items-center gap-3 text-center">
      <p className="text-sm text-white/55">{t('common.editorCanvasEmptyShort')}</p>
      <div className="flex flex-wrap items-center justify-center gap-2">
        {[
          { key: 'text', label: t('common.editorText'), icon: Type, run: () => addItem('text') },
          { key: 'image', label: t('common.editorImage'), icon: Image, run: () => addItem('image') },
          { key: 'template', label: t('common.editorTemplates'), icon: LayoutTemplate, run: () => setShowTemplates(true) },
        ].map(({ key, label, icon: Icon, run }) => (
          <button
            key={key}
            type="button"
            onClick={run}
            className="inline-flex h-8 items-center gap-2 rounded-md border border-white/10 bg-black/40 px-3 text-xs text-white/80 backdrop-blur transition hover:border-white/20 hover:bg-black/60 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
            {label}
          </button>
        ))}
      </div>
    </div>
  );

  const headerButton =
    'inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-xs text-white/70 transition hover:bg-white/[0.07] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:pointer-events-none disabled:opacity-30';

  if (!activeSlide || !activeDraft) return (
    <section className="flex h-full flex-col items-center justify-center gap-4" aria-label={t('nav.editor')}>
      <p className="text-white/60">{t('common.editorEmpty')}</p>
      <button type="button" onClick={onClose} className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-500">{t('nav.slides')}</button>
    </section>
  );

  return (
    <section ref={editorRootRef} data-guide-state={practice && active ? JSON.stringify({ editorSlideId:activeSlide.id,editorItemId:primarySelected?.id ?? '',editorSelected:selectedIds.size === 1,editorRotation:primarySelected?.rotation ?? 0 }) : undefined} aria-labelledby="slide-editor-title" className="editor-workspace flex h-full min-h-0 w-full flex-col overflow-hidden bg-surface-base">
      <div
        className="editor-workspace-layout flex h-full min-h-0 w-full flex-col"
        onKeyDown={(event) => {
          if (gradientOnly && (event.ctrlKey || event.metaKey) && ['z', 'y'].includes(event.key.toLowerCase())
            && !(event.target as Element).closest('input,textarea,select,[contenteditable="true"]')) {
            event.preventDefault(); event.stopPropagation(); setGradientPreview(null);
            if (event.shiftKey || event.key.toLowerCase() === 'y') session.redo(); else session.undo();
            return;
          }
          if (!((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a' && (event.target as Element).closest('[data-editor-rail]'))) handleEditorShortcuts(event.nativeEvent);
          handleNavigationKeyDown(event.nativeEvent);
          event.stopPropagation();
        }}
      >
        {/* Header: one thin bar — back · title/status · insert · history · save */}
        <header className="editor-workspace-header flex h-11 shrink-0 items-center gap-2 border-b border-white/[0.06] bg-surface px-2">
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            <ControlTooltip descriptionKey={'nav.slides'}>
              <button type="button" onClick={onClose} aria-label={t('nav.slides')} title={t('nav.slides')} className={cn(headerButton, 'px-1.5')}>
                <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              </button>
            </ControlTooltip>
            <div className="flex min-w-0 items-baseline gap-2">
              <h2 id="slide-editor-title" className="truncate text-sm font-semibold text-white/90">
                {t('common.editorTitle')}
                {session.isDirty && <span className="sr-only"> · {t('common.editorPendingDraft')}</span>}
              </h2>
              <span className="shrink-0 text-xs tabular-nums text-white/45">
                {t('common.editorSlideCounter', { number: activeIndex + 1, count: deck.slides.length })}
              </span>
              {session.isDirty && (
                <span
                  className="inline-flex shrink-0 items-center gap-1.5 text-[11px] text-amber-200/80"
                  title={session.touchedCount > 0 ? t('common.editorUnsavedSlideCount', { count: session.touchedCount }) : t('common.editorPendingDraft')}
                >
                  <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                  <span className="hidden md:inline">
                    {session.touchedCount > 0 ? t('common.editorUnsavedSlideCount', { count: session.touchedCount }) : t('common.editorPendingDraft')}
                  </span>
                </span>
              )}
            </div>
          </div>

          <div className="editor-workspace-tools flex shrink-0 items-center gap-0.5">
            <ControlTooltip descriptionKey={'common.editorText'}>
              <button
                type="button"
                disabled={!editable && !videoEditable}
                onClick={() => videoEditable ? addVideoText() : addItem('text')}
                aria-label={t('common.editorText')}
                className={headerButton}
              >
                <Type className="h-4 w-4" aria-hidden="true" />
                <span className="hidden xl:inline">{t('common.editorText')}</span>
              </button>
            </ControlTooltip>
            <ControlTooltip descriptionKey={'common.editorImage'}>
              <button type="button" disabled={!editable} onClick={() => addItem('image')} aria-label={t('common.editorImage')} className={headerButton}>
                <Image className="h-4 w-4" aria-hidden="true" />
                <span className="hidden xl:inline">{t('common.editorImage')}</span>
              </button>
            </ControlTooltip>
            <div className="relative" data-editor-popover>
              <ControlTooltip descriptionKey={'common.editorTemplates'} suppress={showTemplates}>
                <button
                  type="button"
                  onClick={() => setShowTemplates(!showTemplates)}
                  disabled={!editable}
                  aria-expanded={showTemplates}
                  aria-label={t('common.editorTemplates')}
                  className={cn(headerButton, showTemplates && 'bg-white/[0.08] text-white')}
                >
                  <LayoutTemplate className="h-4 w-4" aria-hidden="true" />
                  <span className="hidden xl:inline">{t('common.editorTemplates')}</span>
                </button>
              </ControlTooltip>
              {showTemplates && (
                <div className="absolute left-1/2 top-full z-50 mt-1.5 max-h-[70vh] w-72 max-w-[calc(100vw-24px)] -translate-x-1/2 overflow-y-auto rounded-lg border border-white/10 bg-surface-overlay p-2 shadow-2xl">
                  <div className="mb-1.5 flex items-center justify-between px-1">
                    <span className="text-[11px] font-semibold text-white/70">{t('common.editorTemplateTitle')}</span>
                    <button type="button" onClick={() => setShowTemplates(false)} className="rounded p-1 text-white/55 hover:bg-white/10 hover:text-white" aria-label={t('common.close')}>
                      <X className="h-3 w-3" aria-hidden="true" />
                    </button>
                  </div>
                  <SlideTemplates onSelect={handleTemplateSelect} />
                </div>
              )}
            </div>

            <ToolDivider />

            <ToolButton
              label={t('common.undo')}
              descriptionKey="common.undo"
              icon={Undo2}
              disabled={!session.canUndo}
              className="h-8 min-w-8"
              onClick={() => { finishInteraction(); session.undo(); }}
            />
            <ToolButton
              label={t('common.redo')}
              descriptionKey="common.redo"
              icon={Redo2}
              disabled={!session.canRedo}
              className="h-8 min-w-8"
              onClick={() => { finishInteraction(); session.redo(); }}
            />
          </div>

          <div className="flex min-w-0 flex-1 items-center justify-end gap-1.5">
            <button
              ref={inspectorToggleRef}
              type="button"
              className={cn(headerButton, 'px-1.5 lg:hidden', inspectorOpen && 'bg-white/[0.08] text-white')}
              aria-label={t('common.editorInspector')}
              aria-expanded={inspectorOpen}
              aria-controls="editor-inspector"
              onClick={() => { setInspectorOpen(!inspectorOpen); playSfx(inspectorOpen ? 'close' : 'open'); }}
            >
              <PanelRightOpen className="h-4 w-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={handleClose}
              disabled={!session.isDirty}
              className={cn(headerButton, 'px-2.5')}
            >
              {t('common.editorDiscard')}
            </button>
            <button
              type="button"
              data-guide-anchor="editor-save"
              onClick={() => void handleSave()}
              disabled={confirming || !session.isDirty || !videoRangeValid}
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-blue-600 px-3 text-xs font-medium text-white transition hover:bg-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 disabled:bg-white/[0.06] disabled:text-white/35"
            >
              <Save className="h-3.5 w-3.5" aria-hidden="true" />
              {t('common.save')}
            </button>
          </div>
        </header>

        {/* Body */}
        <div className="editor-workspace-body relative flex min-h-0 flex-1 overflow-hidden">
          {railCollapsed ? (
            <div
              className="flex h-full shrink-0 flex-col items-center gap-2 border-r border-white/10 bg-[#151515] py-2"
              style={{ width: RAIL_COLLAPSED_WIDTH }}
            >
              <ControlTooltip descriptionKey={'common.editorRailExpand'}><button
                type="button"
                onClick={() => setRailCollapsed(false)}
                aria-label={t('common.editorRailExpand')}
                title={t('common.editorRailExpand')}
                className="rounded-lg p-1.5 text-white/50 transition hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              >
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </button></ControlTooltip>
              <span className="text-[11px] tabular-nums text-white/55 [writing-mode:vertical-rl]">
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
                selectedIds={session.selection.selectedIds}
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
          <div className="relative flex min-w-0 flex-1">
          {videoEditable ? <VideoEditor key={activeSlide.id + ':' + activeSlide.mediaUrl} slide={activeSlide} playback={activeDraft.videoPlayback} active={active} onChange={session.updateVideoPlayback} onValidityChange={setVideoRangeValid}
            overlays={activeDraft.videoOverlays ?? []} selectedOverlayId={[...selectedIds][0]}
            onSelectOverlay={id => session.setItemSelection(new Set(id ? [id] : []))} onAddOverlay={addVideoText}
            onOverlaysChange={session.updateVideoOverlays} onGestureStart={beginGesture} onGestureEnd={endGesture} /> : !editable ? <div className="flex min-w-0 flex-1 flex-col items-center justify-center gap-3 overflow-auto p-6">
            <div className="aspect-video w-full max-w-4xl overflow-hidden rounded-lg bg-black shadow-[0_0_0_1px_rgba(255,255,255,0.06)]">
              {gradientOnly
                ? <LivePreview slide={{ ...activeSlide, styles: canvasStyles as Slide['styles'] }} isActive={active} muted />
                : <SlidePreviewAny slide={activeSlide} cardWidth={800} enabled={active} />}
            </div>
            <p className="pt-2 text-sm font-medium text-white/85">{t(gradientOnly ? 'gradientLibrary.backgroundOnly' : 'common.editorRailReadOnly')}</p>
            <p className="max-w-lg text-center text-xs leading-relaxed text-white/55">{t(gradientOnly ? 'gradientLibrary.backgroundOnlyHint' : 'common.editorReadOnlyExplanation')}</p>
            <button type="button" onClick={() => onOpenInSlides?.(activeSlide.id)} className="mt-1 inline-flex h-8 items-center rounded-md border border-white/10 bg-white/[0.04] px-3 text-xs text-white/85 transition hover:bg-white/[0.08]">{t('common.editorOpenInSlides')}</button>
          </div> : <CanvasStage
            slideStyles={canvasStyles}
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
            editingId={editingItemId}
            onRequestEdit={(id) => { session.setItemSelection(new Set([id])); setEditingItemId(id); }}
            onTextChange={changeText}
            onEditStart={beginGesture}
            onEditEnd={() => { endGesture(); setEditingItemId(null); }}
            selectionToolbar={selectionToolbar}
            viewControls={viewControls}
            emptyState={emptyCanvas}
          />}

          {/* Transient status + clipboard, bottom-left over the canvas */}
          {(noticeText || (clipboard && editable)) && (
            <div className="pointer-events-none absolute bottom-3 left-3 z-50 flex max-w-[calc(100%-18rem)] flex-col items-start gap-1.5">
              {noticeText && (
                <span
                  role="status"
                  className={cn(
                    'pointer-events-auto rounded-full border px-3 py-1 text-xs shadow-lg backdrop-blur',
                    notice?.tone === 'warn'
                      ? 'border-amber-400/30 bg-amber-950/80 text-amber-100'
                      : 'border-white/10 bg-surface-overlay/95 text-white/85'
                  )}
                >
                  {noticeText}
                </span>
              )}
              {clipboard && editable && (
                <ClipboardChip
                  clipboard={clipboard}
                  targetCount={otherSelectedCount}
                  onApply={handleApplyToOtherSelected}
                  onClear={() => setClipboard(null)}
                />
              )}
            </div>
          )}
          </div>

          {/* Inspector */}
          {inspectorOpen && (
            <button
              type="button"
              className="absolute inset-0 z-30 bg-black/50 lg:hidden"
              aria-label={t('common.editorCloseInspector')}
              onClick={closeInspector}
            />
          )}
          {(editable || gradientOnly) && <aside
            id="editor-inspector"
            ref={inspectorRef}
            aria-label={t('common.editorInspector')}
            aria-hidden={!active || !inspectorVisible}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && inspectorOpen) {
                event.stopPropagation();
                closeInspector();
              }
            }}
            className={cn(
              'absolute inset-y-0 right-0 z-40 flex w-72 max-w-[calc(100%_-_40px)] shrink-0 flex-col overflow-hidden border-l border-white/[0.06] bg-surface lg:static lg:max-w-none lg:translate-x-0 transition-[transform,opacity] duration-[var(--ui-motion-standard,180ms)] ease-[var(--ui-motion-ease)]',
              inspectorVisible ? 'translate-x-0 opacity-100' : 'translate-x-full opacity-0 pointer-events-none'
            )}
          >
            <div className="flex h-11 shrink-0 items-center gap-1 border-b border-white/[0.06] px-2">
            <div
              className="flex h-8 min-w-0 flex-1 items-center gap-0.5 rounded-md bg-black/25 p-0.5"
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
                  onClick={() => { if (id !== tab) { setTab(id); playSfx('swipe'); } }}
                  className={cn(
                    'relative isolate flex h-7 min-w-0 flex-1 items-center justify-center gap-1.5 rounded px-2 text-[11px] font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500',
                    tab === id ? 'text-white' : 'text-white/50 hover:text-white/80'
                  )}
                >
                  {tab === id && <m.span layoutId="editor-inspector-tab" className="pointer-events-none absolute inset-0 -z-10 rounded bg-white/[0.1]" transition={{ duration: motionEnabled ? uiMotion.duration.fast : 0, ease: uiMotion.ease }} />}
                  <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span className="truncate">{label}</span>
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={closeInspector}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-white/60 hover:bg-white/[0.07] hover:text-white lg:hidden focus-visible:ring-2 focus-visible:ring-blue-500"
              aria-label={t('common.editorCloseInspector')}
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
            </div>

            <div
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-6"
              ref={inspectorContentRef}
              id="editor-inspector-panel"
              role="tabpanel"
              aria-labelledby={'editor-tab-' + tab}
              tabIndex={0}
            >
              {tab === 'slide' && (
                <>
                  <ScopeSelector
                    scope={scope}
                    selectedCount={gradientOnly ? gradientSelection.length : new Set([...selectedSlideIds, ...gradientSelection]).size}
                    slideCount={slideOrder.length}
                    onChange={setScope}
                  />
                  {!gradientOnly && <SlideSettingsPanel styles={activeDraft.styles} onChange={updateSlideStyles} />}
                  {(activeSlide.type === 'text' || activeSlide.type === 'image') && <GradientDesigner key={activeSlide.id} slideId={activeSlide.id} initial={activeDraft.styles.generatedBackground as import('../../shared/generatedBackground').GeneratedBackground | undefined}
                    legacy={activeDraft.styles.backgroundGradient as import('../../shared/presentation').GradientStyle | undefined}
                    canClear={!!(activeDraft.styles.backgroundGradient || activeDraft.styles.generatedBackground)}
                    onClear={() => { session.applyBackground(styles => ({ backgroundGradient: undefined, ...(styles.generatedBackground ? { generatedBackground: undefined, backgroundImage: undefined, backgroundBlur: 0, generatedGroupBackground: undefined } : {}) }), gradientIds); setGradientPreview(null); }}
                    targetIds={gradientIds} enabled={active && tab === 'slide'} onPreview={setGradientPreview} onApply={applyGradient} />}
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
                  >
                    {primarySelected && (
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={handleApplySelectionToOtherSlides}
                          title={t('common.editorTransferHint', { count: selectedSlideIds.length })}
                          className="h-7 min-w-0 flex-1 truncate rounded-md bg-blue-600 px-2 text-[11px] font-medium text-white transition hover:bg-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"
                        >
                          {t('common.editorApplyToSelected', { count: otherSelectedCount })}
                        </button>
                        <ToolButton label={t('common.editorApplySameType')} icon={Paintbrush} onClick={handleApplySameTypeStyle} />
                      </div>
                    )}
                  </ScopeSelector>

                  {primarySelected ? (
                    <>
                      {/* Selection header: what is selected + its actions */}
                      <div className="flex h-10 items-center gap-2 border-b border-white/[0.06] pl-3 pr-1.5">
                        {(() => { const Icon = itemTypeIcon; return <Icon className="h-3.5 w-3.5 shrink-0 text-white/45" aria-hidden="true" />; })()}
                        <span className="min-w-0 flex-1 truncate text-xs font-medium text-white/85" title={itemLabel}>{itemLabel}</span>
                        <div className="flex shrink-0 items-center">
                          {selectedIds.size > 1 ? (
                            <>
                              <ToolButton label={t('common.editorGroup')} icon={Group} onClick={handleGroup} />
                              <ToolButton label={t('common.editorUngroup')} icon={Ungroup} disabled={!hasGroupSelected} onClick={handleUngroup} />
                            </>
                          ) : (
                            <>
                              <ToolButton label={t('common.editorBringForward')} descriptionKey="common.editorBringForward" icon={BringToFront} disabled={!canMoveUp} onClick={() => moveItem(primarySelected.id, 'up')} />
                              <ToolButton label={t('common.editorSendBackward')} descriptionKey="common.editorSendBackward" icon={SendToBack} disabled={!canMoveDown} onClick={() => moveItem(primarySelected.id, 'down')} />
                            </>
                          )}
                          <ToolButton
                            label={primarySelected.locked ? t('common.editorUnlock') : t('common.editorLock')}
                            icon={primarySelected.locked ? Lock : Unlock}
                            active={!!primarySelected.locked}
                            pressed={!!primarySelected.locked}
                            onClick={() => toggleItemLock(primarySelected.id)}
                          />
                          <ToolButton label={t('common.editorDuplicate')} icon={Copy} onClick={duplicateSelected} />
                          <ToolButton
                            label={t('common.editorDelete')}
                            icon={Trash2}
                            tone="danger"
                            onClick={() => (selectedIds.size > 1 ? deleteSelected() : deleteItemById(primarySelected.id))}
                          />
                        </div>
                      </div>

                      <Section
                        id="geometry"
                        title={t('common.editorGeometry')}
                        actions={primarySelected.type === 'image' ? (
                          <>
                            <ToolButton
                              label={t('common.editorLockRatio')}
                              icon={ratioLocked ? Link2 : Link2Off}
                              active={ratioLocked}
                              pressed={ratioLocked}
                              disabled={primarySelected.locked}
                              onClick={() => setLockedRatioKeys((prev) => {
                                const next = new Set(prev);
                                if (next.has(ratioKey)) next.delete(ratioKey); else next.add(ratioKey);
                                return next;
                              })}
                            />
                            <ToolButton
                              label={t('common.editorRestoreImageRatio')}
                              icon={RotateCcw}
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
                            />
                          </>
                        ) : undefined}
                      >
                        <div className="grid grid-cols-3 gap-1.5">
                          {(['x', 'y'] as const).map((key) => (
                            <NumberField
                              key={key}
                              label={key.toUpperCase() + ' %'}
                              prefix={key.toUpperCase()}
                              value={Math.round(primarySelected[key])}
                              onChange={(raw) => {
                                const value = parseInt(raw);
                                if (Number.isNaN(value)) return;
                                const max = key === 'x' ? 100 - primarySelected.width : 100 - primarySelected.height;
                                updateItem(primarySelected.id, { [key]: clamp(value, 0, max) });
                              }}
                            />
                          ))}
                          <NumberField
                            label={t('common.editorRotation')}
                            prefix="↻"
                            suffix="°"
                            anchor="editor-rotate"
                            value={primarySelected.rotation || 0}
                            onChange={(raw) => {
                              const value = parseInt(raw || '0', 10);
                              if (!Number.isNaN(value)) updateItem(primarySelected.id, { rotation: value });
                            }}
                          />
                          {(['width', 'height'] as const).map((key) => (
                            <NumberField
                              key={key}
                              label={t(key === 'width' ? 'common.editorWidth' : 'common.editorHeight')}
                              prefix={key === 'width' ? 'W' : 'H'}
                              min={4}
                              max={100}
                              value={Math.round(primarySelected[key])}
                              onChange={(raw) => {
                                const value = parseInt(raw);
                                if (Number.isNaN(value)) return;
                                updateItem(primarySelected.id, (target) =>
                                  target.locked
                                    ? {}
                                    : target.type === 'image'
                                      ? sizeFromCenter(target, key, value, ratioLocked)
                                      : { [key]: clamp(value, 4, 100) }
                                );
                              }}
                            />
                          ))}
                        </div>
                      </Section>

                      {primarySelected.type === 'text' && (
                        <TextStyleEditor
                          item={primarySelected}
                          onChange={(styles) => updateItemStyle(primarySelected.id, { textStyles: styles })}
                          content={
                            <label className="block space-y-1">
                              <span className="sr-only">{t('common.editorContent')}</span>
                              <textarea
                                value={primarySelected.content || ''}
                                onFocus={beginGesture}
                                onBlur={endGesture}
                                onChange={(event) => changeText(primarySelected.id, event.target.value)}
                                rows={3}
                                placeholder={t('common.editorContent')}
                                className="block max-h-[40vh] min-h-[4.5rem] w-full resize-y rounded-md border border-white/[0.08] bg-black/25 px-2 py-1.5 text-xs leading-relaxed text-white/90 outline-none transition hover:border-white/15 focus:border-blue-500/70"
                              />
                              {effectiveScope === 'selected' && multiSlide && (
                                <span className="block text-[11px] text-amber-200/80">
                                  {t('common.editorScopeTextBulk', { count: selectedSlideIds.length })}
                                </span>
                              )}
                            </label>
                          }
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
                          source={
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                disabled={primarySelected.locked}
                                onClick={() => void chooseImageFor(primarySelected.id)}
                                className="inline-flex h-7 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md border border-white/[0.08] bg-white/[0.04] px-2 text-xs text-white/85 transition hover:bg-white/[0.08] disabled:opacity-40"
                              >
                                <ImagePlus className="h-3.5 w-3.5" aria-hidden="true" />
                                <span className="truncate">{t(primarySelected.mediaUrl ? 'common.editorReplaceImage' : 'common.editorSelectImage')}</span>
                              </button>
                              {primarySelected.mediaUrl && (
                                <ToolButton
                                  label={t('common.removeImage')}
                                  icon={X}
                                  disabled={primarySelected.locked}
                                  onClick={() => {
                                    finishInteraction();
                                    updateItem(primarySelected.id, (target) => (target.locked ? {} : replaceImage(target, undefined)));
                                  }}
                                />
                              )}
                            </div>
                          }
                        />
                      )}

                      <Section id="border" title={t('common.editorBorder')} defaultOpen={false}>
                        <div className="grid grid-cols-[1fr_28px_1fr] items-center gap-1.5">
                          <NumberField
                            label={t('common.editorBorder')}
                            prefix="px"
                            min={0}
                            max={20}
                            value={primarySelected.borderWidth || 0}
                            onChange={(raw) => {
                              const value = parseInt(raw);
                              if (!Number.isNaN(value)) updateItem(primarySelected.id, { borderWidth: clamp(value, 0, 20) });
                            }}
                          />
                          <input
                            type="color"
                            aria-label={t('common.editorBorderColor')}
                            title={t('common.editorBorderColor')}
                            value={primarySelected.borderColor || '#ffffff'}
                            onChange={(event) => updateItem(primarySelected.id, { borderColor: event.target.value })}
                            className="h-7 w-7 cursor-pointer rounded-md border border-white/[0.08] bg-black/25 p-1 [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded-sm [&::-webkit-color-swatch]:border-0"
                          />
                          <NumberField
                            label={t('common.editorCornerRadius')}
                            prefix="◜"
                            min={0}
                            max={50}
                            value={primarySelected.borderRadius || 0}
                            onChange={(raw) => {
                              const value = parseInt(raw);
                              if (!Number.isNaN(value)) updateItem(primarySelected.id, { borderRadius: clamp(value, 0, 50) });
                            }}
                          />
                        </div>
                      </Section>

                      <AlignmentTools selectedItems={selectedItems} items={items} onUpdateItems={updateItemsBatch} />
                    </>
                  ) : (
                    <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
                      <MousePointer2 className="h-5 w-5 text-white/25" aria-hidden="true" />
                      <p className="text-xs font-medium text-white/70">{t('common.editorNoSelection')}</p>
                      <p className="text-[11px] leading-relaxed text-white/45">{t('common.editorNoSelectionHint')}</p>
                      <p className="pt-2 text-[11px] leading-relaxed text-white/35">
                        {t('common.editorMultiSelect')} · {t('common.editorRailHint')}
                      </p>
                    </div>
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
