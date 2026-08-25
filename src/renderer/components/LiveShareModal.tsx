import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Tv, X, Radio, WifiOff, QrCode, Smartphone } from 'lucide-react';
import { useStore } from '../state/useStore';
import Dialog from './Dialog';

interface LiveShareModalProps {
  onStartShare: () => Promise<{ ok: boolean; url?: string; error?: string }>;
  onStopShare: () => Promise<void>;
  onAddQrSlide: (qrDataUrl: string, url: string) => void;
}

/**
 * Phone viewers modal — lets people watch the CURRENT LIVE SLIDE (the one sent
 * to the projector by "Canlı Yayın") fullscreen on their phones via a QR code.
 * View-only: phones receive JPEG frames over WebSocket, no controls.
 */
export default function LiveShareModal({ onStartShare, onStopShare, onAddQrSlide }: LiveShareModalProps) {
  const { t } = useTranslation();
  const isLiveShareOpen = useStore((s) => s.isLiveShareOpen);
  const setIsLiveShareOpen = useStore((s) => s.setIsLiveShareOpen);
  const shareActive = useStore((s) => s.screenShareActive);
  const shareUrl = useStore((s) => s.screenShareUrl);
  const shareQr = useStore((s) => s.screenShareQr);
  const shareClientCount = useStore((s) => s.screenShareClientCount);
  const shareNetworkChanged = useStore((s) => s.screenShareNetworkChanged);
  const setShareNetworkChanged = useStore((s) => s.setScreenShareNetworkChanged);

  const [busy, setBusy] = useState(false);

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

  const handleAddQrSlide = () => {
    if (!shareQr || !shareUrl) return;
    onAddQrSlide(shareQr, shareUrl);
  };

  return (
    <Dialog
      open={isLiveShareOpen}
      onClose={() => setIsLiveShareOpen(false)}
      labelledBy="live-share-modal-title"
      className="bg-surface-overlay border border-white/10 rounded-2xl p-6 max-w-md w-full mx-4 shadow-2xl"
    >
      <div className="flex items-center justify-between mb-4">
        <h2 id="live-share-modal-title" className="text-lg font-bold flex items-center gap-2">
          <Tv className="w-5 h-5 shrink-0 text-emerald-400" aria-hidden="true" />
          {t('common.screenShareTitle')}
        </h2>
        <button
          onClick={() => setIsLiveShareOpen(false)}
          aria-label={t('common.close')}
          className="p-1 rounded hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
        >
          <X className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>

      <p className="text-xs text-white/50 mb-4">{t('common.screenShareDesc')}</p>

      {shareActive ? (
        <div className="space-y-4">
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

          <div className="flex justify-center">
            {shareQr ? (
              <div className="bg-white p-3 rounded-lg">
                <img src={shareQr} alt={t('common.screenShareQrAlt')} className="w-56 h-56" />
              </div>
            ) : (
              <div className="w-56 h-56 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center text-[10px] text-white/40">
                {t('common.remoteLoading')}
              </div>
            )}
          </div>

          {shareUrl && (
            <div className="space-y-1.5">
              <p className="text-[10px] text-white/40 uppercase font-bold">{t('common.sttShareUrlLabel')}</p>
              <div className="text-xs text-white/70 bg-black/20 p-3 rounded-lg border border-white/10 break-all font-mono">
                {shareUrl}
              </div>
            </div>
          )}

          <p className="flex items-center justify-center gap-1.5 text-[11px] font-semibold text-emerald-300">
            <Radio className="w-3.5 h-3.5" aria-hidden="true" />
            {t('common.sttShareConnected', { count: shareClientCount })}
          </p>

          <p className="text-[10px] text-white/40 text-center">{t('common.screenShareHint')}</p>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleAddQrSlide}
              disabled={!shareQr}
              className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/30 text-blue-300 px-4 py-2 text-xs font-bold transition-colors disabled:opacity-40"
            >
              <QrCode className="w-3.5 h-3.5" aria-hidden="true" />
              {t('common.screenShareAddSlide')}
            </button>
            <button
              type="button"
              onClick={onStopShare}
              disabled={busy}
              className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-red-600 hover:bg-red-700 text-white px-4 py-2 text-xs font-bold transition-colors disabled:opacity-40"
            >
              <Smartphone className="w-3.5 h-3.5" aria-hidden="true" />
              {t('common.screenShareStop')}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={onStartShare}
          disabled={busy}
          className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-dashed border-white/20 px-4 py-3 text-xs font-semibold text-white/60 hover:text-white hover:border-white/40 hover:bg-white/5 transition-colors disabled:opacity-40"
        >
          <Tv className="w-3.5 h-3.5" aria-hidden="true" />
          {t('common.screenShareStart')}
        </button>
      )}
    </Dialog>
  );
}