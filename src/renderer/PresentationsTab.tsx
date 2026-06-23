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
} from 'lucide-react';
import { AnimatedPreview } from './AnimatedPreview';
import { cn } from './utils';
import { convertPptxToSlides, type PptxImportResult } from './utils';
import type { Presentation, Preset, Slide } from './types';
import { confirmDialog } from './dialogs';
import { useStore } from './state/useStore';

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
            if (e.isIntersecting) { setVisible(true); io.disconnect(); }
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
        <AnimatedPreview
          slide={slide}
          transitionType="none"
          duration={0}
          size="preview"
          volume={0}
          muted
        />
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

const PresetCard = memo(function PresetCard({
  preset,
  isActive,
  onApply,
  onDelete,
  onRename,
}: PresetCardProps) {
  const { t } = useTranslation();
  const [isEditing, setIsEditing] = useState(false);
  const [draftName, setDraftName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const firstSlide = preset.presentation.slides[0];

  return (
    <article
      aria-label={preset.name}
      className={cn(
        'group relative rounded-3xl border overflow-hidden transition-all duration-200',
        isActive
          ? 'border-blue-500/50 bg-blue-500/[0.06] shadow-lg shadow-blue-500/10 ring-1 ring-blue-500/30'
          : 'border-white/5 bg-white/[0.03] hover:border-blue-500/25 hover:bg-white/[0.05]',
      )}
    >
      <div className="relative aspect-video bg-black overflow-hidden">
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
              {t('common.openPreset')}
            </span>
          </div>
        )}

        <div className="absolute inset-0 bg-gradient-to-t from-[#0f1115] via-transparent to-transparent opacity-60" />
      </div>

      <div className="p-4 space-y-2">
        <div className="flex items-center gap-2">
          {isEditing ? (
            <input
              ref={inputRef}
              type="text"
              value={draftName}
              onChange={e => setDraftName(e.target.value)}
              onBlur={() => {
                const trimmed = draftName.trim();
                if (trimmed && trimmed !== preset.name) {
                  onRename(preset.name, trimmed);
                }
                setIsEditing(false);
              }}
              onKeyDown={e => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                if (e.key === 'Escape') setIsEditing(false);
              }}
              aria-label={t('common.presetName')}
              className="flex-1 font-semibold text-sm bg-transparent border-b border-blue-400/50 outline-none text-white"
            />
          ) : (
            <h3 className="font-semibold text-sm truncate group-hover:text-blue-300 transition-colors flex-1">
              {preset.name}
            </h3>
          )}
          <button
            type="button"
            onClick={() => {
              setDraftName(preset.name);
              setIsEditing(true);
              requestAnimationFrame(() => inputRef.current?.select());
            }}
            title={t('common.rename')}
            aria-label={t('common.rename')}
            className="opacity-60 hover:opacity-100 focus-visible:opacity-100 transition-all w-7 h-7 rounded-lg hover:bg-white/10 text-white/40 hover:text-white flex items-center justify-center shrink-0"
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
            {new Date(preset.createdAt).toLocaleDateString('tr-TR', {
              day: 'numeric',
              month: 'short',
              year: 'numeric',
            })}
          </span>
        </div>
      </div>

      <div className="px-4 pb-4 flex gap-2">
        <button
          type="button"
          onClick={() => onApply(preset)}
          className="flex-1 h-10 rounded-xl bg-gradient-to-r from-blue-600 to-violet-600 hover:opacity-90 text-sm font-medium transition-all shadow-md shadow-blue-500/15"
        >
          {t('common.openPreset')}
        </button>
        <button
          type="button"
          onClick={() => onDelete(preset.name)}
          title={t('common.deletePreset')}
          aria-label={t('common.deletePreset')}
          className="w-10 h-10 rounded-xl border border-red-500/20 bg-red-500/10 hover:bg-red-500/20 text-red-400 flex items-center justify-center transition-all"
        >
          <Trash2 className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>
    </article>
  );
});

