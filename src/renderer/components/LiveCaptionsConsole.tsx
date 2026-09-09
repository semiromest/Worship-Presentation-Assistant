import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Mic,
  MicOff,
  X,
  Settings2,
  Languages,
  Captions,
  RefreshCw,
  AlertTriangle,
  Globe2,
  LocateFixed,
  Plus,
  ChevronDown,
} from 'lucide-react';
import { useSttStore } from '../state/useSttStore';
import { refreshSttInputDevices } from '../hooks/useStt';
import { useSlideTrackerStore } from '../state/useSlideTrackerStore';
import { AUTO_STT_LANGUAGE, isAutoSttLanguage, languageName, STT_LANGUAGES } from '../../shared/stt';
import type { Slide } from '../types';
import { SLIDE_REFERENCE_WIDTH } from '../constants';
import { cn } from '../utils';
import CaptionsRenderer from './CaptionsRenderer';
import SharePanel from './SharePanel';

interface LiveCaptionsConsoleProps {
  /** Captions slide used for the WYSIWYG monitor (the live one when on air, otherwise the deck's). */
  captionsSlide?: Slide;
  /** Whether the current live slide is a captions slide (text reaches the projector). */
  captionsOnAir: boolean;
  /** Make captions appear on the screen now (existing slide → go live; otherwise add + go live). */
  onSendCaptionsLive: () => void;
  onAddCaptionsSlide: () => void;
  onAddUtteranceSlide: (original: string, translation: string) => void;
  onOpenSettings: () => void;
  onStart: () => Promise<void>;
  onStop: () => Promise<void>;
  onStartShare: () => Promise<void>;
  onStopShare: () => Promise<void>;
  onAddQrSlide?: (qrDataUrl: string, url: string) => void;
  onClose: () => void;
}

/** Collapsible settings group with progressive disclosure. */
function Section({
  title,
  open,
  onToggle,
  children,
  badge,
  className,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
  badge?: string;
  className?: string;
}) {
  return (
    <div className={cn('rounded-xl border border-white/10 bg-white/5 overflow-hidden', className)}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-white/5 transition-colors"
      >
        <ChevronDown
          className={cn('w-3.5 h-3.5 text-white/40 transition-transform shrink-0', open ? '' : '-rotate-90')}
          aria-hidden="true"
        />
        <span className="flex-1 min-w-0 text-xs font-bold truncate">{title}</span>
        {badge ? <span className="shrink-0 text-[10px] font-semibold text-white/40">{badge}</span> : null}
      </button>
      {open && <div className="px-3 pb-3 pt-0.5 space-y-2">{children}</div>}
    </div>
  );
}

/**
 * Bottom-docked "Live captions console".
 *
 * Two clear states:
 *  - idle → setup: one big Start action on top, optional settings in
 *    collapsible groups (progressive disclosure);
 *  - live → monitoring: WYSIWYG output preview + big Stop + compact status,
 *    with an inline prompt when the captions slide isn't on the screen yet.
 */
