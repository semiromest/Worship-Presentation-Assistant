import { playSfx } from './sfx';
import MotionIcon from './components/MotionIcon';
import ControlTooltip from './components/ControlTooltip';
import { usePractice } from './hooks/usePractice';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Play, Pause, RotateCcw, Plus, Minus, Check } from 'lucide-react';
import type { Slide } from './types';
import { cn } from './utils';
import './countdown-workspace.css';

interface CountdownTabProps {
  onAddCountdownToPresentation?: (
    minutes: number,
    seconds: number,
    styles?: Partial<Slide['styles']>,
    options?: { paused?: boolean }
  ) => void;
}

const COUNTDOWN_THEMES = [
  { id: 'dark', name: 'countdownThemeDark', styles: { backgroundColor: '#000000', textColor: '#ffffff' } },
  { id: 'blue', name: 'countdownThemeBlue', styles: { backgroundColor: '#1e3a8a', textColor: '#60a5fa' } },
  { id: 'gold', name: 'countdownThemeGold', styles: { backgroundColor: '#1c1917', textColor: '#f59e0b' } },
  { id: 'clean', name: 'countdownThemeClean', styles: { backgroundColor: '#f8fafc', textColor: '#0f172a' } },
];

/** Durations people actually use before and during a service. */
const PRESET_MINUTES = [1, 3, 5, 10, 15, 20, 30];
const MAX_TOTAL = 99 * 60 + 59;

