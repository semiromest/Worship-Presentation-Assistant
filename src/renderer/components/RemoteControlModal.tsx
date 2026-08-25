import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Smartphone, Wrench, CheckCircle2, X, AlertTriangle, Loader2, ChevronDown, ChevronUp } from 'lucide-react';
import { useStore } from '../state/useStore';
import Dialog from './Dialog';

interface DiagResult {
  ok: boolean;
  serverRunning: boolean;
  serverUrl: string | null;
  port: number | null;
  selectedAddress: string;
  interfaces: Array<{ name: string; address: string; score: number }>;
  selfConnectTest: { tried: boolean; success: boolean; error?: string };
  firewallWarning: boolean;
  checks: Array<{ label: string; pass: boolean; detail: string }>;
}

export default function RemoteControlModal() {
  const { t } = useTranslation();
  const isRemoteOpen = useStore((s) => s.isRemoteOpen);
  const setIsRemoteOpen = useStore((s) => s.setIsRemoteOpen);
  const remoteQr = useStore((s) => s.remoteQr);
  const remoteUrl = useStore((s) => s.remoteUrl);

  const [diag, setDiag] = useState<DiagResult | null>(null);
  const [diagRunning, setDiagRunning] = useState(false);
  const [diagOpen, setDiagOpen] = useState(false);

  const runDiagnostics = async () => {
    setDiagRunning(true);
    setDiagOpen(true);
    setDiag(null);
    try {
      const result = await window.electronAPI?.getRemoteDiagnostics?.();
      setDiag(result ?? null);
    } catch {
      setDiag(null);
    } finally {
      setDiagRunning(false);
    }
  };

  const diagLabel = (check: string): string => {
    const key = `common.remoteDiag${check.charAt(0).toUpperCase() + check.slice(1)}`;
    return t(key, check);
  };

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

          {/* ── Diagnostics ─────────────────────────────────────────── */}
          <div className="border-t border-white/10 pt-3">
            <button
              type="button"
              onClick={() => setDiagOpen((v) => !v)}
              className="flex items-center gap-2 w-full text-xs text-white/50 hover:text-white/80 transition-colors py-1"
            >
              <Wrench className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span className="flex-1 text-left font-semibold">{t('common.remoteDiagTitle')}</span>
              {diagOpen ? <ChevronUp className="w-3.5 h-3.5 shrink-0" /> : <ChevronDown className="w-3.5 h-3.5 shrink-0" />}
            </button>

            {diagOpen && (
              <div className="mt-2 space-y-2">
                {!diagRunning && !diag && (
                  <button
                    type="button"
                    onClick={runDiagnostics}
                    className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-blue-600/15 border border-blue-500/25 text-blue-300 hover:bg-blue-600/25 text-[11px] font-bold transition-colors"
                  >
                    <Wrench className="w-3.5 h-3.5" aria-hidden="true" />
                    {t('common.remoteDiagRun')}
                  </button>
                )}

                {diagRunning && (
                  <div className="flex items-center gap-2 text-[11px] text-white/50 p-2">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                    {t('common.remoteDiagRunning')}
                  </div>
                )}

                {diag && (
                  <div className="space-y-2">
                    {/* Check list */}
                    <div className="space-y-1.5">
                      {diag.checks.map((check) => (
                        <div
                          key={check.label}
                          className={`flex items-start gap-2 rounded-md px-2.5 py-1.5 text-[11px] leading-relaxed ${
                            check.pass ? 'bg-emerald-600/8 border border-emerald-500/15 text-emerald-300' : 'bg-red-600/8 border border-red-500/15 text-red-300'
                          }`}
                        >
                          {check.pass
                            ? <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 shrink-0 text-emerald-400" aria-hidden="true" />
                            : <X className="w-3.5 h-3.5 mt-0.5 shrink-0 text-red-400" aria-hidden="true" />}
                          <div className="min-w-0">
                            <span className="font-semibold">{diagLabel(check.label)}</span>
                            <span className="text-white/50 block mt-0.5">{check.detail}</span>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Firewall warning */}
                    {diag.firewallWarning && (
                      <div className="flex items-start gap-2 rounded-md bg-yellow-600/10 border border-yellow-500/20 p-2.5 text-[11px] text-yellow-300">
                        <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
                        <div>
                          <span className="font-bold block">{t('common.remoteDiagFirewallTitle')}</span>
                          <ul className="list-disc ml-4 mt-1 space-y-0.5 text-yellow-300/80">
                            <li>{t('common.remoteDiagFirewallStep1')}</li>
                            <li>{t('common.remoteDiagFirewallStep2')}</li>
                            <li>{t('common.remoteDiagFirewallStep3')}</li>
                          </ul>
                        </div>
                      </div>
                    )}

                    {/* Troubleshooting tips */}
                    <div className="rounded-md bg-white/[0.03] border border-white/10 p-2.5 text-[10px] text-white/45 space-y-1.5">
                      <p className="font-bold text-white/55">{t('common.remoteDiagTroubleshooting')}</p>
                      <ul className="list-disc ml-4 space-y-1">
                        <li>{t('common.remoteDiagTrouble1')}</li>
                        <li>{t('common.remoteDiagTrouble2')}</li>
                        <li>{t('common.remoteDiagTrouble3')}</li>
                        <li>{t('common.remoteDiagTrouble4')}</li>
                        <li>{t('common.remoteDiagTrouble5')}</li>
                      </ul>
                    </div>

                    {/* Retry button */}
                    <button
                      type="button"
                      onClick={runDiagnostics}
                      disabled={diagRunning}
                      className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white/50 hover:text-white hover:bg-white/10 text-[11px] font-semibold transition-colors disabled:opacity-40"
                    >
                      <Wrench className="w-3 h-3" aria-hidden="true" />
                      {t('common.remoteDiagRetry')}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
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