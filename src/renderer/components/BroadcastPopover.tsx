import ControlTooltip from './ControlTooltip';
import { playSfx } from '../sfx';
import { useEffect, useState } from 'react';
import { Popover } from '@base-ui/react/popover';
import { Cast, Captions, Network } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useStore } from '../state/useStore';
import { useShallow } from 'zustand/shallow';
import {
  IDLE_NDI_STATUS, NDI_LYRICS_OUTPUT_ID, NDI_OUTPUT_FPS, NDI_OUTPUT_HEIGHT, NDI_OUTPUT_WIDTH, NDI_PROGRAM_OUTPUT_ID,
  VIRTUAL_OUTPUT_IDS, type NdiStatus, type NdiStatusMap,
} from '../../shared/virtualOutputs';

interface BroadcastPopoverProps {
  openOutput: (displayId: string) => Promise<void>;
  closeOutput: (displayId: string) => Promise<void>;
}

/** Null on platforms without NDI (web build): the toolbar then hides the entry. */
function useNdiStatus(): NdiStatusMap | null {
  const supported = typeof window.electronAPI?.getNdiStatus === 'function';
  const [status, setStatus] = useState<NdiStatusMap | null>(supported ? {} : null);
  useEffect(() => {
    if (!supported) return;
    let alive = true;
    void window.electronAPI?.getNdiStatus?.().then((value) => { if (alive && value) setStatus(value); }).catch(() => {});
    const off = window.electronAPI?.onNdiStatus?.((value) => setStatus(value));
    return () => { alive = false; off?.(); };
  }, [supported]);
  return status;
}

const OUTPUTS = [
  { id: NDI_PROGRAM_OUTPUT_ID, icon: Network, titleKey: 'broadcast.ndiProgram', hintKey: 'broadcast.ndiProgramHint', testId: 'ndi-program-toggle' },
  { id: NDI_LYRICS_OUTPUT_ID, icon: Captions, titleKey: 'broadcast.ndiLyrics', hintKey: 'broadcast.ndiLyricsHint', testId: 'ndi-lyrics-toggle' },
] as const;

function NdiOutputRow({ output, status, isOpen, onToggle }: {
  output: (typeof OUTPUTS)[number];
  status: NdiStatus;
  isOpen: boolean;
  onToggle: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const Icon = output.icon;
  const toggle = async () => { setBusy(true); try { await onToggle(); } finally { setBusy(false); } };
  return (
    <section className="rounded-lg border border-white/10 bg-white/[0.03] p-2.5 space-y-2" aria-label={t(output.titleKey)}>
      <div className="flex items-center gap-2">
        <Icon className="w-4 h-4 text-white/55" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold">{t(output.titleKey)}</p>
          <p className="text-[11px] text-white/55 font-mono">{NDI_OUTPUT_WIDTH}×{NDI_OUTPUT_HEIGHT} · {NDI_OUTPUT_FPS} fps</p>
        </div>
        <button
          type="button"
          data-testid={output.testId}
          disabled={busy || (!status.available && !isOpen)}
          onClick={() => void toggle()}
          aria-pressed={isOpen}
          className={isOpen
            ? 'px-2 py-1 rounded-md bg-red-600/20 border border-red-500/30 text-red-300 text-[11px] font-bold hover:bg-red-600/30 disabled:opacity-40'
            : 'px-2 py-1 rounded-md bg-green-600/20 border border-green-500/30 text-green-300 text-[11px] font-bold hover:bg-green-600/30 disabled:opacity-40'}
        >
          {isOpen ? t('broadcast.stop') : t('broadcast.start')}
        </button>
      </div>
      <p className="text-[11px] text-white/60">{t(output.hintKey)}</p>

      {isOpen && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px]" role="status">
          <dt className="text-white/50">{t('broadcast.sourceName')}</dt>
          <dd className="font-mono text-white/85 truncate">{status.sourceName ?? t('broadcast.starting')}</dd>
          <dt className="text-white/50">{t('broadcast.receivers')}</dt>
          <dd className="text-white/85">
            {status.connections}
            {status.onProgram && <span className="ml-2 px-1.5 rounded bg-red-600/30 text-red-200 font-bold">{t('broadcast.onProgram')}</span>}
            {!status.onProgram && status.onPreview && <span className="ml-2 px-1.5 rounded bg-emerald-600/25 text-emerald-200 font-bold">{t('broadcast.onPreview')}</span>}
          </dd>
          {status.dropped > 0 && <>
            <dt className="text-white/50">{t('broadcast.dropped')}</dt>
            <dd className="text-amber-300">{status.dropped}</dd>
          </>}
        </dl>
      )}
      {status.error && <p className="text-[11px] text-red-300" role="alert">{status.available ? status.error : t('broadcast.unavailable', { error: status.error })}</p>}
      {isOpen && status.active && status.connections === 0 && <p className="text-[11px] text-white/50">{t('broadcast.receiverHint')}</p>}
    </section>
  );
}

