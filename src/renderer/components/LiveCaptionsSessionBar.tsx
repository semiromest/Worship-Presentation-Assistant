import { useTranslation } from 'react-i18next';
import { Captions, ChevronUp, MicOff } from 'lucide-react';
import { useSttStore } from '../state/useSttStore';
import { isAutoSttLanguage, languageName } from '../../shared/stt';
import { cn } from '../utils';

interface LiveCaptionsSessionBarProps {
  /** Stops the running captions session (no-op when idle). */
  onStop: () => Promise<void>;
  /** Re-opens the full captions console. */
  onExpand: () => void;
}

/**
 * Slim, always-visible session bar shown while live captions are running and
 * the console is collapsed. Gives operators a glanceable mic/connection state,
 * the live transcript and — most importantly — a one-click Stop from any tab.
 */
export default function LiveCaptionsSessionBar({ onStop, onExpand }: LiveCaptionsSessionBarProps) {
  const { t } = useTranslation();

  const status = useSttStore((s) => s.status);
  const micActive = useSttStore((s) => s.micActive);
  const detectedLanguage = useSttStore((s) => s.detectedLanguage);
  const sttLanguage = useSttStore((s) => s.sttLanguage);
  const translationEnabled = useSttStore((s) => s.translationEnabled);
  const targetLanguages = useSttStore((s) => s.targetLanguages);
  const currentTranslation = useSttStore((s) => s.currentTranslation);
  const partialTranslation = useSttStore((s) => s.partialTranslation);
  const currentOriginal = useSttStore((s) => s.currentOriginal);
  const partialOriginal = useSttStore((s) => s.partialOriginal);

  const liveText = translationEnabled
    ? (currentTranslation + partialTranslation).trim() || (currentOriginal + partialOriginal).trim()
    : (currentOriginal + partialOriginal).trim();

  const spoken = detectedLanguage
    ? languageName(detectedLanguage)
    : isAutoSttLanguage(sttLanguage)
      ? t('common.sttSpokenLanguageAuto')
      : languageName(sttLanguage);
  const targets = targetLanguages.map(languageName).join(', ');
  const connected = status === 'connected';
  const connecting = status === 'connecting';

  return (
    <div
      role="status"
      className="h-10 flex-shrink-0 flex items-center gap-3 px-4 border-t border-white/10 bg-surface-raised"
    >
      <div className="flex items-center gap-2 min-w-0">
        <span
          className={cn(
            'w-1.5 h-1.5 rounded-full shrink-0',
            micActive ? 'bg-red-400 animate-pulse' : connected ? 'bg-emerald-400' : 'bg-amber-400 animate-pulse'
          )}
          aria-hidden="true"
        />
        <Captions className="w-3.5 h-3.5 text-blue-400 shrink-0" aria-hidden="true" />
        <span className="text-xs font-semibold text-white/90 truncate">{t('common.sttPanelTitle')}</span>
        <span
          className={cn(
            'hidden sm:inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-semibold shrink-0',
            micActive || connected
              ? 'text-emerald-300 border-emerald-400/30 bg-emerald-400/10'
              : 'text-amber-300 border-amber-400/30 bg-amber-400/10'
          )}
        >
          {micActive || connected ? t('common.sttSessionLive') : connecting ? t('common.sttConnecting') : t('common.sttSessionLive')}
        </span>
      </div>

      {/* Language summary — matches console header chips */}
      <span className="hidden sm:inline-flex items-center gap-1 text-[11px] font-semibold text-white/50 shrink-0 min-w-0">
        <span className="truncate">{spoken}</span>
        {translationEnabled && targets ? (
          <>
            <span className="text-white/25" aria-hidden="true">
              →
            </span>
            <span className="text-emerald-300/90 truncate">{targets}</span>
          </>
        ) : null}
      </span>

      {/* Live text snippet */}
      <div className="flex-1 min-w-0 text-right sm:text-left">
        <p className="text-xs text-white/55 italic truncate">{liveText || t('common.sttWaiting')}</p>
      </div>

      <button
        type="button"
        onClick={onExpand}
        title={t('common.sttOpenConsole')}
        aria-label={t('common.sttOpenConsole')}
        className="shrink-0 flex items-center gap-1 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[11px] font-semibold text-white/70 hover:text-white hover:bg-white/10 transition-colors"
      >
        <ChevronUp className="w-3 h-3" aria-hidden="true" />
        {t('common.sttOpenConsole')}
      </button>

      <button
        type="button"
        onClick={() => void onStop()}
        aria-label={t('common.sttStop')}
        className="shrink-0 inline-flex items-center gap-1.5 rounded-md bg-red-600 hover:bg-red-700 px-2.5 py-1 text-[11px] font-bold text-white transition-colors focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:outline-none active:scale-[0.97]"
      >
        <MicOff className="w-3 h-3" aria-hidden="true" />
        {t('common.sttStop')}
      </button>
    </div>
  );
}
