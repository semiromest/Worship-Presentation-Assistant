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
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Slide, SlideItem, TextStyle, ImageStyle } from '../types';
import { cn } from '../utils';
import Dialog from '../components/Dialog';
import {
  normalizeSlideStyles,
  normalizeItems,
  normalizeItem,
  convertSlideToItems,
  createItem,
  updateItemAt,
  deleteItemAt,
  deleteItems,
  duplicateItem,
  duplicateItems,
  swapLayer,
  toggleVisibility,
  toggleLock,
  clamp,
  DEFAULT_TEXT_STYLE,
  DEFAULT_IMAGE_STYLE,
  FONT_PRESETS,
} from './editorUtils';
import { useKeyboardShortcuts } from './keyboardShortcuts';
import { CanvasStage } from './CanvasStage';
import { TextStyleEditor } from './styleEditors/TextStyleEditor';
import { ImageStyleEditor } from './styleEditors/ImageStyleEditor';
import { LayerPanel } from './panels/LayerPanel';
import { SlideSettingsPanel } from './panels/SlideSettingsPanel';
import { AlignmentTools } from './AlignmentTools';
import { SlideTemplates } from './SlideTemplates';
import { ColorPalette } from './ColorPalette';
import { applyTemplate } from './templates';
import { createGroup, ungroupGroup } from './groupUtils';

interface SlideEditorProps {
  slide: Slide;
  onSave: (slide: Slide) => void;
  onClose: () => void;
}

type Tool = 'select' | 'layers' | 'settings';
type SlideStyles = NonNullable<Slide['styles']>;

const PanelShell = memo(function PanelShell({
  title,
  icon: Icon,
  children,
  className,
}: {
  title: string;
  icon: ComponentType<{ className?: string }>;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'space-y-3 rounded-2xl border border-white/10 bg-[#1a1a1a] p-4 shadow-sm',
        className,
      )}
    >
      <div className="flex items-center gap-2 text-sm font-semibold text-white/80">
        <Icon className="h-4 w-4" />
        <span>{title}</span>
      </div>
      {children}
    </div>
  );
});

