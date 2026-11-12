import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Pause, Play, RotateCcw } from 'lucide-react';
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

const card = 'space-y-2.5 rounded-xl border border-white/[0.08] bg-white/[0.02] p-3';
const cardTitle = 'text-[11px] font-semibold text-white/65';
const chip =
  'h-7 rounded-md bg-white/[0.04] px-2 text-[11px] font-medium tabular-nums text-white/70 transition hover:bg-white/[0.08] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:pointer-events-none disabled:opacity-35';
const numberInput =
  'h-8 w-full rounded-md border border-white/[0.08] bg-black/25 px-2 text-center font-mono text-sm tabular-nums text-white/90 outline-none transition hover:border-white/15 focus:border-blue-500/70';

export default function CountdownSlideEditor({ slide, onPatch, onUpdateStyles }: CountdownSlideEditorProps) {
  const { t } = useTranslation();
  const data = useMemo(() => parseCountdownContent(slide.content), [slide.content]);

  const [editMinutes, setEditMinutes] = useState(String(data.minutes));
  const [editSeconds, setEditSeconds] = useState(String(data.seconds).padStart(2, '0'));
  const [tick, setTick] = useState(0);

  useEffect(() => {
    setEditMinutes(String(data.minutes));
    setEditSeconds(String(data.seconds).padStart(2, '0'));
  }, [slide.id, data.minutes, data.seconds]);

  useEffect(() => {
    if (data.paused) return;
    const id = setInterval(() => setTick((value) => value + 1), 1000);
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
    onPatch((d) => ({ ...d, startTime: Date.now(), paused: false, pausedRemaining: undefined }));
  }, [onPatch]);

  const pauseCounter = useCallback(() => {
    const left = getCountdownRemaining(data);
    onPatch((d) => ({ ...d, paused: true, pausedRemaining: left }));
  }, [data, onPatch]);

  const resumeCounter = useCallback(() => {
    onPatch((d) => {
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
      onPatch((d) => {
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
  const progress = data.totalSeconds > 0 ? Math.min(1, remaining / data.totalSeconds) : 0;
  const bg = slide.styles?.backgroundColor ?? '#000000';
  const fg = slide.styles?.textColor ?? '#ffffff';
  const activeTheme = COUNTDOWN_THEMES.find(
    (theme) => theme.backgroundColor.toLowerCase() === bg.toLowerCase() && theme.textColor.toLowerCase() === fg.toLowerCase()
  )?.id;
  const statusLabel = data.paused ? t('common.cdPaused') : isFinished ? t('common.countdownFinished') : t('countdown.running');

  return (
    <div className="space-y-3">
      {/* Live state + primary controls */}
      <div className={card}>
        <div className="flex items-center justify-between gap-2">
          <span className={cardTitle}>{t('common.cdRemaining')}</span>
          <span
            className={cn(
              'rounded-full px-2 py-0.5 text-[11px]',
              data.paused ? 'bg-amber-500/15 text-amber-100' : isFinished ? 'bg-white/[0.06] text-white/65' : 'bg-emerald-500/15 text-emerald-200'
            )}
          >
            {statusLabel}
          </span>
        </div>
        <div className="text-center font-mono text-4xl font-bold tabular-nums text-white">{formatCountdownTime(remaining)}</div>
        <div aria-hidden="true" className="h-1 overflow-hidden rounded-full bg-white/[0.06]">
          <div
            className={cn('h-full rounded-full transition-[width] duration-1000 ease-linear', data.paused ? 'bg-amber-400/70' : 'bg-blue-400/80')}
            style={{ width: `${progress * 100}%` }}
          />
        </div>
        <div className="grid grid-cols-[1fr_auto] gap-1.5">
          {data.paused ? (
            <button
              type="button"
              onClick={resumeCounter}
              className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md bg-blue-600 text-xs font-medium text-white transition hover:bg-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"
            >
              <Play className="h-3.5 w-3.5" aria-hidden="true" />
              {t('common.cdResume')}
            </button>
          ) : (
            <button
              type="button"
              onClick={pauseCounter}
              disabled={remaining <= 0}
              className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md bg-white/[0.08] text-xs font-medium text-white/90 transition hover:bg-white/[0.12] disabled:opacity-35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              <Pause className="h-3.5 w-3.5" aria-hidden="true" />
              {t('common.cdPause')}
            </button>
          )}
          <button
            type="button"
            onClick={resetCounter}
            className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md px-3 text-xs font-medium text-white/70 transition hover:bg-white/[0.07] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            {t('common.cdReset')}
          </button>
        </div>
        <div className="grid grid-cols-3 gap-1">
          <button type="button" onClick={() => adjustTime(-30)} className={chip}>
            −{t('countdown.secondsShort', { value: 30 })}
          </button>
          <button type="button" onClick={() => adjustTime(30)} className={chip}>
            +{t('countdown.secondsShort', { value: 30 })}
          </button>
          <button type="button" onClick={() => adjustTime(60)} className={chip}>
            +{t('countdown.minutesShort', { value: 1 })}
          </button>
        </div>
      </div>

      {/* Duration */}
      <div className={card}>
        <span className={cardTitle}>{t('common.cdSetDuration')}</span>
        <form
          className="grid grid-cols-[1fr_auto_1fr_auto] items-center gap-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            applyDuration();
          }}
        >
          <label className="min-w-0">
            <span className="sr-only">{t('common.minutes')}</span>
            <input type="number" min={0} max={99} value={editMinutes} onChange={(event) => setEditMinutes(event.target.value)} className={numberInput} />
          </label>
          <span aria-hidden="true" className="font-mono text-white/35">:</span>
          <label className="min-w-0">
            <span className="sr-only">{t('common.seconds')}</span>
            <input type="number" min={0} max={59} value={editSeconds} onChange={(event) => setEditSeconds(event.target.value)} className={numberInput} />
          </label>
          <button
            type="submit"
            className="h-8 rounded-md bg-white/[0.08] px-3 text-xs font-medium text-white/90 transition hover:bg-white/[0.12] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            {t('common.cdApply')}
          </button>
        </form>
        <div className="flex flex-wrap gap-1">
          {COUNTDOWN_QUICK_PRESETS.map((preset) => (
            <button key={preset.label} type="button" onClick={() => setPreset(preset.minutes, preset.seconds)} className={chip}>
              {t('countdown.minutesShort', { value: preset.minutes })}
            </button>
          ))}
        </div>
      </div>

      {/* Appearance */}
      <div className={card}>
        <span className={cardTitle}>{t('common.cdAppearance')}</span>
        <div className="grid grid-cols-4 gap-1.5">
          {COUNTDOWN_THEMES.map((theme) => {
            const active = activeTheme === theme.id;
            return (
              <button
                key={theme.id}
                type="button"
                aria-pressed={active}
                aria-label={t(`common.${theme.name}`)}
                title={t(`common.${theme.name}`)}
                onClick={() => onUpdateStyles({ backgroundColor: theme.backgroundColor, textColor: theme.textColor })}
                className={cn(
                  'relative grid aspect-video place-items-center rounded-md font-mono text-[10px] font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500',
                  active ? 'ring-2 ring-blue-400 ring-offset-1 ring-offset-surface' : 'ring-1 ring-white/10 hover:ring-white/30'
                )}
                style={{ backgroundColor: theme.backgroundColor, color: theme.textColor }}
              >
                05:00
                {active && (
                  <span className="absolute right-0.5 top-0.5 grid h-3 w-3 place-items-center rounded-full bg-blue-500 text-white">
                    <Check className="h-2 w-2" aria-hidden="true" />
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          {([
            { key: 'backgroundColor', label: t('common.cdBgColor'), value: bg },
            { key: 'textColor', label: t('common.cdDigitColor'), value: fg },
          ] as const).map(({ key, label, value }) => (
            <label
              key={key}
              className="flex h-8 min-w-0 cursor-pointer items-center gap-2 rounded-md border border-white/[0.08] bg-black/25 px-1.5 text-[11px] text-white/65 transition hover:border-white/15"
            >
              <input
                type="color"
                value={/^#[0-9a-f]{6}$/i.test(value) ? value : key === 'textColor' ? '#ffffff' : '#000000'}
                onChange={(event) => onUpdateStyles({ [key]: event.target.value })}
                className="h-5 w-5 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0 [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded [&::-webkit-color-swatch]:border [&::-webkit-color-swatch]:border-white/20"
              />
              <span className="truncate">{label}</span>
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}
