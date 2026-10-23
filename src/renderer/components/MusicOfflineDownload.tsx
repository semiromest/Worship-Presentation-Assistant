import { useEffect, useRef, useState } from 'react';
import { Check, Download, Loader2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { OfflineMusicStatus } from '../../shared/youtubeMusic';

export default function MusicOfflineDownload({ videoId }: { videoId: string }) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<OfflineMusicStatus>({ state: 'missing' });
  const [checking, setChecking] = useState(true);
  const alive = useRef(false);
  const statusRef = useRef(status);
  statusRef.current = status;
  const epoch = useRef(0);
  useEffect(() => {
    alive.current = true;
    let cancelled = false;
    const check = async () => {
      const request = epoch.current;
      try {
        const result = await window.electronAPI.youtubeMusicOfflineStatus(videoId);
        if (!cancelled && request === epoch.current) { setStatus(result); setChecking(false); }
      } catch { if (!cancelled) { setStatus({ state: 'error', error: 'unavailable' }); setChecking(false); } }
    };
    void check();
    const timer = setInterval(() => { if (statusRef.current.state === 'downloading') void check(); }, 1500);
    return () => { cancelled = true; alive.current = false; clearInterval(timer); };
  }, [videoId]);
  const download = async () => {
    if (status.state === 'downloading') { await window.electronAPI.youtubeMusicCancelDownload(videoId).catch(() => {}); return; }
    epoch.current++;
    setStatus({ state: 'downloading' });
    try {
      const result = await window.electronAPI.youtubeMusicDownload(videoId);
      if (alive.current) setStatus(result.state === 'error' && result.error === 'cancelled' ? { state: 'missing' } : result);
    } catch { if (alive.current) setStatus({ state: 'error', error: 'download-failed' }); }
  };
  const ready = status.state === 'ready';
  const busy = status.state === 'downloading';
  return <div className="space-y-1">
    <button type="button" data-testid="music-offline-download" disabled={checking || ready} onClick={() => void download()}
      title={t(ready ? 'offlineMusic.localHint' : busy ? 'offlineMusic.cancel' : 'offlineMusic.hint')}
      aria-label={t(busy ? 'offlineMusic.cancel' : ready ? 'offlineMusic.ready' : 'offlineMusic.download')}
      className="inline-flex min-h-8 items-center gap-1.5 rounded-md border border-white/10 px-2 py-1 text-[11px] text-white/75 hover:bg-white/10 disabled:cursor-default disabled:opacity-75">
      {ready ? <Check className="h-3.5 w-3.5 text-emerald-300" /> : busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
      <span>{t(ready ? 'offlineMusic.ready' : busy ? 'offlineMusic.downloading' : 'offlineMusic.download')}</span>
      {busy && <X className="h-3 w-3" />}
    </button>
    {status.state === 'error' && <p role="alert" className="text-[11px] text-red-300">{t(status.error === 'busy' ? 'offlineMusic.busy' : 'offlineMusic.error')}</p>}
  </div>;
}
