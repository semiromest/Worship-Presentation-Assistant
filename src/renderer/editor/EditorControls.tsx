import ControlTooltip from '../components/ControlTooltip';
import { ChevronDown, ClipboardCheck, Palette as PaletteIcon, X } from 'lucide-react';
import { memo, useEffect, useId, useRef, useState, type ComponentType, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../utils';
import { ColorPalette } from './ColorPalette';
import { fieldLabelClass, iconButtonClass, inputClass } from './editorStyles';

import { type EditScope, type EditorClipboard } from './useEditorDeck';

/** Icon-only button with tooltip and an accessible name. */
export function ToolButton({
  label,
  icon: Icon,
  onClick,
  active,
  disabled,
  tone,
  descriptionKey,
  children,
  className,
  pressed,
  anchor,
}: {
  label: string;
  icon?: ComponentType<{ className?: string }>;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  tone?: 'default' | 'danger';
  descriptionKey?: string;
  children?: ReactNode;
  className?: string;
  /** Exposes toggle state for toggle buttons. */
  pressed?: boolean;
  anchor?: string;
}) {
  return (
    <ControlTooltip descriptionKey={descriptionKey}>
      <button
        type="button"
        aria-label={label}
        title={label}
        aria-pressed={pressed}
        data-guide-anchor={anchor}
        disabled={disabled}
        onClick={onClick}
        className={cn(iconButtonClass(active, tone), className)}
      >
        {Icon && (
          <span aria-hidden="true" className="contents">
            <Icon className="h-4 w-4" />
          </span>
        )}
        {children}
      </button>
    </ControlTooltip>
  );
}

/** Thin vertical divider for toolbars. */
export function ToolDivider() {
  return <span aria-hidden="true" className="mx-0.5 h-4 w-px shrink-0 bg-white/10" />;
}

// ─── Sections ────────────────────────────────────────────────────────────────

const sectionMemory = new Map<string, boolean>();

/**
 * Flat, collapsible inspector section. Replaces the old card-in-card shells:
 * a hairline divider, a small heading and the content. Open state is
 * remembered for the session so the panel doesn't re-collapse on every
 * selection change.
 */
export function Section({
  id,
  title,
  children,
  actions,
  defaultOpen = true,
  collapsible = true,
}: {
  /** Stable id used to remember the open state. */
  id: string;
  title: string;
  children: ReactNode;
  actions?: ReactNode;
  defaultOpen?: boolean;
  collapsible?: boolean;
}) {
  const [open, setOpenState] = useState(() => sectionMemory.get(id) ?? defaultOpen);
  const contentId = useId();
  const setOpen = (value: boolean) => {
    sectionMemory.set(id, value);
    setOpenState(value);
  };
  const expanded = !collapsible || open;
  return (
    <section className="border-t border-white/[0.06] first:border-t-0" data-editor-section={id}>
      <div className="flex min-h-9 items-center justify-between gap-2 px-3">
        {collapsible ? (
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls={contentId}
            onClick={() => setOpen(!open)}
            className="group -mx-1 flex min-w-0 flex-1 items-center gap-1 rounded px-1 py-2 text-left text-[11px] font-semibold text-white/70 transition hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            <ChevronDown
              className={cn('h-3 w-3 shrink-0 text-white/40 transition-transform', !expanded && '-rotate-90')}
              aria-hidden="true"
            />
            <span className="truncate">{title}</span>
          </button>
        ) : (
          <h3 className="truncate py-2 text-[11px] font-semibold text-white/70">{title}</h3>
        )}
        {actions && <div className="flex shrink-0 items-center gap-0.5">{actions}</div>}
      </div>
      {expanded && (
        <div id={contentId} className="space-y-2.5 px-3 pb-3">
          {children}
        </div>
      )}
    </section>
  );
}

// ─── Fields ──────────────────────────────────────────────────────────────────

/** Label above a control, sentence case and small. */
export function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={cn('block min-w-0 space-y-1', className)}>
      <span className={fieldLabelClass}>{label}</span>
      {children}
    </label>
  );
}

/**
 * Number input with the label drawn inside the box (`X 12`). The visible
 * prefix is short; `label` is the accessible name.
 */