const formatTime = (totalSeconds: number): string => {
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const isHex = (value: string) => /^#[0-9a-f]{6}$/i.test(value);

function SectionTitle({ children, id }: { children: React.ReactNode; id?: string }) {
  return (
    <h3 id={id} className="text-[11px] font-semibold text-white/70">
      {children}
    </h3>
  );
}

/** Swatch + hex in one compact row. */
function ColorRow({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (value: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <label htmlFor={id} className="block min-w-0 space-y-1">
      <span className="block text-[11px] text-white/55">{label}</span>
      <span className="flex h-8 min-w-0 items-center gap-2 rounded-md border border-white/[0.08] bg-black/25 px-1.5 transition hover:border-white/15 focus-within:border-blue-500/70">
        <input
          id={id}
          type="color"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="h-5 w-5 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0 [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded [&::-webkit-color-swatch]:border [&::-webkit-color-swatch]:border-white/20"
        />
        <input
          type="text"
          aria-label={label}
          value={draft}
          spellCheck={false}
          onChange={(event) => {
            setDraft(event.target.value);
            if (isHex(event.target.value)) onChange(event.target.value);
          }}
          onBlur={() => setDraft(value)}
          className="h-full min-w-0 flex-1 bg-transparent font-mono text-xs uppercase text-white/85 outline-none"
        />
      </span>
    </label>
  );
}

export default function CountdownTab({ onAddCountdownToPresentation }: CountdownTabProps) {
  const { t } = useTranslation();
  const practice = usePractice();
  const [minutes, setMinutes] = useState(5);
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!practice) return;
    let live = true;
    void window.electronAPI
      .readPracticeWorkspace(null)
      .then((value) => {
        if (live && ['countdown-duration', 'countdown-add'].includes(value.guide.step) && value.guide.ui?.minutes === 2) setMinutes(2);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [practice]);
  const [timeLeft, setTimeLeft] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);
  const [runTotal, setRunTotal] = useState(0);
  const [countdownStyles, setCountdownStyles] = useState(COUNTDOWN_THEMES[0].styles);
  const [startPaused, setStartPaused] = useState(false);

  // startTime stored in ref — interval not dependent on timeLeft
  const startTimeRef = useRef<number | null>(null);
  const totalSecondsRef = useRef<number>(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const selectedThemeId = COUNTDOWN_THEMES.find(
    (theme) => theme.styles.backgroundColor === countdownStyles.backgroundColor && theme.styles.textColor === countdownStyles.textColor
  )?.id;

  const clearTimer = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!isRunning) {
      clearTimer();
      return;
    }
    startTimeRef.current = Date.now();
    intervalRef.current = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTimeRef.current!) / 1000);
      const remaining = Math.max(0, totalSecondsRef.current - elapsed);
      setTimeLeft(remaining);
      if (remaining <= 0) setIsRunning(false);
    }, 1000);
    return clearTimer;
  }, [isRunning, clearTimer]);

  const total = minutes * 60 + seconds;

  const startCountdown = useCallback(() => {
    if (total <= 0) return;
    playSfx('start');
    totalSecondsRef.current = total;
    setRunTotal(total);
    setHasStarted(true);
    setTimeLeft(total);
    setIsRunning(true);
  }, [total]);

  const pauseCountdown = useCallback(() => {
    playSfx('pause');
    totalSecondsRef.current = timeLeft;
    setIsRunning(false);
  }, [timeLeft]);

  const resumeCountdown = useCallback(() => {
    if (timeLeft <= 0) return;
    playSfx('play');
    totalSecondsRef.current = timeLeft;
    setIsRunning(true);
  }, [timeLeft]);

  const resetCountdown = useCallback(() => {
    if (!hasStarted) return;
    playSfx('stop');
    setHasStarted(false);
    setIsRunning(false);
    setTimeLeft(0);
    setRunTotal(0);
    totalSecondsRef.current = 0;
    startTimeRef.current = null;
  }, [hasStarted]);

  const setTotal = useCallback((next: number) => {
    const value = clamp(next, 0, MAX_TOTAL);
    setMinutes(Math.floor(value / 60));
    setSeconds(value % 60);
  }, []);

  const addToPresentation = () => {
    if (total <= 0) return;
    onAddCountdownToPresentation?.(minutes, seconds, countdownStyles, startPaused ? { paused: true } : undefined);
  };

  const isStarted = hasStarted;
  const displayTime = hasStarted ? timeLeft : total;
  const progress = hasStarted && runTotal > 0 ? timeLeft / runTotal : 1;
  const finished = hasStarted && !isRunning && timeLeft <= 0;

  const status = !isStarted
    ? t('countdown.ready')
    : isRunning
      ? t('countdown.running')
      : timeLeft > 0
        ? t('common.countdownSlidePaused')
        : t('common.countdownFinished');

  const pill =
    'inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:pointer-events-none disabled:opacity-35';
  const timeInput =
    'w-[2.6ch] bg-transparent text-center font-mono text-4xl font-semibold tabular-nums text-white outline-none disabled:text-white/45 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none';

  return (
    <div data-guide-state={JSON.stringify({ minutes })} className="countdown-workspace h-full min-h-0 overflow-y-auto overscroll-contain">
      <div className="countdown-content">
        <header className="flex items-baseline justify-between gap-3">
          <h2 className="text-lg font-semibold text-white/90">{t('common.countdownTitle')}</h2>
        </header>

        <div className="countdown-layout">
          {/* Settings column */}
          <div className="countdown-settings">
            {/* Duration */}
            <section aria-labelledby="countdown-duration-title" className="space-y-3 p-4">
              <SectionTitle id="countdown-duration-title">{t('common.countdownSlideSetDuration')}</SectionTitle>

              <div className="flex items-center gap-2">
                <ControlTooltip>
                  <button
                    type="button"
                    aria-label={t('countdown.minusMinute')}
                    title={t('countdown.minusMinute')}
                    disabled={isStarted || total < 60}
                    onClick={() => setTotal(total - 60)}
                    className="grid h-10 w-10 shrink-0 place-items-center rounded-md text-white/60 transition hover:bg-white/[0.07] hover:text-white disabled:pointer-events-none disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                  >
                    <Minus className="h-4 w-4" aria-hidden="true" />
                  </button>
                </ControlTooltip>
                <div
                  className={cn(
                    'flex h-16 min-w-0 flex-1 items-center justify-center gap-1 rounded-lg border bg-black/25 transition',
                    isStarted ? 'border-white/[0.05]' : 'border-white/[0.08] hover:border-white/15 focus-within:border-blue-500/70'
                  )}
                >
                  {(['minutes', 'seconds'] as const).map((key, index) => {
                    const isMin = key === 'minutes';
                    return (
                      <span key={key} className="contents">
                        {index === 1 && (
                          <span aria-hidden="true" className="pb-4 font-mono text-3xl text-white/35">
                            :
                          </span>
                        )}
                        <span className="flex flex-col items-center">
                        <input
                          data-guide-anchor={isMin ? 'countdown-duration' : undefined}
                          id={`countdown-${key}`}
                          aria-describedby="countdown-range-hint"
                          type="number"
                          inputMode="numeric"
                          min="0"
                          max={isMin ? 99 : 59}
                          value={isMin ? minutes : String(seconds).padStart(2, '0')}
                          onFocus={(event) => event.currentTarget.select()}
                          onChange={(event) => {
                            const value = parseInt(event.target.value) || 0;
                            if (isMin) setMinutes(clamp(value, 0, 99));
                            else setSeconds(clamp(value, 0, 59));
                          }}
                          disabled={isRunning || isStarted}
                          className={timeInput}
                        />
                        <label htmlFor={`countdown-${key}`} className="-mt-0.5 text-[9px] font-medium uppercase tracking-wider text-white/35">
                          {t(isMin ? 'common.countdownMinutes' : 'common.countdownSeconds')}
                        </label>
                        </span>
                      </span>
                    );
                  })}
                </div>
                <ControlTooltip>
                  <button
                    type="button"
                    aria-label={t('countdown.plusMinute')}
                    title={t('countdown.plusMinute')}
                    disabled={isStarted || total >= MAX_TOTAL}
                    onClick={() => setTotal(total + 60)}
                    className="grid h-10 w-10 shrink-0 place-items-center rounded-md text-white/60 transition hover:bg-white/[0.07] hover:text-white disabled:pointer-events-none disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                  >
                    <Plus className="h-4 w-4" aria-hidden="true" />
                  </button>
                </ControlTooltip>
              </div>
              <div role="group" aria-label={t('countdown.presets')} className="flex flex-wrap gap-1">
                {PRESET_MINUTES.map((value) => {
                  const active = total === value * 60;
                  return (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={active}
                      disabled={isStarted}
                      onClick={() => {
                        if (!active) playSfx('select');
                        setTotal(value * 60);
                      }}
                      className={cn(
                        'h-7 min-w-[2.75rem] rounded-md px-2 text-xs tabular-nums transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:pointer-events-none disabled:opacity-35',
                        active ? 'bg-blue-500/20 text-blue-100' : 'bg-white/[0.04] text-white/65 hover:bg-white/[0.08] hover:text-white'
                      )}
                    >
                      {t('countdown.minutesShort', { value })}
                    </button>
                  );
                })}
              </div>
              <p id="countdown-range-hint" className={cn('text-[11px] leading-snug', isStarted ? 'text-amber-200/75' : 'sr-only')}>
                {isStarted ? t('countdown.durationLocked') : t('common.countdownRangeHint')}
              </p>
            </section>

            {/* Appearance */}
            <section aria-labelledby="countdown-theme-title" className="space-y-3 border-t border-white/[0.06] p-4">
              <SectionTitle id="countdown-theme-title">{t('common.countdownThemeLabel')}</SectionTitle>
              <div className="grid grid-cols-4 gap-2">
                {COUNTDOWN_THEMES.map((theme) => {
                  const active = selectedThemeId === theme.id;
                  return (
                    <ControlTooltip key={theme.id}>
                      <button
                        type="button"
                        data-countdown-theme={theme.id}
                        aria-pressed={active}
                        aria-label={t(`common.${theme.name}`)}
                        title={t(`common.${theme.name}`)}
                        onClick={() => {
                          if (!active) {
                            setCountdownStyles(theme.styles);
                            playSfx('select');
                          }
                        }}
                        className={cn(
                          'group relative grid aspect-video place-items-center overflow-hidden rounded-md font-mono text-xs font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500',
                          active ? 'ring-2 ring-blue-400 ring-offset-2 ring-offset-surface' : 'ring-1 ring-white/10 hover:ring-white/30'
                        )}
                        style={{ backgroundColor: theme.styles.backgroundColor, color: theme.styles.textColor }}
                      >
                        05:00
                        {active && (
                          <span className="absolute right-0.5 top-0.5 grid h-3.5 w-3.5 place-items-center rounded-full bg-blue-500 text-white">
                            <Check className="h-2.5 w-2.5" aria-hidden="true" />
                          </span>
                        )}
                      </button>
                    </ControlTooltip>
                  );
                })}
              </div>
              <p className="text-[11px] text-white/45">
                {selectedThemeId
                  ? t(`common.${COUNTDOWN_THEMES.find((theme) => theme.id === selectedThemeId)!.name}`)
                  : t('countdown.customTheme')}
              </p>
              <div className="grid grid-cols-2 gap-2">
                <ColorRow
                  id="countdown-background-color"
                  label={t('common.countdownSlideBg')}
                  value={countdownStyles.backgroundColor}
                  onChange={(value) => setCountdownStyles((previous) => ({ ...previous, backgroundColor: value }))}
                />
                <ColorRow
                  id="countdown-digit-color"
                  label={t('common.countdownSlideDigitColor')}
                  value={countdownStyles.textColor}
                  onChange={(value) => setCountdownStyles((previous) => ({ ...previous, textColor: value }))}
                />
              </div>
            </section>

            {/* Add */}
            <section aria-labelledby="countdown-add-title" className="space-y-3 border-t border-white/[0.06] p-4">
              <SectionTitle id="countdown-add-title">{t('countdown.whenAdded')}</SectionTitle>
              <div role="radiogroup" aria-labelledby="countdown-add-title" className="grid grid-cols-2 gap-0.5 rounded-md bg-black/25 p-0.5">
                {[
                  { value: false, label: t('countdown.startNow') },
                  { value: true, label: t('countdown.startPaused') },
                ].map((option) => (
                  <button
                    key={String(option.value)}
                    type="button"
                    role="radio"
                    aria-checked={startPaused === option.value}
                    onClick={() => setStartPaused(option.value)}
                    className={cn(
                      'min-h-7 rounded px-2 py-1 text-[11px] font-medium leading-tight transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500',
                      startPaused === option.value ? 'bg-white/[0.12] text-white' : 'text-white/55 hover:text-white/85'
                    )}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <p className="text-[11px] leading-snug text-white/45">
                {startPaused ? t('countdown.startPausedHint') : t('countdown.startNowHint')}
              </p>

              <button
                type="button"
                data-guide-anchor="countdown-add"
                onClick={addToPresentation}
                disabled={total <= 0}
                className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-md bg-blue-600 px-4 text-sm font-medium text-white transition-colors hover:bg-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 disabled:cursor-not-allowed disabled:bg-white/[0.06] disabled:text-white/35"
              >
                <Plus size={16} aria-hidden="true" />
                {t('common.countdownAddToSlide')}
              </button>
            </section>
          </div>

          {/* Preview column */}
          <section className="countdown-preview-panel" aria-labelledby="countdown-preview-title">
            <div className="mb-2 flex items-center justify-between gap-3">
              <h3 id="countdown-preview-title" className="text-[11px] font-semibold text-white/70">
                {t('countdown.preview')}
              </h3>
              <span
                role="status"
                aria-live="polite"
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px]',
                  isRunning
                    ? 'bg-emerald-500/15 text-emerald-200'
                    : finished
                      ? 'bg-white/[0.06] text-white/70'
                      : isStarted
                        ? 'bg-amber-500/15 text-amber-100'
                        : 'bg-white/[0.06] text-white/60'
                )}
              >
                <MotionIcon name="timer-countdown" active={isRunning} />
                {status}
              </span>
            </div>

            <div className="countdown-stage">
            <div
              className="countdown-preview"
              style={{ backgroundColor: countdownStyles.backgroundColor }}
            >
              <div
                role="timer"
                aria-live="off"
                aria-label={t('countdown.remaining', { time: formatTime(displayTime) })}
                style={{ color: countdownStyles.textColor }}
                className={cn('font-mono font-bold tabular-nums select-none transition-opacity', finished && 'animate-pulse')}
              >
                {formatTime(displayTime)}
              </div>
              {hasStarted && (
                <div aria-hidden="true" className="absolute inset-x-0 bottom-0 h-1 bg-white/10">
                  <div
                    className="h-full transition-[width] duration-1000 ease-linear"
                    style={{ width: `${progress * 100}%`, backgroundColor: countdownStyles.textColor, opacity: 0.6 }}
                  />
                </div>
              )}
            </div>
            </div>

            <div className="mt-3 flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2">
              <div className="flex items-center gap-1">
                {!isStarted ? (
                  <button type="button" onClick={startCountdown} disabled={total <= 0} className={cn(pill, 'bg-white/[0.06] text-white/85 hover:bg-white/[0.1]')}>
                    <Play size={14} aria-hidden="true" />
                    {t('common.countdownStart')}
                  </button>
                ) : isRunning ? (
                  <button type="button" onClick={pauseCountdown} className={cn(pill, 'bg-white/[0.06] text-white/85 hover:bg-white/[0.1]')}>
                    <Pause size={14} aria-hidden="true" />
                    {t('common.countdownPause')}
                  </button>
                ) : timeLeft > 0 ? (
                  <button type="button" onClick={resumeCountdown} className={cn(pill, 'bg-white/[0.06] text-white/85 hover:bg-white/[0.1]')}>
                    <Play size={14} aria-hidden="true" />
                    {t('common.countdownResume')}
                  </button>
                ) : null}
                <button type="button" onClick={resetCountdown} disabled={!isStarted} className={cn(pill, 'text-white/65 hover:bg-white/[0.07] hover:text-white')}>
                  <RotateCcw size={14} aria-hidden="true" />
                  {t('common.countdownReset')}
                </button>
              </div>
              <p className="max-w-md text-[11px] leading-snug text-white/40">{t('countdown.previewHint')}</p>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
