import { Check, ChevronRight } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import type { BibleBook } from './bibleParser';
import { type ReadingEntry } from './scriptureReading';
import { cn } from './utils';

export const BookRow = memo(({ book, active, onClick }: { book: BibleBook; active: boolean; onClick: () => void }) => (
  <button
    type="button"
    onClick={onClick}
    data-guide-anchor={book.number === '1' ? 'bible-book' : undefined}
    aria-current={active ? 'true' : undefined}
    className={cn(
      'group flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-[13px] transition-colors',
      active ? 'bg-blue-500/15 font-semibold text-blue-300' : 'text-zinc-400 hover:bg-white/5 hover:text-white'
    )}
  >
    <span className="truncate">{book.name}</span>
    <ChevronRight className={cn('h-4 w-4', active ? 'opacity-100' : 'opacity-0 group-hover:opacity-60')} />
  </button>
));
BookRow.displayName = 'BookRow';

export const VerseRow = memo(
  ({
    verse,
    selected,
    onToggle,
    label,
  }: {
    verse: ReadingEntry;
    selected: boolean;
    onToggle: (number: string, range: boolean) => void;
    label: string;
  }) => {
    const { t } = useTranslation();
    return (
      <button
        data-guide-anchor={verse.number === '1' ? 'bible-verse' : undefined}
        id={`scripture-verse-${verse.id}`}
        type="button"
        disabled={Boolean(verse.issue)}
        aria-pressed={selected}
        aria-label={`${label} ${verse.number}: ${verse.text} ${verse.issue ? t('common.scriptureIssue_' + verse.issue) : ''}`}
        onClick={(event) => onToggle(verse.id, event.shiftKey)}
        className={cn(
          'ui-selection-surface group flex w-full items-start gap-4 rounded-2xl border px-4 py-3.5 disabled:cursor-default disabled:opacity-70 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/70',
          selected
            ? 'border-blue-500/30 bg-blue-500/10'
            : 'border-transparent bg-zinc-900/35 hover:border-zinc-700 hover:bg-zinc-800/55'
        )}
      >
        <span
          className={cn(
            'mt-0.5 flex h-7 min-w-7 px-2 gap-1 shrink-0 items-center justify-center rounded-lg text-[11px] font-bold',
            selected ? 'bg-blue-500 text-white' : 'bg-zinc-800 text-zinc-400'
          )}
        >
          {verse.number}
          {selected && <Check className="ui-choice-mark h-3.5 w-3.5" />}
        </span>
        <span className={cn('text-[14px] leading-6', selected ? 'font-medium text-zinc-100' : 'text-zinc-300')}>
          {verse.text}
          {verse.evidence && <span className="block text-xs text-blue-300/70">{t('common.scriptureMerged')}</span>}
          {verse.issue && (
            <span className="block text-xs text-amber-300/80">{t('common.scriptureIssue_' + verse.issue)}</span>
          )}
        </span>
      </button>
    );
  }
);
VerseRow.displayName = 'VerseRow';
