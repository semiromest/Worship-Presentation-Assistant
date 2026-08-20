import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Mic, MicOff, X, Settings2, Languages, Captions, RefreshCw, AlertTriangle, Globe2, LocateFixed, Plus,
} from 'lucide-react';
import { useSttStore } from '../state/useSttStore';
import { refreshSttInputDevices } from '../hooks/useStt';
import { useSlideTrackerStore } from '../state/useSlideTrackerStore';
import { AUTO_STT_LANGUAGE, isAutoSttLanguage, languageName, STT_LANGUAGES } from '../../shared/stt';
import { cn } from '../utils';
import SharePanel from './SharePanel';

interface SttPanelProps {
  onAddCaptionsSlide: () => void;
  onAddUtteranceSlide: (original: string, translation: string) => void;
  onOpenSettings: () => void;
  onStart: () => Promise<void>;
  onStop: () => Promise<void>;
  onStartShare: () => Promise<void>;
  onStopShare: () => Promise<void>;
}

/**
 * Live captions & translation panel.
 *
 * STT and translation are independent: the STT toggle starts/stops the
 * microphone + Soniox session, while the translation toggle controls whether
 * the session requests one-way translation (and whether translated text is
 * rendered). Both language pickers are separate — the spoken language biases
 * recognition ('auto' = auto-detect) and the target language is where the
 * spoken text gets translated to. Language/translation changes are applied on
 * the next session start (Soniox fixes them at session creation), so they are
 * locked while a session is active.
 */