export function NumberField({
  label,
  prefix,
  value,
  onChange,
  min,
  max,
  step,
  disabled,
  anchor,
  placeholder,
  suffix,
}: {
  label: string;
  prefix?: ReactNode;
  value: number | string;
  onChange: (value: string) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  anchor?: string;
  placeholder?: string;
  suffix?: string;
}) {
  return (
    <label className="group relative flex h-7 min-w-0 items-center rounded-md border border-white/[0.08] bg-black/25 transition hover:border-white/15 focus-within:border-blue-500/70">
      <span className="sr-only">{label}</span>
      {prefix !== undefined && (
        <span aria-hidden="true" className="pointer-events-none select-none pl-2 text-[11px] text-white/45">
          {prefix}
        </span>
      )}
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        placeholder={placeholder}
        data-guide-anchor={anchor}
        onChange={(event) => onChange(event.target.value)}
        className="h-full w-full min-w-0 bg-transparent px-1.5 text-xs tabular-nums text-white/90 outline-none disabled:opacity-40 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
      {suffix && (
        <span aria-hidden="true" className="pointer-events-none pr-2 text-[11px] text-white/40">
          {suffix}
        </span>
      )}
    </label>
  );
}

/** Range slider with inline label and value readout. */
export function SliderField({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  format?: (value: number) => string;
}) {
  return (
    <label className="block space-y-1">
      <span className="flex items-center justify-between">
        <span className={fieldLabelClass}>{label}</span>
        <span className="text-[11px] tabular-nums text-white/45">{format ? format(value) : value}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(parseFloat(event.target.value))}
        className="h-4 w-full accent-blue-500"
      />
    </label>
  );
}

/**
 * Compact color control: swatch (native picker), hex text and an optional
 * palette popover. One row, 28px tall.
 */
export function ColorField({
  label,
  value,
  fallback,
  onChange,
  onClear,
  showText = true,
}: {
  label: string;
  value?: string;
  fallback: string;
  onChange: (color: string) => void;
  onClear?: () => void;
  showText?: boolean;
}) {
  const { t } = useTranslation();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!paletteOpen) return;
    const outside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setPaletteOpen(false);
    };
    window.addEventListener('pointerdown', outside);
    return () => window.removeEventListener('pointerdown', outside);
  }, [paletteOpen]);
  const swatch = value && value !== 'transparent' && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
  return (
    <div ref={rootRef} className="relative min-w-0 space-y-1">
      <span className={fieldLabelClass}>{label}</span>
      <div className="flex h-7 min-w-0 items-center gap-1 rounded-md border border-white/[0.08] bg-black/25 pr-0.5 transition hover:border-white/15 focus-within:border-blue-500/70">
        <input
          type="color"
          aria-label={label}
          value={swatch}
          onChange={(event) => onChange(event.target.value)}
          className="ml-1 h-5 w-5 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0 [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded [&::-webkit-color-swatch]:border [&::-webkit-color-swatch]:border-white/20"
        />
        {showText ? (
          <input
            type="text"
            aria-label={label}
            value={value ?? ''}
            placeholder={fallback}
            onChange={(event) => onChange(event.target.value)}
            className="h-full min-w-0 flex-1 bg-transparent text-xs text-white/85 outline-none placeholder:text-white/35"
          />
        ) : (
          <span className="flex-1" />
        )}
        <ToolButton
          label={t('common.editorColorPalette')}
          descriptionKey="common.editorColorPalette"
          icon={PaletteIcon}
          active={paletteOpen}
          onClick={() => setPaletteOpen(!paletteOpen)}
          className="h-6 min-w-6"
        />
        {onClear && (
          <ToolButton label={t('common.editorClear')} icon={X} onClick={onClear} className="h-6 min-w-6" />
        )}
      </div>
      {paletteOpen && (
        <div className="absolute left-0 right-0 top-full z-30 mt-1 rounded-lg border border-white/10 bg-surface-overlay p-2 shadow-2xl">
          <ColorPalette
            currentColor={value}
            onSelect={(color) => {
              onChange(color);
              setPaletteOpen(false);
            }}
          />
        </div>
      )}
    </div>
  );
}

