import { useTranslation } from 'react-i18next';
import { Globe, Zap, Settings2, Save } from 'lucide-react';
import { useStore } from '../state/useStore';
import { useUpdaterStore } from '../state/useUpdaterStore';
import { cn } from '../utils';

export default function SettingsTab() {
  const { t, i18n } = useTranslation();
  const { autoGoLive, setAutoGoLive, setIsUpdatesOpen, liveSaveEnabled, setLiveSaveEnabled, liveSaveLastSaved } = useStore();
  const updaterStatus = useUpdaterStore((s) => s.status);

  const languages = Object.keys(i18n.options.resources ?? {});

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-2xl mx-auto p-6 space-y-5">
        <h2 className="text-lg font-bold flex items-center gap-2">
          <Settings2 className="w-5 h-5 text-blue-400" aria-hidden="true" />
          {t('nav.settings')}
        </h2>

        {/* Language */}
        <section className="rounded-xl border border-white/10 bg-surface-raised p-4 space-y-3" aria-label={t('settings.language')}>
          <div className="flex items-center gap-2">
            <Globe className="w-4 h-4 text-white/60 shrink-0" aria-hidden="true" />
            <div>
              <h3 className="text-sm font-semibold">{t('settings.language')}</h3>
              <p className="text-[11px] text-white/45">{t('settings.languageDesc')}</p>
            </div>
          </div>
          <select
            value={i18n.language}
            onChange={(e) => i18n.changeLanguage(e.target.value)}
            aria-label={t('settings.language')}
            className="w-full sm:w-auto bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm outline-none focus-visible:border-blue-500/60 focus-visible:ring-2 focus-visible:ring-blue-500/40 transition-colors"
          >
            {languages.map((lng) => (
              <option key={lng} value={lng} className="bg-surface-overlay">
                {t(`language.${lng}`)}
              </option>
            ))}
          </select>
        </section>

        {/* Auto Go-Live */}
        <section className="rounded-xl border border-white/10 bg-surface-raised p-4" aria-label={t('common.autoGoLive')}>
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2 min-w-0">
              <Zap className={cn('w-4 h-4 shrink-0', autoGoLive ? 'text-emerald-300' : 'text-white/35')} aria-hidden="true" />
              <div className="min-w-0">
                <h3 className="text-sm font-semibold">{t('common.autoGoLive')}</h3>
                <p className="text-[11px] text-white/45">{t('common.autoGoLiveHint')}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setAutoGoLive(!autoGoLive)}
              aria-pressed={autoGoLive}
              aria-label={t('common.autoGoLive')}
              className={cn(
                'relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none active:scale-[0.96]',
                autoGoLive ? 'bg-emerald-500' : 'bg-white/15'
              )}
            >
              <span
                className={cn(
                  'inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform',
                  autoGoLive ? 'translate-x-6' : 'translate-x-1'
                )}
              />
            </button>
          </div>
        </section>

        {/* Live Save */}
        <section className="rounded-xl border border-white/10 bg-surface-raised p-4" aria-label={t('settings.liveSave')}>
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2 min-w-0">
              <Save className={cn('w-4 h-4 shrink-0', liveSaveEnabled ? 'text-emerald-300' : 'text-white/35')} aria-hidden="true" />
              <div className="min-w-0">
                <h3 className="text-sm font-semibold">{t('settings.liveSave')}</h3>
                {liveSaveEnabled && liveSaveLastSaved && (
                  <p className="text-[11px] text-white/45 flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shrink-0" aria-hidden="true" />
                    {t('settings.liveSaveLastSaved', { time: new Date(liveSaveLastSaved).toLocaleTimeString() })}
                  </p>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setLiveSaveEnabled(!liveSaveEnabled)}
              aria-pressed={liveSaveEnabled}
              aria-label={t('settings.liveSave')}
              className={cn(
                'relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none active:scale-[0.96]',
                liveSaveEnabled ? 'bg-emerald-500' : 'bg-white/15'
              )}
            >
              <span
                className={cn(
                  'inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform',
                  liveSaveEnabled ? 'translate-x-6' : 'translate-x-1'
                )}
              />
            </button>
          </div>
        </section>

        {/* Updates */}
        <section className="rounded-xl border border-white/10 bg-surface-raised p-4" aria-label={t('settings.updates')}>
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <h3 className="text-sm font-semibold">{t('settings.updates')}</h3>
              <p className="text-[11px] text-white/45">{t('settings.updatesDesc')}</p>
            </div>
            <button
              onClick={() => setIsUpdatesOpen(true)}
              className="relative inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-sm font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none active:scale-[0.96]"
            >
              {t('settings.openUpdates')}
              {(updaterStatus === 'available' || updaterStatus === 'downloaded') && (
                <span
                  className="w-2 h-2 rounded-full bg-green-500"
                  aria-hidden="true"
                  title={updaterStatus === 'downloaded' ? t('updates.updateDownloadedBadge') : t('updates.updateAvailableBadge')}
                />
              )}
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}