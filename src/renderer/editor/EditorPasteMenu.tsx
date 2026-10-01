import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ClipboardPaste, Copy, Layers, MousePointerClick, Paintbrush } from 'lucide-react';
import { cn } from '../utils';

export interface PasteMenuContext {
  /** Screen position the popover opens from. */
  x: number;
  y: number;
  /** When opened from a thumbnail, paste straight into that slide. */
  slideId?: string;
}

export interface EditorPasteMenuProps {
  context: PasteMenuContext | null;
  /** Is there anything on the clipboard? */
  hasClipboard: boolean;
  /** How many slides are selected (excluding the active one) as bulk targets. */
  selectedTargetCount: number;
  /** Total slides in the deck, for the "all slides" entry. */
  totalCount: number;
  /** Whether the active slide has selected items (required for style paste). */
  hasItemSelection: boolean;
  onClose: () => void;
  onPasteHere: () => void;
  onPasteSamePosition: () => void;
  onPasteSelected: () => void;
  onPasteAll: () => void;
  onPasteStyle: () => void;
}

interface MenuEntry {
  id: 'here' | 'exact' | 'selected' | 'all' | 'style';
  label: string;
  hint?: string;
  icon: typeof Copy;
  disabled: boolean;
}

const MENU_WIDTH = 268;

/**
 * One menu for every paste variant. Reached from Ctrl/Cmd+Shift+V, the canvas
 * context menu and rail thumbnails, so the vocabulary only has to be learned
 * once.
 */
export default function EditorPasteMenu({
  context,
  hasClipboard,
  selectedTargetCount,
  totalCount,
  hasItemSelection,
  onClose,
  onPasteHere,
  onPasteSamePosition,
  onPasteSelected,
  onPasteAll,
  onPasteStyle,
}: EditorPasteMenuProps) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState({ left: 0, top: 0 });

  useLayoutEffect(() => {
    if (!context) return;
    const height = ref.current?.offsetHeight ?? 220;
    const maxLeft = window.innerWidth - MENU_WIDTH - 8;
    const maxTop = window.innerHeight - height - 8;
    setPosition({
      left: Math.max(8, Math.min(context.x, maxLeft)),
      top: Math.max(8, Math.min(context.y, maxTop)),
    });
  }, [context]);

  useEffect(() => {
    if (!context) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('pointerdown', onPointerDown);
    };
  }, [context, onClose]);

  if (!context) return null;

  const entries: MenuEntry[] = [
    {
      id: 'here',
      label: t('common.editorPasteHere'),
      hint: 'Ctrl/Cmd+V',
      icon: ClipboardPaste,
      disabled: !hasClipboard,
    },
    {
      id: 'exact',
      label: t('common.editorPasteSamePosition'),
      icon: MousePointerClick,
      disabled: !hasClipboard,
    },
    {
      id: 'selected',
      label: t('common.editorPasteSelected', { count: Math.max(1, selectedTargetCount) }),
      icon: Layers,
      disabled: !hasClipboard || selectedTargetCount === 0,
    },
    {
      id: 'all',
      label: t('common.editorPasteAll', { count: totalCount }),
      icon: Copy,
      disabled: !hasClipboard || totalCount === 0,
    },
    {
      id: 'style',
      label: t('common.editorPasteStyleOnly'),
      hint: t('common.editorPasteStyleHint'),
      icon: Paintbrush,
      disabled: !hasClipboard || !hasItemSelection,
    },
  ];

  const run = (id: MenuEntry['id']) => {
    onClose();
    if (id === 'here') onPasteHere();
    else if (id === 'exact') onPasteSamePosition();
    else if (id === 'selected') onPasteSelected();
    else if (id === 'all') onPasteAll();
    else onPasteStyle();
  };

  const firstEnabled = entries.find((entry) => !entry.disabled)?.id;

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={t('common.editorPasteMenuTitle')}
      data-editor-paste-menu
      className="fixed z-[70] rounded-xl border border-white/15 bg-[#1f1f1f] p-1.5 shadow-2xl"
      style={{ left: position.left, top: position.top, width: MENU_WIDTH }}
      onKeyDown={(event) => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter') {
          // Native button order handles Tab/Shift+Tab; arrows keep it keyboard-fast.
          const items = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])') ?? []);
          if (items.length === 0) return;
          const current = items.indexOf(document.activeElement as HTMLButtonElement);
          event.preventDefault();
          if (event.key === 'Enter') {
            (items[Math.max(0, current)] ?? items[0]).click();
            return;
          }
          const step = event.key === 'ArrowDown' ? 1 : -1;
          const next = items[(current + step + items.length) % items.length];
          next.focus();
        }
      }}
    >
      <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-white/40">
        {t('common.editorPasteMenuTitle')}
      </p>
      {entries.map((entry) => {
        const Icon = entry.icon;
        return (
          <button
            key={entry.id}
            type="button"
            role="menuitem"
            autoFocus={entry.id === firstEnabled}
            disabled={entry.disabled}
            onClick={() => run(entry.id)}
            className={cn(
              'flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs transition',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500',
              entry.disabled
                ? 'cursor-not-allowed text-white/25'
                : 'text-white/80 hover:bg-white/10 focus-visible:bg-white/10',
            )}
          >
            <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <span className="block truncate">{entry.label}</span>
              {entry.hint && <span className="block text-[10px] text-white/35">{entry.hint}</span>}
            </span>
          </button>
        );
      })}
      {!hasClipboard && (
        <p className="px-2 py-1.5 text-[10px] text-amber-200/80">
          {t('common.editorPasteEmptyClipboard')}
        </p>
      )}
    </div>
  );
}
