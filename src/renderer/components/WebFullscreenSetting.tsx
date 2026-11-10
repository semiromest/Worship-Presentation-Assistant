import { Download } from 'lucide-react';
import { useTranslation } from 'react-i18next';

/** Web only: the bridge exposes `downloadFullscreenSetup`; the desktop app never renders this card. */
export default function WebFullscreenSetting() {
  const { t } = useTranslation();
  const download = window.electronAPI?.downloadFullscreenSetup;
  const isWindows = typeof navigator !== 'undefined' && navigator.userAgent.includes('Windows');
  if (!download || !isWindows) return null;
  return (
    <section id="settings-item-fullscreen-setup" tabIndex={-1} className="settings-simple-card settings-row flex items-center justify-between gap-4 rounded-xl border border-white/10 bg-surface-raised p-4" aria-label={t('settings.fullscreenSetupTitle')}>
      <div className="min-w-0">
        <h3 className="text-sm font-semibold">{t('settings.fullscreenSetupTitle')}</h3>
        <p className="text-sm leading-relaxed text-white/60">{t('settings.fullscreenSetupDesc')}</p>
      </div>
      <button type="button" onClick={() => void download()} className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-white/15 px-3 py-2 text-sm hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none">
        <Download className="h-4 w-4" aria-hidden="true" />{t('settings.fullscreenSetupDownload')}
      </button>
    </section>
  );
}
