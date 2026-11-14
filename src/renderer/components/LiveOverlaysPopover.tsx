import ControlTooltip from './ControlTooltip';
import { playSfx } from '../sfx';
import { useState } from 'react';
import { Popover } from '@base-ui/react/popover';
import { Megaphone, MessageSquareWarning, UserRound, Radio, EyeOff, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { useLiveOverlayStore } from '../state/useLiveOverlayStore';
import {
  SPEAKER_NAME_MAX_LENGTH, SPEAKER_TITLE_MAX_LENGTH, TICKER_MAX_LENGTH, speakerVisible, tickerLine, tickerVisible,
  type TickerPosition,
} from '../liveOverlays';
import { cn } from '../utils';

type OverlayTab = 'message' | 'speaker';

const fieldClass = 'w-full rounded-lg border border-white/10 bg-black/30 px-2.5 py-2 text-sm text-white placeholder:text-white/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500';

function OnAirActions({ onAir, changed, canSend, onSend, onOff }: {
  onAir: boolean; changed: boolean; canSend: boolean; onSend: () => void; onOff: () => void;
}) {
  const { t } = useTranslation();
  if (!onAir) {
    return (
      <button type="button" disabled={!canSend} onClick={onSend}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-red-600 px-3 py-2 text-sm font-bold text-white transition-colors hover:bg-red-500 disabled:opacity-40 disabled:hover:bg-red-600">
        <Radio className="h-4 w-4" aria-hidden="true" />{t('liveOverlays.goOnAir')}
      </button>
    );
  }
  return (
    <div className="flex gap-2">
      {changed && (
        <button type="button" disabled={!canSend} onClick={onSend}
          className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-blue-500/40 bg-blue-600/20 px-3 py-2 text-sm font-semibold text-blue-200 hover:bg-blue-600/30 disabled:opacity-40">
          <RefreshCw className="h-4 w-4" aria-hidden="true" />{t('liveOverlays.update')}
        </button>
      )}
      <button type="button" onClick={onOff}
        className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm font-semibold text-white/80 hover:bg-white/10 hover:text-white">
        <EyeOff className="h-4 w-4" aria-hidden="true" />{t('liveOverlays.takeOff')}
      </button>
    </div>
  );
}

function MessagePanel() {
  const { t } = useTranslation();
  const { ticker, setTicker } = useLiveOverlayStore(useShallow(s => ({ ticker: s.ticker, setTicker: s.setTicker })));
  const [draft, setDraft] = useState(ticker.text);
  const onAir = tickerVisible(ticker);
  const canSend = !!tickerLine(draft);
  const send = () => {
    if (!canSend) return;
    setTicker({ text: draft, onAir: true });
    playSfx(onAir ? 'success' : 'start');
  };
  const positions: { value: TickerPosition; label: string }[] = [
    { value: 'top', label: t('liveOverlays.top') },
    { value: 'bottom', label: t('liveOverlays.bottom') },
  ];
  return (
    <div className="space-y-3">
      <label className="block space-y-1.5">
        <span className="flex items-center justify-between text-xs text-white/65">
          {t('liveOverlays.messageLabel')}
          <span className="font-mono text-[11px] text-white/40">{draft.length}/{TICKER_MAX_LENGTH}</span>
        </span>
        <textarea value={draft} rows={3} maxLength={TICKER_MAX_LENGTH} autoFocus
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); send(); } }}
          placeholder={t('liveOverlays.messagePlaceholder')} className={cn(fieldClass, 'resize-none')} />
      </label>
      <div className="space-y-1.5">
        <span className="text-xs text-white/65">{t('liveOverlays.position')}</span>
        <div role="radiogroup" aria-label={t('liveOverlays.position')} className="grid grid-cols-2 gap-1 rounded-lg border border-white/10 bg-black/20 p-1">
          {positions.map(option => (
            <button key={option.value} type="button" role="radio" aria-checked={ticker.position === option.value}
              onClick={() => { if (ticker.position !== option.value) { setTicker({ position: option.value }); playSfx('snap'); } }}
              className={cn('rounded-md px-2 py-1.5 text-xs font-semibold transition-colors',
                ticker.position === option.value ? 'bg-white/15 text-white' : 'text-white/55 hover:text-white')}>
              {option.label}
            </button>
          ))}
        </div>
      </div>
      <OnAirActions onAir={onAir} changed={draft !== ticker.text} canSend={canSend} onSend={send}
        onOff={() => { setTicker({ onAir: false }); playSfx('stop'); }} />
      <p className="text-[11px] leading-relaxed text-white/45">{t('liveOverlays.messageHint')}</p>
    </div>
  );
}

