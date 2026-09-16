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
  LocateFixed,
  Plus,
  ChevronDown,
  ChevronUp,
  Download,
} from 'lucide-react';
import { useSttStore } from '../state/useSttStore';
import { refreshSttInputDevices } from '../hooks/useStt';
import { useSlideTrackerStore } from '../state/useSlideTrackerStore';
import { useStore } from '../state/useStore';
import { AUTO_STT_LANGUAGE, isAutoSttLanguage, languageName, STT_LANGUAGES } from '../../shared/stt';
import type { Slide } from '../types';
import { SLIDE_REFERENCE_WIDTH } from '../constants';
import { cn } from '../utils';
import CaptionsRenderer from './CaptionsRenderer';
import SharePanel from './SharePanel';

type ConsoleTab = 'setup' | 'share' | 'history';

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
    <div
      className={cn(
        'rounded-[var(--radius-lg)] border border-white/10 bg-white/5 overflow-hidden',
        className
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-white/5 transition-colors"
      >
        <ChevronDown
          className={cn('w-3.5 h-3.5 text-white/40 transition-transform shrink-0', open ? '' : '-rotate-90')}
          aria-hidden="true"
        />
        <span className="flex-1 min-w-0 text-xs font-semibold truncate">{title}</span>
        {badge ? <span className="shrink-0 text-[11px] font-semibold text-white/40">{badge}</span> : null}
      </button>
      {open && <div className="px-3 pb-2.5 pt-0.5 space-y-2">{children}</div>}
    </div>
  );
}

function FieldLabel({ children }: { children: ReactNode }) {
  return <span className="text-xs text-white/55">{children}</span>;
}

