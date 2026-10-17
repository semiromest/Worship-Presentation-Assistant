import { useUiMotionEnabled } from '../hooks/useUiMotionEnabled';
import { uiMotion } from '../uiMotion';
import * as m from 'motion/react-m';
import { playSfx } from '../sfx';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import type { Position } from '../types';
import { cn } from '../utils';

const POSITION_OPTIONS: { value: Position; label: string; labelKey: string }[] = [
  { value: 'top-left', label: '↖', labelKey: 'common.hymnsAuthorPosTopLeft' },
  { value: 'top-center', label: '↑', labelKey: 'common.hymnsAuthorPosTopCenter' },
  { value: 'top-right', label: '↗', labelKey: 'common.hymnsAuthorPosTopRight' },
  { value: 'bottom-left', label: '↙', labelKey: 'common.hymnsAuthorPosBottomLeft' },
  { value: 'bottom-center', label: '↓', labelKey: 'common.hymnsAuthorPosBottomCenter' },
  { value: 'bottom-right', label: '↘', labelKey: 'common.hymnsAuthorPosBottomRight' },
];

interface PositionPickerProps {
  value: Position;
  onChange: (value: Position) => void;
  disabled?: boolean;
  labelFor?: (value: Position) => string;
  ariaLabel?: string;
  className?: string;
}

/** 3×2 konum ızgarası. Yazar konumu ve logo filigranı aynı kontrolü paylaşır. */
export function PositionPicker({ value, onChange, disabled, labelFor, ariaLabel, className }: PositionPickerProps) {
  const { t } = useTranslation();
  const indicatorId = useId();
  const motionEnabled = useUiMotionEnabled();
  return (
    <div role="group" className={cn('grid grid-cols-3 gap-1.5', disabled && 'opacity-40', className)} aria-label={ariaLabel}>
      {POSITION_OPTIONS.map((opt) => {
        const active = value === opt.value;
        const label = labelFor?.(opt.value) ?? t(opt.labelKey);
        return (
          <button
            key={opt.value}
            type="button"
            disabled={disabled}
            aria-pressed={active}
            aria-label={label}
            title={label}
            onClick={() => { if (value !== opt.value) { onChange(opt.value); playSfx('snap'); } }}
            className={cn(
              'relative isolate flex h-9 items-center justify-center rounded-lg border text-sm font-bold transition-colors',
              active
                ? 'border-blue-500/40 text-blue-200 shadow-inner'
                : 'border-white/10 bg-white/5 text-white/60 hover:bg-white/10 hover:text-white',
              disabled && 'pointer-events-none',
            )}
          >
            {active && <m.span layoutId={`position-${indicatorId}`} className="pointer-events-none absolute inset-0 -z-10 rounded-lg bg-blue-600/20" transition={{ duration: motionEnabled ? uiMotion.duration.fast : 0, ease: uiMotion.ease }} />}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

interface SettingSliderProps {
  testId?: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  onChange: (value: number) => void;
  disabled?: boolean;
  id?: string;
  ariaLabel?: string;
  className?: string;
}

/** Etiket + değer + kaydırıcı satırı. Tüm ayar kaydırıcıları için ortak stil. */
export function SettingSlider({
  testId,
  label,
  value,
  min,
  max,
  step = 1,
  suffix = '',
  onChange,
  disabled,
  id,
  ariaLabel,
  className,
}: SettingSliderProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={inputId} className="text-xs text-white/65">
          {label}
        </label>
        <span className="font-mono text-[11px] tabular-nums text-white/60">
          {value}
          {suffix}
        </span>
      </div>
      <input
        data-testid={testId}
        id={inputId}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={ariaLabel ?? label}
        className={cn(
          'h-1.5 w-full cursor-pointer appearance-none rounded-full bg-white/10 accent-blue-500',
          disabled && 'cursor-not-allowed opacity-40',
        )}
      />
    </div>
  );
}