/** Toolbar entry for network outputs: NDI Program (full picture) and NDI Lyrics (key layer). Desktop only. */
export default function BroadcastPopover({ openOutput, closeOutput }: BroadcastPopoverProps) {
  const { t } = useTranslation();
  const statuses = useNdiStatus();
  const open = useStore(useShallow((s) => Object.fromEntries(VIRTUAL_OUTPUT_IDS.map((id) => [id, !!s.outputAssignments[id]?.isOpen])) as Record<string, boolean>));
  const [popoverOpen, setPopoverOpen] = useState(false);
  if (!statuses) return null;

  const statusOf = (id: string) => statuses[id] ?? IDLE_NDI_STATUS;
  const anyOpen = VIRTUAL_OUTPUT_IDS.some((id) => open[id]);
  const onAir = VIRTUAL_OUTPUT_IDS.some((id) => open[id] && statusOf(id).onProgram);
  const allActive = VIRTUAL_OUTPUT_IDS.every((id) => !open[id] || statusOf(id).active);
  const dot = onAir ? 'bg-red-500' : anyOpen && allActive ? 'bg-emerald-400' : anyOpen ? 'bg-amber-400' : null;

  return (
    <Popover.Root open={popoverOpen} onOpenChange={(next) => { if (next !== popoverOpen) playSfx(next ? 'open' : 'close'); setPopoverOpen(next); }}>
      <ControlTooltip suppress={popoverOpen}><Popover.Trigger
        title={t('broadcast.title')}
        aria-label={t('broadcast.title')}
        data-testid="broadcast-popover-trigger"
        className="relative flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-md bg-white/5 hover:bg-white/10 border border-white/10 text-white/60 hover:text-white transition-colors focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none active:scale-[0.96]"
      >
        <Cast className="w-4 h-4" aria-hidden="true" />
        <span className="hidden xl:inline text-xs font-semibold">{t('broadcast.short')}</span>
        {dot && <span aria-hidden="true" className={`absolute top-1 right-1 w-2 h-2 rounded-full ${dot}`} />}
      </Popover.Trigger></ControlTooltip>

      <Popover.Portal>
        <Popover.Positioner side="bottom" align="end" sideOffset={8} className="z-[80]">
          <Popover.Popup
            aria-label={t('broadcast.title')}
            className="base-popover-popup w-[340px] max-w-[calc(100vw-24px)] rounded-xl border border-white/10 bg-surface-overlay shadow-2xl p-3 space-y-3 origin-[var(--transform-origin)] max-h-[80vh] overflow-y-auto"
          >
            <div className="flex items-center gap-2 px-1">
              <Cast className="w-4 h-4 text-blue-400" aria-hidden="true" />
              <div className="min-w-0">
                <h2 className="text-xs font-bold text-white">{t('broadcast.title')}</h2>
                <p className="text-[11px] text-white/60">{t('broadcast.hint')}</p>
              </div>
            </div>
            {OUTPUTS.map((output) => (
              <NdiOutputRow
                key={output.id}
                output={output}
                status={statusOf(output.id)}
                isOpen={open[output.id]}
                onToggle={() => (open[output.id] ? closeOutput(output.id) : openOutput(output.id))}
              />
            ))}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
