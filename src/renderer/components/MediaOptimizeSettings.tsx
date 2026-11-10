// Settings → Autosave → "Optimize media": one click shrinks the images and videos the open
// presentation uses (see src/renderer/mediaOptimize.ts). Desktop only.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Zap } from 'lucide-react';
import { formatBytes } from '../mediaStorage';
import { mediaOptimizeAvailable, runOptimize, scanOptimizable, type OptimizeOutcome, type OptimizeProgress, type OptimizeScan } from '../mediaOptimize';
import { useStore } from '../state/useStore';

export default function MediaOptimizeSettings() {
  const { t } = useTranslation();
  const presentation = useStore(state => state.presentation);
  const [scan, setScan] = useState<OptimizeScan | null>(null);
  const [progress, setProgress] = useState<OptimizeProgress | null>(null);
  const [outcome, setOutcome] = useState<OptimizeOutcome | null>(null);
  const [failed, setFailed] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const running = !!progress;

  const refresh = useCallback(async () => {
    try { setScan(await scanOptimizable()); setFailed(false); }
    catch (error) { console.warn('[media optimize]', error); setFailed(true); }
  }, []);
  // Re-scan when the deck changes (not while a job is rewriting it).
  useEffect(() => { if (mediaOptimizeAvailable() && !controller.current) void refresh(); }, [refresh, presentation]);
  useEffect(() => () => controller.current?.abort(), []);

  if (!mediaOptimizeAvailable()) return null;

  const start = async () => {
    if (!scan || running) return;
    const abort = new AbortController();
    controller.current = abort;
    setOutcome(null);
    setProgress({ fraction: 0, kind: 'image', index: 0, total: scan.images.length + scan.videos.length });
    try { setOutcome(await runOptimize(scan, setProgress, abort.signal)); }
    catch (error) { console.warn('[media optimize]', error); setFailed(true); }
    finally { controller.current = null; setProgress(null); await refresh(); }
  };

  const count = scan ? scan.images.length + scan.videos.length : 0;
  const saved = outcome ? Math.max(0, outcome.before - outcome.after) : 0;

  return (
    <section id="settings-item-media-optimize" tabIndex={-1} className="rounded-xl border border-white/10 bg-surface-raised p-4 space-y-4" aria-label={t('mediaOptimize.title')}>
      <div className="flex items-start gap-3">
        <Zap className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" aria-hidden="true" />
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">{t('mediaOptimize.title')}</h3>
          <p className="mt-1 text-sm leading-relaxed text-white/60">{t('mediaOptimize.description')}</p>
        </div>
      </div>

      <div className="settings-row flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-white/70" role="status">
          {failed ? t('mediaOptimize.failed')
            : !scan ? t('mediaOptimize.scanning')
            : count === 0 ? t('mediaOptimize.nothing')
            : t('mediaOptimize.found', { images: scan.images.length, videos: scan.videos.length, size: formatBytes(scan.bytes) })}
        </p>
        {running
          ? <button type="button" onClick={() => controller.current?.abort()} className="rounded-lg border border-white/15 px-3 py-2 text-sm hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none">{t('mediaOptimize.cancel')}</button>
          : <button type="button" disabled={!scan || count === 0} onClick={() => void start()} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:outline-none">
            <Zap className="h-4 w-4" aria-hidden="true" />{t('mediaOptimize.action')}
          </button>}
      </div>

      {progress && <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2 text-xs text-white/60">
          <span className="inline-flex items-center gap-1.5"><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            {t(progress.kind === 'video' ? 'mediaOptimize.workingVideo' : 'mediaOptimize.workingImage', { current: Math.min(progress.index + 1, progress.total), total: progress.total })}</span>
          <span className="tabular-nums">{Math.round(progress.fraction * 100)}%</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress.fraction * 100)}>
          <div className="h-full bg-blue-400 transition-[width]" style={{ width: `${progress.fraction * 100}%` }} />
        </div>
      </div>}

      {outcome && !running && <p className="text-sm text-emerald-300" role="status">
        {outcome.images + outcome.videos === 0
          ? t('mediaOptimize.noGain')
          : t('mediaOptimize.done', { saved: formatBytes(saved), percent: outcome.before ? Math.round(saved / outcome.before * 100) : 0, count: outcome.images + outcome.videos })}
        {outcome.kept > 0 && <span className="text-white/55"> {t('mediaOptimize.kept', { count: outcome.kept })}</span>}
        {outcome.failed > 0 && <span className="text-amber-300"> {t('mediaOptimize.failedSome', { count: outcome.failed })}</span>}
        {outcome.cancelled && <span className="text-white/55"> {t('mediaOptimize.cancelled')}</span>}
      </p>}
    </section>
  );
}