export default function LiveCaptionsConsole({
  captionsSlide,
  captionsOnAir,
  onSendCaptionsLive,
  onAddCaptionsSlide,
  onAddUtteranceSlide,
  onOpenSettings,
  onStart,
  onStop,
  onStartShare,
  onStopShare,
  onAddQrSlide,
  onClose,
}: LiveCaptionsConsoleProps) {
  const { t } = useTranslation();

  const status = useSttStore((s) => s.status);
  const hasKey = useSttStore((s) => s.hasKey);
  const micActive = useSttStore((s) => s.micActive);
  const sttLanguage = useSttStore((s) => s.sttLanguage);
  const targetLanguages = useSttStore((s) => s.targetLanguages);
  const translationEnabled = useSttStore((s) => s.translationEnabled);
  const setSttLanguage = useSttStore((s) => s.setSttLanguage);
  const setTargetLanguages = useSttStore((s) => s.setTargetLanguages);
  const setTranslationEnabled = useSttStore((s) => s.setTranslationEnabled);
  const detectedLanguage = useSttStore((s) => s.detectedLanguage);
  const inputDeviceId = useSttStore((s) => s.inputDeviceId);
  const inputDevices = useSttStore((s) => s.inputDevices);
  const setInputDeviceId = useSttStore((s) => s.setInputDeviceId);
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
  const [openSections, setOpenSections] = useState<string[]>(['languages']);
  const [targetLanguageSearch, setTargetLanguageSearch] = useState('');

  const detectedName = detectedLanguage ? languageName(detectedLanguage) : null;
  const spokenName = isAutoSttLanguage(sttLanguage) ? t('common.sttSpokenLanguageAuto') : languageName(sttLanguage);
  const targetsName = targetLanguages.map(languageName).join(', ');

  const filteredTargetLanguages = useMemo(() => {
    const query = targetLanguageSearch.trim().toLocaleLowerCase();
    if (!query) return STT_LANGUAGES;
    return STT_LANGUAGES.filter((lang) => `${lang.name} ${lang.code}`.toLocaleLowerCase().includes(query));
  }, [targetLanguageSearch]);

  const toggleSection = (id: string) =>
    setOpenSections((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const toggleTargetLanguage = (code: string) => {
    const next = targetLanguages.includes(code)
      ? targetLanguages.filter((selected) => selected !== code)
      : [...targetLanguages, code];
    setTargetLanguages(next.length ? next : [code]);
  };

  const toggleSession = () => {
    if (active) void onStop();
    else void onStart();
  };

  // Refresh the audio input device list (labels appear once mic permission is
  // granted) and keep it in sync with hot-plugging.
  useEffect(() => {
    void refreshSttInputDevices();
    const onDeviceChange = () => void refreshSttInputDevices();
    navigator.mediaDevices?.addEventListener?.('devicechange', onDeviceChange);
    return () => {
      navigator.mediaDevices?.removeEventListener?.('devicechange', onDeviceChange);
    };
  }, []);

  const sessionLabel =
    status === 'connected'
      ? t('common.sttConnected')
      : status === 'connecting'
        ? t('common.sttConnecting')
        : t('common.sttIdle');
  const sessionDot =
    status === 'connected' ? 'bg-emerald-400' : status === 'connecting' ? 'bg-amber-400 animate-pulse' : 'bg-white/20';

  const errorBanner = error ? (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200"
    >
      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
      <div className="flex-1 min-w-0 space-y-1.5">
        <p>{error.message}</p>
        {(error.code === 'NO_API_KEY' || error.code === 'INVALID_API_KEY') && (
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
  ) : null;

  const monitorNote = active
    ? captionsOnAir
      ? { tone: 'text-emerald-300 border-emerald-400/30 bg-emerald-400/10', text: t('common.sttOnAir') }
      : { tone: 'text-amber-300 border-amber-400/30 bg-amber-400/10', text: t('common.sttOffAir') }
    : { tone: 'text-white/45 border-white/10 bg-white/5', text: t('common.sttSessionReady') };

  return (
    <section aria-label={t('common.sttPanelTitle')} className="flex flex-col h-full bg-surface overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-white/10 bg-surface-raised shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <Captions className="w-4 h-4 text-blue-400 shrink-0" aria-hidden="true" />
          <div className="min-w-0">
            <h2 className="text-sm font-bold truncate leading-tight">{t('common.sttPanelTitle')}</h2>
            <p className="text-[10px] text-white/45 truncate leading-tight">{t('common.sttPanelDesc')}</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span
            className={cn(
              'hidden md:inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[10px] font-bold mr-1',
              monitorNote.tone
            )}
          >
            {active && micActive && (
              <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" aria-hidden="true" />
            )}
            {active ? t('common.sttSessionLive') : t('common.sttSessionReady')}
          </span>
          <button
            type="button"
            onClick={clearAll}
            disabled={active}
            title={active ? t('common.sttNextStart') : t('common.sttClear')}
            aria-label={t('common.sttClear')}
            className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-white/50 hover:text-white/80 transition-colors disabled:opacity-40 disabled:hover:bg-white/5"
          >
            <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={onOpenSettings}
            title={t('common.sttOpenSettings')}
            aria-label={t('common.sttOpenSettings')}
            className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-white/50 hover:text-white/80 transition-colors"
          >
            <Settings2 className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={onClose}
            title={t('common.close')}
            aria-label={t('common.close')}
            className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-white/50 hover:text-white/80 transition-colors"
          >
            <X className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-1 min-h-0 gap-4 p-3">
        {/* ── Output monitor: compact 16:9 screen, left-aligned ── */}
        <div className="flex flex-col gap-2 shrink-0 max-w-[46%] min-w-0">
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-[10px] font-bold uppercase tracking-widest text-white/40">
              {t('common.sttMonitor')}
            </span>
            {detectedName && active && (
              <span
                className="rounded-md border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] font-semibold text-white/55"
                title={t('common.sttDetected')}
              >
                {detectedName}
              </span>
            )}
            <span
              className={cn(
                'ml-auto inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[10px] font-bold',
                monitorNote.tone
              )}
            >
              {active && micActive && (
                <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" aria-hidden="true" />
              )}
              {monitorNote.text}
            </span>
          </div>
          <div className="relative aspect-video h-[calc(100%-30px)] max-w-full rounded-xl border border-white/10 bg-black overflow-hidden">
            <FitStage
              captionsSlide={captionsSlide}
              captionsOnAir={captionsOnAir}
              active={active}
              translationEnabled={translationEnabled}
              onSendCaptionsLive={onSendCaptionsLive}
              onAddCaptionsSlide={onAddCaptionsSlide}
            />
          </div>
        </div>

        {/* ── Controls: fill the remaining space ── */}
        <div className="flex-1 min-w-0 flex flex-col">
          <div className="flex-1 min-h-0 overflow-y-auto space-y-3 pr-0.5">
            {errorBanner}

            {active ? (
              <>
                {/* Big Stop */}
                <button
                  type="button"
                  onClick={toggleSession}
                  className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-red-600 hover:bg-red-700 px-4 py-3 text-sm font-bold text-white transition-colors focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:outline-none active:scale-[0.99]"
                >
                  <MicOff className="w-4 h-4" aria-hidden="true" />
                  {t('common.sttStop')}
                </button>

                {/* Compact status list */}
                <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2.5">
                  <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-white/40">
                          <Mic className="w-3 h-3 text-white/35" aria-hidden="true" />
                          {t('common.sttMic')}
                        </span>
                        <span
                          className={cn(
                            'flex items-center gap-1.5 text-xs font-semibold',
                            micActive ? 'text-red-300' : 'text-white/50'
                          )}
                        >
                          <span
                            className={cn(
                              'w-1.5 h-1.5 rounded-full',
                              micActive ? 'bg-red-400 animate-pulse' : 'bg-white/20'
                            )}
                            aria-hidden="true"
                          />
                          {micActive ? t('common.sttMicOn') : t('common.sttMicOff')}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-white/40">
                          <Globe2 className="w-3 h-3 text-white/35" aria-hidden="true" />
                          {t('common.sttSession')}
                        </span>
                        <span className="flex items-center gap-1.5 text-xs font-semibold text-white/80">
                          <span className={cn('w-1.5 h-1.5 rounded-full', sessionDot)} aria-hidden="true" />
                          {sessionLabel}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-white/40">
                          <Languages className="w-3 h-3 text-white/35" aria-hidden="true" />
                          {t('common.sttTranslation')}
                        </span>
                        <span className="flex items-center gap-1.5 text-xs font-semibold text-white/80">
                          <span
                            className={cn(
                              'w-1.5 h-1.5 rounded-full',
                              translationEnabled ? 'bg-emerald-400' : 'bg-white/20'
                            )}
                            aria-hidden="true"
                          />
                          {translationEnabled ? t('common.sttTranslationOn') : t('common.sttTranslationOff')}
                        </span>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <div className="flex flex-wrap gap-1.5 pt-0.5">
                        <span className="rounded-full border border-white/10 bg-black/20 px-2 py-0.5 text-[10px] text-white/60">
                          {spokenName}
                        </span>
                        {translationEnabled && targetsName && (
                          <>
                            <span className="text-[10px] text-white/25 self-center" aria-hidden="true">
                              →
                            </span>
                            <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2 py-0.5 text-[10px] text-emerald-200">
                              {targetsName}
                            </span>
                          </>
                        )}
                      </div>
                      <p className="text-[10px] text-white/40">{t('common.sttNextStart')}</p>
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <>
                {/* Start — the single primary action while idle */}
                <div className="rounded-xl border border-white/10 bg-white/5 p-3 space-y-2">
                  <button
                    type="button"
                    onClick={toggleSession}
                    disabled={!hasKey}
                    className={cn(
                      'w-full inline-flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-bold transition-colors focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none active:scale-[0.99]',
                      hasKey
                        ? 'bg-blue-600 hover:bg-blue-500 text-white'
                        : 'bg-blue-600 text-white opacity-40 cursor-not-allowed'
                    )}
                  >
                    <Mic className="w-4 h-4" aria-hidden="true" />
                    {t('common.sttStart')}
                  </button>
                  <p className="text-[11px] text-white/55 leading-snug text-center">
                    {translationEnabled ? t('common.sttTranslationOnDesc') : t('common.sttTranslationOffDesc')}
                  </p>
                  <div className="flex items-center justify-center gap-1.5 flex-wrap">
                    <span className="rounded-full border border-white/10 bg-black/20 px-2 py-0.5 text-[10px] text-white/60">
                      {spokenName}
                    </span>
                    {translationEnabled && targetsName && (
                      <>
                        <span className="text-[10px] text-white/25" aria-hidden="true">
                          →
                        </span>
                        <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2 py-0.5 text-[10px] text-emerald-200">
                          {targetsName}
                        </span>
                      </>
                    )}
                  </div>
                  {!hasKey && (
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
                </div>

                <div className="grid grid-cols-2 gap-3">
                  {/* Language & translation */}
                  <Section
                    className="col-span-2"
                    title={t('common.sttLanguages')}
                    open={openSections.includes('languages')}
                    onToggle={() => toggleSection('languages')}
                  >
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

                    <div className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/5 px-3 py-2.5">
                      <div className="flex items-center gap-2 min-w-0">
                        <Languages
                          className={cn('w-4 h-4 shrink-0', translationEnabled ? 'text-emerald-300' : 'text-white/35')}
                          aria-hidden="true"
                        />
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

                    {translationEnabled && (
                      <label className="block space-y-1.5">
                        <span className="text-[10px] font-bold uppercase tracking-widest text-white/40">
                          {t('common.sttTargetLanguage')} ({targetLanguages.length})
                        </span>
                        <input
                          type="search"
                          value={targetLanguageSearch}
                          onChange={(e) => setTargetLanguageSearch(e.target.value)}
                          disabled={active}
                          placeholder={t('common.sttTargetLanguageSearch')}
                          aria-label={t('common.sttTargetLanguageSearch')}
                          className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white/80 placeholder:text-white/35 outline-none focus-visible:border-blue-500/60 transition-colors disabled:opacity-50"
                        />
                        <div className="grid grid-cols-2 gap-1.5 max-h-36 overflow-y-auto rounded-lg border border-white/10 bg-black/10 p-1.5">
                          {filteredTargetLanguages.length > 0 ? (
                            filteredTargetLanguages.map((lang) => {
                              const selected = targetLanguages.includes(lang.code);
                              return (
                                <button
                                  key={lang.code}
                                  type="button"
                                  onClick={() => toggleTargetLanguage(lang.code)}
                                  disabled={active}
                                  aria-pressed={selected}
                                  className={cn(
                                    'rounded-md px-2 py-1.5 text-left text-[11px] transition-colors disabled:opacity-50',
                                    selected
                                      ? 'bg-emerald-400/20 text-emerald-100 ring-1 ring-emerald-400/40'
                                      : 'bg-white/5 text-white/65 hover:bg-white/10 hover:text-white'
                                  )}
                                >
                                  {lang.name} <span className="text-white/35">({lang.code})</span>
                                </button>
                              );
                            })
                          ) : (
                            <span className="col-span-2 px-2 py-2 text-[11px] text-white/40">
                              {t('common.sttTargetLanguageNoResults')}
                            </span>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {targetLanguages.map((code) => (
                            <button
                              key={code}
                              type="button"
                              onClick={() => toggleTargetLanguage(code)}
                              disabled={active}
                              title={t('common.sttTargetLanguageRemove')}
                              aria-label={`${languageName(code)} ${t('common.sttTargetLanguageRemove')}`}
                              className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2 py-0.5 text-[10px] text-emerald-100 hover:bg-red-400/15 hover:border-red-400/40 hover:text-red-100 disabled:opacity-50"
                            >
                              {languageName(code)} ×
                            </button>
                          ))}
                        </div>
                        <span className="block text-[10px] text-white/40">{t('common.sttTargetLanguageHint')}</span>
                      </label>
                    )}
                  </Section>

                  {/* Phone sharing — self-contained card */}
                  <div className="col-span-2">
                    <SharePanel onStartShare={onStartShare} onStopShare={onStopShare} onAddQrSlide={onAddQrSlide} />
                  </div>

                  {/* Microphone / input source */}
                  <Section
                    title={t('common.sttMic')}
                    open={openSections.includes('mic')}
                    onToggle={() => toggleSection('mic')}
                  >
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
                          {inputDeviceId && !inputDevices.some((d) => d.id === inputDeviceId) && (
                            <option value={inputDeviceId} className="bg-surface-overlay">
                              {t('common.sttInputDeviceUnavailable')}
                            </option>
                          )}
                        </select>
                      </div>
                      <span className="block text-[10px] text-white/40">{t('common.sttInputDeviceHint')}</span>
                    </label>
                  </Section>

                  {/* Advanced (slide tracking) */}
                  <Section
                    title={t('common.sttAdvanced')}
                    open={openSections.includes('advanced')}
                    onToggle={() => toggleSection('advanced')}
                  >
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
                  </Section>

                  {/* Utterance history */}
                  {utterances.length > 0 && (
                    <Section
                      className="col-span-2"
                      title={t('common.sttHistory')}
                      badge={String(utterances.length)}
                      open={openSections.includes('history')}
                      onToggle={() => toggleSection('history')}
                    >
                      {utterances
                        .slice()
                        .reverse()
                        .map((u) => (
                          <div
                            key={u.id}
                            className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 flex items-start gap-2"
                          >
                            <div className="flex-1 min-w-0 space-y-0.5">
                              {translationEnabled && u.translation && (
                                <p className="text-xs font-semibold leading-snug whitespace-pre-wrap text-white">
                                  {u.translation}
                                </p>
                              )}
                              {u.original && (
                                <p
                                  className={cn(
                                    'text-[11px] leading-snug whitespace-pre-wrap',
                                    translationEnabled ? 'text-white/45' : 'text-white/80'
                                  )}
                                >
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
                    </Section>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ─── 16:9 output stage ───────────────────────────────────────────────────── */

function FitStage({
  captionsSlide,
  captionsOnAir,
  active,
  translationEnabled,
  onSendCaptionsLive,
  onAddCaptionsSlide,
}: {
  captionsSlide?: Slide;
  captionsOnAir: boolean;
  active: boolean;
  translationEnabled: boolean;
  onSendCaptionsLive: () => void;
  onAddCaptionsSlide: () => void;
}) {
  const { t } = useTranslation();
  const outerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number; s: number } | null>(null);

  useEffect(() => {
    const el = outerRef.current;
    if (!el) return;
    const update = () => {
      const pw = el.clientWidth;
      const ph = el.clientHeight;
      if (pw === 0 || ph === 0) return;
      const target = 16 / 9;
      let w: number;
      let h: number;
      if (pw / ph > target) {
        h = ph;
        w = h * target;
      } else {
        w = pw;
        h = w / target;
      }
      setSize({ w, h, s: w / SLIDE_REFERENCE_WIDTH });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // True WYSIWYG whenever a captions slide exists and either it is on air, or
  // nothing is running yet (styled idle preview of the deck's captions slide).
  const showWysiwyg = !!captionsSlide && (captionsOnAir || !active);

  return (
    <div ref={outerRef} className="absolute inset-0 flex items-center justify-center overflow-hidden bg-black">
      {size &&
        (showWysiwyg && captionsSlide ? (
          <div style={{ width: size.w, height: size.h }}>
            <CaptionsRenderer slide={captionsSlide} width={size.w} height={size.h} scale={size.s} />
          </div>
        ) : (
          <OffAirStage width={size.w} height={size.h} translationEnabled={translationEnabled} active={active} />
        ))}
      {!showWysiwyg && active && (
        <div className="absolute left-0 right-0 bottom-0 flex items-center justify-between gap-3 px-4 py-3 bg-gradient-to-t from-black/90 to-transparent">
          <p className="text-[11px] text-white/55">{t('common.sttOffAir')}</p>
          <button
            type="button"
            onClick={captionsSlide ? onSendCaptionsLive : onAddCaptionsSlide}
            className="shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 px-3 py-1.5 text-xs font-bold text-white transition-colors active:scale-[0.98]"
          >
            <Captions className="w-3.5 h-3.5" aria-hidden="true" />
            {captionsSlide ? t('common.sttSendLive') : t('common.sttAddCaptionsSlide')}
          </button>
        </div>
      )}
      {!showWysiwyg && !active && size && (
        <div className="flex flex-col items-center gap-3 px-6 text-center" style={{ width: size.w }}>
          <Captions className="w-8 h-8 text-white/20" aria-hidden="true" />
          <p className="text-xs text-white/45 max-w-md leading-relaxed">{t('common.sttAddCaptionsSlideHint')}</p>
          <button
            type="button"
            onClick={onAddCaptionsSlide}
            className="inline-flex items-center gap-2 rounded-xl border border-dashed border-white/25 px-4 py-2 text-xs font-semibold text-white/65 hover:text-white hover:border-white/45 hover:bg-white/5 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" aria-hidden="true" />
            {t('common.sttAddCaptionsSlide')}
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Fallback stage shown while the session is running but the captions slide is
 * not on the screen: a readable live transcript mirroring the caption layout.
 */
function OffAirStage({
  width,
  height,
  translationEnabled,
  active,
}: {
  width: number;
  height: number;
  translationEnabled: boolean;
  active: boolean;
}) {
  const { t } = useTranslation();
  const currentTranslation = useSttStore((s) => s.currentTranslation);
  const partialTranslation = useSttStore((s) => s.partialTranslation);
  const currentOriginal = useSttStore((s) => s.currentOriginal);
  const partialOriginal = useSttStore((s) => s.partialOriginal);
  const lastTranslation = useSttStore((s) => s.lastTranslation);
  const lastOriginal = useSttStore((s) => s.lastOriginal);

  const liveTranslation = (currentTranslation + partialTranslation).trim();
  const liveOriginal = (currentOriginal + partialOriginal).trim();
  const hasLive = liveTranslation.length > 0 || liveOriginal.length > 0;
  const translation = hasLive ? liveTranslation : lastTranslation;
  const original = hasLive ? liveOriginal : lastOriginal;
  const primary = translationEnabled ? translation : original;

  return (
    <div
      className="flex flex-col items-center justify-center px-[6%] text-center"
      style={{ width, height, backgroundColor: '#000000' }}
    >
      <div className="w-full">
        {primary ? (
          <p
            className="whitespace-pre-wrap break-words text-center leading-snug w-full font-bold text-white"
            style={{ fontSize: Math.max(16, 30 * (width / 1920)) }}
          >
            {primary}
          </p>
        ) : (
          <p className="text-white/35 text-center w-full" style={{ fontSize: Math.max(13, 22 * (width / 1920)) }}>
            {active ? t('common.sttWaiting') : t('common.sttEmpty')}
          </p>
        )}
        {translationEnabled && original && (
          <p
            className="whitespace-pre-wrap break-words text-center leading-snug w-full text-white/50 mt-2"
            style={{ fontSize: Math.max(11, 17 * (width / 1920)) }}
          >
            {original}
          </p>
        )}
      </div>
    </div>
  );
}