/**
 * Bottom-docked "Live captions console" — broadcast control desk layout.
 *
 * Shared shell for idle + live: hero output monitor on the left; primary
 * Start/Stop + tabs (Setup / Share / History) on the right.
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
  const { t, i18n } = useTranslation();

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

  const currentTranslation = useSttStore((s) => s.currentTranslation);
  const partialTranslation = useSttStore((s) => s.partialTranslation);
  const currentOriginal = useSttStore((s) => s.currentOriginal);
  const partialOriginal = useSttStore((s) => s.partialOriginal);

  const shareActive = useStore((s) => s.shareActive);

  const trackerEnabled = useSlideTrackerStore((s) => s.enabled);
  const setTrackerEnabled = useSlideTrackerStore((s) => s.setEnabled);
  const trackerSensitivity = useSlideTrackerStore((s) => s.sensitivity);
  const setTrackerSensitivity = useSlideTrackerStore((s) => s.setSensitivity);
  const trackerLastResult = useSlideTrackerStore((s) => s.lastResult);

  const active = status !== 'idle';
  const [openSections, setOpenSections] = useState<string[]>(['mic']);
  const [targetLanguageSearch, setTargetLanguageSearch] = useState('');
  const [tickerOpen, setTickerOpen] = useState(true);
  const [tab, setTab] = useState<ConsoleTab>('setup');
  const prevActiveRef = useRef(active);

  const detectedName = detectedLanguage ? languageName(detectedLanguage) : null;
  const spokenName = isAutoSttLanguage(sttLanguage) ? t('common.sttSpokenLanguageAuto') : languageName(sttLanguage);
  const targetsName = targetLanguages.map(languageName).join(', ');

  const liveText = translationEnabled
    ? (currentTranslation + partialTranslation).trim() || (currentOriginal + partialOriginal).trim()
    : (currentOriginal + partialOriginal).trim();

  const filteredTargetLanguages = useMemo(() => {
    const query = targetLanguageSearch.trim().toLocaleLowerCase();
    if (!query) return STT_LANGUAGES;
    return STT_LANGUAGES.filter((lang) => `${lang.name} ${lang.code}`.toLocaleLowerCase().includes(query));
  }, [targetLanguageSearch]);

  // Default tab: idle → Setup; live → History (or Share if already broadcasting).
  useEffect(() => {
    const wasActive = prevActiveRef.current;
    prevActiveRef.current = active;
    if (active && !wasActive) {
      setTab(shareActive ? 'share' : 'history');
    } else if (!active && wasActive) {
      setTab('setup');
    }
  }, [active, shareActive]);

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

  const downloadHistory = () => {
    if (utterances.length === 0) return;
    const locale = i18n.language || 'en';
    const dateFormatter = new Intl.DateTimeFormat(locale, {
      dateStyle: 'short',
      timeStyle: 'medium',
    });
    const lines = utterances.map((utterance, index) => {
      const parts = [
        `${index + 1}. ${dateFormatter.format(new Date(utterance.at))}`,
        utterance.translation ? `${t('common.sttExportTranslation')}: ${utterance.translation}` : '',
        utterance.original ? `${t('common.sttExportOriginal')}: ${utterance.original}` : '',
      ].filter(Boolean);
      return parts.join('\n');
    });
    const content = `${t('common.sttPanelTitle')}\n${'='.repeat(40)}\n\n${lines.join('\n\n')}\n`;
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `live-captions-${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };

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

  // Unified status: one strip in the header (not duplicated on the monitor).
  const statusTone = !active
    ? 'text-white/55 border-white/10 bg-white/5'
    : captionsOnAir
      ? 'text-emerald-300 border-emerald-400/30 bg-emerald-400/10'
      : 'text-amber-300 border-amber-400/30 bg-amber-400/10';
  const statusText = !active
    ? t('common.sttSessionReady')
    : captionsOnAir
      ? t('common.sttOnAir')
      : t('common.sttOffAir');

  const monitorFrame = !active
    ? 'border-white/10'
    : captionsOnAir
      ? 'border-emerald-400/50 ring-2 ring-emerald-500/30'
      : 'border-amber-400/45 ring-2 ring-amber-500/25';

  const showSendLiveCta = active && !captionsOnAir;

  const errorBanner = error ? (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-[var(--radius-lg)] border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200"
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

  const tabs: { id: ConsoleTab; label: string; badge?: string }[] = [
    { id: 'setup', label: t('common.sttTabSetup') },
    { id: 'share', label: t('common.sttTabShare') },
    {
      id: 'history',
      label: t('common.sttTabHistory'),
      badge: utterances.length > 0 ? String(utterances.length) : undefined,
    },
  ];

  return (
    <section aria-label={t('common.sttPanelTitle')} className="flex flex-col h-full bg-surface overflow-hidden">
      {/* Header — unified status */}
      <div
        className="flex items-center justify-between gap-2 px-4 py-1.5 border-b border-white/10 bg-surface-raised shrink-0"
        title={t('common.sttPanelDesc')}
      >
        <div className="flex items-center gap-2 min-w-0">
          <Captions className="w-4 h-4 text-blue-400 shrink-0" aria-hidden="true" />
          <h2 className="text-sm font-semibold truncate leading-tight">{t('common.sttPanelTitle')}</h2>
          <span
            role="status"
            aria-live="polite"
            className={cn(
              'hidden sm:inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-semibold max-w-[min(280px,40vw)] truncate',
              statusTone
            )}
          >
            {active && micActive && (
              <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse shrink-0" aria-hidden="true" />
            )}
            {!active && <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', sessionDot)} aria-hidden="true" />}
            {active && !micActive && (
              <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', sessionDot)} aria-hidden="true" />
            )}
            {statusText}
          </span>
          <span className="hidden md:inline-flex items-center gap-1 text-[11px] font-semibold text-white/50 shrink-0 min-w-0">
            <span className="truncate">{spokenName}</span>
            {translationEnabled && targetsName ? (
              <>
                <span className="text-white/25" aria-hidden="true">
                  →
                </span>
                <span className="text-emerald-300/90 truncate">{targetsName}</span>
              </>
            ) : null}
          </span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
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

      {/* Body — broadcast desk grid */}
      <div className="flex-1 min-h-0 grid grid-cols-1 max-lg:grid-rows-[minmax(140px,200px)_minmax(0,1fr)] lg:grid-cols-[minmax(0,1.05fr)_minmax(280px,0.95fr)] gap-3 p-3">
        {/* Output monitor */}
        <div className="flex flex-col gap-1.5 min-h-0 min-w-0">
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-white/40">
              {t('common.sttMonitor')}
            </span>
            {detectedName && active && (
              <span
                className="rounded-md border border-white/10 bg-white/5 px-1.5 py-0.5 text-[11px] font-semibold text-white/55"
                title={t('common.sttDetected')}
              >
                {detectedName}
              </span>
            )}
            {active && (
              <span className="ml-auto flex items-center gap-1.5 text-[11px] font-semibold text-white/50">
                <span className={cn('w-1.5 h-1.5 rounded-full', sessionDot)} aria-hidden="true" />
                {sessionLabel}
              </span>
            )}
          </div>
          <div
            className={cn(
              'relative flex-1 min-h-0 rounded-[var(--radius-lg)] border bg-black overflow-hidden',
              monitorFrame
            )}
          >
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

        {/* Controls */}
        <div className="flex flex-col min-h-0 min-w-0 gap-2">
          {/* Primary action — always top of the control column */}
          <button
            type="button"
            onClick={toggleSession}
            disabled={!active && !hasKey}
            className={cn(
              'w-full shrink-0 inline-flex items-center justify-center gap-2 rounded-[var(--radius-lg)] px-4 py-2.5 text-sm font-bold text-white transition-colors focus-visible:outline-none active:scale-[0.99]',
              active
                ? 'bg-red-600 hover:bg-red-700 focus-visible:ring-2 focus-visible:ring-red-400'
                : hasKey
                  ? 'bg-blue-600 hover:bg-blue-500 focus-visible:ring-2 focus-visible:ring-blue-500'
                  : 'bg-blue-600 opacity-40 cursor-not-allowed'
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

          {showSendLiveCta && (
            <button
              type="button"
              onClick={captionsSlide ? onSendCaptionsLive : onAddCaptionsSlide}
              className="w-full shrink-0 inline-flex items-center justify-center gap-1.5 rounded-[var(--radius-lg)] border border-emerald-400/40 bg-emerald-500/10 hover:bg-emerald-500/20 px-3 py-2 text-xs font-bold text-emerald-100 transition-colors active:scale-[0.99]"
            >
              <Captions className="w-3.5 h-3.5" aria-hidden="true" />
              {captionsSlide ? t('common.sttSendLive') : t('common.sttAddCaptionsSlide')}
            </button>
          )}

          {!hasKey && !active && (
            <div className="shrink-0 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-100/90">
              {t('common.sttNoApiKeyDesc')}{' '}
              <button type="button" onClick={onOpenSettings} className="underline font-semibold hover:text-amber-50">
                {t('common.sttGoToSettings')}
              </button>
            </div>
          )}

          {/* Live transcript ticker */}
          {active && (
            <div className="shrink-0 rounded-[var(--radius-lg)] border border-white/10 bg-white/5 overflow-hidden">
              <button
                type="button"
                onClick={() => setTickerOpen((o) => !o)}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left hover:bg-white/5 transition-colors"
                aria-expanded={tickerOpen}
              >
                <span
                  className={cn('w-1.5 h-1.5 rounded-full shrink-0', micActive ? 'bg-red-400 animate-pulse' : sessionDot)}
                  aria-hidden="true"
                />
                <span className="flex-1 min-w-0 text-[11px] font-semibold text-white/50 truncate">
                  {micActive ? t('common.sttListening') : sessionLabel}
                </span>
                {tickerOpen ? (
                  <ChevronUp className="w-3.5 h-3.5 text-white/35 shrink-0" aria-hidden="true" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5 text-white/35 shrink-0" aria-hidden="true" />
                )}
              </button>
              {tickerOpen && (
                <p className="px-2.5 pb-2 max-h-16 overflow-y-auto text-xs text-white/70 leading-snug whitespace-pre-wrap">
                  {liveText || t('common.sttWaiting')}
                </p>
              )}
            </div>
          )}

          {errorBanner}

          {/* Tabs */}
          <div className="flex flex-col flex-1 min-h-0 rounded-[var(--radius-lg)] border border-white/10 bg-white/5 overflow-hidden">
            <div role="tablist" aria-label={t('common.sttPanelTitle')} className="flex shrink-0 border-b border-white/10">
              {tabs.map((item) => {
                const selected = tab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="tab"
                    id={`stt-tab-${item.id}`}
                    aria-selected={selected}
                    aria-controls={`stt-panel-${item.id}`}
                    tabIndex={selected ? 0 : -1}
                    onClick={() => setTab(item.id)}
                    onKeyDown={(e) => {
                      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
                      e.preventDefault();
                      const idx = tabs.findIndex((x) => x.id === item.id);
                      const next =
                        e.key === 'ArrowRight'
                          ? tabs[(idx + 1) % tabs.length]
                          : tabs[(idx - 1 + tabs.length) % tabs.length];
                      setTab(next.id);
                    }}
                    className={cn(
                      'flex-1 px-2 py-2 text-xs font-semibold transition-colors inline-flex items-center justify-center gap-1.5',
                      selected
                        ? 'text-white bg-white/10 border-b-2 border-blue-400'
                        : 'text-white/50 hover:text-white/80 hover:bg-white/5 border-b-2 border-transparent'
                    )}
                  >
                    <span className="truncate">{item.label}</span>
                    {item.badge ? (
                      <span className="shrink-0 rounded-full bg-white/15 px-1.5 py-px text-[10px] font-bold text-white/70">
                        {item.badge}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto p-2.5 space-y-2.5">
              {tab === 'setup' && (
                <div
                  role="tabpanel"
                  id="stt-panel-setup"
                  aria-labelledby="stt-tab-setup"
                  className="space-y-2.5"
                >
                  {active && (
                    <p className="text-[11px] text-white/45 leading-snug">{t('common.sttLangLocked')}</p>
                  )}

                  {/* Languages — always visible */}
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-white/70">{t('common.sttLanguages')}</p>

                    <label className="block space-y-1">
                      <FieldLabel>{t('common.sttSpokenLanguage')}</FieldLabel>
                      <div className="flex items-center gap-2">
                        <Mic className="w-4 h-4 text-white/35 shrink-0" aria-hidden="true" />
                        <select
                          value={sttLanguage}
                          onChange={(e) => setSttLanguage(e.target.value)}
                          disabled={active}
                          aria-label={t('common.sttSpokenLanguage')}
                          className="w-full bg-white/5 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white/80 outline-none focus-visible:border-blue-500/60 transition-colors disabled:opacity-50"
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
                        <span className="block text-[11px] text-white/40">{t('common.sttSpokenLanguageHint')}</span>
                      )}
                    </label>

                    <div className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/5 px-2.5 py-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <Languages
                          className={cn(
                            'w-4 h-4 shrink-0',
                            translationEnabled ? 'text-emerald-300' : 'text-white/35'
                          )}
                          aria-hidden="true"
                        />
                        <div className="min-w-0">
                          <p className="text-xs font-semibold truncate">{t('common.sttTranslationToggle')}</p>
                          <p className="text-[11px] text-white/45 truncate">
                            {translationEnabled
                              ? t('common.sttTranslationOnDesc')
                              : t('common.sttTranslationOffDesc')}
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
                          'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:outline-none active:scale-[0.96] disabled:opacity-40',
                          translationEnabled ? 'bg-emerald-500' : 'bg-white/15'
                        )}
                      >
                        <span
                          className={cn(
                            'inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform',
                            translationEnabled ? 'translate-x-[18px]' : 'translate-x-[3px]'
                          )}
                        />
                      </button>
                    </div>

                    {translationEnabled && (
                      <label className="block space-y-1.5">
                        <FieldLabel>
                          {t('common.sttTargetLanguage')} ({targetLanguages.length})
                        </FieldLabel>
                        <input
                          type="search"
                          value={targetLanguageSearch}
                          onChange={(e) => setTargetLanguageSearch(e.target.value)}
                          disabled={active}
                          placeholder={t('common.sttTargetLanguageSearch')}
                          aria-label={t('common.sttTargetLanguageSearch')}
                          className="w-full bg-white/5 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white/80 placeholder:text-white/35 outline-none focus-visible:border-blue-500/60 transition-colors disabled:opacity-50"
                        />
                        <div className="grid grid-cols-2 gap-1 max-h-28 overflow-y-auto rounded-lg border border-white/10 bg-black/10 p-1">
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
                                    'rounded-md px-2 py-1 text-left text-[11px] transition-colors disabled:opacity-50',
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
                        <div className="flex flex-wrap gap-1">
                          {targetLanguages.map((code) => (
                            <button
                              key={code}
                              type="button"
                              onClick={() => toggleTargetLanguage(code)}
                              disabled={active}
                              title={t('common.sttTargetLanguageRemove')}
                              aria-label={`${languageName(code)} ${t('common.sttTargetLanguageRemove')}`}
                              className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2 py-0.5 text-[11px] text-emerald-100 hover:bg-red-400/15 hover:border-red-400/40 hover:text-red-100 disabled:opacity-50"
                            >
                              {languageName(code)} ×
                            </button>
                          ))}
                        </div>
                      </label>
                    )}
                  </div>

                  {/* Mic — collapsible */}
                  <Section
                    title={t('common.sttMic')}
                    open={openSections.includes('mic')}
                    onToggle={() => toggleSection('mic')}
                  >
                    <label className="block space-y-1">
                      <FieldLabel>{t('common.sttInputDevice')}</FieldLabel>
                      <div className="flex items-center gap-2">
                        <Mic className="w-4 h-4 text-white/35 shrink-0" aria-hidden="true" />
                        <select
                          value={inputDeviceId}
                          onChange={(e) => setInputDeviceId(e.target.value)}
                          disabled={active}
                          aria-label={t('common.sttInputDevice')}
                          className="w-full bg-white/5 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white/80 outline-none focus-visible:border-blue-500/60 transition-colors disabled:opacity-50"
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
                      <span className="block text-[11px] text-white/40">{t('common.sttInputDeviceHint')}</span>
                    </label>
                  </Section>

                  {/* Advanced — collapsible */}
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
                          <p className="text-[11px] text-white/45 truncate">{t('common.sttTrackerDesc')}</p>
                        </div>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={trackerEnabled}
                        onClick={() => setTrackerEnabled(!trackerEnabled)}
                        aria-label={t('common.sttTrackerTitle')}
                        className={cn(
                          'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:outline-none active:scale-[0.96]',
                          trackerEnabled ? 'bg-violet-500' : 'bg-white/15'
                        )}
                      >
                        <span
                          className={cn(
                            'inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform',
                            trackerEnabled ? 'translate-x-[18px]' : 'translate-x-[3px]'
                          )}
                        />
                      </button>
                    </div>

                    {trackerEnabled && (
                      <label className="block space-y-1.5">
                        <div className="flex items-center justify-between">
                          <FieldLabel>{t('common.sttTrackerSensitivity')}</FieldLabel>
                          <span className="text-[11px] font-semibold text-violet-200/80">{trackerSensitivity}%</span>
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
                        <span className="block text-[11px] text-white/40">
                          {t('common.sttTrackerSensitivityHint')}
                        </span>
                      </label>
                    )}

                    {trackerEnabled && trackerLastResult && (
                      <p
                        className={cn(
                          'text-[11px]',
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
                </div>
              )}

              {tab === 'share' && (
                <div role="tabpanel" id="stt-panel-share" aria-labelledby="stt-tab-share">
                  <SharePanel
                    embedded
                    onStartShare={onStartShare}
                    onStopShare={onStopShare}
                    onAddQrSlide={onAddQrSlide}
                  />
                </div>
              )}

              {tab === 'history' && (
                <div
                  role="tabpanel"
                  id="stt-panel-history"
                  aria-labelledby="stt-tab-history"
                  className="space-y-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-semibold text-white/45">{t('common.sttTabHistory')}</span>
                    <button
                      type="button"
                      onClick={downloadHistory}
                      disabled={utterances.length === 0}
                      title={t('common.sttExportHistory')}
                      aria-label={t('common.sttExportHistory')}
                      className="inline-flex items-center justify-center rounded-md border border-white/10 bg-white/5 p-1.5 text-white/55 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
                    >
                      <Download className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </div>
                  {utterances.length === 0 ? (
                    <p className="text-[11px] text-white/45 py-4 text-center">{t('common.sttEmpty')}</p>
                  ) : (
                    utterances
                      .slice()
                      .reverse()
                      .map((u) => (
                        <div
                          key={u.id}
                          className="rounded-lg border border-white/10 bg-black/20 px-2.5 py-1.5 flex items-start gap-2"
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
                            className="shrink-0 p-1 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-white/50 hover:text-white/90 transition-colors"
                          >
                            <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                          </button>
                        </div>
                      ))
                  )}
                </div>
              )}
            </div>
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
            className="inline-flex items-center gap-2 rounded-[var(--radius-lg)] border border-dashed border-white/25 px-4 py-2 text-xs font-semibold text-white/65 hover:text-white hover:border-white/45 hover:bg-white/5 transition-colors"
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
