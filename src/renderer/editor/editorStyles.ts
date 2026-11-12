import { cn } from '../utils';

// ─── Shared compact styling ──────────────────────────────────────────────────

/** 28px compact input used everywhere in the inspector. */
export const inputClass =
  'h-7 w-full min-w-0 rounded-md border border-white/[0.08] bg-black/25 px-2 text-xs text-white/90 outline-none transition placeholder:text-white/40 hover:border-white/15 focus:border-blue-500/70 disabled:opacity-40';

export const fieldLabelClass = 'block text-[11px] text-white/55';

const iconButtonBase =
  'inline-flex h-7 min-w-7 shrink-0 items-center justify-center gap-1.5 rounded-md px-1.5 text-xs transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:pointer-events-none disabled:opacity-30';

export function iconButtonClass(active = false, tone: 'default' | 'danger' = 'default') {
  return cn(
    iconButtonBase,
    active
      ? 'bg-blue-500/20 text-blue-100'
      : tone === 'danger'
        ? 'text-red-300/80 hover:bg-red-500/10 hover:text-red-200'
        : 'text-white/65 hover:bg-white/[0.07] hover:text-white'
  );
}
