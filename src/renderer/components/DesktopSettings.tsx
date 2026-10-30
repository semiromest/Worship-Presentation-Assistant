import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDesktopState } from '../desktopState';
import { SPELLCHECK_LANGUAGES, type DesktopPreferences } from '../../shared/desktop';
import SettingSwitch from './SettingSwitch';

export default function DesktopSettings() {
  const { t } = useTranslation();
  const status = useDesktopState();
  const [draft, setDraft] = useState<DesktopPreferences>(status.preferences);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const preferenceKey = JSON.stringify(status.preferences);
  useEffect(() => { setDraft(JSON.parse(preferenceKey)); }, [preferenceKey]);
  const update = async (change: Partial<DesktopPreferences>) => {
    if (busy) return;
    const preferences = { ...draft, ...change };
    setDraft(preferences); setBusy(true); setError('');
    try {
      const next = await window.electronAPI.desktopSettings(preferences);
      useDesktopState.setState(next); setDraft(next.preferences);
    } catch (error) {
      setDraft(useDesktopState.getState().preferences);
      setError(String(error));
    }
    finally { setBusy(false); }
  };
  return <section aria-busy={busy} className="rounded-xl border border-white/10 bg-surface-raised p-4 space-y-4">
    <h4 className="font-semibold">{t('desktop.settings')}</h4>
    <fieldset disabled={busy} className="min-w-0 space-y-4">
    {(['shortcutsEnabled', 'spellcheck', 'notifications'] as const).map(key => <div key={key} className="flex items-center justify-between gap-4 border-b border-white/10 pb-3 text-sm"><span>{t(`desktop.${key}`)}</span><SettingSwitch label={t(`desktop.${key}`)} checked={draft[key]} onCheckedChange={checked => void update({ [key]: checked })} /></div>)}
    {/Macintosh/.test(navigator.userAgent) ? <p className="text-xs text-white/60">{t('desktop.spellingSystem')}</p> : <label className="flex items-center justify-between gap-4 text-sm">
      <span>{t('desktop.spellingLanguage')}</span><select className="rounded-lg border border-white/15 bg-surface-base px-3 py-2" value={draft.spellcheckLanguage} onChange={event => void update({ spellcheckLanguage: event.target.value as DesktopPreferences['spellcheckLanguage'] })}>
        {SPELLCHECK_LANGUAGES.map(value => <option key={value} value={value}>{value === 'auto' ? t('desktop.spellingAuto') : ({ tr: 'Türkçe', 'en-US': 'English (US)', de: 'Deutsch', es: 'Español', ko: '한국어' })[value]}</option>)}
      </select>
    </label>}
    </fieldset>
    {error && <p role="alert" className="text-red-300">{error}</p>}
  </section>;
}
