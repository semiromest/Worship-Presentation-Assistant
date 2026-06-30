import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Play, Pause, Square, RotateCcw, PlusSquare } from 'lucide-react';

interface CountdownTabProps {
  onAddCountdownToPresentation?: (minutes: number, seconds: number, styles?: any) => void;
}

const COUNTDOWN_THEMES = [
  {
    id: 'dark',
    name: 'countdownThemeDark',
    styles: { backgroundColor: '#000000', textColor: '#ffffff' },
    previewBg: 'bg-black',
    previewText: 'text-white'
  },
  {
    id: 'blue',
    name: 'countdownThemeBlue',
    styles: { backgroundColor: '#1e3a8a', textColor: '#60a5fa' },
    previewBg: 'bg-blue-900',
    previewText: 'text-blue-400'
  },
  {
    id: 'gold',
    name: 'countdownThemeGold',
    styles: { backgroundColor: '#1c1917', textColor: '#f59e0b' },
    previewBg: 'bg-stone-900',
    previewText: 'text-amber-500'
  },
  {
    id: 'clean',
    name: 'countdownThemeClean',
    styles: { backgroundColor: '#f8fafc', textColor: '#0f172a' },
    previewBg: 'bg-slate-50',
    previewText: 'text-slate-900'
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
  const [minutes, setMinutes] = useState(5);
  const [seconds, setSeconds] = useState(0);
  const [timeLeft, setTimeLeft] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [selectedThemeId, setSelectedThemeId] = useState('dark');

  // startTime stored in ref — interval not dependent on timeLeft
  const startTimeRef = useRef<number | null>(null);
  const totalSecondsRef = useRef<number>(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const selectedTheme = COUNTDOWN_THEMES.find(t => t.id === selectedThemeId) || COUNTDOWN_THEMES[0];

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
    totalSecondsRef.current = total;
    setTimeLeft(total);
    setIsRunning(true);
  }, [minutes, seconds]);

  // Pause: stop the timer, keep current value for resume
  const pauseCountdown = useCallback(() => {
    // Store remaining time so resume can pick up correctly
    totalSecondsRef.current = timeLeft;
    setIsRunning(false);
  }, [timeLeft]);

  const resumeCountdown = useCallback(() => {
    if (timeLeft <= 0) return;
    totalSecondsRef.current = timeLeft;
    setIsRunning(true);
  }, [timeLeft]);

  const resetCountdown = useCallback(() => {
    setIsRunning(false);
    setTimeLeft(0);
    totalSecondsRef.current = 0;
    startTimeRef.current = null;
  }, []);

  const handleMinutesChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setMinutes(clamp(parseInt(e.target.value) || 0, 0, 99));
  }, []);

  const handleSecondsChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setSeconds(clamp(parseInt(e.target.value) || 0, 0, 59));
  }, []);

  const isStarted = timeLeft > 0;
  const displayTime = isStarted ? timeLeft : minutes * 60 + seconds;

  return (
    <div className="p-6 space-y-6">
      <h2 className="text-2xl font-bold text-white">{t('common.countdownTitle')}</h2>

      <div className="bg-white/10 rounded-lg p-6 space-y-4">
        {/* Süre girişi */}
        <div className="flex items-center space-x-4">
          {(['minutes', 'seconds'] as const).map((key) => {
            const isMin = key === 'minutes';
            return (
              <div key={key}>
                <label className="block text-sm font-medium text-white mb-1">{isMin ? t('common.countdownMinutes') : t('common.countdownSeconds')}</label>
                <input
                  type="number"
                  min="0"
                  max={isMin ? 99 : 59}
                  value={isMin ? minutes : seconds}
                  onChange={isMin ? handleMinutesChange : handleSecondsChange}
                  className="w-20 px-3 py-2 bg-white/20 border border-white/30 rounded text-white placeholder-white/50"
                  disabled={isRunning || isStarted}
                />
              </div>
            );
          })}
        </div>

        {/* Sayaç göstergesi */}
        <div className="text-center">
          <div className="text-6xl font-mono font-bold text-white tabular-nums mb-4">
            {formatTime(displayTime)}
          </div>
        </div>

        {/* Kontroller */}
        <div className="flex flex-wrap justify-center gap-3">
          {!isStarted ? (
            <button
              onClick={startCountdown}
              disabled={minutes === 0 && seconds === 0}
              className="flex items-center space-x-2 px-6 py-3 bg-green-600 hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
            >
              <Play size={20} />
              <span>{t('common.countdownStart')}</span>
            </button>
          ) : isRunning ? (
            <button
              onClick={pauseCountdown}
              className="flex items-center space-x-2 px-6 py-3 bg-yellow-500 hover:bg-yellow-600 text-white rounded-lg transition-colors"
            >
              <Pause size={20} />
              <span>{t('common.countdownPause')}</span>
            </button>
          ) : (
            <button
              onClick={resumeCountdown}
              className="flex items-center space-x-2 px-6 py-3 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors"
            >
              <Play size={20} />
              <span>{t('common.countdownResume')}</span>
            </button>
          )}

          <button
            onClick={resetCountdown}
            className="flex items-center space-x-2 px-6 py-3 bg-gray-600 hover:bg-gray-700 text-white rounded-lg transition-colors"
          >
            <RotateCcw size={20} />
            <span>{t('common.countdownReset')}</span>
          </button>

          <button
            onClick={() => onAddCountdownToPresentation?.(minutes, seconds, selectedTheme.styles)}
            disabled={minutes === 0 && seconds === 0}
            className="flex items-center space-x-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
          >
            <PlusSquare size={20} />
            <span>{t('common.countdownAddToSlide')}</span>
          </button>
        </div>
      </div>

      {/* Tema Seçimi */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-white/60 uppercase tracking-wider">{t('common.countdownThemeLabel')}</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {COUNTDOWN_THEMES.map((theme) => (
            <button
              key={theme.id}
              onClick={() => setSelectedThemeId(theme.id)}
              className={`relative p-3 rounded-xl border-2 transition-all text-left space-y-2 ${
                selectedThemeId === theme.id
                  ? 'border-blue-500 bg-blue-500/10'
                  : 'border-white/5 bg-white/5 hover:bg-white/10'
              }`}
            >
              <div className={`aspect-video rounded-md flex items-center justify-center font-mono font-bold text-xs ${theme.previewBg} ${theme.previewText}`}>
                00:00
              </div>
              <span className="block text-[11px] font-medium text-white/70">{t(`common.${theme.name}`)}</span>
              {selectedThemeId === theme.id && (
                <div className="absolute top-2 right-2 w-2 h-2 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.8)]" />
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}