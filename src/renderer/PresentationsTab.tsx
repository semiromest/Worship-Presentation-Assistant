import { useListMotion } from './hooks/useListMotion';
import { Menu } from '@base-ui/react/menu';
import './PresentationsHeader.css';
import { useCallback, useMemo, useState, memo, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import * as m from 'motion/react-m';
import {
  Layers,
  Trash2,
  Search,
  X,
  Save,
  FolderOpen,
  HardDrive,
  LayoutGrid,
  Clock,
  FileUp,
  Loader2,
  AlertCircle,
  Timer,
  Pencil,
  Cloud,
  Plus,
  ChevronDown,
  DatabaseBackup,
  ShieldCheck,
  FileDown,
} from 'lucide-react';
import { AnimatedPreview } from './AnimatedPreview';
import { cn } from './utils';
import { type PptxImportResult } from './utils';
import type { PptxImportMode } from '../shared/fileOpen';
import { choiceDialog } from './choiceDialogState';
import type { Presentation, Preset, Slide } from './types';
import type { PlayingSFX } from 'uisfx';
import { playSfx, stopSfx } from './sfx';
import { confirmDialog } from './dialogs';
import { useStore } from './state/useStore';
import { isLiveSavePreset, getLiveSaveRetention } from './hooks/useLiveSave';
import DrivePanel from './components/DrivePanel';
import Dialog from './components/Dialog';
import { presentationContentKey } from './presentationLibrary';

// ─── Shared action/styles (page-scoped) ────────────────────────────────────
// All actions use the same secondary outline style for a quiet, uniform look;
// wider variants add extra horizontal padding for emphasis.
const BTN_BASE =
  'inline-flex items-center gap-2 min-h-9 rounded-lg text-sm font-medium transition-all active:scale-[0.98] shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 disabled:opacity-50 disabled:pointer-events-none';
const BTN_SECONDARY_WIDE = `${BTN_BASE} workspace-secondary-action px-6`;

type SortOrder = 'newest' | 'oldest' | 'name';

// ─── LazyAnimatedPreview ─────────────────────────────────────────────────────
// Defined at module level so it's not recreated on every PresetCard render,
// which was breaking memo() optimization and causing unnecessary re-mounts.
const LazyAnimatedPreview = memo(function LazyAnimatedPreview({ slide }: { slide: Slide | undefined }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            setVisible(e.isIntersecting);
          }
        },
        { rootMargin: '200px' }
      );
      io.observe(el);
      return () => io.disconnect();
    }
    setVisible(true);
  }, []);

  return (
    <div ref={ref} className="w-full h-full">
      {visible && slide ? (
        <AnimatedPreview slide={slide} transitionType="none" duration={0} size="preview" volume={0} muted isActive={false} />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center text-white/10">
          <Layers className="w-10 h-10" aria-hidden="true" />
        </div>
      )}
    </div>
  );
});

export interface PresentationsTabProps {
  presentation: Presentation;
  presets: Preset[];
  selectedPresetName: string | null;
  onPresetsChange: (presets: Preset[]) => void;
  onApplyPreset: (preset: Preset) => void;
  onSelectedPresetNameChange: (name: string | null) => void;
  onOpenFile?: () => void | Promise<void>;
  onSaveFile?: () => void;
  onImportPptx?: (filePath: string, mode: PptxImportMode) => Promise<PptxImportResult | null>;
  onImportWarnings?: (warnings: string[]) => void;
  onImportingChange?: (importing: boolean) => void;
  onNewPresentation?: () => void;
}

interface PresetCardProps {
  preset: Preset;
  isActive: boolean;
  onApply: (preset: Preset) => void;
  onDelete: (name: string) => void;
  onRename: (oldName: string, newName: string) => void;
}

