import { useCallback, useMemo, useState, useTransition, memo, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
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
import { convertPptxToSlides, type PptxImportResult } from './utils';
import type { Presentation, Preset, Slide } from './types';
import type { PlayingSFX } from 'uisfx';
import { playSfx, stopSfx } from './sfx';
import { confirmDialog } from './dialogs';
import { useStore } from './state/useStore';
import { isLiveSavePreset, getLiveSaveRetention } from './hooks/useLiveSave';
import DrivePanel from './components/DrivePanel';

// ─── Shared action/styles (page-scoped) ────────────────────────────────────
// All actions use the same secondary outline style for a quiet, uniform look;
// wider variants add extra horizontal padding for emphasis.
const BTN_BASE =
  'inline-flex items-center gap-2 h-10 rounded-xl text-sm font-medium transition-all active:scale-[0.98] shrink-0';
const BTN_SECONDARY = `${BTN_BASE} border border-white/10 bg-white/[0.03] hover:bg-white/[0.07] text-white/70 hover:text-white px-4`;
const BTN_SECONDARY_WIDE = `${BTN_BASE} border border-white/10 bg-white/[0.03] hover:bg-white/[0.07] text-white/70 hover:text-white px-6`;

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
            if (e.isIntersecting) {
              setVisible(true);
              io.disconnect();
            }
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
        <AnimatedPreview slide={slide} transitionType="none" duration={0} size="preview" volume={0} muted />
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
  onOpenFile?: () => void;
  onSaveFile?: () => void;
  onImportSlides?: (slides: import('./types').Slide[]) => void;
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
  const { t } = useTranslation();
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
    <article
      aria-label={`${t('common.openPreset')}: ${preset.name}`}
      role="button"
      tabIndex={0}
      onClick={openPreset}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openPreset();
        }
      }}
      className={cn(
        'group relative rounded-2xl border overflow-hidden transition-all duration-200 cursor-pointer focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none',
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
            className="opacity-60 group-hover:opacity-100 focus-visible:opacity-100 transition-all w-7 h-7 rounded-lg hover:bg-white/10 text-white/40 hover:text-white flex items-center justify-center shrink-0"
          >
            <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </div>
        <div className="flex items-center gap-3 text-xs text-white/45">
          <span className="flex items-center gap-1">
            <LayoutGrid className="w-3 h-3" />
            {t('common.presetCount', { count: preset.presentation.slides.length })}
          </span>
          <span className="flex items-center gap-1 min-w-0 truncate">
            <Clock className="w-3 h-3 shrink-0" />
            {new Date(preset.createdAt).toLocaleString('tr-TR', {
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
          className="flex-1 h-9 rounded-xl border border-white/10 bg-white/[0.03] hover:bg-white/[0.07] text-white/70 hover:text-white text-sm font-medium transition-all"
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
          className="w-7 h-7 self-center rounded-lg text-white/40 opacity-60 group-hover:opacity-100 focus-visible:opacity-100 hover:bg-red-500/15 hover:text-red-300 text-red-400/70 flex items-center justify-center transition-all"
        >
          <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      </div>
    </article>
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
  onImportSlides,
  onNewPresentation,
}: PresentationsTabProps) {
  const { t } = useTranslation();
  const setPresentationName = useStore((s) => s.setPresentationName);
  const setDrivePanelOpen = useStore((s) => s.setDrivePanelOpen);
  const drivePanelOpen = useStore((s) => s.drivePanelOpen);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortOrder, setSortOrder] = useState<SortOrder>('newest');
  const [isAutosaveOpen, setIsAutosaveOpen] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState({ current: 0, total: 0 });
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

  const [isSaving, startSaveTransition] = useTransition();

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
    const visible = presets.filter((p) => !isLiveSavePreset(p.name));
    const q = searchQuery.trim().toLowerCase();
    return q ? visible.filter((p) => p.name.toLowerCase().includes(q)) : visible;
  }, [presets, searchQuery]);

  const sortedPresets = useMemo(() => {
    const arr = [...filteredPresets];
    if (sortOrder === 'name') {
      return arr.sort((a, b) => a.name.localeCompare(b.name, 'tr'));
    }
    return arr.sort((a, b) => (sortOrder === 'oldest' ? a.createdAt - b.createdAt : b.createdAt - a.createdAt));
  }, [filteredPresets, sortOrder]);

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

  const saveCurrentPreset = useCallback(() => {
    const name = presentation.name || 'Yeni Sunum';

    startSaveTransition(() => {
      void (async () => {
        const updated = await window.electronAPI?.savePreset?.({
          name,
          presentation,
          retentionMs: getLiveSaveRetention(),
        });
        if (Array.isArray(updated)) {
          onPresetsChange(updated);
          onSelectedPresetNameChange(name);
          setPresentationName(name);
          playSfx('complete');
          if (onNewPresentation && (await confirmDialog(t('warnings.confirmNewAfterSave')))) {
            onNewPresentation();
          }
        }
      })();
    });
  }, [presentation, onPresetsChange, onSelectedPresetNameChange, setPresentationName, onNewPresentation, t]);

  const deletePreset = useCallback(
    async (name: string) => {
      if (!(await confirmDialog(t('common.confirmDeletePreset', { name })))) return;

      const updated = await window.electronAPI?.deletePreset?.(name, getLiveSaveRetention());
      if (Array.isArray(updated)) {
        onPresetsChange(updated);
        onSelectedPresetNameChange(name === selectedPresetName ? null : selectedPresetName);
        playSfx('delete');
      }
    },
    [selectedPresetName, onPresetsChange, onSelectedPresetNameChange, t]
  );

  const renamePreset = useCallback(
    async (oldName: string, newName: string) => {
      const updated = await window.electronAPI?.renamePreset?.(oldName, newName, getLiveSaveRetention());
      if (Array.isArray(updated)) {
        onPresetsChange(updated);
        if (selectedPresetName === oldName) {
          onSelectedPresetNameChange(newName);
        }
      }
    },
    [selectedPresetName, onPresetsChange, onSelectedPresetNameChange]
  );

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
    importLoopRef.current = playSfx('processing');
    try {
      setImportError(null);
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

      const result: PptxImportResult = await window.electronAPI?.importPptx?.(filePath);

      if (!result.success || !result.slides) {
        throw new Error(result.error || t('common.importFailedGeneric'));
      }

      stopSfx(importLoopRef.current);
      importLoopRef.current = null;

      const slides = convertPptxToSlides(result);

      if (onImportSlides && slides.length > 0) {
        onImportSlides(slides);
      }

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
    }
  }, [onImportSlides, t]);

  return (
    <div className="h-full bg-surface-base text-white overflow-hidden flex flex-col">
      <header className="flex-shrink-0 border-b border-white/5 bg-surface-raised/95 backdrop-blur-xl">
        <div className="px-6 pt-4 flex items-center justify-between gap-x-4 gap-y-3 flex-wrap">
          <div className="flex items-center gap-4 min-w-0">
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-blue-500/20 to-violet-500/20 border border-white/10 flex items-center justify-center shadow-lg shadow-blue-500/10 shrink-0">
              <Layers className="w-5 h-5 text-blue-400" />
            </div>
            <div className="min-w-0">
              <h2 className="text-lg font-semibold tracking-tight">{t('common.presetsTitle')}</h2>
              <p className="text-xs text-white/40 mt-0.5 truncate">{t('common.presetsSubtitle')}</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 justify-end shrink-0">
            <button
              type="button"
              onClick={handleExportPptx}
              disabled={isExporting}
              className={`${BTN_SECONDARY} disabled:opacity-50 disabled:hover:bg-white/[0.03]`}
            >
              {isExporting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                  {exportProgress.total > 0
                    ? `${exportProgress.current}/${exportProgress.total}`
                    : t('common.exporting')}
                </>
              ) : (
                <>
                  <FileDown className="w-4 h-4" aria-hidden="true" />
                  {t('common.exportPptx')}
                </>
              )}
            </button>
            {onImportSlides && (
              <button
                type="button"
                onClick={handleImportPptx}
                disabled={isImporting}
                className={`${BTN_SECONDARY} disabled:opacity-50 disabled:hover:bg-white/[0.03]`}
              >
                {isImporting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                    {importProgress.total > 0
                      ? `${importProgress.current}/${importProgress.total}`
                      : t('common.importing')}
                  </>
                ) : (
                  <>
                    <FileUp className="w-4 h-4" aria-hidden="true" />
                    {t('common.importPptx')}
                  </>
                )}
              </button>
            )}
            {onOpenFile && (
              <button type="button" onClick={onOpenFile} className={BTN_SECONDARY}>
                <FolderOpen className="w-4 h-4" aria-hidden="true" />
                {t('common.openFromFile')}
              </button>
            )}
            {onSaveFile && (
              <button type="button" onClick={onSaveFile} className={BTN_SECONDARY}>
                <HardDrive className="w-4 h-4" aria-hidden="true" />
                {t('common.saveToFile')}
              </button>
            )}
            <button
              type="button"
              onClick={() => setIsAutosaveOpen((prev) => !prev)}
              className={cn(
                BTN_SECONDARY,
                isAutosaveOpen &&
                  'border-emerald-500/50 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/10 shadow-lg shadow-emerald-500/10'
              )}
            >
              <DatabaseBackup className="w-4 h-4" aria-hidden="true" />
              {t('nav.autosaves')}
            </button>
            <button
              type="button"
              onClick={() => setDrivePanelOpen(!drivePanelOpen)}
              aria-pressed={drivePanelOpen}
              className={cn(
                BTN_SECONDARY,
                drivePanelOpen &&
                  'border-blue-500/50 bg-blue-500/10 text-blue-400 hover:bg-blue-500/10 shadow-lg shadow-blue-500/10'
              )}
            >
              <Cloud className="w-4 h-4" aria-hidden="true" />
              Drive
            </button>
            {onNewPresentation && (
              <button
                type="button"
                onClick={async () => {
                  if (presentation?.slides?.length > 0) {
                    const confirmed = await confirmDialog(
                      'Yeni bir sunum açmak istediğinize emin misiniz? Kaydedilmemiş değişiklikler kaybolacak.',
                      {
                        title: 'Yeni Sunum',
                        confirmLabel: 'Yeni Sunum Aç',
                        cancelLabel: 'İptal',
                      }
                    );
                    if (!confirmed) return;
                  }
                  onNewPresentation();
                }}
                className={BTN_SECONDARY_WIDE}
              >
                <Plus className="w-4 h-4" aria-hidden="true" />
                {t('common.newPresentation')}
              </button>
            )}
          </div>
        </div>

        {/* Action strip — current presentation name + save */}
        <div className="px-6 py-3 border-t border-white/5 flex flex-col sm:flex-row sm:items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-xs text-white/40 shrink-0">{t('common.currentName')}:</span>
            {isEditingName ? (
              <input
                ref={nameInputRef}
                type="text"
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                onBlur={commitName}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitName();
                  if (e.key === 'Escape') setIsEditingName(false);
                }}
                aria-label={t('common.presetName')}
                className="min-w-0 max-w-[260px] font-semibold text-sm text-white bg-transparent border-b border-blue-400/50 outline-none"
              />
            ) : (
              <button
                type="button"
                onClick={startNameEdit}
                title={t('common.clickToRename')}
                aria-label={t('common.clickToRename')}
                className="group flex items-center gap-1.5 font-semibold text-sm text-white/85 truncate max-w-[260px] hover:text-blue-300 transition-colors cursor-pointer rounded px-1 py-0.5 -ml-1 hover:bg-white/5"
              >
                <span className="truncate">{presentation.name}</span>
                <Pencil
                  className="w-3 h-3 text-white/25 group-hover:text-white/50 transition-colors shrink-0"
                  aria-hidden="true"
                />
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={saveCurrentPreset}
            disabled={isSaving}
            className={cn(BTN_SECONDARY_WIDE, 'disabled:opacity-50 disabled:pointer-events-none')}
          >
            {isSaving ? (
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
            ) : (
              <Save className="w-4 h-4" aria-hidden="true" />
            )}
            {isSaving ? t('common.saving') : t('common.savePreset')}
          </button>

          <p className="hidden md:block sm:ml-auto text-[11px] text-white/45 leading-relaxed max-w-[280px]">
            {t('common.presetCalendarHint')}
          </p>
        </div>

        <div aria-live="polite">
          {(importDuration !== null || importError) && (
            <div className="px-6 pb-3 space-y-2">
              {importDuration !== null && !importError && (
                <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/20 p-3 flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-emerald-500/20 flex items-center justify-center shrink-0">
                    <Timer className="w-4 h-4 text-emerald-400" aria-hidden="true" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-emerald-300 font-medium">{t('common.importComplete')}</p>
                    <p className="text-xs text-emerald-200/70 mt-0.5">
                      {t('common.importSlidesCount', {
                        count: importProgress.total,
                        duration: formatDuration(importDuration),
                      })}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setImportDuration(null)}
                    className="text-emerald-400 hover:text-emerald-300 shrink-0"
                    aria-label={t('common.clearSearch')}
                  >
                    <X className="w-4 h-4" aria-hidden="true" />
                  </button>
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
      </header>

      {isAutosaveOpen && (
        <div className="absolute inset-0 z-40 bg-slate-950/60 backdrop-blur-[2px] flex items-center justify-center p-4" onClick={() => setIsAutosaveOpen(false)}>
          <div className="w-full max-w-3xl max-h-[80vh] overflow-hidden rounded-3xl border border-emerald-500/20 bg-surface-raised shadow-2xl shadow-emerald-500/10" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                  <ShieldCheck className="w-5 h-5 text-emerald-300" aria-hidden="true" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-white">{t('nav.autosaves')}</h3>
                  <p className="text-[11px] text-white/45">{t('common.liveSaveBadge')}</p>
                </div>
              </div>
              <button type="button" onClick={() => setIsAutosaveOpen(false)} className="rounded-lg bg-white/5 p-2 text-white/60 hover:bg-white/10 hover:text-white">
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>

            <div className="max-h-[60vh] overflow-y-auto p-4">
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
                        {new Date(preset.createdAt).toLocaleString('tr-TR', {
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
                          onClick={async () => {
                            const confirmed = await confirmDialog(t('common.confirmDeletePreset', { name: preset.name }));
                            if (!confirmed) return;
                            const updated = await window.electronAPI?.deletePreset?.(preset.name, getLiveSaveRetention());
                            if (Array.isArray(updated)) {
                              onPresetsChange(updated);
                            }
                          }}
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
          </div>
        </div>
      )}

      <div className="flex-1 flex flex-col overflow-hidden min-h-0">
        <div className="flex-shrink-0 p-5 pb-3 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <h2 className="font-semibold flex items-center gap-2">
              <LayoutGrid className="w-4 h-4 text-blue-400" aria-hidden="true" />
              {t('common.savedPresentations')}
            </h2>
            <p className="text-xs text-white/40 mt-0.5">
              {t('common.presetCount', { count: presets.length })}
              {searchQuery && t('common.searchResults', { count: filteredPresets.length })}
            </p>
          </div>

          <div className="flex items-center gap-2 w-full xl:w-auto">
            <div className="relative shrink-0">
              <select
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value as SortOrder)}
                aria-label={t('common.sortBy')}
                className="h-10 rounded-xl bg-white/[0.04] border border-white/10 text-sm text-white/70 outline-none focus:border-blue-500/30 transition-all pl-3 pr-9 appearance-none cursor-pointer"
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

            <div className="relative w-full xl:w-72">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/25" aria-hidden="true" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t('common.searchPresets')}
                aria-label={t('common.searchPresets')}
                className="w-full h-10 pl-10 pr-9 rounded-xl bg-white/[0.04] border border-white/10 text-sm outline-none focus:border-blue-500/30 transition-all placeholder:text-white/25"
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

        <div className="flex-1 overflow-y-auto p-5 pt-1">
          {presets.length === 0 ? (
            <EmptyLibrary onSave={saveCurrentPreset} />
          ) : sortedPresets.length === 0 ? (
            <EmptySearch onClear={clearSearch} />
          ) : (
            <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {sortedPresets.map((preset) => (
                <PresetCard
                  key={preset.name}
                  preset={preset}
                  isActive={selectedPresetName === preset.name}
                  onApply={onApplyPreset}
                  onDelete={deletePreset}
                  onRename={renamePreset}
                />
              ))}
            </div>
          )}
        </div>
      </div>
      <DrivePanel />
    </div>
  );
}
