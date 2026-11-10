// Settings → Presentation: start the phone server (remote control, phone sharing) with the app.
// Off by default: the server then starts only when Phone Control or phone sharing is opened.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Smartphone } from 'lucide-react';
import SettingSwitch from './SettingSwitch';
import { cn } from '../utils';

export default function RemoteAutoStartSetting() {
  const { t } = useTranslation();
  const [autoStart, setAutoStart] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    void window.electronAPI?.remoteGetSettings?.()
      .then(settings => { if (alive && typeof settings?.autoStart === 'boolean') setAutoStart(settings.autoStart); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  // Desktop only; the setting is unavailable on the web.
  if (autoStart === null) return null;

  const change = async (next: boolean) => {
    setAutoStart(next);
    try {
      const saved = await window.electronAPI?.remoteSetAutoStart?.(next);
      if (typeof saved?.autoStart === 'boolean') setAutoStart(saved.autoStart);
    } catch {
      setAutoStart(!next);
    }
  };

  return (
    <section id="settings-item-phone-server" tabIndex={-1} className="settings-simple-card rounded-xl border border-white/10 bg-surface-raised p-4" aria-label={t('remoteServer.autoStart')}>
      <div className="settings-row flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 min-w-0">
          <Smartphone className={cn('w-4 h-4 shrink-0', autoStart ? 'text-emerald-300' : 'text-white/55')} aria-hidden="true" />
          <div className="min-w-0">
            <h3 className="text-sm font-semibold">{t('remoteServer.autoStart')}</h3>
            <p className="text-sm leading-relaxed text-white/60">{t('remoteServer.autoStartHint')}</p>
          </div>
        </div>
        <SettingSwitch checked={autoStart} onCheckedChange={next => void change(next)} label={t('remoteServer.autoStart')} />
      </div>
    </section>
  );
}
