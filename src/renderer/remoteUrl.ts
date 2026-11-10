// Phone remote URL and QR code in the store. The URL is '' while the phone server is off:
// it starts when Phone Control opens (or a phone share starts), not at app launch.
import QRCode from 'qrcode';
import { useStore } from './state/useStore';

let latest = '';

export function applyRemoteUrl(url: unknown): void {
  if (typeof url !== 'string') return;
  latest = url;
  const { setRemoteUrl, setRemoteQr, setRemoteDebug } = useStore.getState();
  setRemoteUrl(url);
  if (!url) { setRemoteQr(null); return; }
  QRCode.toDataURL(url)
    .then(qr => { if (latest === url) setRemoteQr(qr); })
    .catch(() => { if (latest === url) setRemoteQr(null); });
  void window.electronAPI?.getRemoteDebug?.().then(info => { if (info?.remoteServerUrl) setRemoteDebug(info); }).catch(() => {});
}

/** Starts the phone server if needed and shows its QR code. */
export async function startRemote(): Promise<void> {
  const api = window.electronAPI;
  const url = api?.remoteStart ? await api.remoteStart() : await api?.getRemoteUrl?.();
  applyRemoteUrl(url ?? '');
}