const PresetCard = memo(function PresetCard({ preset, isActive, onApply, onDelete, onRename }: PresetCardProps) {
  const { t, i18n } = useTranslation();
  const [isEditing, setIsEditing] = useState(false);
  const [draftName, setDraftName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const firstSlide = preset.presentation.slides[0];
  const isLiveSave = isLiveSavePreset(preset.name);

  const startRename = () => {
    setDraftName(preset.name);
    setIsEditing(true);
    requestAnimationFrame(() => inputRef.current?.select());
  };

  const openPreset = () => onApply(preset);

  return (
    <m.article
      data-motion-item="preset"
      data-motion-id={preset.name}
      initial={false}
      aria-label={`${t('common.openPreset')}: ${preset.name}`}
      className={cn(
        'group relative rounded-2xl border overflow-hidden transition-colors duration-[var(--ui-motion-fast,120ms)] focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none',
        isLiveSave
          ? 'border-emerald-500/35 bg-emerald-500/[0.05] shadow-lg shadow-emerald-500/10 ring-1 ring-emerald-500/20'
          : isActive
            ? 'border-blue-500/50 bg-blue-500/[0.06] shadow-lg shadow-blue-500/10 ring-1 ring-blue-500/30'
            : 'border-white/5 bg-white/[0.03] hover:border-blue-500/25 hover:bg-white/[0.05]'
      )}
    >
      <div className="relative aspect-video bg-black overflow-hidden pointer-events-none">
        {firstSlide ? (
          <LazyAnimatedPreview slide={firstSlide} />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-white/20">
            <Layers className="w-10 h-10" aria-hidden="true" />
          </div>
        )}

        {isActive && (
          <div className="absolute top-2 left-2">
            <span className="px-2 py-1 rounded-lg bg-blue-600/90 text-[10px] font-semibold uppercase tracking-wide">
              {t('common.active')}
            </span>
          </div>
        )}

        <div className="absolute inset-0 bg-gradient-to-t from-[#0f1115] via-transparent to-transparent opacity-60" />
      </div>

      <div className="p-3 space-y-1.5">
        <div className="flex items-center gap-2">
          {isEditing ? (
            <div className="flex-1 min-w-0" onClick={(e) => e.stopPropagation()}>
              <input
                ref={inputRef}
                type="text"
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                onBlur={() => {
                  const trimmed = draftName.trim();
                  if (trimmed && trimmed !== preset.name) {
                    onRename(preset.name, trimmed);
                  }
                  setIsEditing(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                  if (e.key === 'Escape') setIsEditing(false);
                }}
                aria-label={t('common.presetName')}
                className="w-full font-semibold text-sm bg-transparent border-b border-blue-400/50 outline-none text-white"
              />
            </div>
          ) : (
            <>
              <h3 className={cn(
                'flex-1 font-semibold text-sm truncate transition-colors',
                isLiveSave ? 'group-hover:text-emerald-300 text-emerald-100' : 'group-hover:text-blue-300 text-white'
              )}>
                {isLiveSave ? `${t('common.liveSaveBadge')} - ${preset.presentation.name}` : preset.name}
              </h3>
              {isLiveSave && (
                <span
                  className="w-2 h-2 rounded-full bg-emerald-400 shrink-0"
                  aria-hidden="true"
                  title={t('common.liveSaveBadge')}
                />
              )}
            </>
          )}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              startRename();
            }}
            title={t('common.rename')}
            aria-label={t('common.rename')}
            className="opacity-75 group-hover:opacity-100 focus-visible:opacity-100 transition-all w-8 h-8 rounded-lg hover:bg-white/10 text-white/65 hover:text-white flex items-center justify-center shrink-0"
          >
            <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-white/65">
          <span className="flex items-center gap-1">
            <LayoutGrid className="w-3 h-3" />
            {t('library.slideCount', { count: preset.presentation.slides.length })}
          </span>
          <span className="flex items-center gap-1 min-w-0 truncate">
            <Clock className="w-3 h-3 shrink-0" />
            {new Date(preset.createdAt).toLocaleString(i18n.language, {
              day: 'numeric',
              month: 'short',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </span>
        </div>
      </div>

      <div className="px-3 pb-3 flex gap-2">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            openPreset();
          }}
          className="workspace-secondary-action flex-1 font-medium transition-colors"
        >
          {t('common.openPreset')}
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(preset.name);
          }}
          title={t('common.deletePreset')}
          aria-label={t('common.deletePreset')}
          className="w-8 h-8 self-center rounded-lg opacity-75 group-hover:opacity-100 focus-visible:opacity-100 hover:bg-red-500/15 hover:text-red-300 text-red-400/80 flex items-center justify-center transition-colors"
        >
          <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      </div>
    </m.article>
  );
});

interface EmptyLibraryProps {
  onSave: () => void;
}
const EmptyLibrary = ({ onSave }: EmptyLibraryProps) => {
  const { t } = useTranslation();
  return (
    <div className="h-full min-h-[300px] flex items-center justify-center">
      <div className="rounded-3xl border border-dashed border-white/10 bg-white/[0.02] p-12 text-center max-w-md">
        <div className="w-16 h-16 mx-auto rounded-3xl bg-blue-500/10 border border-blue-500/10 flex items-center justify-center mb-4">
          <Layers className="w-8 h-8 text-blue-400/60" aria-hidden="true" />
        </div>
        <h2 className="font-medium text-white/80">{t('common.noSavedPresets')}</h2>
        <p className="text-sm text-white/35 mt-2 leading-relaxed">{t('common.noSavedPresetsDesc')}</p>
        <button type="button" onClick={onSave} className={`${BTN_SECONDARY_WIDE} mt-6`}>
          <Save className="w-4 h-4" aria-hidden="true" />
          {t('common.savePreset')}
        </button>
      </div>
    </div>
  );
};

