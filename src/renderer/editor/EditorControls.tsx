import { ClipboardCheck, X } from 'lucide-react';
import { memo, type ComponentType, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../utils';
import { type EditScope, type EditorClipboard } from './useEditorDeck';

export const PanelShell = memo(function PanelShell({
  title,
  icon: Icon,
  children,
  className,
  actions,
}: {
  title: string;
  icon: ComponentType<{ className?: string }>;
  children: ReactNode;
  className?: string;
  actions?: ReactNode;
}) {
  return (
    <div className={cn('space-y-3 rounded-2xl border border-white/10 bg-[#1a1a1a] p-4 shadow-sm', className)}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2 text-sm font-semibold text-white/80">
          <Icon className="h-4 w-4 shrink-0" />
          <span className="truncate">{title}</span>
        </div>
        {actions}
      </div>
      {children}
    </div>
  );
});

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
}: {
  scope: EditScope;
  selectedCount: number;
  slideCount: number;
  onChange: (scope: EditScope) => void;
}) {
  const { t } = useTranslation();
  if (selectedCount <= 1) return null;
  return (
    <div className="space-y-1">
      <div
        role="radiogroup"
        aria-label={t('common.editorScopeLabel')}
        className="grid grid-cols-2 gap-1 rounded-xl border border-white/10 bg-black/25 p-1"
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
              'rounded-lg px-2 py-1.5 text-[11px] font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500',
              scope === option.value
                ? 'bg-blue-600/30 text-blue-100'
                : 'text-white/55 hover:bg-white/5 hover:text-white/80'
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
      {scope === 'selected' && (
        <p
          role="status"
          className="rounded-lg border border-amber-400/30 bg-amber-500/10 px-2 py-1 text-[10px] text-amber-100"
        >
          {t('common.editorScopeNotice', { count: Math.min(selectedCount, slideCount) })}
        </p>
      )}
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
    <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-white/70">
      <ClipboardCheck className="h-3.5 w-3.5 text-blue-300" aria-hidden="true" />
      <span className="truncate">
        {t('common.editorClipboardLabel')}:{' '}
        <strong className="font-medium text-white/85">{t(clipboard.labelKey)}</strong>
        {clipboard.items.length > 1 && ` · ${clipboard.items.length}`}
      </span>
      {targetCount > 0 && (
        <button
          type="button"
          onClick={onApply}
          className="rounded-lg border border-blue-500/30 bg-blue-600/25 px-2 py-1 text-[11px] font-medium text-blue-100 transition hover:bg-blue-600/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
        >
          {t('common.editorApplyToSelected', { count: targetCount })}
        </button>
      )}
      <button
        type="button"
        onClick={onClear}
        aria-label={t('common.editorClearClipboard')}
        title={t('common.editorClearClipboard')}
        className="rounded p-0.5 text-white/40 transition hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
      >
        <X className="h-3 w-3" aria-hidden="true" />
      </button>
    </div>
  );
});
