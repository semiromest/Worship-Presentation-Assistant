import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Trash2 } from 'lucide-react';
import type { GradientLibraryEntry } from '../../shared/gradientLibrary';
export function useGradientLibrary(enabled: boolean) {
  const [entries, setEntries] = useState<GradientLibraryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision((n) => n + 1), []);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setLoading(true);
    setError(false);
    window.electronAPI
      .listGradientLibrary()
      .then((list) => {
        if (!cancelled) setEntries(list);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, revision]);
  return { entries, setEntries, loading, error, reload };
}
export function GradientLibraryGallery({
  entries,
  loading,
  error,
  disabled,
  onChoose,
  onRemove,
}: {
  entries: GradientLibraryEntry[];
  loading: boolean;
  error: boolean;
  disabled?: boolean;
  onChoose: (entry: GradientLibraryEntry) => void;
  onRemove?: (entry: GradientLibraryEntry) => void;
}) {
  const { t } = useTranslation();
  if (loading)
    return (
      <p role="status" className="py-3 text-xs text-white/60">
        {t('common.loading')}
      </p>
    );
  if (error)
    return (
      <p role="alert" className="py-3 text-xs text-red-300">
        {t('gradientLibrary.libraryError')}
      </p>
    );
  if (!entries.length) return <p className="py-3 text-xs leading-5 text-white/60">{t('gradientLibrary.empty')}</p>;
  return (
    <ul className="grid grid-cols-2 gap-2" aria-label={t('gradientLibrary.library')}>
      {entries.map((entry) => (
        <li key={entry.id} className="min-w-0 rounded-lg border border-white/15 bg-white/[0.025]">
          <button
            type="button"
            disabled={disabled}
            title={entry.name}
            aria-label={entry.name}
            data-gradient-entry={entry.id}
            onClick={() => onChoose(entry)}
            className="block w-full rounded-lg p-1.5 text-left hover:bg-white/5 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
          >
            <img src={entry.image} alt="" loading="lazy" className="aspect-video w-full rounded object-cover" />
            <span className="mt-1 block truncate px-0.5 text-xs text-white/90">{entry.name}</span>
          </button>
          {onRemove && (
            <button
              type="button"
              disabled={disabled}
              onClick={() => onRemove(entry)}
              aria-label={t('gradientLibrary.deleteNamed', { name: entry.name })}
              className="mb-1 ml-auto mr-1 flex h-8 w-8 items-center justify-center rounded text-white/50 hover:bg-red-500/10 hover:text-red-300 focus-visible:ring-2 focus-visible:ring-violet-400"
            >
              <Trash2 size={14} aria-hidden="true" />
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
