import { useEffect, useId, useRef, useState } from 'react';
import { Popover } from '@base-ui/react/popover';
import { ExternalLink, Heart, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { SupportAvailability, SupportPlatform } from '../../shared/support';
import ControlTooltip from './ControlTooltip';

export default function SupportDevelopment() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [available, setAvailable] = useState<SupportAvailability | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState<SupportPlatform | null>(null);
  const titleId = useId(), descriptionId = useId();
  const opening = useRef(false);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setAvailable(null); setError(false);
    void window.electronAPI.getSupportAvailability().then(value => {
      if (alive) setAvailable({ kreosus: value?.kreosus === true, github: value?.github === true });
    }).catch(() => { if (alive) { setAvailable({ kreosus: false, github: false }); setError(true); } });
    return () => { alive = false; };
  }, [open]);
  async function choose(platform: SupportPlatform) {
    if (!available?.[platform] || opening.current) return;
    opening.current = true; setBusy(platform); setError(false);
    try {
      if (await window.electronAPI.openSupport(platform)) setOpen(false);
      else setError(true);
    } catch { setError(true); }
    finally { opening.current = false; setBusy(null); }
  }
  return <section id="settings-item-support" tabIndex={-1} className="rounded-xl border border-white/10 bg-surface-raised p-4">
    <h4 className="font-semibold">Worship Presentation Assistant</h4>
    <p className="mt-3 whitespace-pre-line break-words text-sm leading-7 text-white/70">{t('support.description')}</p>
    <div className="mt-5">
      <Popover.Root open={open} onOpenChange={setOpen}>
        <ControlTooltip suppress={open} description={t('support.hint')}><Popover.Trigger data-testid="support-development" className="workspace-secondary-action inline-flex items-center gap-2 focus-visible:outline-none focus-visible:ring-blue-400">
          <Heart className="h-4 w-4 text-rose-300" aria-hidden="true" />{t('support.title')}
        </Popover.Trigger></ControlTooltip>
        <Popover.Portal><Popover.Positioner side="bottom" align="end" sideOffset={8} className="z-[80]">
          <Popover.Popup aria-labelledby={titleId} aria-describedby={descriptionId} onKeyDown={event => event.stopPropagation()}
            className="base-popover-popup w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-white/15 bg-surface-overlay p-4 text-white shadow-2xl">
            <div className="flex items-center justify-between gap-3"><h3 id={titleId} className="font-semibold">{t('support.title')}</h3>
              <Popover.Close aria-label={t('common.close')} className="rounded-md p-1 text-white/60 hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-blue-400"><X className="h-4 w-4" aria-hidden="true" /></Popover.Close></div>
            <p id={descriptionId} className="mt-2 text-sm leading-relaxed text-white/60">{t('support.external')}</p>
            <div className="mt-3 space-y-2" aria-busy={!!busy || !available}>
              {(['kreosus', 'github'] as const).map(platform => <button key={platform} type="button" onClick={() => void choose(platform)}
                disabled={!available?.[platform] || !!busy} data-testid={`support-${platform}`}
                className="flex w-full items-center justify-between gap-3 rounded-lg border border-white/15 px-3 py-2.5 text-left text-sm hover:bg-white/5 focus-visible:ring-2 focus-visible:ring-blue-400 disabled:cursor-default disabled:opacity-45">
                <span>{platform === 'github' ? 'GitHub Sponsors' : 'Kreosus'}</span><ExternalLink className="h-4 w-4 shrink-0" aria-hidden="true" />
              </button>)}
            </div>
            {available && !available.github && !available.kreosus && !error && <p className="mt-3 text-xs leading-relaxed text-white/55" role="status">{t('support.notReady')}</p>}
            {error && <p className="mt-3 text-sm text-red-300" role="alert">{t('support.error')}</p>}
          </Popover.Popup>
        </Popover.Positioner></Popover.Portal>
      </Popover.Root>
    </div>
  </section>;
}
