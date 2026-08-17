import { useTranslation } from 'react-i18next';
import { AlertTriangle, CheckCircle2, Download, Loader2, RefreshCw } from 'lucide-react';
import { useStore } from '../state/useStore';
import { useUpdaterStore } from '../state/useUpdaterStore';
import Dialog from './Dialog';

const fmtMB = (bytes: number) => (bytes / 1048576).toFixed(1) + ' MB';

const primaryButtonClass =
  'inline-flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none';
const secondaryButtonClass =
  'inline-flex items-center justify-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-sm font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none';

export default function UpdatesModal() {
  const { t } = useTranslation();
  const isUpdatesOpen = useStore((s) => s.isUpdatesOpen);
  const setIsUpdatesOpen = useStore((s) => s.setIsUpdatesOpen);
  const updater = useUpdaterStore();
  const { status, currentVersion, updaterActive, nextVersion, percent, transferred, total, errorMessage } = updater;

  return (
    <Dialog
      open={isUpdatesOpen}
      onClose={() => setIsUpdatesOpen(false)}
      labelledBy="updates-title"
      className="bg-surface-overlay border border-white/10 rounded-2xl p-6 max-w-lg w-full mx-4 shadow-2xl"
    >
      <div className="flex items-center justify-between mb-4">
        <h2 id="updates-title" className="text-lg font-bold">
          {t('updates.title')}
        </h2>
        <button
          onClick={() => setIsUpdatesOpen(false)}
          aria-label={t('common.close')}
          className="p-1 rounded hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
        >
          <span aria-hidden="true">✕</span>
        </button>
      </div>

      {!updaterActive && (
        <p className="mb-4 flex items-start gap-2 text-xs text-white/60 bg-white/5 border border-white/10 rounded-lg p-3">
          <AlertTriangle className="w-4 h-4 shrink-0 text-yellow-400" aria-hidden="true" />
          {t('updates.devMode')}
        </p>
      )}

      {status === 'idle' && (
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm text-white/70">
            {t('updates.currentVersion')}: <span className="text-white font-semibold">v{currentVersion}</span>
          </p>
          <button className={primaryButtonClass} onClick={() => updater.check()} disabled={!updaterActive}>
            <RefreshCw className="w-4 h-4" aria-hidden="true" />
            {t('updates.check')}
          </button>
        </div>
      )}

      {status === 'checking' && (
        <p className="flex items-center gap-2 text-sm text-white/70">
          <Loader2 className="w-5 h-5 text-blue-400 animate-spin" aria-hidden="true" />
          {t('updates.checking')}
        </p>
      )}

      {status === 'uptodate' && (
        <p className="flex items-center gap-2 text-sm text-emerald-400 font-semibold">
          <CheckCircle2 className="w-5 h-5 shrink-0" aria-hidden="true" />
          {t('updates.uptodate')}
        </p>
      )}

      {status === 'available' && (
        <div className="space-y-4">
          <p className="font-semibold">
            {t('updates.available')}{' '}
            <span className="text-white/60 text-sm font-normal">
              {t('updates.fromTo', { current: currentVersion, next: nextVersion ?? '' })}
            </span>
          </p>

          <button className={primaryButtonClass} onClick={() => updater.download()}>
            <Download className="w-4 h-4" aria-hidden="true" />
            {t('updates.download')}
          </button>
        </div>
      )}

      {status === 'downloading' && (
        <div className="space-y-3">
          <p className="flex items-center gap-2 text-sm text-white/70">
            <Loader2 className="w-5 h-5 text-blue-400 animate-spin" aria-hidden="true" />
            {t('updates.downloading')}
          </p>
          <div className="w-full h-2 bg-white/10 rounded-full overflow-hidden" role="progressbar" aria-label={t('updates.downloading')} aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full bg-blue-600 rounded-full transition-[width]" style={{ width: `${percent}%` }} />
          </div>
          <p className="text-xs text-white/50 text-right">
            {fmtMB(transferred)} / {fmtMB(total)}
          </p>
        </div>
      )}

      {status === 'downloaded' && (
        <div className="space-y-4">
          <p className="flex items-center gap-2 text-emerald-400 font-semibold">
            <CheckCircle2 className="w-5 h-5 shrink-0" aria-hidden="true" />
            {t('updates.downloadedTitle')}
          </p>
          <p className="text-sm text-white/70">{t('updates.downloadedDesc', { version: nextVersion ?? '' })}</p>
          <div className="flex gap-3">
            <button className={primaryButtonClass} onClick={() => updater.install()}>
              {t('updates.restartNow')}
            </button>
            <button className={secondaryButtonClass} onClick={() => setIsUpdatesOpen(false)}>
              {t('updates.later')}
            </button>
          </div>
        </div>
      )}

      {status === 'error' && (
        <div className="space-y-4">
          <p className="flex items-center gap-2 text-red-400 font-semibold">
            <AlertTriangle className="w-5 h-5 shrink-0" aria-hidden="true" />
            {t('updates.errorTitle')}
          </p>
          <p className="text-sm text-white/70 whitespace-pre-wrap">
            {t('updates.errorDesc', { message: errorMessage ?? '' })}
          </p>
          <button className={secondaryButtonClass} onClick={() => updater.check()} disabled={!updaterActive}>
            <RefreshCw className="w-4 h-4" aria-hidden="true" />
            {t('updates.check')}
          </button>
        </div>
      )}
    </Dialog>
  );
}