interface EmptySearchProps {
  onClear: () => void;
}
const EmptySearch = memo(function EmptySearch({ onClear }: EmptySearchProps) {
  const { t } = useTranslation();
  return (
    <div className="rounded-3xl border border-dashed border-white/10 bg-white/[0.02] p-10 text-center">
      <p className="text-white/50">{t('common.noSearchResults')}</p>
      <button type="button" onClick={onClear} className="mt-3 text-sm text-blue-400 hover:text-blue-300">
        {t('common.clearSearch')}
      </button>
    </div>
  );
});

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  return `${minutes}d ${remainingSeconds}s`;
}

export default function PresentationsTab({
  presentation,
  presets,
  selectedPresetName,
  onPresetsChange,
  onApplyPreset,
  onSelectedPresetNameChange,
  onOpenFile,
  onSaveFile,
  onImportPptx,
  onImportWarnings,
  onImportingChange,
  onNewPresentation,
}: PresentationsTabProps) {
  const { t, i18n } = useTranslation();
  const setPresentationName = useStore((s) => s.setPresentationName);
  const setDrivePanelOpen = useStore((s) => s.setDrivePanelOpen);
  const drivePanelOpen = useStore((s) => s.drivePanelOpen);
  const driveButtonRef = useRef<HTMLButtonElement>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortOrder, setSortOrder] = useState<SortOrder>('newest');
  const [isAutosaveOpen, setIsAutosaveOpen] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState({ current: 0, total: 0 });
  const [importWarnings, setImportWarnings] = useState<string[]>([]);
  const [importCount, setImportCount] = useState(0);
  const [importError, setImportError] = useState<string | null>(null);
  const [importDuration, setImportDuration] = useState<number | null>(null);
  const importStartTimeRef = useRef<number>(0);
  const importLoopRef = useRef<PlayingSFX | null>(null);

  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState({ current: 0, total: 0 });
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportResult, setExportResult] = useState<{
    filePath: string;
    slideCount: number;
    warnings: string[];
  } | null>(null);
  const [exportDuration, setExportDuration] = useState<number | null>(null);
  const exportStartTimeRef = useRef<number>(0);
  const exportLoopRef = useRef<PlayingSFX | null>(null);

  const [isEditingName, setIsEditingName] = useState(false);
  const [draftName, setDraftName] = useState('');
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail && onApplyPreset) {
        onApplyPreset({ name: detail.name ?? 'Drive Sunumu', presentation: detail, createdAt: Date.now() });
      }
    };
    window.addEventListener('drive-open-presentation', handler);
    return () => window.removeEventListener('drive-open-presentation', handler);
  }, [onApplyPreset]);

  const [isSaving, setIsSaving] = useState(false);
  const operationRef = useRef(false);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [isOpening, setIsOpening] = useState(false);
  const openingRef = useRef(false);
  const handleOpenFile = async () => {
    if (openingRef.current || !onOpenFile) return;
    openingRef.current = true; setIsOpening(true); setOperationError(null);
    try { await onOpenFile(); }
    catch (error) { setOperationError(error instanceof Error ? error.message : t('desktop.openFailed')); }
    finally { openingRef.current = false; setIsOpening(false); }
  };
  const [savedSnapshot, setSavedSnapshot] = useState<Presentation | null>(null);
  const liveSaveEnabled = useStore((s) => s.liveSaveEnabled);
  const liveSaveLastSaved = useStore((s) => s.liveSaveLastSaved);
  const visiblePresets = useMemo(() => presets.filter((p) => !isLiveSavePreset(p.name)), [presets]);
  const currentSavedPreset = visiblePresets.find((p) => p.name === selectedPresetName);
  const currentKey = useMemo(() => presentationContentKey(presentation), [presentation]);
  const savedKey = useMemo(() => {
    const snapshot = savedSnapshot ?? (currentSavedPreset && {
      ...currentSavedPreset.presentation, name: currentSavedPreset.name,
    });
    return snapshot ? presentationContentKey(snapshot) : null;
  }, [savedSnapshot, currentSavedPreset]);
  const saved = currentKey === savedKey;


  useEffect(() => {
    if (!window.electronAPI?.onPptxImportProgress) return;

    let lastEmit = 0;
    const THROTTLE_MS = 100;
    const unsubscribe = window.electronAPI.onPptxImportProgress((data) => {
      const now = Date.now();
      if (now - lastEmit >= THROTTLE_MS) {
        lastEmit = now;
        setImportProgress({ current: data.current, total: data.total });
      }
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!window.electronAPI?.onPptxExportProgress) return;

    let lastEmit = 0;
    const THROTTLE_MS = 100;
    const unsubscribe = window.electronAPI.onPptxExportProgress((data) => {
      const now = Date.now();
      if (now - lastEmit >= THROTTLE_MS) {
        lastEmit = now;
        setExportProgress({ current: data.current, total: data.total });
      }
    });

    return () => unsubscribe();
  }, []);

  // Stop any running import/export sound loops if this tab unmounts mid-task.
  useEffect(() => {
    return () => {
      stopSfx(importLoopRef.current);
      stopSfx(exportLoopRef.current);
    };
  }, []);

  const liveSavePresets = useMemo(
    () => [...presets].filter((p) => isLiveSavePreset(p.name)).sort((a, b) => b.createdAt - a.createdAt),
    [presets]
  );

  const filteredPresets = useMemo(() => {
    const visible = visiblePresets;
    const q = searchQuery.trim().toLowerCase();
    return q ? visible.filter((p) => p.name.toLowerCase().includes(q)) : visible;
  }, [visiblePresets, searchQuery]);

  const sortedPresets = useMemo(() => {
    const arr = [...filteredPresets];
    if (sortOrder === 'name') {
      return arr.sort((a, b) => a.name.localeCompare(b.name, i18n.language));
    }
    return arr.sort((a, b) => (sortOrder === 'oldest' ? a.createdAt - b.createdAt : b.createdAt - a.createdAt));
  }, [filteredPresets, sortOrder, i18n.language]);

  const motionRoot = useRef<HTMLDivElement>(null);
  useListMotion(motionRoot, sortedPresets.map(preset => preset.name), 'library', 'preset', searchQuery);

  const startNameEdit = () => {
    setDraftName(presentation.name);
    setIsEditingName(true);
    requestAnimationFrame(() => nameInputRef.current?.select());
  };

  const commitName = () => {
    const trimmed = draftName.trim();
    if (trimmed && trimmed !== presentation.name) {
      setPresentationName(trimmed);
    }
    setIsEditingName(false);
  };

  const saveCurrentPreset = useCallback(async () => {
    if (operationRef.current) return;
    operationRef.current = true;
    setIsSaving(true);
    setOperationError(null);
    const name = presentation.name.trim() || t('common.newPresentation');
    try {
      const existing = visiblePresets.find((preset) => preset.name === name);
      if (existing && existing.presentation.id !== presentation.id &&
          !(await confirmDialog(t('library.confirmOverwrite', { name })))) return;
      const updated = await window.electronAPI?.savePreset?.({
        name, presentation: { ...presentation, name }, retentionMs: getLiveSaveRetention(),
      });
      if (!Array.isArray(updated)) throw new Error(t('library.saveFailed'));
      onPresetsChange(updated);
      if (useStore.getState().presentation.id === presentation.id) {
        onSelectedPresetNameChange(name);
        setSavedSnapshot(presentation);
      }
      playSfx('complete');
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : t('library.saveFailed'));
    } finally {
      operationRef.current = false;
      setIsSaving(false);
    }
  }, [presentation, visiblePresets, onPresetsChange, onSelectedPresetNameChange, t]);

  const deletePreset = useCallback(async (name: string) => {
    if (operationRef.current) return;
    operationRef.current = true;
    setOperationError(null);
    try {
      if (!(await confirmDialog(t('common.confirmDeletePreset', { name })))) return;
      const updated = await window.electronAPI?.deletePreset?.(name, getLiveSaveRetention());
      if (!Array.isArray(updated)) throw new Error(t('library.operationFailed'));
      onPresetsChange(updated);
      if (name === selectedPresetName) { onSelectedPresetNameChange(null); setSavedSnapshot(null); }
      playSfx('delete');
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : t('library.operationFailed'));
    } finally { operationRef.current = false; }
  }, [selectedPresetName, onPresetsChange, onSelectedPresetNameChange, t]);

  const renamePreset = useCallback(async (oldName: string, newName: string) => {
    if (operationRef.current) return;
    setOperationError(null);
    if (visiblePresets.some((p) => p.name === newName && p.name !== oldName)) {
      setOperationError(t('library.nameExists')); return;
    }
    operationRef.current = true;
    try {
      const updated = await window.electronAPI?.renamePreset?.(oldName, newName, getLiveSaveRetention());
      if (!Array.isArray(updated)) throw new Error(t('library.operationFailed'));
      onPresetsChange(updated);
      if (selectedPresetName === oldName) {
        setSavedSnapshot(null);
        onSelectedPresetNameChange(newName);
        setPresentationName(newName);
      }
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : t('library.operationFailed'));
    } finally { operationRef.current = false; }
  }, [selectedPresetName, visiblePresets, onPresetsChange, onSelectedPresetNameChange, setPresentationName, t]);

  const clearSearch = useCallback(() => setSearchQuery(''), []);

  const handleExportPptx = useCallback(async () => {
    exportLoopRef.current = playSfx('processing');
    try {
      setExportError(null);
      setExportResult(null);
      setExportDuration(null);
      setIsExporting(true);
      setExportProgress({ current: 0, total: 0 });

      exportStartTimeRef.current = performance.now();

      const content = JSON.stringify(presentation, null, 2);
      const result = await window.electronAPI?.exportPptx?.(content);

      if (!result || result.canceled) {
        stopSfx(exportLoopRef.current);
        exportLoopRef.current = null;
        setIsExporting(false);
        setExportProgress({ current: 0, total: 0 });
        return;
      }

      if (!result.success || !result.filePath) {
        throw new Error(result.error || t('common.exportFailedGeneric'));
      }

      stopSfx(exportLoopRef.current);
      exportLoopRef.current = null;

      setExportResult({
        filePath: result.filePath,
        slideCount: result.slideCount ?? 0,
        warnings: result.warnings ?? [],
      });

      const duration = performance.now() - exportStartTimeRef.current;
      setExportDuration(Math.round(duration));

      setIsExporting(false);
      setExportProgress({ current: 0, total: 0 });
      playSfx('complete');
    } catch (error) {
      console.error('PPTX export error:', error);
      stopSfx(exportLoopRef.current);
      exportLoopRef.current = null;
      setExportError(error instanceof Error ? error.message : t('common.unknownError'));
      setIsExporting(false);
      setExportProgress({ current: 0, total: 0 });

      if (exportStartTimeRef.current > 0) {
        const duration = performance.now() - exportStartTimeRef.current;
        setExportDuration(Math.round(duration));
      }
      playSfx('error');
    }
  }, [presentation, t]);

  const handleImportPptx = useCallback(async () => {
    try {
      setImportError(null);
      setImportWarnings([]);
      onImportWarnings?.([]);
      setImportCount(0);
      setImportDuration(null);
      setIsImporting(true);
      setImportProgress({ current: 0, total: 0 });

      importStartTimeRef.current = performance.now();

      const filePath = await window.electronAPI?.selectPptxFile?.();
      if (!filePath) {
        stopSfx(importLoopRef.current);
        importLoopRef.current = null;
        setIsImporting(false);
        return;
      }

      const mode = await choiceDialog({
        title: t('fileOpen.pptxTitle'), message: t('fileOpen.pptxMessage'),
        detail: `${filePath.split(/[\\/]/).pop()}\n\n${t('fileOpen.pptxOptionsDetail')}`,
        choices: [
          { value: 'cancel', label: t('common.cancel') },
          { value: 'new', label: t('fileOpen.newPresentation') },
          { value: 'append', label: t('fileOpen.append'), tone: 'primary' },
        ],
      });
      if (mode !== 'new' && mode !== 'append' || !onImportPptx) { setIsImporting(false); return; }
      onImportingChange?.(true);
      importLoopRef.current = playSfx('processing');
      importStartTimeRef.current = performance.now();
      const result = await onImportPptx(filePath, mode);
      if (!result) { stopSfx(importLoopRef.current); importLoopRef.current = null; setIsImporting(false); setImportProgress({ current: 0, total: 0 }); return; }

      if (!result.success || !result.slides) {
        throw new Error(result.error || t('common.importFailedGeneric'));
      }

      stopSfx(importLoopRef.current);
      importLoopRef.current = null;

      setImportCount(result.slides.length);
      setImportWarnings(result.warnings ?? []);
      onImportWarnings?.(result.warnings ?? []);

      const duration = performance.now() - importStartTimeRef.current;
      setImportDuration(Math.round(duration));

      setIsImporting(false);
      setImportProgress({ current: 0, total: 0 });
      playSfx('complete');
    } catch (error) {
      console.error('PPTX import error:', error);
      stopSfx(importLoopRef.current);
      importLoopRef.current = null;
      setImportError(error instanceof Error ? error.message : t('common.unknownError'));
      setIsImporting(false);
      setImportProgress({ current: 0, total: 0 });

      if (importStartTimeRef.current > 0) {
        const duration = performance.now() - importStartTimeRef.current;
        setImportDuration(Math.round(duration));
      }
      playSfx('error');
    } finally {
      onImportingChange?.(false);
    }
  }, [onImportPptx, onImportWarnings, onImportingChange, t]);

  return (
    <div ref={motionRoot} className="h-full bg-surface-base text-white overflow-y-auto">
      <header data-guide-anchor="presentations-overview" className="presentations-header border-b border-white/10 bg-surface-raised"
        onKeyDown={(event) => {
          const target = event.target as Element;
          if (target.closest('[role="menu"]') ||
              ((event.key === 'Enter' || event.key === ' ') && target.closest('button'))) event.stopPropagation();
        }}>
        <div className="presentations-header-title">
          <h2 className="text-xl font-semibold tracking-tight">{t('common.presetsTitle')}</h2>
          <p className="text-sm text-white/60 mt-0.5">{t('library.subtitle')}</p>
        </div>
        <div className="presentations-tools" role="group" aria-label={t('library.tools')}>
          <div className="presentations-tool-group">
            {onNewPresentation && <button type="button" className="presentation-action" disabled={isSaving}
              onClick={async () => {
                if (!saved && !(await confirmDialog(t('library.confirmNew'), { title: t('common.newPresentation') }))) return;
                onNewPresentation();
              }}><Plus aria-hidden="true" />{t('common.newPresentation')}</button>}
            {onOpenFile && <button type="button" onClick={() => void handleOpenFile()} disabled={isOpening || isImporting} className="presentation-action">
              <FolderOpen aria-hidden="true" />{t('common.openFromFile')}
            </button>}
          </div>
          <div className="presentations-tool-group">
            <button type="button" onClick={() => setIsAutosaveOpen(true)} aria-haspopup="dialog" className="presentation-action">
              <DatabaseBackup aria-hidden="true" />{t('nav.autosaves')}
            </button>
            <button ref={driveButtonRef} type="button" onClick={() => { setDrivePanelOpen(true); playSfx('open'); }} aria-haspopup="dialog" aria-expanded={drivePanelOpen} className="presentation-action">
              <Cloud aria-hidden="true" />Google Drive
            </button>
          </div>
          <Menu.Root>
            <Menu.Trigger className="presentation-action">
              <FileUp aria-hidden="true" />{t('library.powerPoint')}<ChevronDown aria-hidden="true" />
            </Menu.Trigger>
            <Menu.Portal>
              <Menu.Positioner side="bottom" align="start" sideOffset={6} className="presentation-ppt-menu">
                <Menu.Popup className="presentation-ppt-popup" aria-label={t('library.powerPoint')}>
                  {onImportPptx && <Menu.Item onClick={() => void handleImportPptx()} disabled={isImporting || isExporting} className="presentation-ppt-item">
                    <FileUp aria-hidden="true" />{isImporting ? t('common.importing') : t('common.importPptx')}
                  </Menu.Item>}
                  <Menu.Item onClick={() => void handleExportPptx()} disabled={isExporting || isImporting} className="presentation-ppt-item">
                    <FileDown aria-hidden="true" />{isExporting ? t('common.exporting') : t('common.exportPptx')}
                  </Menu.Item>
                </Menu.Popup>
              </Menu.Positioner>
            </Menu.Portal>
          </Menu.Root>
        </div>
        <section aria-label={t('library.current')} className="presentation-current">
          <div className="presentation-current-layout">
            <div className="presentation-current-info">
              <p className="text-xs font-medium text-blue-300 mb-1">{t('library.current')}</p>
              {isEditingName ? <input ref={nameInputRef} autoFocus type="text" value={draftName}
                onChange={(e) => setDraftName(e.target.value)} onBlur={commitName}
                onKeyDown={(e) => { if (e.key === 'Enter') commitName(); if (e.key === 'Escape') setIsEditingName(false); }}
                aria-label={t('common.presetName')} className="presentation-name-input" />
                : <button type="button" onClick={startNameEdit} title={t('common.clickToRename')} className="presentation-name">
                    <span className="truncate" title={presentation.name}>{presentation.name}</span><Pencil className="w-4 h-4 shrink-0 text-white/50" aria-hidden="true" />
                  </button>}
              <div className="presentation-current-status" role="status">
                <span><Layers aria-hidden="true" />{t('library.slideCount', { count: presentation.slides.length })}</span>
                <span className={saved ? 'text-emerald-300' : 'text-amber-200'}>
                  {saved ? <ShieldCheck aria-hidden="true" /> : <AlertCircle aria-hidden="true" />}
                  {saved ? t('library.saved') : t('library.unsaved')}
                </span>
                <span><DatabaseBackup aria-hidden="true" />{liveSaveEnabled
                  ? liveSaveLastSaved ? t('library.backupAt', { time: new Date(liveSaveLastSaved).toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' }) }) : t('library.backupOn')
                  : t('library.backupOff')}</span>
              </div>
            </div>
            <div className="presentation-current-actions">
              <button data-guide-anchor="save" type="button" onClick={saveCurrentPreset} disabled={isSaving} className="presentation-action">
                {isSaving ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Save aria-hidden="true" />}
                {isSaving ? t('common.saving') : t('library.save')}
              </button>
              {onSaveFile && <button type="button" onClick={onSaveFile} className="presentation-action">
                <HardDrive aria-hidden="true" />{t('library.saveFile')}
              </button>}
            </div>
          </div>
        </section>
        <div className="presentation-header-notices">
          {operationError && <p role="alert" className="rounded-lg border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-200">{operationError}</p>}
        {((isImporting && !onImportingChange) || isExporting) && <p role="status" className="px-6 pb-3 text-sm text-blue-300">
          {isImporting ? t('common.importing') : t('common.exporting')}{' '}
          {isImporting && importProgress.total > 0 && `${importProgress.current}/${importProgress.total}`}
          {isExporting && exportProgress.total > 0 && `${exportProgress.current}/${exportProgress.total}`}
        </p>}
        <div aria-live="polite">
          {(importDuration !== null || importError) && (
            <div className="px-6 pb-3 space-y-2">
              {importDuration !== null && !importError && (
                <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/20 p-3 flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-emerald-500/20 flex items-center justify-center shrink-0">
                    <Timer className="w-4 h-4 text-emerald-400" aria-hidden="true" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-emerald-300 font-medium">{t(importWarnings.length ? 'common.importCompleteWithWarnings' : 'common.importComplete')}</p>
                    <p className="text-xs text-emerald-200/70 mt-0.5">
                      {t('common.importSlidesCount', {
                        count: importCount,
                        duration: formatDuration(importDuration),
                      })}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => { setImportDuration(null); setImportWarnings([]); }}
                    className="text-emerald-400 hover:text-emerald-300 shrink-0"
                    aria-label={t('common.clearSearch')}
                  >
                    <X className="w-4 h-4" aria-hidden="true" />
                  </button>
                </div>
              )}

              {importWarnings.length > 0 && !onImportWarnings && !importError && (
                <div role="status" className="rounded-lg border border-amber-400/30 bg-amber-500/10 p-3 text-sm text-amber-100">
                  <p>{t('common.importReviewWarnings')}</p>
                  <ul className="mt-2 list-disc pl-5 space-y-1 break-words">
                    {importWarnings.map((warning, index) => <li key={index}>{warning}</li>)}
                  </ul>
                </div>
              )}

              {importError && (
                <div className="rounded-xl bg-red-500/10 border border-red-500/20 p-3 flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" aria-hidden="true" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-red-300 font-medium">{t('common.importError')}</p>
                    <p className="text-xs text-red-200/70 mt-1">{importError}</p>
                    {importDuration !== null && (
                      <p className="text-xs text-red-200/50 mt-1">
                        {t('common.importFailedAfter', { duration: formatDuration(importDuration) })}
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setImportError(null);
                      setImportDuration(null);
                    }}
                    className="text-red-400 hover:text-red-300 shrink-0"
                    aria-label={t('common.clearSearch')}
                  >
                    <X className="w-4 h-4" aria-hidden="true" />
                  </button>
                </div>
              )}
            </div>
          )}

          {(exportDuration !== null || exportError) && (
            <div className="px-6 pb-3 space-y-2">
              {exportDuration !== null && !exportError && exportResult && (
                <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/20 p-3 flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg bg-emerald-500/20 flex items-center justify-center shrink-0">
                    <FileDown className="w-4 h-4 text-emerald-400" aria-hidden="true" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-emerald-300 font-medium">{t('common.exportComplete')}</p>
                    <p className="text-xs text-emerald-200/70 mt-0.5 break-all">
                      {t('common.exportSlidesCount', {
                        count: exportResult.slideCount,
                        duration: formatDuration(exportDuration),
                      })}
                    </p>
                    <p className="text-xs text-emerald-200/60 mt-0.5 break-all">{exportResult.filePath}</p>
                    {exportResult.warnings.length > 0 && (
                      <ul className="mt-2 space-y-1">
                        {exportResult.warnings.map((warn, idx) => (
                          <li key={idx} className="text-[11px] text-amber-300/80 list-disc ml-4">
                            {warn}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setExportResult(null);
                      setExportDuration(null);
                    }}
                    className="text-emerald-400 hover:text-emerald-300 shrink-0"
                    aria-label={t('common.clearSearch')}
                  >
                    <X className="w-4 h-4" aria-hidden="true" />
                  </button>
                </div>
              )}

              {exportError && (
                <div className="rounded-xl bg-red-500/10 border border-red-500/20 p-3 flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" aria-hidden="true" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-red-300 font-medium">{t('common.exportError')}</p>
                    <p className="text-xs text-red-200/70 mt-1">{exportError}</p>
                    {exportDuration !== null && (
                      <p className="text-xs text-red-200/50 mt-1">
                        {t('common.importFailedAfter', { duration: formatDuration(exportDuration) })}
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setExportError(null);
                      setExportDuration(null);
                    }}
                    className="text-red-400 hover:text-red-300 shrink-0"
                    aria-label={t('common.clearSearch')}
                  >
                    <X className="w-4 h-4" aria-hidden="true" />
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
        </div>
      </header>

      <Dialog open={isAutosaveOpen} onClose={() => setIsAutosaveOpen(false)} labelledBy="autosave-title"
        className="w-full max-w-3xl max-h-[80vh] overflow-hidden rounded-3xl border border-emerald-500/20 bg-surface-raised shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                  <ShieldCheck className="w-5 h-5 text-emerald-300" aria-hidden="true" />
                </div>
                <div>
                  <h3 id="autosave-title" className="text-base font-semibold text-white">{t('nav.autosaves')}</h3>
                  <p className="text-[11px] text-white/45">{t('common.liveSaveBadge')}</p>
                </div>
              </div>
              <button type="button" aria-label={t('common.close')} onClick={() => setIsAutosaveOpen(false)} className="rounded-lg bg-white/5 p-2 text-white/60 hover:bg-white/10 hover:text-white">
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>

            <div className="max-h-[60vh] overflow-y-auto p-4">
              {operationError && <p role="alert" className="mb-3 rounded-lg border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-200">{operationError}</p>}
              {liveSavePresets.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-emerald-500/20 bg-emerald-500/5 p-8 text-center text-white/60">
                  {t('settings.liveSaveEmpty')}
                </div>
              ) : (
                <div className="grid gap-3 md:grid-cols-2">
                  {liveSavePresets.map((preset) => (
                    <article key={preset.name} className="rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.04] p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 text-emerald-200">
                            <ShieldCheck className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                            <span className="text-[10px] font-semibold uppercase tracking-[0.12em]">{t('common.liveSaveBadge')}</span>
                          </div>
                          <h4 className="mt-2 text-sm font-semibold text-white break-words line-clamp-2">{preset.presentation.name}</h4>
                        </div>
                        <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 shrink-0 mt-1" aria-hidden="true" />
                      </div>

                      <p className="mt-3 text-[11px] text-white/50">
                        {new Date(preset.createdAt).toLocaleString(i18n.language, {
                          day: '2-digit',
                          month: '2-digit',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </p>

                      <div className="mt-4 flex gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            onApplyPreset(preset);
                            setIsAutosaveOpen(false);
                          }}
                          className="flex-1 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm font-medium text-emerald-100 hover:bg-emerald-500/15 transition-colors"
                        >
                          {t('common.openPreset')}
                        </button>
                        <button
                          type="button"
                          onClick={() => deletePreset(preset.name)}
                          className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white/70 hover:bg-white/10 transition-colors"
                          aria-label={t('common.deletePreset')}
                        >
                          {t('common.deletePreset')}
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>
      </Dialog>

      <div className="flex flex-col min-h-0">
        <div className="flex-shrink-0 px-4 sm:px-5 py-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold flex items-center gap-2">
              <LayoutGrid className="w-4 h-4 text-blue-400" aria-hidden="true" />
              {t('common.savedPresentations')}
            </h2>
            <p className="text-xs text-white/40 mt-0.5">
              {t('common.presetCount', { count: visiblePresets.length })}
              {searchQuery && t('common.searchResults', { count: filteredPresets.length })}
            </p>
          </div>

          <div className="flex min-w-0 flex-1 basis-80 flex-wrap items-center justify-end gap-2 sm:max-w-lg">
            <div className="relative shrink-0">
              <select
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value as SortOrder)}
                aria-label={t('common.sortBy')}
                className="h-10 rounded-lg bg-white/[0.04] border border-white/10 text-sm text-white/70 outline-none focus-visible:ring-2 focus-visible:ring-blue-400 transition-all pl-3 pr-9 appearance-none cursor-pointer"
              >
                <option value="newest" className="bg-surface-overlay text-white">
                  {t('common.sortNewest')}
                </option>
                <option value="oldest" className="bg-surface-overlay text-white">
                  {t('common.sortOldest')}
                </option>
                <option value="name" className="bg-surface-overlay text-white">
                  {t('common.sortName')}
                </option>
              </select>
              <ChevronDown
                className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30 pointer-events-none"
                aria-hidden="true"
              />
            </div>

            <div className="relative min-w-0 flex-1 basis-40">
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/55" aria-hidden="true" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t('common.searchPresets')}
                aria-label={t('common.searchPresets')}
                className="workspace-search-input transition-colors"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={clearSearch}
                  aria-label={t('common.clearSearch')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-lg hover:bg-white/10 flex items-center justify-center text-white/40"
                >
                  <X className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="px-4 sm:px-5 pb-4 pt-1">
          {visiblePresets.length === 0 ? (
            <EmptyLibrary onSave={saveCurrentPreset} />
          ) : sortedPresets.length === 0 ? (
            <EmptySearch onClear={clearSearch} />
          ) : (
            <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 280px), 1fr))' }}>
                {sortedPresets.map((preset) => (
                  <PresetCard
                    key={preset.name}
                    preset={preset}
                    isActive={selectedPresetName === preset.name}
                    onApply={(preset) => {
                      setSavedSnapshot(null);
                      onApplyPreset(preset);
                    }}
                    onDelete={deletePreset}
                    onRename={renamePreset}
                  />
                ))}
            </div>
          )}
        </div>
      </div>
      <DrivePanel returnFocus={driveButtonRef} />
    </div>
  );
}
