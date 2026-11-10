// Settings → Autosave → Storage: stored media usage, warning limit and approved cleanup.
// Desktop: the app's own copies in userData/media. Web: media stored in the browser.
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { HardDrive, ShieldAlert, ShieldCheck, Trash2 } from 'lucide-react';
import type { MediaStorageReport } from '../../shared/mediaStorage';
import { formatBytes, mediaStorageAvailable, readMediaStorage, reviewMediaStorage } from '../mediaStorage';
import { playSfx } from '../sfx';

export default function StorageSettings() {
  const { t } = useTranslation();
  const [report, setReport] = useState<MediaStorageReport | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try { setReport(await readMediaStorage()); setFailed(false); }
    catch (error) { console.warn('[media storage]', error); setFailed(true); }
  }, []);
  useEffect(() => { if (mediaStorageAvailable()) void refresh(); }, [refresh]);

  if (!mediaStorageAvailable()) return null;

  const run = async (task: () => Promise<unknown>) => {
    setBusy(true);
    try { await task(); } catch (error) { console.warn('[media storage]', error); } finally { setBusy(false); await refresh(); }
  };
  const api = window.electronAPI;

  return (
    <section id="settings-item-storage" tabIndex={-1} className="rounded-xl border border-white/10 bg-surface-raised p-4 space-y-4" aria-label={t('mediaStorage.title')}>
      <div className="flex items-start gap-3">
        <HardDrive className="mt-0.5 h-4 w-4 shrink-0 text-white/60" aria-hidden="true" />
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">{t('mediaStorage.title')}</h3>
          <p className="mt-1 text-sm leading-relaxed text-white/60">
            {t(report?.platform === 'web' ? 'mediaStorage.descriptionWeb' : 'mediaStorage.descriptionDesktop')}
          </p>
        </div>
      </div>

      {!report && <p className="text-sm text-white/60" role="status">{failed ? t('mediaStorage.failed') : t('mediaStorage.loading')}</p>}

      {report && <>
        <div className="space-y-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
            <span className="font-medium">{t('mediaStorage.files', { size: formatBytes(report.mediaBytes), count: report.mediaCount })}</span>
            {report.browser?.usage != null && report.browser.quota != null && (
              <span className="text-white/55">{t('mediaStorage.browserTotal', { used: formatBytes(report.browser.usage), quota: formatBytes(report.browser.quota) })}</span>
            )}
            {report.diskFree != null && <span className="text-white/55">{t('mediaStorage.diskFree', { free: formatBytes(report.diskFree) })}</span>}
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-label={t('mediaStorage.limit')}
            aria-valuemin={0} aria-valuemax={report.limitBytes} aria-valuenow={Math.min(report.mediaBytes, report.limitBytes)}>
            <div className={report.mediaBytes > report.limitBytes ? 'h-full bg-amber-400' : 'h-full bg-emerald-400'}
              style={{ width: `${Math.min(100, (report.mediaBytes / report.limitBytes) * 100)}%` }} />
          </div>
        </div>

        <div className="settings-row flex flex-wrap items-center justify-between gap-3">
          <label htmlFor="media-storage-limit" className="text-sm text-white/75">{t('mediaStorage.limit')}</label>
          <select id="media-storage-limit" value={String(report.limitBytes)} disabled={busy}
            onChange={event => { playSfx('press'); void run(() => api?.mediaStorageSettings?.({ limitBytes: Number(event.target.value) }) ?? Promise.resolve()); }}
            className="rounded-lg border border-white/10 bg-surface-overlay px-3 py-2 text-sm text-white outline-none focus-visible:border-emerald-400 focus-visible:ring-2 focus-visible:ring-emerald-500/30">
            {report.limitOptions.map(value => (
              <option key={value} value={String(value)} className="bg-surface-overlay text-white">
                {formatBytes(value)}{report.limitIsDefault && value === report.limitBytes ? ` ${t('mediaStorage.defaultSuffix')}` : ''}
              </option>
            ))}
          </select>
        </div>

        {report.browser && (
          <div className="flex items-start gap-2 text-sm text-white/65">
            {report.browser.persisted
              ? <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" aria-hidden="true" />
              : <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" aria-hidden="true" />}
            <span className="min-w-0 flex-1">{t(report.browser.persisted ? 'mediaStorage.persisted' : 'mediaStorage.notPersisted')}</span>
            {report.browser.persisted === false && api?.mediaStorageRequestPersistence && (
              <button type="button" disabled={busy} onClick={() => void run(() => api.mediaStorageRequestPersistence!())}
                className="shrink-0 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[11px] font-medium text-white/75 hover:bg-white/10">
                {t('mediaStorage.askPersist')}
              </button>
            )}
          </div>
        )}

        <div className="settings-row flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-4">
          <span className="text-sm text-white/60">{t('mediaStorage.unusedSize', { size: formatBytes(report.unused.bytes) })}</span>
          <button type="button" disabled={busy} onClick={() => void run(() => reviewMediaStorage(false))}
            className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-white/80 hover:bg-white/10 disabled:opacity-50">
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />{t('mediaStorage.cleanButton')}
          </button>
        </div>
      </>}
    </section>
  );
}