function SpeakerPanel() {
  const { t } = useTranslation();
  const { speaker, setSpeaker } = useLiveOverlayStore(useShallow(s => ({ speaker: s.speaker, setSpeaker: s.setSpeaker })));
  const [name, setName] = useState(speaker.name);
  const [title, setTitle] = useState(speaker.title);
  const onAir = speakerVisible(speaker);
  const canSend = !!name.trim();
  const send = () => {
    if (!canSend) return;
    setSpeaker({ name: name.trim(), title: title.trim(), onAir: true });
    playSfx(onAir ? 'success' : 'start');
  };
  const onEnter = (event: React.KeyboardEvent) => { if (event.key === 'Enter') { event.preventDefault(); send(); } };
  return (
    <div className="space-y-3">
      <label className="block space-y-1.5">
        <span className="text-xs text-white/65">{t('liveOverlays.speakerName')}</span>
        <input value={name} maxLength={SPEAKER_NAME_MAX_LENGTH} autoFocus onChange={(event) => setName(event.target.value)} onKeyDown={onEnter}
          placeholder={t('liveOverlays.speakerNamePlaceholder')} className={fieldClass} />
      </label>
      <label className="block space-y-1.5">
        <span className="text-xs text-white/65">{t('liveOverlays.speakerTitle')}</span>
        <input value={title} maxLength={SPEAKER_TITLE_MAX_LENGTH} onChange={(event) => setTitle(event.target.value)} onKeyDown={onEnter}
          placeholder={t('liveOverlays.speakerTitlePlaceholder')} className={fieldClass} />
      </label>
      <OnAirActions onAir={onAir} changed={name.trim() !== speaker.name || title.trim() !== speaker.title} canSend={canSend} onSend={send}
        onOff={() => { setSpeaker({ onAir: false }); playSfx('stop'); }} />
    </div>
  );
}

/** Toolbar entry: announcement ticker and speaker lower-third over the live output. */
export default function LiveOverlaysPopover() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<OverlayTab>('message');
  const { tickerOn, speakerOn, clearAll } = useLiveOverlayStore(useShallow(s => ({
    tickerOn: tickerVisible(s.ticker), speakerOn: speakerVisible(s.speaker), clearAll: s.clearAll,
  })));
  const anyOn = tickerOn || speakerOn;
  const tabs: { id: OverlayTab; label: string; icon: typeof Megaphone; on: boolean }[] = [
    { id: 'message', label: t('liveOverlays.message'), icon: MessageSquareWarning, on: tickerOn },
    { id: 'speaker', label: t('liveOverlays.speaker'), icon: UserRound, on: speakerOn },
  ];

  return (
    <Popover.Root open={open} onOpenChange={(next) => { if (next !== open) playSfx(next ? 'open' : 'close'); setOpen(next); }}>
      <ControlTooltip suppress={open} description={t('liveOverlays.hint')}><Popover.Trigger
        title={t('liveOverlays.title')}
        aria-label={t('liveOverlays.title')}
        data-testid="live-overlays-trigger"
        className={cn(
          'relative flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-md border transition-colors focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none active:scale-[0.96]',
          anyOn ? 'bg-red-600/20 hover:bg-red-600/30 border-red-500/40 text-red-200' : 'bg-white/5 hover:bg-white/10 border-white/10 text-white/60 hover:text-white',
        )}
      >
        <Megaphone className="w-4 h-4" aria-hidden="true" />
        <span className="design-action-label hidden lg:inline text-xs font-semibold">{t('liveOverlays.short')}</span>
        {anyOn && <span aria-hidden="true" className="absolute top-1 right-1 h-2 w-2 rounded-full bg-red-500 animate-pulse" />}
      </Popover.Trigger></ControlTooltip>

      <Popover.Portal>
        <Popover.Positioner side="bottom" align="end" sideOffset={8} className="z-[80]">
          <Popover.Popup
            aria-label={t('liveOverlays.title')}
            className="base-popover-popup w-[360px] max-w-[calc(100vw-24px)] rounded-xl border border-white/10 bg-surface-overlay shadow-2xl p-3 space-y-3 origin-[var(--transform-origin)]"
          >
            <div className="flex items-center gap-2 px-1">
              <Megaphone className="w-4 h-4 text-blue-400" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <h2 className="text-xs font-bold text-white">{t('liveOverlays.title')}</h2>
                <p className="text-[11px] text-white/60">{t('liveOverlays.hint')}</p>
              </div>
              {anyOn && (
                <button type="button" onClick={() => { clearAll(); playSfx('stop'); }}
                  className="shrink-0 rounded-md border border-red-500/30 bg-red-600/15 px-2 py-1 text-[11px] font-bold text-red-300 hover:bg-red-600/25">
                  {t('liveOverlays.clearAll')}
                </button>
              )}
            </div>

            <div role="tablist" aria-label={t('liveOverlays.title')} className="grid grid-cols-2 gap-1 rounded-lg border border-white/10 bg-black/20 p-1">
              {tabs.map(({ id, label, icon: Icon, on }) => (
                <button key={id} type="button" role="tab" aria-selected={tab === id} id={`live-overlay-tab-${id}`} aria-controls={`live-overlay-panel-${id}`}
                  onClick={() => setTab(id)}
                  className={cn('flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-semibold transition-colors',
                    tab === id ? 'bg-white/15 text-white' : 'text-white/55 hover:text-white')}>
                  <Icon className="h-3.5 w-3.5" aria-hidden="true" />{label}
                  {on && <span className="ml-0.5 rounded bg-red-600/30 px-1 text-[10px] font-bold uppercase tracking-wide text-red-200">{t('liveOverlays.onAir')}</span>}
                </button>
              ))}
            </div>

            <div role="tabpanel" id={`live-overlay-panel-${tab}`} aria-labelledby={`live-overlay-tab-${tab}`}>
              {tab === 'message' ? <MessagePanel /> : <SpeakerPanel />}
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
