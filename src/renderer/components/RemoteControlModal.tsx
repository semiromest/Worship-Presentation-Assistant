import { useTranslation } from 'react-i18next';
import { Smartphone } from 'lucide-react';
import { useStore } from '../state/useStore';
import Dialog from './Dialog';

export default function RemoteControlModal() {
  const { t } = useTranslation();
  const isRemoteOpen = useStore((s) => s.isRemoteOpen);
  const setIsRemoteOpen = useStore((s) => s.setIsRemoteOpen);
  const remoteQr = useStore((s) => s.remoteQr);
  const remoteUrl = useStore((s) => s.remoteUrl);

  return (
    <Dialog
      open={isRemoteOpen}
      onClose={() => setIsRemoteOpen(false)}
      labelledBy="remote-modal-title"
      className="bg-surface-overlay border border-white/10 rounded-2xl p-6 max-w-md w-full mx-4 shadow-2xl"
    >
      <div className="flex items-center justify-between mb-4">
        <h2 id="remote-modal-title" className="text-lg font-bold flex items-center gap-2">
          <Smartphone className="w-5 h-5 shrink-0 text-blue-400" aria-hidden="true" />
          {t('common.remoteTitle')}
        </h2>
        <button
          onClick={() => setIsRemoteOpen(false)}
          aria-label={t('common.close')}
          className="p-1 rounded hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
        >
          <span aria-hidden="true">✕</span>
        </button>
      </div>

      <p className="text-xs text-white/50 mb-4">{t('common.remoteDesc')}</p>

      {remoteQr ? (
        <div className="space-y-4">
          <div className="flex justify-center">
            <div className="bg-white p-3 rounded-lg">
              <img src={remoteQr} alt={t('common.remoteQrAlt')} className="w-64 h-64" />
            </div>
          </div>
          {remoteUrl && (
            <div className="space-y-1.5">
              <p className="text-[10px] text-white/40 uppercase font-bold">{t('common.remoteUrlLabel')}</p>
              <div className="text-sm text-white/70 bg-black/20 p-3 rounded-lg border border-white/10 break-all font-mono">
                {remoteUrl}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-lg bg-yellow-600/10 border border-yellow-500/30 p-3 space-y-1.5">
          <p className="text-[11px] font-bold text-yellow-400 uppercase">⚠ {t('common.remoteLoading')}</p>
          <p className="text-xs text-yellow-300/80">{t('common.remoteLoadingDesc')}</p>
        </div>
      )}
    </Dialog>
  );
}