export default function SlideEditor({ slide, onSave, onClose }: SlideEditorProps) {
  const { t } = useTranslation();
  const [items, setItems] = useState<SlideItem[]>(() => convertSlideToItems(slide));
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [tool, setTool] = useState<Tool>('select');
  const [slideStyles, setSlideStyles] = useState<Record<string, unknown>>(() =>
    normalizeSlideStyles(slide.styles as Record<string, unknown>),
  );
  const [showTemplates, setShowTemplates] = useState(false);
  const [clipboard, setClipboard] = useState<SlideItem[]>([]);

  // Grid and snap state
  const [gridEnabled, setGridEnabled] = useState(slide.gridEnabled ?? false);
  const [gridSize, setGridSize] = useState(slide.gridSize ?? 10);
  const [gridColor, setGridColor] = useState(slide.gridColor ?? 'rgba(255,255,255,0.06)');
  const [snapEnabled, setSnapEnabled] = useState(slide.snapEnabled ?? false);

  const canvasRef = useRef<HTMLDivElement | null>(null);

  const selectedItems = useMemo(
    () => items.filter(item => selectedIds.has(item.id)),
    [items, selectedIds],
  );

  const primarySelected = useMemo(
    () => selectedItems[selectedItems.length - 1] ?? null,
    [selectedItems],
  );

  // ── Slide reset on external change ──
  useEffect(() => {
    setItems(convertSlideToItems(slide));
    setSelectedIds(new Set());
    setSlideStyles(normalizeSlideStyles(slide.styles as Record<string, unknown>));
    setGridEnabled(slide.gridEnabled ?? false);
    setGridSize(slide.gridSize ?? 10);
    setGridColor(slide.gridColor ?? 'rgba(255,255,255,0.06)');
    setSnapEnabled(slide.snapEnabled ?? false);
  }, [slide.id]);

  // ── Callbacks ──

  const updateSlideStyles = useCallback(
    (updates: Record<string, unknown>) =>
      setSlideStyles(prev => normalizeSlideStyles({ ...prev, ...updates })),
    [],
  );

  const updateItem = useCallback(
    (id: string, updates: Partial<SlideItem>) => {
      setItems(prev => updateItemAt(prev, id, updates));
    },
    [],
  );

  const updateItemsBatch = useCallback(
    (updatedItems: SlideItem[]) => setItems(updatedItems),
    [],
  );

  const handleDrag = useCallback(
    (id: string, x: number, y: number) => {
      setItems(prev =>
        prev.map(item => (item.id === id ? { ...item, x, y } : item)),
      );
    },
    [],
  );

  const handleDragEnd = useCallback(
    (id: string) => {
      // Normalize after drag completes
      setItems(prev => normalizeItems(prev));
    },
    [],
  );

  const handleResize = useCallback(
    (id: string, width: number, height: number) => {
      setItems(prev =>
        prev.map(item =>
          item.id === id
            ? normalizeItem({ ...item, width, height })
            : item,
        ),
      );
    },
    [],
  );

  const handleRotate = useCallback(
    (id: string, rotation: number) => {
      setItems(prev =>
        prev.map(item =>
          item.id === id ? { ...item, rotation } : item,
        ),
      );
    },
    [],
  );

  const handleSelect = useCallback(
    (id: string | null, multi?: boolean) => {
      if (id === null) {
        setSelectedIds(new Set());
        return;
      }
      if (multi) {
        setSelectedIds(prev => {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        });
      } else {
        setSelectedIds(new Set([id]));
      }
    },
    [],
  );

  const handleSelectMany = useCallback((ids: Set<string>) => {
    setSelectedIds(ids);
  }, []);

  const addItem = useCallback(
    (type: 'text' | 'image') => {
      setItems(prev => {
        const newItem = createItem(type, prev, type === 'text' ? t('common.editorNewText') : undefined);
        const next = normalizeItems([...prev, newItem]);
        const created = next[next.length - 1];
        setSelectedIds(new Set([created.id]));
        setTool('select');
        return next;
      });
    },
    [],
  );

  const deleteSelected = useCallback(() => {
    if (selectedIds.size === 0) return;
    setItems(prev => deleteItems(prev, selectedIds));
    setSelectedIds(new Set());
  }, [selectedIds]);

  const deleteItem = useCallback(
    (id: string) => {
      setItems(prev => deleteItemAt(prev, id));
      setSelectedIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    },
    [],
  );

  const duplicateSelected = useCallback(() => {
    if (selectedIds.size === 0) return;
    setItems(prev => {
      const next = duplicateItems(prev, selectedIds);
      const newIds = new Set(
        next.filter(
          i => !prev.some(p => p.id === i.id),
        ).map(i => i.id),
      );
      setSelectedIds(newIds);
      return next;
    });
  }, [selectedIds]);

  const duplicateItemById = useCallback((id: string) => {
    setItems(prev => {
      const next = duplicateItem(prev, id);
      const created = next[next.length - 1];
      setSelectedIds(new Set([created.id]));
      return next;
    });
  }, []);

  const moveItem = useCallback(
    (id: string, direction: 'up' | 'down') =>
      setItems(prev => swapLayer(prev, id, direction)),
    [],
  );

  const toggleItemVisibility = useCallback(
    (id: string) => setItems(prev => toggleVisibility(prev, id)),
    [],
  );

  const toggleItemLock = useCallback(
    (id: string) => setItems(prev => toggleLock(prev, id)),
    [],
  );

  // ── Group/Ungroup ──

  const handleGroup = useCallback(() => {
    if (selectedIds.size < 2) return;
    setItems(prev => {
      const next = createGroup(prev, selectedIds);
      const groupId = next.find(
        n => !prev.some(p => p.id === n.id),
      )?.id;
      if (groupId) setSelectedIds(new Set([groupId]));
      return next;
    });
  }, [selectedIds]);

  const handleUngroup = useCallback(() => {
    const groupItems = items.filter(
      i => selectedIds.has(i.id) && i.type === 'group',
    );
    if (groupItems.length === 0) return;
    setItems(prev => {
      let result = prev;
      for (const g of groupItems) {
        result = ungroupGroup(result, g.id);
      }
      return result;
    });
    setSelectedIds(new Set());
  }, [items, selectedIds]);

  // ── Copy/Paste ──

  const handleCopy = useCallback(() => {
    if (selectedItems.length === 0) return;
    setClipboard(selectedItems.map(item => ({ ...item })));
  }, [selectedItems]);

  const handlePaste = useCallback(() => {
    if (clipboard.length === 0) return;
    setItems(prev => {
      const newItems = clipboard.map(source =>
        normalizeItem({
          ...source,
          id: `item-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          x: clamp(source.x + 2, 0, 100 - source.width),
          y: clamp(source.y + 2, 0, 100 - source.height),
          zIndex: prev.length + Math.random(),
        }),
      );
      const result = normalizeItems([...prev, ...newItems]);
      setSelectedIds(new Set(newItems.map(i => i.id)));
      return result;
    });
  }, [clipboard]);

  // ── Select all ──

  const handleSelectAll = useCallback(() => {
    setSelectedIds(new Set(items.map(i => i.id)));
  }, [items]);

  // ── Template ──

  const handleTemplateSelect = useCallback(
    (templateId: string) => {
      const templateItems = applyTemplate(templateId);
      if (templateItems.length === 0) return;
      setItems(prev => {
        const result = normalizeItems([...prev, ...templateItems]);
        setSelectedIds(new Set(templateItems.map(i => i.id)));
        return result;
      });
      setShowTemplates(false);
    },
    [],
  );

  // ── Save ──

  const handleSave = useCallback(() => {
    const normalized = normalizeItems(items);

    let savedSlide = {
      ...slide,
      items: normalized,
      styles: slideStyles as SlideStyles,
      gridEnabled,
      gridSize,
      gridColor,
      snapEnabled,
    };

    if (slide.type === 'text') {
      const primaryText = normalized.find(item => item.type === 'text');
      if (primaryText) {
        const ts = primaryText.textStyles;
        const baseStyles = slideStyles as Record<string, unknown>;
        savedSlide = {
          ...savedSlide,
          content: primaryText.content ?? slide.content,
          styles: {
            ...(baseStyles as SlideStyles),
            ...(ts && {
              fontSize: ts.fontSize,
              textColor: ts.textColor,
              ...(ts.fontFamily && { fontFamily: ts.fontFamily }),
              ...(ts.fontWeight && { fontWeight: ts.fontWeight }),
              ...(ts.fontStyle && { fontStyle: ts.fontStyle }),
              ...(ts.lineHeight && { lineHeight: ts.lineHeight }),
              ...(ts.letterSpacing != null && { letterSpacing: ts.letterSpacing }),
              ...(ts.textDecoration && { textDecoration: ts.textDecoration }),
              ...(ts.textAlign && { textAlign: ts.textAlign }),
              ...(ts.verticalAlign && { verticalAlign: ts.verticalAlign }),
            }),
          },
        };
      }
    }

    setTimeout(() => {
      onSave(savedSlide);
      onClose();
    }, 10);
  }, [items, onClose, onSave, slide, slideStyles, gridEnabled, gridSize, gridColor, snapEnabled]);

  useKeyboardShortcuts({
    selectedIds,
    setSelectedIds,
    onDeleteSelected: deleteSelected,
    onDuplicateSelected: duplicateSelected,
    onSelectAll: handleSelectAll,
    onGroup: handleGroup,
    onUngroup: handleUngroup,
    onCopy: handleCopy,
    onPaste: handlePaste,
  });

  // ── Derived state ──

  const selectedIndex = useMemo(
    () =>
      primarySelected
        ? items.findIndex(item => item.id === primarySelected.id)
        : -1,
    [items, primarySelected],
  );
  const canMoveUp = selectedIndex >= 0 && selectedIndex < items.length - 1;
  const canMoveDown = selectedIndex > 0;

  // ── Render ──

  return (
    <Dialog
      open
      onClose={onClose}
      labelledBy="slide-editor-title"
      overlayClassName="fixed inset-0 z-50 flex bg-black/90"
      className="flex h-full w-full max-w-none flex-col overflow-hidden bg-surface-base rounded-none border-0"
      closeOnOverlayClick={false}
    >
        {/* Header */}
        <header className="flex h-14 items-center justify-between border-b border-white/10 bg-surface-raised px-4">
          <div className="flex min-w-0 items-center gap-4">
            <div>
              <h2 id="slide-editor-title" className="text-lg font-semibold text-blue-400">{t('common.editorTitle')}</h2>
              <div className="text-xs text-white/40">
                {t('common.editorHeaderInfo', { count: items.length })}
                {selectedIds.size > 1 && ` · ${selectedIds.size} ${t('common.selected')}`}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => addItem('text')}
              className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/80 transition hover:bg-white/10"
            >
              <Type className="h-4 w-4" />
              {t('common.editorText')}
            </button>

            <button
              type="button"
              onClick={() => addItem('image')}
              className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/80 transition hover:bg-white/10"
            >
              <Image className="h-4 w-4" />
              {t('common.editorImage')}
            </button>

            <div className="relative">
              <button
                type="button"
                onClick={() => setShowTemplates(!showTemplates)}
                className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/80 transition hover:bg-white/10"
              >
                <LayoutTemplate className="h-4 w-4" />
                {t('common.editorTemplates')}
              </button>
              {showTemplates && (
                <div className="absolute right-0 top-full mt-2 w-72 rounded-2xl border border-white/10 bg-[#1a1a1a] shadow-2xl z-50 p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-white/80">{t('common.editorTemplateTitle')}</span>
                    <button
                      type="button"
                      onClick={() => setShowTemplates(false)}
                      className="text-white/40 hover:text-white"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                  <SlideTemplates onSelect={handleTemplateSelect} />
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={onClose}
              aria-label={t('common.close')}
              className="rounded-xl p-2 text-white/60 transition hover:bg-white/5 hover:text-white focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
        </header>

        {/* Body */}
        <div className="flex min-h-0 flex-1 overflow-hidden">
          {/* Left sidebar */}
          <aside className="w-72 shrink-0 overflow-y-auto border-r border-white/10 bg-[#181818] p-3">
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  { icon: Move, label: t('common.editorSelect'), value: 'select' },
                  { icon: Layers, label: t('common.editorLayer'), value: 'layers' },
                  { icon: Palette, label: t('common.editorSettings'), value: 'settings' },
                ] as const
              ).map(({ icon: Icon, label, value }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setTool(value)}
                  className={cn(
                    'flex flex-col items-center gap-1 rounded-xl border px-3 py-3 transition',
                    tool === value
                      ? 'border-blue-500/50 bg-blue-600/25 text-blue-200'
                      : 'border-white/10 bg-black/20 text-white/60 hover:bg-black/30',
                  )}
                >
                  <Icon className="h-4 w-4" />
                  <span className="text-[10px]">{label}</span>
                </button>
              ))}
            </div>

            <div className="mt-3 space-y-3">
              {tool === 'layers' && (
                <LayerPanel
                  items={items}
                  selectedIds={selectedIds}
                  onSelect={id => setSelectedIds(new Set([id]))}
                  onMove={moveItem}
                  onDelete={deleteItem}
                  onToggleVisibility={toggleItemVisibility}
                  onDuplicate={duplicateItemById}
                  onToggleLock={toggleItemLock}
                />
              )}

              {tool === 'settings' && (
                <SlideSettingsPanel
                  styles={slideStyles}
                  onChange={updateSlideStyles}
                  gridEnabled={gridEnabled}
                  gridSize={gridSize}
                  gridColor={gridColor}
                  snapEnabled={snapEnabled}
                  onGridToggle={setGridEnabled}
                  onGridSizeChange={setGridSize}
                  onGridColorChange={setGridColor}
                  onSnapToggle={setSnapEnabled}
                />
              )}

              {tool === 'select' && (
                <>
                  {primarySelected ? (
                    <PanelShell title={t('common.editorSelectedItem')} icon={Palette}>
                      <div className="grid grid-cols-2 gap-3">
                        <label className="space-y-1">
                          <span className="text-[10px] uppercase tracking-wide text-white/40">
                            X %
                          </span>
                          <input
                            type="number"
                            value={Math.round(primarySelected.x)}
                            onChange={e => {
                              const v = parseInt(e.target.value);
                              if (!Number.isNaN(v))
                                updateItem(primarySelected.id, {
                                  x: clamp(v, 0, 100 - primarySelected.width),
                                });
                            }}
                            className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs outline-none transition focus:border-blue-500"
                          />
                        </label>
                        <label className="space-y-1">
                          <span className="text-[10px] uppercase tracking-wide text-white/40">
                            Y %
                          </span>
                          <input
                            type="number"
                            value={Math.round(primarySelected.y)}
                            onChange={e => {
                              const v = parseInt(e.target.value);
                              if (!Number.isNaN(v))
                                updateItem(primarySelected.id, {
                                  y: clamp(v, 0, 100 - primarySelected.height),
                                });
                            }}
                            className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs outline-none transition focus:border-blue-500"
                          />
                        </label>
                        <label className="space-y-1">
                          <span className="text-[10px] uppercase tracking-wide text-white/40">
                            {t('common.editorWidth')}
                          </span>
                          <input
                            type="number"
                            min={4}
                            max={100}
                            value={Math.round(primarySelected.width)}
                            onChange={e => {
                              const v = parseInt(e.target.value);
                              if (!Number.isNaN(v))
                                updateItem(primarySelected.id, {
                                  width: clamp(v, 4, 100),
                                });
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
                            onChange={e => {
                              const v = parseInt(e.target.value);
                              if (!Number.isNaN(v))
                                updateItem(primarySelected.id, {
                                  height: clamp(v, 4, 100),
                                });
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
                            onChange={e => {
                              const v = parseInt(e.target.value || '0', 10);
                              if (!Number.isNaN(v))
                                updateItem(primarySelected.id, { rotation: v });
                            }}
                            className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs outline-none transition focus:border-blue-500"
                          />
                        </label>
                      </div>

                      {/* Border controls */}
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
                            onChange={e => {
                              const v = parseInt(e.target.value);
                              if (!Number.isNaN(v))
                                updateItem(primarySelected.id, {
                                  borderWidth: clamp(v, 0, 20),
                                });
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
                            onChange={e =>
                              updateItem(primarySelected.id, {
                                borderColor: e.target.value,
                              })
                            }
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
                            onChange={e => {
                              const v = parseInt(e.target.value);
                              if (!Number.isNaN(v))
                                updateItem(primarySelected.id, {
                                  borderRadius: clamp(v, 0, 50),
                                });
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
                    </PanelShell>
                  ) : (
                    <PanelShell title={t('common.editorNoSelection')} icon={Palette}>
                      <div className="text-sm text-white/55">
                        {t('common.editorNoSelectionHint')}
                      </div>
                    </PanelShell>
                  )}

                  {/* Alignment tools */}
                  {selectedItems.length > 1 && (
                    <AlignmentTools
                      selectedItems={selectedItems}
                      items={items}
                      onUpdateItems={updateItemsBatch}
                    />
                  )}

                  {/* Multi-select actions */}
                  {selectedIds.size > 1 && (
                    <PanelShell title={t('common.editorMultiSelection')} icon={Copy}>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={handleGroup}
                          className="flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white/70 transition hover:bg-black/30"
                        >
                          <Group className="h-4 w-4" /> {t('common.editorGroup')}
                        </button>
                        <button
                          type="button"
                          onClick={handleUngroup}
                          className="flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white/70 transition hover:bg-black/30"
                        >
                          <Ungroup className="h-4 w-4" /> {t('common.editorUngroup')}
                        </button>
                      </div>
                    </PanelShell>
                  )}
                </>
              )}
            </div>
          </aside>

          {/* Canvas */}
          <CanvasStage
            slideStyles={slideStyles}
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
          />

          {/* Right sidebar */}
          <aside className="w-80 shrink-0 overflow-y-auto border-l border-white/10 bg-[#181818] p-3">
            {primarySelected ? (
              <div className="space-y-3">
                <PanelShell title={t('common.editorSelectedItemProperties')} icon={Palette}>
                  {primarySelected.type === 'text' ? (
                    <label className="block space-y-1">
                      <span className="block text-[10px] uppercase tracking-wide text-white/40">
                        {t('common.editorContent')}
                      </span>
                      <textarea
                        value={primarySelected.content || ''}
                        onChange={e =>
                          updateItem(primarySelected.id, {
                            content: e.target.value,
                          })
                        }
                        className="min-h-[7rem] max-h-32 w-full resize-y rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-xs outline-none transition focus:border-blue-500"
                      />
                    </label>
                  ) : (
                    <div className="space-y-3">
                      <button
                        type="button"
                        onClick={async () => {
                          const file = await (window as unknown as {
                            electronAPI?: {
                              selectMediaFile?: (
                                type: string,
                              ) => Promise<string | null>;
                            };
                          }).electronAPI?.selectMediaFile?.('image');
                          if (!file) return;
                          updateItem(primarySelected.id, {
                            mediaUrl: `file://${file.replace(/\\/g, '/')}`,
                          });
                        }}
                        className="w-full rounded-xl bg-blue-600 px-4 py-3 text-sm font-medium text-white transition hover:bg-blue-500"
                      >
                        {t('common.editorSelectImage')}
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          updateItem(primarySelected.id, { mediaUrl: undefined })
                        }
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
                    onChange={styles =>
                      updateItem(primarySelected.id, { textStyles: styles })
                    }
                  />
                )}

                {primarySelected.type === 'image' && (
                  <ImageStyleEditor
                    item={primarySelected}
                    onChange={styles =>
                      updateItem(primarySelected.id, { imageStyles: styles })
                    }
                  />
                )}

                <PanelShell title={t('common.editorItemOperations')} icon={RotateCw}>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => deleteItem(primarySelected.id)}
                      className="inline-flex items-center justify-center gap-2 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-300 transition hover:bg-red-500/15"
                    >
                      <Trash2 className="h-4 w-4" /> {t('common.editorDelete')}
                    </button>

                    <button
                      type="button"
                      onClick={() => toggleItemLock(primarySelected.id)}
                      className={cn(
                        'inline-flex items-center justify-center gap-2 rounded-xl border px-3 py-2 text-sm transition',
                        primarySelected.locked
                          ? 'border-yellow-500/20 bg-yellow-500/10 text-yellow-300'
                          : 'border-white/10 bg-black/20 text-white/70 hover:bg-black/30',
                      )}
                    >
                      {primarySelected.locked ? (
                        <Lock className="h-4 w-4" />
                      ) : (
                        <Unlock className="h-4 w-4" />
                      )}
                      {primarySelected.locked ? t('common.editorUnlock') : t('common.editorLock')}
                    </button>

                    <button
                      type="button"
                      onClick={duplicateSelected}
                      className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white/70 transition hover:bg-black/30"
                    >
                      <Copy className="h-4 w-4" /> {t('common.editorDuplicate')}
                    </button>

                    <button
                      type="button"
                      onClick={() => setSelectedIds(new Set())}
                      className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white/70 transition hover:bg-black/30"
                    >
                      {t('common.editorClearSelection')}
                    </button>
                  </div>
                </PanelShell>
              </div>
            ) : (
              <SlideSettingsPanel
                styles={slideStyles}
                onChange={updateSlideStyles}
                gridEnabled={gridEnabled}
                gridSize={gridSize}
                gridColor={gridColor}
                snapEnabled={snapEnabled}
                onGridToggle={setGridEnabled}
                onGridSizeChange={setGridSize}
                onGridColorChange={setGridColor}
                onSnapToggle={setSnapEnabled}
              />
            )}
          </aside>
        </div>

        {/* Footer */}
        <footer className="flex h-14 items-center justify-between border-t border-white/10 bg-[#1e1e1e] px-4">
          <div className="flex items-center gap-4 text-xs text-white/40">
            <span>{t('common.editorDragHint')}</span>
            <span>·</span>
            <span>{t('common.editorMultiSelect')}</span>
            <span>·</span>
            <span>{t('common.editorZoomHint')}</span>
            <span>·</span>
            <span>{t('common.editorPanHint')}</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/80 transition hover:bg-white/10"
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="inline-flex items-center gap-2 rounded-xl bg-green-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-green-500"
            >
              <Save className="h-4 w-4" />
              {t('common.save')}
            </button>
          </div>
        </footer>
    </Dialog>
  );
}
