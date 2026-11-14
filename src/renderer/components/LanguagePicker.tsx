import { useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { Popover } from '@base-ui/react/popover';
import { Check, Search, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { languageOptions, searchLanguages, suggestedLanguageCodes, type LanguageOption } from '../sttLanguageOptions';
import { playSfx } from '../sfx';
import { cn } from '../utils';

interface LanguagePickerProps {
  /** Currently chosen codes (single-select pickers pass one). */
  selected: readonly string[];
  onSelect: (code: string) => void;
  /** Codes not offered at all (e.g. languages already added). */
  exclude?: readonly string[];
  /** Adds an "Auto-detect" row at the top with this code and label. */
  auto?: { code: string; label: string; description?: string };
  disabled?: boolean;
  ariaLabel: string;
  triggerClassName?: string;
  children: ReactNode;
}

type Row = { kind: 'auto'; code: string; label: string; description?: string } | { kind: 'language'; option: LanguageOption };

/** Searchable language list in a popover: localized names, native names and suggestions first. */
export default function LanguagePicker({ selected, onSelect, exclude = [], auto, disabled, ariaLabel, triggerClassName, children }: LanguagePickerProps) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listId = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const locale = i18n.language || 'en';

  const { suggested, rest } = useMemo(() => {
    const skip = new Set(exclude);
    const all = languageOptions(locale).filter(option => !skip.has(option.code));
    if (query.trim()) return { suggested: [] as LanguageOption[], rest: searchLanguages(all, query) };
    const codes = suggestedLanguageCodes(locale, exclude);
    const byCode = new Map(all.map(option => [option.code, option]));
    return { suggested: codes.map(code => byCode.get(code)!).filter(Boolean), rest: all };
  }, [locale, exclude, query]);

  const rows: Row[] = [
    ...(auto && !query.trim() ? [{ kind: 'auto' as const, ...auto }] : []),
    ...suggested.map(option => ({ kind: 'language' as const, option })),
    ...rest.map(option => ({ kind: 'language' as const, option })),
  ];
  const autoCount = auto && !query.trim() ? 1 : 0;
  const clamped = Math.min(active, Math.max(0, rows.length - 1));

  const choose = (code: string) => {
    onSelect(code);
    playSfx('select');
    setOpen(false);
  };
  const scrollTo = (index: number) => {
    listRef.current?.querySelector<HTMLElement>(`[data-row="${index}"]`)?.scrollIntoView({ block: 'nearest' });
  };
  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const next = rows.length ? (clamped + (event.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length : 0;
      setActive(next);
      scrollTo(next);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const row = rows[clamped];
      if (row) choose(row.kind === 'auto' ? row.code : row.option.code);
    }
  };

  const renderRow = (row: Row, index: number) => {
    const code = row.kind === 'auto' ? row.code : row.option.code;
    const isSelected = selected.includes(code);
    const hint = row.kind === 'auto'
      ? row.description
      : [row.option.native !== row.option.label ? row.option.native : null, row.option.code].filter(Boolean).join(' · ');
    return (
      <div key={`${index}-${code}`} id={`${listId}-${index}`} data-row={index} role="option" aria-selected={isSelected}
        onMouseMove={() => { if (clamped !== index) setActive(index); }}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => choose(code)}
        className={cn('flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs',
          index === clamped ? 'bg-blue-600/25 text-white' : 'text-white/80')}>
        {row.kind === 'auto' && <Sparkles className="h-3.5 w-3.5 shrink-0 text-amber-300" aria-hidden="true" />}
        <span className="min-w-0 flex-1 truncate">
          <span className="font-medium">{row.kind === 'auto' ? row.label : row.option.label}</span>
          {hint && <span className="ml-1.5 text-white/45">{hint}</span>}
        </span>
        {isSelected && <Check className="h-3.5 w-3.5 shrink-0 text-emerald-300" aria-hidden="true" />}
      </div>
    );
  };

  return (
    <Popover.Root open={open} onOpenChange={(next) => { setOpen(next); if (next) { setQuery(''); setActive(0); } }}>
      <Popover.Trigger disabled={disabled} aria-label={ariaLabel} className={triggerClassName}>{children}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="start" sideOffset={6} className="z-[90]">
          <Popover.Popup aria-label={ariaLabel}
            className="base-popover-popup w-[300px] max-w-[calc(100vw-24px)] rounded-xl border border-white/10 bg-surface-overlay p-2 shadow-2xl origin-[var(--transform-origin)]">
            <div className="relative mb-1.5">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/40" aria-hidden="true" />
              <input autoFocus type="search" value={query} role="combobox" aria-expanded="true" aria-controls={listId}
                aria-activedescendant={rows.length ? `${listId}-${clamped}` : undefined}
                onChange={(event) => { setQuery(event.target.value); setActive(0); }} onKeyDown={onKeyDown}
                placeholder={t('common.sttTargetLanguageSearch')} aria-label={t('common.sttTargetLanguageSearch')}
                className="w-full rounded-lg border border-white/10 bg-black/30 py-1.5 pl-8 pr-2.5 text-xs text-white placeholder:text-white/35 outline-none focus-visible:border-blue-500/60" />
            </div>
            <div ref={listRef} id={listId} role="listbox" aria-label={ariaLabel} className="max-h-72 space-y-0.5 overflow-y-auto">
              {rows.length === 0 && <p className="px-2 py-3 text-center text-[11px] text-white/50">{t('common.sttTargetLanguageNoResults')}</p>}
              {rows.slice(0, autoCount).map((row, index) => renderRow(row, index))}
              {suggested.length > 0 && <p className="px-2 pb-0.5 pt-1.5 text-[10px] font-semibold uppercase tracking-wider text-white/40">{t('common.sttSuggestedLanguages')}</p>}
              {rows.slice(autoCount, autoCount + suggested.length).map((row, index) => renderRow(row, autoCount + index))}
              {suggested.length > 0 && <p className="px-2 pb-0.5 pt-2 text-[10px] font-semibold uppercase tracking-wider text-white/40">{t('common.sttAllLanguages')}</p>}
              {rows.slice(autoCount + suggested.length).map((row, index) => renderRow(row, autoCount + suggested.length + index))}
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