/** Compact select. */
export function SelectField({
  label,
  value,
  onChange,
  options,
  disabled,
  hideLabel,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string; disabled?: boolean }>;
  disabled?: boolean;
  hideLabel?: boolean;
}) {
  return (
    <label className="block min-w-0 space-y-1">
      <span className={hideLabel ? 'sr-only' : fieldLabelClass}>{label}</span>
      <select value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} className={cn(inputClass, 'pr-6')}>
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Icon toggle group in one rounded track. */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T | undefined;
  options: Array<{ value: T; label: string; icon?: ComponentType<{ className?: string }>; text?: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="flex h-7 min-w-0 items-center gap-0.5 rounded-md bg-black/25 p-0.5">
      {options.map(({ value: optionValue, label: optionLabel, icon: Icon, text }) => (
        <ControlTooltip key={optionValue}>
          <button
            type="button"
            aria-label={optionLabel}
            title={optionLabel}
            aria-pressed={value === optionValue}
            onClick={() => onChange(optionValue)}
            className={cn(
              'flex h-6 min-w-0 flex-1 items-center justify-center rounded text-xs transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500',
              value === optionValue ? 'bg-white/[0.12] text-white' : 'text-white/55 hover:text-white/85'
            )}
          >
            {Icon ? <Icon className="h-3.5 w-3.5" /> : <span className="font-semibold">{text}</span>}
          </button>
        </ControlTooltip>
      ))}
    </div>
  );
}

// ─── Scope + clipboard ───────────────────────────────────────────────────────

/**
 * Scope control: the single place that decides whether an edit lands on the
 * working slide only or on every selected slide. It only appears when there is
 * more than one slide selected, and it always defaults to the safe option.
 */
export const ScopeSelector = memo(function ScopeSelector({
  scope,
  selectedCount,
  slideCount,
  onChange,
  children,
}: {
  scope: EditScope;
  selectedCount: number;
  slideCount: number;
  onChange: (scope: EditScope) => void;
  /** Extra bulk actions shown under the switch. */
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  if (selectedCount <= 1) return null;
  return (
    <div className="space-y-2 border-b border-white/[0.06] bg-blue-500/[0.06] px-3 py-2.5">
      <div
        role="radiogroup"
        aria-label={t('common.editorScopeLabel')}
        className="grid h-7 grid-cols-2 gap-0.5 rounded-md bg-black/30 p-0.5"
      >
        {[
          { value: 'active' as const, label: t('common.editorScopeActive') },
          { value: 'selected' as const, label: t('common.editorScopeSelected', { count: selectedCount }) },
        ].map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={scope === option.value}
            onClick={() => onChange(option.value)}
            className={cn(
              'truncate rounded px-2 text-[11px] font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500',
              scope === option.value ? 'bg-blue-500/30 text-blue-50' : 'text-white/55 hover:text-white/85'
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
      {scope === 'selected' && (
        <p role="status" className="text-[11px] leading-snug text-blue-100/75">
          {t('common.editorScopeNotice', { count: Math.min(selectedCount, slideCount) })}
        </p>
      )}
      {children}
    </div>
  );
});

/** Clipboard status + the one-click "apply to the other selected slides". */
export const ClipboardChip = memo(function ClipboardChip({
  clipboard,
  targetCount,
  onApply,
  onClear,
}: {
  clipboard: EditorClipboard;
  targetCount: number;
  onApply: () => void;
  onClear: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-white/10 bg-surface-overlay/95 py-1 pl-3 pr-1 text-xs text-white/70 shadow-lg backdrop-blur">
      <ClipboardCheck className="h-3.5 w-3.5 shrink-0 text-blue-300" aria-hidden="true" />
      <span className="truncate">
        {t('common.editorClipboardLabel')}:{' '}
        <strong className="font-medium text-white/85">{t(clipboard.labelKey)}</strong>
        {clipboard.items.length > 1 && ` · ${clipboard.items.length}`}
      </span>
      {targetCount > 0 && (
        <button
          type="button"
          onClick={onApply}
          className="rounded-full bg-blue-500/25 px-2 py-0.5 text-[11px] font-medium text-blue-50 transition hover:bg-blue-500/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
        >
          {t('common.editorApplyToSelected', { count: targetCount })}
        </button>
      )}
      <ControlTooltip descriptionKey={'common.editorClearClipboard'}>
        <button
          type="button"
          onClick={onClear}
          aria-label={t('common.editorClearClipboard')}
          title={t('common.editorClearClipboard')}
          className="rounded-full p-1 text-white/55 transition hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        >
          <X className="h-3 w-3" aria-hidden="true" />
        </button>
      </ControlTooltip>
    </div>
  );
});
