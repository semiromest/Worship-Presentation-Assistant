import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { HexColorPicker } from 'react-colorful';
import {
  Timer,
  RotateCcw,
  Play,
  Pause,
  Plus,
  Minus,
  Clock,
} from 'lucide-react';
import CountdownRenderer from './CountdownRenderer';
import { cn } from './utils';
import type { Slide } from './types';
import {
  parseCountdownContent,
  getCountdownRemaining,
  formatCountdownTime,
  COUNTDOWN_QUICK_PRESETS,
  COUNTDOWN_THEMES,
  type CountdownSlideData,
} from './countdownUtils';

export interface CountdownSlideEditorProps {
  slide: Slide;
  onPatch: (mutate: (data: CountdownSlideData) => CountdownSlideData) => void;
  onUpdateStyles: (styles: Partial<NonNullable<Slide['styles']>>) => void;
}

export default function CountdownSlideEditor({
  slide,
  onPatch,
  onUpdateStyles,
}: CountdownSlideEditorProps) {
  const { t } = useTranslation();
  const data = useMemo(() => parseCountdownContent(slide.content), [slide.content]);

  const [editMinutes, setEditMinutes] = useState(String(data.minutes));
  const [editSeconds, setEditSeconds] = useState(
    String(data.seconds).padStart(2, '0')
  );
  const [tick, setTick] = useState(0);
  const [activeColorPicker, setActiveColorPicker] = useState<'bg' | 'text' | null>(
    null
  );

  useEffect(() => {
    setEditMinutes(String(data.minutes));
    setEditSeconds(String(data.seconds).padStart(2, '0'));
  }, [slide.id, data.minutes, data.seconds]);

  useEffect(() => {
    if (data.paused) return;
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, [data.paused, data.startTime, data.totalSeconds]);

  const remaining = useMemo(
    () => getCountdownRemaining(data),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, tick]
  );

  const applyDuration = useCallback(() => {
    const m = Math.max(0, Math.min(99, parseInt(editMinutes, 10) || 0));
    const s = Math.max(0, Math.min(59, parseInt(editSeconds, 10) || 0));
    onPatch(() => ({
      minutes: m,
      seconds: s,
      totalSeconds: m * 60 + s,
      startTime: Date.now(),
      paused: false,
      pausedRemaining: undefined,
    }));
  }, [editMinutes, editSeconds, onPatch]);

  const resetCounter = useCallback(() => {
    onPatch(d => ({
      ...d,
      startTime: Date.now(),
      paused: false,
      pausedRemaining: undefined,
    }));
  }, [onPatch]);

  const pauseCounter = useCallback(() => {
    const left = getCountdownRemaining(data);
    onPatch(d => ({
      ...d,
      paused: true,
      pausedRemaining: left,
    }));
  }, [data, onPatch]);

  const resumeCounter = useCallback(() => {
    onPatch(d => {
      const left = d.pausedRemaining ?? d.totalSeconds;
      return {
        ...d,
        totalSeconds: left,
        minutes: Math.floor(left / 60),
        seconds: left % 60,
        startTime: Date.now(),
        paused: false,
        pausedRemaining: undefined,
      };
    });
  }, [onPatch]);

  const adjustTime = useCallback(
    (deltaSeconds: number) => {
      onPatch(d => {
        const base = d.paused ? (d.pausedRemaining ?? 0) : getCountdownRemaining(d);
        const next = Math.max(0, Math.min(99 * 60 + 59, base + deltaSeconds));
        return {
          minutes: Math.floor(next / 60),
          seconds: next % 60,
          totalSeconds: next,
          startTime: Date.now(),
          paused: false,
          pausedRemaining: undefined,
        };
      });
    },
    [onPatch]
  );

  const setPreset = useCallback(
    (minutes: number, seconds: number) => {
      onPatch(() => ({
        minutes,
        seconds,
        totalSeconds: minutes * 60 + seconds,
        startTime: Date.now(),
        paused: false,
        pausedRemaining: undefined,
      }));
    },
    [onPatch]
  );

  const isFinished = remaining <= 0 && !data.paused;

  return (
    <div className="space-y-4">

      {/* Kalan süre */}
      <div
        className={cn(
          'rounded-xl border p-3 flex items-center justify-between',
          data.paused
            ? 'border-amber-500/30 bg-amber-500/10'
            : isFinished
              ? 'border-white/10 bg-white/5'
              : 'border-blue-500/30 bg-blue-500/10'
        )}
      >
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-blue-400" />
          <span className="text-[10px] font-bold uppercase tracking-widest text-white/50">
            {data.paused ? t('common.cdPaused') : t('common.cdRemaining')}
          </span>
        </div>
        <span className="text-2xl font-mono font-bold tabular-nums text-white">
          {formatCountdownTime(remaining)}
        </span>
      </div>

      {/* Süre belirleme */}
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 space-y-3">
        <span className="text-[10px] font-bold uppercase tracking-widest text-white/40">
          {t('common.cdSetDuration')}
        </span>
        <div className="grid grid-cols-[1fr_1fr_auto] gap-2 items-end">
          <div className="space-y-1">
            <label className="text-[10px] text-white/35">{t('common.minutes')}</label>
            <input
              type="number"
              min={0}
              max={99}
              value={editMinutes}
              onChange={e => setEditMinutes(e.target.value)}
              className="w-full bg-black/40 border border-white/10 rounded-lg px-2 py-2 text-sm outline-none focus:border-blue-500/50 tabular-nums"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] text-white/35">{t('common.seconds')}</label>
            <input
              type="number"
              min={0}
              max={59}
              value={editSeconds}
              onChange={e => setEditSeconds(e.target.value)}
              className="w-full bg-black/40 border border-white/10 rounded-lg px-2 py-2 text-sm outline-none focus:border-blue-500/50 tabular-nums"
            />
          </div>
          <button
            type="button"
            onClick={applyDuration}
            className="h-[38px] px-3 rounded-lg bg-blue-600 hover:bg-blue-700 text-xs font-semibold transition-colors"
          >
            {t('common.cdApply')}
          </button>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {COUNTDOWN_QUICK_PRESETS.map(p => (
            <button
              key={p.label}
              type="button"
              onClick={() => setPreset(p.minutes, p.seconds)}
              className="px-2.5 py-1 rounded-lg bg-white/5 border border-white/10 text-[11px] font-medium text-white/70 hover:bg-blue-600/20 hover:border-blue-500/30 hover:text-blue-300 transition-all"
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Kontroller */}
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={resetCounter}
          className="flex items-center justify-center gap-2 py-2.5 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 text-xs font-semibold transition-all"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          {t('common.cdReset')}
        </button>
        {data.paused ? (
          <button
            type="button"
            onClick={resumeCounter}
            className="flex items-center justify-center gap-2 py-2.5 rounded-xl bg-emerald-600/20 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-600/30 text-xs font-semibold transition-all"
          >
            <Play className="w-3.5 h-3.5" />
            {t('common.cdResume')}
          </button>
        ) : (
          <button
            type="button"
            onClick={pauseCounter}
            disabled={remaining <= 0}
            className="flex items-center justify-center gap-2 py-2.5 rounded-xl bg-amber-600/20 border border-amber-500/30 text-amber-300 hover:bg-amber-600/30 disabled:opacity-40 text-xs font-semibold transition-all"
          >
            <Pause className="w-3.5 h-3.5" />
            {t('common.cdPause')}
          </button>
        )}
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => adjustTime(-30)}
          className="flex-1 flex items-center justify-center gap-1 py-2 rounded-lg bg-white/5 border border-white/10 text-[11px] font-medium hover:bg-white/10 transition-all"
        >
          <Minus className="w-3 h-3" />
          30 sn
        </button>
        <button
          type="button"
          onClick={() => adjustTime(30)}
          className="flex-1 flex items-center justify-center gap-1 py-2 rounded-lg bg-white/5 border border-white/10 text-[11px] font-medium hover:bg-white/10 transition-all"
        >
          <Plus className="w-3 h-3" />
          30 sn
        </button>
        <button
          type="button"
          onClick={() => adjustTime(60)}
          className="flex-1 flex items-center justify-center gap-1 py-2 rounded-lg bg-white/5 border border-white/10 text-[11px] font-medium hover:bg-white/10 transition-all"
        >
          <Plus className="w-3 h-3" />
          1 dk
        </button>
      </div>

      {/* Görünüm */}
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 space-y-3">
        <span className="text-[10px] font-bold uppercase tracking-widest text-white/40 flex items-center gap-2">
          <Timer className="w-3.5 h-3.5" />
          {t('common.cdAppearance')}
        </span>

        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <span className="text-[10px] text-white/35">{t('common.cdBgColor')}</span>
            <button
              type="button"
              onClick={() =>
                setActiveColorPicker(activeColorPicker === 'bg' ? null : 'bg')
              }
              className="w-full h-8 rounded-lg border border-white/10"
              style={{
                backgroundColor: slide.styles?.backgroundColor ?? '#000000',
              }}
            />
            {activeColorPicker === 'bg' && (
              <div className="mt-2 color-picker-container">
                <HexColorPicker
                  color={slide.styles?.backgroundColor ?? '#000000'}
                  onChange={c => onUpdateStyles({ backgroundColor: c })}
                />
              </div>
            )}
          </div>
          <div className="space-y-1">
            <span className="text-[10px] text-white/35">{t('common.cdDigitColor')}</span>
            <button
              type="button"
              onClick={() =>
                setActiveColorPicker(activeColorPicker === 'text' ? null : 'text')
              }
              className="w-full h-8 rounded-lg border border-white/10"
              style={{ backgroundColor: slide.styles?.textColor ?? '#ffffff' }}
            />
            {activeColorPicker === 'text' && (
              <div className="mt-2 color-picker-container">
                <HexColorPicker
                  color={slide.styles?.textColor ?? '#ffffff'}
                  onChange={c => onUpdateStyles({ textColor: c })}
                />
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {COUNTDOWN_THEMES.map(theme => (
            <button
              key={theme.id}
              type="button"
              onClick={() =>
                onUpdateStyles({
                  backgroundColor: theme.backgroundColor,
                  textColor: theme.textColor,
                })
              }
              className="px-2 py-1 rounded-lg text-[10px] font-medium border border-white/10 hover:border-blue-500/40 transition-all"
              style={{
                backgroundColor: theme.backgroundColor,
                color: theme.textColor,
              }}
            >
              {t(`common.${theme.name}` as any)}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
