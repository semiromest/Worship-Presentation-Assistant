import { useCallback, useEffect } from 'react';
import QRCode from 'qrcode';
import { useStore } from '../state/useStore';
import { IS_PROJECTOR_MODE } from '../constants';

/**
 * Live-screen phone broadcast (Phone Viewers).
 *
 * Lets people watch the current live slide (the one sent to the projector by
 * “Canlı Yayın”) fullscreen on their phones via a QR code. The main process
 * holds the token + WebSocket fan-out; this hook only manages the
 * renderer-side state (URL, QR, client count). JPEG frames of the live slide
 * are pushed by useLiveScreenShare (mounted once in App.tsx).
 *
 * Control window only — the projector window is a no-op.
 */
export function useScreenShare(): {
  startShare: () => Promise<{ ok: boolean; url?: string; error?: string }>;
  stopShare: () => Promise<void>;
} {
  const setScreenShareActive = useStore((s) => s.setScreenShareActive);
  const setScreenShareUrl = useStore((s) => s.setScreenShareUrl);
  const setScreenShareQr = useStore((s) => s.setScreenShareQr);
  const setScreenShareClientCount = useStore((s) => s.setScreenShareClientCount);
  const setScreenShareNetworkChanged = useStore((s) => s.setScreenShareNetworkChanged);

  // Main → renderer events: client count, network change, status re-hydration.
  useEffect(() => {
    if (IS_PROJECTOR_MODE) return;

    const offCount = window.electronAPI?.onScreenShareClientCount?.((count) => {
      setScreenShareClientCount(count);
    });

    const offNetwork = window.electronAPI?.onScreenShareNetworkChanged?.(({ url }) => {
      setScreenShareUrl(url);
      setScreenShareNetworkChanged(true);
      QRCode.toDataURL(url)
        .then(setScreenShareQr)
        .catch(() => setScreenShareQr(null));
    });

    // Re-hydrate after a control-window reload while a broadcast is running.
    void window.electronAPI?.screenShareGetStatus?.().then((status) => {
      if (!status?.active) return;
      setScreenShareActive(true);
      setScreenShareUrl(status.url);
      setScreenShareClientCount(status.clientCount);
      QRCode.toDataURL(status.url)
        .then(setScreenShareQr)
        .catch(() => setScreenShareQr(null));
    });

    return () => {
      offCount?.();
      offNetwork?.();
    };
  }, [setScreenShareActive, setScreenShareUrl, setScreenShareQr, setScreenShareClientCount, setScreenShareNetworkChanged]);

  const startShare = useCallback(async () => {
    const res = await window.electronAPI?.screenShareStart?.();
    if (!res?.ok || !res.url) return { ok: false, error: res?.error };
    setScreenShareActive(true);
    setScreenShareUrl(res.url);
    setScreenShareClientCount(0);
    setScreenShareNetworkChanged(false);
    QRCode.toDataURL(res.url)
      .then(setScreenShareQr)
      .catch(() => setScreenShareQr(null));
    return { ok: true, url: res.url };
  }, [setScreenShareActive, setScreenShareUrl, setScreenShareQr, setScreenShareClientCount, setScreenShareNetworkChanged]);

  const stopShare = useCallback(async () => {
    await window.electronAPI?.screenShareStop?.();
    setScreenShareActive(false);
    setScreenShareUrl('');
    setScreenShareQr(null);
    setScreenShareClientCount(0);
    setScreenShareNetworkChanged(false);
  }, [setScreenShareActive, setScreenShareUrl, setScreenShareQr, setScreenShareClientCount, setScreenShareNetworkChanged]);

  return { startShare, stopShare };
}
