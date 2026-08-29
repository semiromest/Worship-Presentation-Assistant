import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Smartphone, Radio, WifiOff, X, Plus } from 'lucide-react';
import { useStore } from '../state/useStore';
import { cn } from '../utils';

interface SharePanelProps {
  onStartShare: () => Promise<void>;
  onStopShare: () => Promise<void>;
  onAddQrSlide?: (qrDataUrl: string, url: string) => void;
}

/**
 * Phone captions/translation share card.
 *
 * "Start → scan QR → see captions instantly in the browser". The share is
 * independent of the STT session: it can be on before/after STT starts and
 * keeps showing "waiting" on phones when no speech is being captured.
 */
export default function SharePanel({ onStartShare, onStopShare, onAddQrSlide }: SharePanelProps) {
  const { t } = useTranslation();
  const shareActive = useStore((s) => s.shareActive);
  const shareUrl = useStore((s) => s.shareUrl);
  const shareQr = useStore((s) => s.shareQr);
  const shareClientCount = useStore((s) => s.shareClientCount);
  const shareNetworkChanged = useStore((s) => s.shareNetworkChanged);
  const setShareNetworkChanged = useStore((s) => s.setShareNetworkChanged);

  const [busy, setBusy] = useState(false);

  const handleAddQrSlide = () => {
    if (!shareQr || !shareUrl || !onAddQrSlide) return;
    onAddQrSlide(shareQr, shareUrl);
  };

  const toggle = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (shareActive) await onStopShare();
      else await onStartShare();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-3 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Smartphone className="w-4 h-4 text-emerald-300 shrink-0" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-xs font-semibold truncate">{t('common.sttShareTitle')}</p>
            <p className="text-[10px] text-white/45 truncate">{t('common.sttShareDesc')}</p>
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={shareActive}
          onClick={toggle}
          disabled={busy}
          aria-label={shareActive ? t('common.sttShareStop') : t('common.sttShareStart')}
          className={cn(
            'relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:outline-none active:scale-[0.96] disabled:opacity-40',
            shareActive ? 'bg-emerald-500' : 'bg-white/15'
          )}
        >
          <span
            className={cn(
              'inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform',
              shareActive ? 'translate-x-6' : 'translate-x-1'
            )}
          />
        </button>
      </div>

      {shareActive && (
        <>
          {shareNetworkChanged && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/25 bg-amber-500/10 px-2.5 py-2 text-[11px] text-amber-100/90">
              <WifiOff className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" />
              <span className="flex-1">{t('common.sttShareNetworkChanged')}</span>
              <button
                type="button"
                onClick={() => setShareNetworkChanged(false)}
                aria-label={t('common.close')}
                className="shrink-0 rounded p-0.5 text-amber-100/60 hover:text-amber-50 hover:bg-amber-500/20 transition-colors"
              >
                <X className="w-3 h-3" aria-hidden="true" />
              </button>
            </div>
          )}

          <div className="flex items-center gap-3">
            {shareQr ? (
              <img
                src={shareQr}
                alt={t('common.sttShareQrAlt')}
                className="w-28 h-28 rounded-lg bg-white p-1.5 shrink-0"
              />
            ) : (
              <div className="w-28 h-28 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center text-[10px] text-white/40 shrink-0">
                {t('common.remoteLoading')}
              </div>
            )}
            <div className="flex-1 min-w-0 space-y-1.5">
              {shareUrl && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-white/40">
                    {t('common.sttShareUrlLabel')}
                  </p>
                  <p className="text-[11px] text-white/75 break-all leading-snug">{shareUrl}</p>
                </div>
              )}
              <p className="flex items-center gap-1.5 text-[11px] font-semibold text-emerald-300">
                <Radio className="w-3.5 h-3.5" aria-hidden="true" />
                {t('common.sttShareConnected', { count: shareClientCount })}
              </p>
              <p className="text-[10px] text-white/40">{t('common.sttShareHint')}</p>
            </div>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleAddQrSlide}
              disabled={!shareQr}
              title={t('common.screenShareAddSlide')}
              aria-label={t('common.screenShareAddSlide')}
              className="shrink-0 p-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-white/50 hover:text-white/90 transition-colors disabled:opacity-40"
            >
              <Plus className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={onStopShare}
            disabled={busy}
            className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-red-600 hover:bg-red-700 text-white px-4 py-2 text-xs font-bold transition-colors disabled:opacity-40"
          >
            <Smartphone className="w-3.5 h-3.5" aria-hidden="true" />
            {t('common.sttShareStop')}
            </button>
          </div>
        </>
      )}

      {!shareActive && (
        <button
          type="button"
          onClick={onStartShare}
          disabled={busy}
          className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-dashed border-white/20 px-4 py-2 text-xs font-semibold text-white/60 hover:text-white hover:border-white/40 hover:bg-white/5 transition-colors disabled:opacity-40"
        >
          <Smartphone className="w-3.5 h-3.5" aria-hidden="true" />
          {t('common.sttShareStart')}
        </button>
      )}
    </div>
  );
}
