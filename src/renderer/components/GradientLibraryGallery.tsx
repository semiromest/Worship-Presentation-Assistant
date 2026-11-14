import { useCallback, useEffect, useState } from 'react';
import type { GradientLibraryEntry } from '../../shared/gradientLibrary';
/** Saved gradients; loaded while `enabled`. Rendered by GradientDesigner as a compact row. */
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