const EmptyLibrary = () => {
  const { t } = useTranslation();
  return (
    <div className="h-full min-h-[280px] flex items-center justify-center">
      <div className="rounded-3xl border border-dashed border-white/10 bg-white/[0.02] p-12 text-center max-w-md">
        <div className="w-16 h-16 mx-auto rounded-3xl bg-blue-500/10 border border-blue-500/10 flex items-center justify-center mb-4">
          <Layers className="w-8 h-8 text-blue-400/60" />
        </div>
        <h5 className="font-medium text-white/80">{t('common.noSavedPresets')}</h5>
        <p className="text-sm text-white/35 mt-2 leading-relaxed">
          {t('common.noSavedPresetsDesc')}
        </p>
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
      <button
        type="button"
        onClick={onClear}
        className="mt-3 text-sm text-blue-400 hover:text-blue-300"
      >
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
  const setPresentationName = useStore(s => s.setPresentationName);
  const [searchQuery, setSearchQuery] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState({ current: 0, total: 0 });
  const [importError, setImportError] = useState<string | null>(null);
  const [importDuration, setImportDuration] = useState<number | null>(null);
  const importStartTimeRef = useRef<number>(0);

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

  const filteredPresets = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return q ? presets.filter(p => p.name.toLowerCase().includes(q)) : presets;
  }, [presets, searchQuery]);

  const saveCurrentPreset = useCallback(() => {
    const name = presentation.name || 'Yeni Sunum';

    startSaveTransition(() => {
      void (async () => {
        const updated = await window.electronAPI?.savePreset?.({ name, presentation });
        if (Array.isArray(updated)) {
          onPresetsChange(updated);
          onSelectedPresetNameChange(name);
          setPresentationName(name);
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

      const updated = await window.electronAPI?.deletePreset?.(name);
      if (Array.isArray(updated)) {
        onPresetsChange(updated);
        onSelectedPresetNameChange(
          name === selectedPresetName ? null : selectedPresetName,
        );
      }
    },
    [selectedPresetName, onPresetsChange, onSelectedPresetNameChange],
  );

  const renamePreset = useCallback(
    async (oldName: string, newName: string) => {
      const updated = await window.electronAPI?.renamePreset?.(oldName, newName);
      if (Array.isArray(updated)) {
        onPresetsChange(updated);
        if (selectedPresetName === oldName) {
          onSelectedPresetNameChange(newName);
        }
      }
    },
    [selectedPresetName, onPresetsChange, onSelectedPresetNameChange],
  );

  const clearSearch = useCallback(() => setSearchQuery(''), []);

  const handleImportPptx = useCallback(async () => {
    try {
      setImportError(null);
      setImportDuration(null);
      setIsImporting(true);
      setImportProgress({ current: 0, total: 0 });

      importStartTimeRef.current = performance.now();

      const filePath = await window.electronAPI?.selectPptxFile?.();
      if (!filePath) {
        setIsImporting(false);
        return;
      }

      const result: PptxImportResult = await window.electronAPI?.importPptx?.(filePath);

      if (!result.success || !result.slides) {
        throw new Error(result.error || t('common.importFailedGeneric'));
      }

      const slides = convertPptxToSlides(result);

      if (onImportSlides && slides.length > 0) {
        onImportSlides(slides);
      }

      const duration = performance.now() - importStartTimeRef.current;
      setImportDuration(Math.round(duration));

      setIsImporting(false);
      setImportProgress({ current: 0, total: 0 });
    } catch (error) {
      console.error('PPTX import error:', error);
      setImportError(error instanceof Error ? error.message : t('common.unknownError'));
      setIsImporting(false);
      setImportProgress({ current: 0, total: 0 });

      if (importStartTimeRef.current > 0) {
        const duration = performance.now() - importStartTimeRef.current;
        setImportDuration(Math.round(duration));
      }
    }
  }, [onImportSlides]);

  return (
    <div className="h-full bg-surface-base text-white overflow-hidden flex flex-col">
      <div className="flex-shrink-0 border-b border-white/5 bg-surface-raised/95 backdrop-blur-xl">
        <div className="px-6 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-4 min-w-0">
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-blue-500/20 to-violet-500/20 border border-white/10 flex items-center justify-center shadow-lg shadow-blue-500/10 shrink-0">
              <Layers className="w-5 h-5 text-blue-400" />
            </div>
            <div className="min-w-0">
              <h2 className="text-lg font-semibold tracking-tight">{t('common.presetsTitle')}</h2>
              <p className="text-xs text-white/40 mt-0.5 truncate">
                {t('common.presetsSubtitle')}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {onImportSlides && (
              <button
                type="button"
                onClick={handleImportPptx}
                disabled={isImporting}
                className="h-10 px-4 rounded-xl bg-gradient-to-r from-orange-500 to-amber-500 hover:opacity-90 disabled:opacity-50 transition-all text-sm font-medium flex items-center gap-2 shadow-lg shadow-orange-500/20"
              >
                {isImporting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {importProgress.total > 0
                      ? `${importProgress.current}/${importProgress.total}`
                      : t('common.importing')}
                  </>
                ) : (
                  <>
                    <FileUp className="w-4 h-4" />
                    {t('common.importPptx')}
                  </>
                )}
              </button>
            )}
            {onOpenFile && (
              <button
                type="button"
                onClick={onOpenFile}
                className="h-10 px-4 rounded-xl border border-white/10 bg-white/[0.03] hover:bg-white/[0.07] transition-all text-sm font-medium flex items-center gap-2"
              >
                <FolderOpen className="w-4 h-4 text-white/60" />
                {t('common.openFromFile')}
              </button>
            )}
            {onSaveFile && (
              <button
                type="button"
                onClick={onSaveFile}
                className="h-10 px-4 rounded-xl border border-white/10 bg-white/[0.03] hover:bg-white/[0.07] transition-all text-sm font-medium flex items-center gap-2"
              >
                <HardDrive className="w-4 h-4 text-white/60" />
                {t('common.saveToFile')}
              </button>
            )}
          </div>
        </div>

        <div aria-live="polite">
          {(importDuration !== null || importError) && (
            <div className="px-6 pb-3 space-y-2">
              {importDuration !== null && !importError && (
                <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/20 p-3 flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-emerald-500/20 flex items-center justify-center shrink-0">
                    <Timer className="w-4 h-4 text-emerald-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-emerald-300 font-medium">
                      {t('common.importComplete')}
                    </p>
                    <p className="text-xs text-emerald-200/70 mt-0.5">
                      {t('common.importSlidesCount', { count: importProgress.total, duration: formatDuration(importDuration) })}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setImportDuration(null)}
                    className="text-emerald-400 hover:text-emerald-300 shrink-0"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )}

              {importError && (
                <div className="rounded-xl bg-red-500/10 border border-red-500/20 p-3 flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
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
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-hidden flex flex-col lg:flex-row">
        <div className="lg:w-[380px] shrink-0 border-b lg:border-b-0 lg:border-r border-white/5 overflow-y-auto">
          <div className="p-5 space-y-5">
            <div className="text-center">
              <div className="w-14 h-14 mx-auto rounded-2xl bg-gradient-to-br from-emerald-500/20 to-teal-500/20 border border-emerald-500/10 flex items-center justify-center mb-3">
                <Save className="w-6 h-6 text-emerald-400" />
              </div>
              <p className="text-xs text-white/40 mb-1">{t('common.currentName')}</p>
              <p className="font-semibold text-sm truncate text-white/80">{presentation.name}</p>
            </div>

            <button
              type="button"
              onClick={saveCurrentPreset}
              disabled={isSaving}
              className="w-full h-12 rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:opacity-90 disabled:opacity-50 transition-all font-medium flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/20"
            >
              <Save className="w-4 h-4" />
              {isSaving ? t('common.saving') : t('common.savePreset')}
            </button>

            <p className="text-[11px] text-white/45 leading-relaxed">
              {t('common.presetCalendarHint')}
            </p>
          </div>
        </div>

        <div className="flex-1 flex flex-col overflow-hidden min-h-0">
          <div className="flex-shrink-0 p-5 pb-0 flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
            <div>
              <h2 className="font-semibold flex items-center gap-2">
                <LayoutGrid className="w-4 h-4 text-blue-400" />
                {t('common.savedPresentations')}
              </h2>
              <p className="text-xs text-white/40 mt-0.5">
                {t('common.presetCount', { count: presets.length })}
                {searchQuery && t('common.searchResults', { count: filteredPresets.length })}
              </p>
            </div>

            <div className="relative w-full sm:w-72">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/25" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
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

          <div className="flex-1 overflow-y-auto p-5">
            {presets.length === 0 ? (
              <EmptyLibrary />
            ) : filteredPresets.length === 0 ? (
              <EmptySearch onClear={clearSearch} />
            ) : (
              <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                {filteredPresets.map(preset => (
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
      </div>
    </div>
  );
}
