import { useMemo, useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Globe, Zap, Settings2, Save, Trash2, DatabaseBackup, Volume2, Mic, KeyRound, Languages, Check, Loader2 } from 'lucide-react';
import { useStore } from '../state/useStore';
import { useUpdaterStore } from '../state/useUpdaterStore';
import { WatermarkSettingsPanel } from './WatermarkSettingsPanel';
import { useSttStore, refreshSttStatus } from '../state/useSttStore';
import { AUTO_STT_LANGUAGE, STT_LANGUAGES } from '../../shared/stt';
import { cn } from '../utils';
import { DEFAULT_LIVE_SAVE_RETENTION_MS, isLiveSavePreset, LIVE_SAVE_RETENTION_OPTIONS, getLiveSaveRetention } from '../hooks/useLiveSave';

export default function SettingsTab() {
  const { t, i18n } = useTranslation();
  const autoGoLive = useStore((s) => s.autoGoLive);
  const setAutoGoLive = useStore((s) => s.setAutoGoLive);
  const setIsUpdatesOpen = useStore((s) => s.setIsUpdatesOpen);
  const liveSaveEnabled = useStore((s) => s.liveSaveEnabled);
  const setLiveSaveEnabled = useStore((s) => s.setLiveSaveEnabled);
  const liveSaveLastSaved = useStore((s) => s.liveSaveLastSaved);
  const liveSaveRetentionMs = useStore((s) => s.liveSaveRetentionMs);
  const setLiveSaveRetentionMs = useStore((s) => s.setLiveSaveRetentionMs);
  const presets = useStore((s) => s.presets);
  const setPresets = useStore((s) => s.setPresets);
  const uiSfxEnabled = useStore((s) => s.uiSfxEnabled);
  const setUiSfxEnabled = useStore((s) => s.setUiSfxEnabled);
  const updaterStatus = useUpdaterStore((s) => s.status);

  // Soniox real-time captions
  const sttHasKey = useSttStore((s) => s.hasKey);
  const sttKeyHint = useSttStore((s) => s.keyHint);
  const sttSpokenLanguage = useSttStore((s) => s.sttLanguage);
  const sttSetSpokenLanguage = useSttStore((s) => s.setSttLanguage);
  const sttTargetLanguage = useSttStore((s) => s.targetLanguage);
  const sttSetTargetLanguage = useSttStore((s) => s.setTargetLanguage);
  const [apiKeyDraft, setApiKeyDraft] = useState('');
  const [apiKeyState, setApiKeyState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [keyError, setKeyError] = useState<string | null>(null);

  useEffect(() => {
    void refreshSttStatus();
  }, []);

  const saveApiKey = async () => {
    const key = apiKeyDraft.trim();
    if (!key) {
      setKeyError(t('settings.sonioxKeyEmpty'));
      return;
    }
    setApiKeyState('saving');
    setKeyError(null);
    try {
      const res = await window.electronAPI?.sttSetApiKey?.(key);
      if (!res?.ok) {
        setKeyError(t('settings.sonioxKeySaveFailed'));
      } else {
        setApiKeyDraft('');
        setApiKeyState('saved');
        await refreshSttStatus();
        setTimeout(() => setApiKeyState('idle'), 2200);
      }
    } catch {
      setKeyError(t('settings.sonioxKeySaveFailed'));
      setApiKeyState('idle');
    }
  };

  // Language defaults persist inside the store setters (localStorage).
  const changeSpokenLanguage = (code: string) => sttSetSpokenLanguage(code);
  const changeTargetLanguage = (code: string) => sttSetTargetLanguage(code);

  const languages = Object.keys(i18n.options.resources ?? {});
  const liveSavePresets = useMemo(
    () => [...presets].filter((preset) => isLiveSavePreset(preset.name)).sort((a, b) => b.createdAt - a.createdAt),
    [presets]
  );
  const latestLiveSave = liveSavePresets[0] ?? null;

  const clearLiveSaves = async () => {
    const names = liveSavePresets.map((preset) => preset.name);
    if (names.length === 0) return;

    let next = [...presets];
    for (const name of names) {
      const updated = await window.electronAPI?.deletePreset?.(name, getLiveSaveRetention());
      if (Array.isArray(updated)) next = updated;
    }

    setPresets(next);
  };

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

        {/* Sound Effects */}
        <section className="rounded-xl border border-white/10 bg-surface-raised p-4" aria-label={t('settings.soundEffects')}>
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2 min-w-0">
              <Volume2 className={cn('w-4 h-4 shrink-0', uiSfxEnabled ? 'text-emerald-300' : 'text-white/35')} aria-hidden="true" />
              <div className="min-w-0">
                <h3 className="text-sm font-semibold">{t('settings.soundEffects')}</h3>
                <p className="text-[11px] text-white/45">{t('settings.soundEffectsDesc')}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setUiSfxEnabled(!uiSfxEnabled)}
              aria-pressed={uiSfxEnabled}
              aria-label={t('settings.soundEffects')}
              className={cn(
                'relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none active:scale-[0.96]',
                uiSfxEnabled ? 'bg-emerald-500' : 'bg-white/15'
              )}
            >
              <span
                className={cn(
                  'inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform',
                  uiSfxEnabled ? 'translate-x-6' : 'translate-x-1'
                )}
              />
            </button>
          </div>
        </section>

        {/* Soniox Real-time Captions & Translation */}
        <section className="rounded-xl border border-white/10 bg-surface-raised p-4 space-y-4" aria-label={t('settings.soniox')}>
          <div className="flex items-center gap-2">
            <Mic className="w-4 h-4 text-blue-400 shrink-0" aria-hidden="true" />
            <div>
              <h3 className="text-sm font-semibold">{t('settings.soniox')}</h3>
              <p className="text-[11px] text-white/45">{t('settings.sonioxDesc')}</p>
            </div>
          </div>

          {/* API key status */}
          <div
            className={cn(
              'flex items-center gap-2 rounded-lg border px-3 py-2 text-xs',
              sttHasKey
                ? 'border-emerald-500/25 bg-emerald-500/5 text-emerald-200'
                : 'border-amber-500/25 bg-amber-500/5 text-amber-100/90'
            )}
          >
            {sttHasKey ? (
              <>
                <Check className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                <span>{t('settings.sonioxKeyConfigured')}</span>
              </>
            ) : (
              <>
                <KeyRound className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                <span>{t('settings.sonioxKeyMissing')}</span>
              </>
            )}
            {sttKeyHint && (
              <span className="ml-auto font-mono text-[10px] text-white/40" title={sttKeyHint}>
                {sttKeyHint}
              </span>
            )}
          </div>

          {/* API key input (password, write-only) */}
          <div className="space-y-1.5">
            <label htmlFor="soniox-api-key" className="block text-[11px] text-white/55">
              {t('settings.sonioxApiKey')}
            </label>
            <div className="flex gap-2">
              <input
                id="soniox-api-key"
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={apiKeyDraft}
                onChange={(e) => setApiKeyDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void saveApiKey();
                }}
                placeholder={sttHasKey ? '••••••••••••••••' : t('settings.sonioxApiKeyPlaceholder')}
                className="flex-1 min-w-0 rounded-lg border border-white/10 bg-surface-overlay px-3 py-2 text-sm outline-none focus-visible:border-blue-500/60 focus-visible:ring-2 focus-visible:ring-blue-500/40 transition-colors"
              />
              <button
                type="button"
                onClick={() => void saveApiKey()}
                disabled={apiKeyState === 'saving'}
                className="shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 px-4 py-2 text-sm font-semibold transition-colors"
              >
                {apiKeyState === 'saving' ? (
                  <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                ) : apiKeyState === 'saved' ? (
                  <Check className="w-4 h-4" aria-hidden="true" />
                ) : (
                  <KeyRound className="w-4 h-4" aria-hidden="true" />
                )}
                {apiKeyState === 'saved' ? t('common.saved') : t('common.save')}
              </button>
            </div>
            <p className="text-[10px] text-white/40">{t('settings.sonioxApiKeyHint')}</p>
            {keyError && <p className="text-[11px] text-red-400">{keyError}</p>}
          </div>

          {/* Default spoken language (STT recognition) */}
          <div className="space-y-1.5">
            <label htmlFor="soniox-stt-language" className="block text-[11px] text-white/55">
              {t('settings.sonioxSttLanguage')}
            </label>
            <div className="flex items-center gap-2">
              <Mic className="w-4 h-4 text-white/35 shrink-0" aria-hidden="true" />
              <select
                id="soniox-stt-language"
                value={sttSpokenLanguage}
                onChange={(e) => changeSpokenLanguage(e.target.value)}
                aria-label={t('settings.sonioxSttLanguage')}
                className="flex-1 min-w-0 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm outline-none focus-visible:border-blue-500/60 focus-visible:ring-2 focus-visible:ring-blue-500/40 transition-colors"
              >
                <option value={AUTO_STT_LANGUAGE} className="bg-surface-overlay">
                  {t('settings.sonioxSttAuto')}
                </option>
                {STT_LANGUAGES.map((lang) => (
                  <option key={lang.code} value={lang.code} className="bg-surface-overlay">
                    {lang.name} ({lang.code})
                  </option>
                ))}
              </select>
            </div>
            <p className="text-[10px] text-white/40">{t('settings.sonioxSttLanguageHint')}</p>
          </div>

          {/* Translation target language */}
          <div className="space-y-1.5">
            <label htmlFor="translation-target-language" className="block text-[11px] text-white/55">
              {t('settings.sonioxTargetLanguage')}
            </label>
            <div className="flex items-center gap-2">
              <Languages className="w-4 h-4 text-white/35 shrink-0" aria-hidden="true" />
              <select
                id="soniox-target-language"
                value={sttTargetLanguage}
                onChange={(e) => changeTargetLanguage(e.target.value)}
                aria-label={t('settings.sonioxTargetLanguage')}
                className="flex-1 min-w-0 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm outline-none focus-visible:border-blue-500/60 focus-visible:ring-2 focus-visible:ring-blue-500/40 transition-colors disabled:opacity-50"
              >
                {STT_LANGUAGES.map((lang) => (
                  <option key={lang.code} value={lang.code} className="bg-surface-overlay">
                    {lang.name} ({lang.code})
                  </option>
                ))}
              </select>
            </div>
            <p className="text-[10px] text-white/40">{t('settings.sonioxTargetLanguageHint')}</p>
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

          <div className="mt-4 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3">
            <div className="flex items-center gap-2 text-emerald-100/90 text-[11px] font-medium uppercase tracking-[0.12em]">
              <DatabaseBackup className="w-3.5 h-3.5" aria-hidden="true" />
              <span>{t('settings.liveSaveRetention')}</span>
            </div>
            <select
              value={String(liveSaveRetentionMs)}
              onChange={(e) => setLiveSaveRetentionMs(Number(e.target.value))}
              className="mt-2 w-full rounded-lg border border-white/10 bg-surface-overlay px-3 py-2 text-sm text-white outline-none focus-visible:border-emerald-400 focus-visible:ring-2 focus-visible:ring-emerald-500/30"
              aria-label={t('settings.liveSaveRetention')}
            >
              {LIVE_SAVE_RETENTION_OPTIONS.map((option) => (
                <option key={option} value={String(option)} className="bg-surface-overlay text-white">
                  {option === 0 ? t('settings.retentionForever') : option === DEFAULT_LIVE_SAVE_RETENTION_MS ? t('settings.retention7d') : option === 24 * 60 * 60 * 1000 ? t('settings.retention1d') : t('settings.retention30d')}
                </option>
              ))}
            </select>
          </div>

          <div className="mt-3 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-[11px] text-emerald-100/80">
            {latestLiveSave ? (
              <div className="flex items-center justify-between gap-3">
                <span>
                  {t('settings.liveSaveLastSaved', {
                    time: new Date(latestLiveSave.createdAt).toLocaleString('tr-TR', {
                      day: '2-digit',
                      month: '2-digit',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    }),
                  })}
                </span>
                <button
                  type="button"
                  onClick={clearLiveSaves}
                  className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[10px] font-medium text-white/75 hover:bg-white/10 transition-colors"
                >
                  <Trash2 className="w-3 h-3" aria-hidden="true" />
                  {t('common.deletePreset')}
                </button>
              </div>
            ) : (
              <span>{t('settings.liveSaveEmpty')}</span>
            )}
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

        {/* Logo filigran */}
        <WatermarkSettingsPanel />
      </div>
    </div>
  );
}