export default function SttPanel({ onAddCaptionsSlide, onAddUtteranceSlide, onOpenSettings, onStart, onStop, onStartShare, onStopShare }: SttPanelProps) {
  const { t } = useTranslation();

  const status = useSttStore((s) => s.status);
  const hasKey = useSttStore((s) => s.hasKey);
  const micActive = useSttStore((s) => s.micActive);
  const sttLanguage = useSttStore((s) => s.sttLanguage);
  const targetLanguage = useSttStore((s) => s.targetLanguage);
  const translationEnabled = useSttStore((s) => s.translationEnabled);
  const setSttLanguage = useSttStore((s) => s.setSttLanguage);
  const setTargetLanguage = useSttStore((s) => s.setTargetLanguage);
  const setTranslationEnabled = useSttStore((s) => s.setTranslationEnabled);
  const detectedLanguage = useSttStore((s) => s.detectedLanguage);
  const inputDeviceId = useSttStore((s) => s.inputDeviceId);
  const inputDevices = useSttStore((s) => s.inputDevices);
  const setInputDeviceId = useSttStore((s) => s.setInputDeviceId);
  const currentOriginal = useSttStore((s) => s.currentOriginal);
  const currentTranslation = useSttStore((s) => s.currentTranslation);
  const partialOriginal = useSttStore((s) => s.partialOriginal);
  const partialTranslation = useSttStore((s) => s.partialTranslation);
  const utterances = useSttStore((s) => s.utterances);
  const error = useSttStore((s) => s.error);
  const setError = useSttStore((s) => s.setError);
  const clearAll = useSttStore((s) => s.clearAll);

  // Slide tracker (independent of translation — driven by original text).
  const trackerEnabled = useSlideTrackerStore((s) => s.enabled);
  const setTrackerEnabled = useSlideTrackerStore((s) => s.setEnabled);
  const trackerSensitivity = useSlideTrackerStore((s) => s.sensitivity);
  const setTrackerSensitivity = useSlideTrackerStore((s) => s.setSensitivity);
  const trackerLastResult = useSlideTrackerStore((s) => s.lastResult);

  const active = status !== 'idle';
  const translation = (currentTranslation + partialTranslation).trim();
  const original = (currentOriginal + partialOriginal).trim();
  const detectedName = detectedLanguage ? languageName(detectedLanguage) : null;

  const errorBanner = useMemo(() => {
    if (!error) return null;
    const showSettings = error.code === 'NO_API_KEY' || error.code === 'INVALID_API_KEY';
    return (
      <div
        role="alert"
        className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-xs text-red-200"
      >
        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
        <div className="flex-1 min-w-0 space-y-1.5">
          <p>{error.message}</p>
          {showSettings && (
            <button
              type="button"
              onClick={() => {
                setError(null);
                onOpenSettings();
              }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-red-400/40 bg-red-500/20 px-2.5 py-1 font-semibold text-red-100 hover:bg-red-500/30 transition-colors"
            >
              <Settings2 className="w-3 h-3" aria-hidden="true" />
              {t('common.sttGoToSettings')}
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={() => setError(null)}
          aria-label={t('common.close')}
          className="shrink-0 rounded p-0.5 text-red-200/60 hover:text-red-100 hover:bg-red-500/20 transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }, [error, setError, t, onOpenSettings]);

  // Refresh the audio input device list (labels become available once mic
  // permission is granted) and keep it in sync with device hot-plugging.
  useEffect(() => {
    void refreshSttInputDevices();
    const onDeviceChange = () => void refreshSttInputDevices();
    navigator.mediaDevices?.addEventListener?.('devicechange', onDeviceChange);
    return () => {
      navigator.mediaDevices?.removeEventListener?.('devicechange', onDeviceChange);
    };
  }, []);

  const toggleSession = () => {
    if (active) {
      void onStop();
    } else {
      void onStart();
    }
  };

  return (
    <div className="flex flex-col h-full bg-surface border-l border-white/10 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-white/10 bg-surface-raised shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <Captions className="w-4 h-4 text-blue-400 shrink-0" aria-hidden="true" />
          <div className="min-w-0">
            <h2 className="text-sm font-bold truncate">{t('common.sttPanelTitle')}</h2>
            <p className="text-[10px] text-white/45 truncate">{t('common.sttPanelDesc')}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={clearAll}
          title={t('common.sttClear')}
          aria-label={t('common.sttClear')}
          className="shrink-0 p-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-white/50 hover:text-white/80 transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto space-y-4 p-4">
        {errorBanner}

        {/* Status row */}
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2">
            <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-white/40">
              <Mic className={cn('w-3 h-3', micActive ? 'text-red-400' : 'text-white/30')} aria-hidden="true" />
              {t('common.sttMic')}
            </div>
            <div className="mt-1 flex items-center gap-1.5 text-xs font-semibold">
              <span
                className={cn(
                  'w-1.5 h-1.5 rounded-full',
                  micActive ? 'bg-red-400 animate-pulse' : 'bg-white/20'
                )}
                aria-hidden="true"
              />
              {micActive ? t('common.sttMicOn') : t('common.sttMicOff')}
            </div>
          </div>

          <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2">
            <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-white/40">
              <Globe2 className="w-3 h-3 text-white/30" aria-hidden="true" />
              {t('common.sttSession')}
            </div>
            <div className="mt-1 flex items-center gap-1.5 text-xs font-semibold">
              <span
                className={cn(
                  'w-1.5 h-1.5 rounded-full',
                  status === 'connected' ? 'bg-emerald-400' : status === 'connecting' ? 'bg-amber-400 animate-pulse' : 'bg-white/20'
                )}
                aria-hidden="true"
              />
              {status === 'connected'
                ? t('common.sttConnected')
                : status === 'connecting'
                  ? t('common.sttConnecting')
                  : t('common.sttIdle')}
            </div>
          </div>

          <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2">
            <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-white/40">
              <Languages className={cn('w-3 h-3', translationEnabled ? 'text-emerald-300' : 'text-white/30')} aria-hidden="true" />
              {t('common.sttTranslation')}
            </div>
            <div className="mt-1 flex items-center gap-1.5 text-xs font-semibold">
              <span
                className={cn(
                  'w-1.5 h-1.5 rounded-full',
                  translationEnabled ? 'bg-emerald-400' : 'bg-white/20'
                )}
                aria-hidden="true"
              />
              {translationEnabled
                ? t('common.sttTranslationOn')
                : t('common.sttTranslationOff')}
            </div>
          </div>
        </div>

        {/* Controls */}
        <div className="rounded-xl border border-white/10 bg-white/5 p-3 space-y-3">
          {/* STT toggle — master switch (mic + session) */}
          <button
            type="button"
            onClick={toggleSession}
            disabled={!hasKey && !active}
            className={cn(
              'w-full inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold transition-colors focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none active:scale-[0.98]',
              active
                ? 'bg-red-600 hover:bg-red-700 text-white'
                : 'bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-40 disabled:hover:bg-blue-600'
            )}
          >
            {active ? (
              <>
                <MicOff className="w-4 h-4" aria-hidden="true" />
                {t('common.sttStop')}
              </>
            ) : (
              <>
                <Mic className="w-4 h-4" aria-hidden="true" />
                {t('common.sttStart')}
              </>
            )}
          </button>

          {/* Audio input source */}
          <label className="block space-y-1">
            <span className="text-[10px] font-bold uppercase tracking-widest text-white/40">
              {t('common.sttInputDevice')}
            </span>
            <div className="flex items-center gap-2">
              <Mic className="w-4 h-4 text-white/35 shrink-0" aria-hidden="true" />
              <select
                value={inputDeviceId}
                onChange={(e) => setInputDeviceId(e.target.value)}
                disabled={active}
                aria-label={t('common.sttInputDevice')}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white/80 outline-none focus-visible:border-blue-500/60 transition-colors disabled:opacity-50"
              >
                <option value="" className="bg-surface-overlay">
                  {t('common.sttDefaultInputDevice')}
                </option>
                {inputDevices.map((d, i) => (
                  <option key={d.id} value={d.id} className="bg-surface-overlay">
                    {d.label || t('common.sttMicDeviceFallback', { index: i + 1 })}
                  </option>
                ))}
                {inputDeviceId &&
                  !inputDevices.some((d) => d.id === inputDeviceId) && (
                    <option value={inputDeviceId} className="bg-surface-overlay">
                      {t('common.sttInputDeviceUnavailable')}
                    </option>
                  )}
              </select>
            </div>
            <span className="block text-[10px] text-white/40">{t('common.sttInputDeviceHint')}</span>
          </label>

          {/* Translation toggle — independent of STT */}
          <div className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/5 px-3 py-2.5">
            <div className="flex items-center gap-2 min-w-0">
              <Languages className={cn('w-4 h-4 shrink-0', translationEnabled ? 'text-emerald-300' : 'text-white/35')} aria-hidden="true" />
              <div className="min-w-0">
                <p className="text-xs font-semibold truncate">{t('common.sttTranslationToggle')}</p>
                <p className="text-[10px] text-white/45 truncate">
                  {translationEnabled ? t('common.sttTranslationOnDesc') : t('common.sttTranslationOffDesc')}
                </p>
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={translationEnabled}
              disabled={active}
              onClick={() => setTranslationEnabled(!translationEnabled)}
              aria-label={t('common.sttTranslationToggle')}
              className={cn(
                'relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:outline-none active:scale-[0.96] disabled:opacity-40',
                translationEnabled ? 'bg-emerald-500' : 'bg-white/15'
              )}
            >
              <span
                className={cn(
                  'inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform',
                  translationEnabled ? 'translate-x-6' : 'translate-x-1'
                )}
              />
            </button>
          </div>

          {/* Spoken language (STT) */}
          <label className="block space-y-1">
            <span className="text-[10px] font-bold uppercase tracking-widest text-white/40">
              {t('common.sttSpokenLanguage')}
            </span>
            <div className="flex items-center gap-2">
              <Mic className="w-4 h-4 text-white/35 shrink-0" aria-hidden="true" />
              <select
                value={sttLanguage}
                onChange={(e) => setSttLanguage(e.target.value)}
                disabled={active}
                aria-label={t('common.sttSpokenLanguage')}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white/80 outline-none focus-visible:border-blue-500/60 transition-colors disabled:opacity-50"
              >
                <option value={AUTO_STT_LANGUAGE} className="bg-surface-overlay">
                  {t('common.sttSpokenLanguageAuto')}
                </option>
                {STT_LANGUAGES.map((lang) => (
                  <option key={lang.code} value={lang.code} className="bg-surface-overlay">
                    {lang.name} ({lang.code})
                  </option>
                ))}
              </select>
            </div>
            {!isAutoSttLanguage(sttLanguage) && (
              <span className="block text-[10px] text-white/40">{t('common.sttSpokenLanguageHint')}</span>
            )}
          </label>

          {/* Translation target language */}
          {translationEnabled && (
            <label className="block space-y-1">
              <span className="text-[10px] font-bold uppercase tracking-widest text-white/40">
                {t('common.sttTargetLanguage')}
              </span>
              <div className="flex items-center gap-2">
                <Languages className="w-4 h-4 text-white/35 shrink-0" aria-hidden="true" />
                <select
                  value={targetLanguage}
                  onChange={(e) => setTargetLanguage(e.target.value)}
                  disabled={active}
                  aria-label={t('common.sttTargetLanguage')}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white/80 outline-none focus-visible:border-blue-500/60 transition-colors disabled:opacity-50"
                >
                  {STT_LANGUAGES.map((lang) => (
                    <option key={lang.code} value={lang.code} className="bg-surface-overlay">
                      {lang.name} ({lang.code})
                    </option>
                  ))}
                </select>
              </div>
            </label>
          )}

          {active && (
            <span className="block text-[10px] text-white/40">{t('common.sttNextStart')}</span>
          )}
          {!active && translationEnabled && !micActive && (
            <span className="block text-[10px] text-white/40">{t('common.sttTranslationNeedsStt')}</span>
          )}

          {/* No API key hint */}
          {!hasKey && !active && (
            <div className="rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-100/90">
              {t('common.sttNoApiKeyDesc')}{' '}
              <button
                type="button"
                onClick={onOpenSettings}
                className="underline font-semibold hover:text-amber-50"
              >
                {t('common.sttGoToSettings')}
              </button>
            </div>
          )}

          {/* Insert captions slide */}
          <button
            type="button"
            onClick={onAddCaptionsSlide}
            className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-dashed border-white/20 px-4 py-2 text-xs font-semibold text-white/60 hover:text-white hover:border-white/40 hover:bg-white/5 transition-colors"
          >
            <Captions className="w-3.5 h-3.5" aria-hidden="true" />
            {t('common.sttAddCaptionsSlide')}
          </button>
        </div>

        {/* Phone captions/translation share */}
        <SharePanel onStartShare={onStartShare} onStopShare={onStopShare} />

        {/* Auto slide tracking */}
        <div className="rounded-xl border border-white/10 bg-white/5 p-3 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <LocateFixed className="w-4 h-4 text-violet-300 shrink-0" aria-hidden="true" />
              <div className="min-w-0">
                <p className="text-xs font-semibold truncate">{t('common.sttTrackerTitle')}</p>
                <p className="text-[10px] text-white/45 truncate">{t('common.sttTrackerDesc')}</p>
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={trackerEnabled}
              onClick={() => setTrackerEnabled(!trackerEnabled)}
              aria-label={t('common.sttTrackerTitle')}
              className={cn(
                'relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:outline-none active:scale-[0.96]',
                trackerEnabled ? 'bg-violet-500' : 'bg-white/15'
              )}
            >
              <span
                className={cn(
                  'inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform',
                  trackerEnabled ? 'translate-x-6' : 'translate-x-1'
                )}
              />
            </button>
          </div>

          {trackerEnabled && (
            <label className="block space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-widest text-white/40">
                  {t('common.sttTrackerSensitivity')}
                </span>
                <span className="text-[10px] font-semibold text-violet-200/80">{trackerSensitivity}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={trackerSensitivity}
                onChange={(e) => setTrackerSensitivity(Number(e.target.value))}
                aria-label={t('common.sttTrackerSensitivity')}
                className="w-full accent-violet-500"
              />
              <span className="block text-[10px] text-white/40">{t('common.sttTrackerSensitivityHint')}</span>
            </label>
          )}

          {trackerEnabled && trackerLastResult && (
            <p
              className={cn(
                'text-[10px]',
                trackerLastResult.confident ? 'text-violet-200/80' : 'text-white/40'
              )}
            >
              {trackerLastResult.index === null
                ? t('common.sttTrackerIdle')
                : t('common.sttTrackerStatus', {
                    slide: trackerLastResult.index + 1,
                    score: Math.round(trackerLastResult.score * 100),
                  })}
            </p>
          )}
        </div>

        {/* Live transcript */}
        <div className="rounded-xl border border-white/10 bg-black/30 p-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-bold uppercase tracking-widest text-white/40">
              {t('common.sttLive')}
            </span>
            <div className="flex items-center gap-2 min-w-0">
              {detectedName && (
                <span
                  className="shrink-0 rounded-md border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] font-semibold text-white/55"
                  title={t('common.sttDetected')}
                >
                  {detectedName}
                </span>
              )}
              {active && (
                <span className="flex items-center gap-1 text-[10px] font-semibold text-red-400 shrink-0">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" aria-hidden="true" />
                  {t('common.sttListening')}
                </span>
              )}
            </div>
          </div>

          {translationEnabled ? (
            <>
              {translation && (
                <p className="text-sm font-semibold leading-snug whitespace-pre-wrap text-white">
                  {translation}
                </p>
              )}
              {original && (
                <p className="text-xs leading-snug whitespace-pre-wrap text-white/50">
                  {original}
                </p>
              )}
            </>
          ) : (
            original && (
              <p className="text-sm font-semibold leading-snug whitespace-pre-wrap text-white">
                {original}
              </p>
            )
          )}
          {!translation && !original && (
            <p className="text-xs text-white/30">
              {active ? t('common.sttWaiting') : t('common.sttEmpty')}
            </p>
          )}
        </div>

        {/* History */}
        {utterances.length > 0 && (
          <div className="space-y-2">
            <span className="text-[10px] font-bold uppercase tracking-widest text-white/40">
              {t('common.sttHistory')}
            </span>
            <div className="space-y-2">
              {utterances
                .slice()
                .reverse()
                .map((u) => (
                  <div
                    key={u.id}
                    className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 flex items-start gap-2"
                  >
                    <div className="flex-1 min-w-0 space-y-0.5">
                      {translationEnabled && u.translation && (
                        <p className="text-xs font-semibold leading-snug whitespace-pre-wrap text-white">
                          {u.translation}
                        </p>
                      )}
                      {u.original && (
                        <p className={cn('text-[11px] leading-snug whitespace-pre-wrap', translationEnabled ? 'text-white/45' : 'text-white/80')}>
                          {u.original}
                        </p>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => onAddUtteranceSlide(u.original, u.translation)}
                      title={t('common.sttAddUtteranceSlide')}
                      aria-label={t('common.sttAddUtteranceSlide')}
                      className="shrink-0 p-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-white/50 hover:text-white/90 transition-colors"
                    >
                      <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                  </div>
                ))}
            </div>
          </div>
        )}
      </div>

      {/* Footer shortcut to settings */}
      <div className="px-4 py-2.5 border-t border-white/10 bg-surface-raised shrink-0">
        <button
          type="button"
          onClick={onOpenSettings}
          className="w-full inline-flex items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[11px] font-semibold text-white/60 hover:text-white hover:bg-white/10 transition-colors"
        >
          <Settings2 className="w-3.5 h-3.5" aria-hidden="true" />
          {t('common.sttOpenSettings')}
        </button>
      </div>
    </div>
  );
}
