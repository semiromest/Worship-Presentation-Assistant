import { playSfx } from './sfx';
import { usePractice } from './hooks/usePractice';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Play, Pause, RotateCcw, PlusSquare, Check } from 'lucide-react';
import type { Slide } from './types';
import './countdown-workspace.css';

interface CountdownTabProps {
  onAddCountdownToPresentation?: (minutes: number, seconds: number, styles?: Partial<Slide['styles']>) => void;
}

const COUNTDOWN_THEMES = [
  {
    id: 'dark',
    name: 'countdownThemeDark',
    styles: { backgroundColor: '#000000', textColor: '#ffffff' }
  },
  {
    id: 'blue',
    name: 'countdownThemeBlue',
    styles: { backgroundColor: '#1e3a8a', textColor: '#60a5fa' }
  },
  {
    id: 'gold',
    name: 'countdownThemeGold',
    styles: { backgroundColor: '#1c1917', textColor: '#f59e0b' }
  },
  {
    id: 'clean',
    name: 'countdownThemeClean',
    styles: { backgroundColor: '#f8fafc', textColor: '#0f172a' }
  }
];

const formatTime = (totalSeconds: number): string => {
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
};

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

export default function CountdownTab({ onAddCountdownToPresentation }: CountdownTabProps) {
  const { t } = useTranslation();
  const practice = usePractice();
  const [minutes, setMinutes] = useState(5);
  const [seconds, setSeconds] = useState(0);
  useEffect(() => { if (!practice) return; let live=true;
    void window.electronAPI.readPracticeWorkspace(null).then(value => { if (live && ['countdown-duration','countdown-add'].includes(value.guide.step) && value.guide.ui?.minutes === 2) setMinutes(2); }).catch(() => {});
    return () => { live=false; }; }, [practice]);
  const [timeLeft, setTimeLeft] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);
  const [countdownStyles, setCountdownStyles] = useState(COUNTDOWN_THEMES[0].styles);

  // startTime stored in ref — interval not dependent on timeLeft
  const startTimeRef = useRef<number | null>(null);
  const totalSecondsRef = useRef<number>(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const selectedThemeId = COUNTDOWN_THEMES.find(theme =>
    theme.styles.backgroundColor === countdownStyles.backgroundColor && theme.styles.textColor === countdownStyles.textColor
  )?.id;

  const clearTimer = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  // Single effect — runs only when isRunning changes
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

      if (remaining <= 0) {
        setIsRunning(false);
      }
    }, 1000);

    return clearTimer;
  }, [isRunning, clearTimer]);

  const startCountdown = useCallback(() => {
    const total = minutes * 60 + seconds;
    if (total <= 0) return;
    playSfx('start');
    totalSecondsRef.current = total;
    setHasStarted(true);
    setTimeLeft(total);
    setIsRunning(true);
  }, [minutes, seconds]);

  // Pause: stop the timer, keep current value for resume
  const pauseCountdown = useCallback(() => {
    playSfx('pause');
    // Store remaining time so resume can pick up correctly
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
    totalSecondsRef.current = 0;
    startTimeRef.current = null;
  }, [hasStarted]);

  const handleMinutesChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setMinutes(clamp(parseInt(e.target.value) || 0, 0, 99));
  }, []);

  const handleSecondsChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setSeconds(clamp(parseInt(e.target.value) || 0, 0, 59));
  }, []);

  const isStarted = hasStarted;
  const displayTime = hasStarted ? timeLeft : minutes * 60 + seconds;

  const status = !isStarted ? t('countdown.ready') : isRunning ? t('countdown.running')
    : timeLeft > 0 ? t('common.countdownSlidePaused') : t('common.countdownFinished');

  return (
    <div data-guide-state={JSON.stringify({ minutes })} className="countdown-workspace h-full min-h-0 overflow-y-auto overscroll-contain">
      <div className="countdown-content">
        <h2 className="text-xl font-semibold text-white">{t('common.countdownTitle')}</h2>
        <div className="countdown-layout">
          <fieldset className="countdown-duration">
            <legend>{t('common.countdownSlideSetDuration')}</legend>
            <div className="countdown-duration-inputs">
              {(['minutes', 'seconds'] as const).map(key => {
                const isMin = key === 'minutes';
                return <div key={key}>
                  <label htmlFor={`countdown-${key}`}>{t(isMin ? 'common.countdownMinutes' : 'common.countdownSeconds')}</label>
                  <input data-guide-anchor={isMin ? 'countdown-duration' : undefined}
                    id={`countdown-${key}`} aria-describedby="countdown-range-hint"
                    type="number" min="0" max={isMin ? 99 : 59}
                    value={isMin ? minutes : seconds} onChange={isMin ? handleMinutesChange : handleSecondsChange}
                    disabled={isRunning || isStarted} />
                </div>;
              })}
            </div>
            <p id="countdown-range-hint" className="countdown-hint">{t('common.countdownRangeHint')}</p>
          </fieldset>

          <section className="countdown-preview-panel" aria-labelledby="countdown-preview-title">
            <div className="countdown-preview-heading">
              <h3 id="countdown-preview-title">{t('countdown.preview')}</h3>
              <span role="status" aria-live="polite" className="countdown-state">{status}</span>
            </div>
            <div className="countdown-preview" style={{ backgroundColor: countdownStyles.backgroundColor }}>
              <div role="timer" aria-live="off" aria-label={t('countdown.remaining', { time: formatTime(displayTime) })}
                style={{ color: countdownStyles.textColor }} className="font-mono font-bold tabular-nums select-none">
                {formatTime(displayTime)}
              </div>
            </div>
            <div className="countdown-preview-controls">
              {!isStarted ? (
                <button type="button" onClick={startCountdown} disabled={minutes === 0 && seconds === 0} className="workspace-secondary-action">
                  <Play size={16} aria-hidden="true" />{t('common.countdownStart')}
                </button>
              ) : isRunning ? (
                <button type="button" onClick={pauseCountdown} className="workspace-secondary-action">
                  <Pause size={16} aria-hidden="true" />{t('common.countdownPause')}
                </button>
              ) : timeLeft > 0 ? (
                <button type="button" onClick={resumeCountdown} className="workspace-secondary-action">
                  <Play size={16} aria-hidden="true" />{t('common.countdownResume')}
                </button>
              ) : null}
              <button type="button" onClick={resetCountdown} className="workspace-secondary-action">
                <RotateCcw size={16} aria-hidden="true" />{t('common.countdownReset')}
              </button>
            </div>
            <p className="countdown-hint">{t('countdown.previewHint')}</p>
          </section>

          <fieldset className="countdown-themes">
            <legend>{t('common.countdownThemeLabel')}</legend>
            <div className="countdown-theme-options">
              {COUNTDOWN_THEMES.map(theme => (
                <button key={theme.id} type="button" data-countdown-theme={theme.id}
                  aria-pressed={selectedThemeId === theme.id}
                  onClick={() => { if (theme.id !== selectedThemeId) { setCountdownStyles(theme.styles); playSfx('select'); } }}
                  className="countdown-theme">
                  <span aria-hidden="true" className="countdown-theme-swatch font-mono" style={{ backgroundColor: theme.styles.backgroundColor, color: theme.styles.textColor }}>00</span>
                  <span>{t(`common.${theme.name}`)}</span>
                  {selectedThemeId === theme.id ? <Check size={14} aria-hidden="true" /> : <span aria-hidden="true" />}
                </button>
              ))}
            </div>
            <div className="countdown-colors">
              <label htmlFor="countdown-background-color">
                <span>{t('common.countdownSlideBg')}</span>
                <input id="countdown-background-color" type="color" value={countdownStyles.backgroundColor}
                  onChange={event => setCountdownStyles(previous => ({ ...previous, backgroundColor: event.target.value }))} />
              </label>
              <label htmlFor="countdown-digit-color">
                <span>{t('common.countdownSlideDigitColor')}</span>
                <input id="countdown-digit-color" type="color" value={countdownStyles.textColor}
                  onChange={event => setCountdownStyles(previous => ({ ...previous, textColor: event.target.value }))} />
              </label>
            </div>
          </fieldset>

          <div className="countdown-apply">
            <button type="button" data-guide-anchor="countdown-add"
              onClick={() => onAddCountdownToPresentation?.(minutes, seconds, countdownStyles)}
              disabled={minutes === 0 && seconds === 0}
              className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#171717]">
              <PlusSquare size={16} aria-hidden="true" />{t('common.countdownAddToSlide')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
