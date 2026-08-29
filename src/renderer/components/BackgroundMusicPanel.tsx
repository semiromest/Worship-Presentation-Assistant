import { useEffect, useRef, useState } from 'react';
import { FolderOpen, Music, Pause, Play, RefreshCw, Square, Volume2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useStore } from '../state/useStore';
import { cn, toFileUrl } from '../utils';

export default function BackgroundMusicPanel() {
  const { t } = useTranslation();
  const audioRef = useRef<HTMLAudioElement>(null);
  const [error, setError] = useState<string | null>(null);
  const folder = useStore((s) => s.backgroundMusicFolder);
  const files = useStore((s) => s.backgroundMusicFiles);
  const current = useStore((s) => s.backgroundMusicCurrent);
  const playing = useStore((s) => s.backgroundMusicPlaying);
  const volume = useStore((s) => s.mediaVolume);
  const muted = useStore((s) => s.isMediaMuted);
  const setFolder = useStore((s) => s.setBackgroundMusicFolder);
  const setFiles = useStore((s) => s.setBackgroundMusicFiles);
  const setCurrent = useStore((s) => s.setBackgroundMusicCurrent);
  const setPlaying = useStore((s) => s.setBackgroundMusicPlaying);

  const scan = async (path = folder) => {
    if (!path) return;
    const result = await window.electronAPI?.readAudioFolder?.(path, true);
    if (result?.missing) setError(t('settings.backgroundMusicMissing'));
    else { setError(null); setFiles(result?.paths ?? []); }
  };

  const chooseFolder = async () => {
    const path = await window.electronAPI?.selectAudioFolder?.();
    if (!path) return;
    setFolder(path);
    await scan(path);
  };

  useEffect(() => { if (folder) void scan(); }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !current) return;
    // YouTube returns an already signed HTTPS URL; local files need the
    // app's local-resource conversion. Converting YouTube URLs breaks them.
    audio.src = /^https?:\/\//i.test(current) ? current : toFileUrl(current);
    audio.volume = volume;
    audio.muted = muted;
    if (playing) audio.play().catch(() => { setPlaying(false); setError(t('settings.backgroundMusicPlayError')); });
    else audio.pause();
  }, [current, playing, volume, muted, t]);

  const playFile = (file: string) => {
    setCurrent(file);
    setPlaying(true);
    setError(null);
  };

  const stop = () => { audioRef.current?.pause(); setPlaying(false); };

  return (
    <section className="rounded-xl border border-white/10 bg-surface-raised p-4 space-y-4" aria-label={t('settings.backgroundMusic')}>
      <audio ref={audioRef} onEnded={() => setPlaying(false)} onError={() => { if (playing) { setPlaying(false); setError(t('settings.backgroundMusicPlayError')); } }} />
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Music className="w-4 h-4 text-blue-400 shrink-0" aria-hidden="true" />
          <div className="min-w-0">
            <h3 className="text-sm font-semibold">{t('settings.backgroundMusic')}</h3>
            <p className="text-[11px] text-white/45">{t('settings.backgroundMusicDesc')}</p>
          </div>
        </div>
        <button type="button" onClick={chooseFolder} className="shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 px-3 py-2 text-xs font-semibold">
          <FolderOpen className="w-3.5 h-3.5" />{t('settings.backgroundMusicChooseFolder')}
        </button>
      </div>
      {folder && <div className="flex items-center gap-2 text-[10px] text-white/45"><span className="truncate flex-1">{folder}</span><button type="button" onClick={() => void scan()} title={t('settings.backgroundMusicRefresh')}><RefreshCw className="w-3.5 h-3.5" /></button></div>}
      {files.length > 0 ? (
        <div className="max-h-48 overflow-y-auto space-y-1">
          {files.map((file) => (
            <button key={file} type="button" onClick={() => playFile(file)} className={cn('w-full flex items-center gap-2 rounded-lg px-3 py-2 text-left text-xs transition-colors', current === file ? 'bg-blue-600/20 text-blue-200' : 'bg-black/20 text-white/70 hover:bg-white/10')}>
              {current === file && playing ? <Volume2 className="w-3.5 h-3.5 shrink-0" /> : <Music className="w-3.5 h-3.5 shrink-0 text-white/40" />}
              <span className="truncate">{file.split(/[\\/]/).pop()}</span>
              {current === file && <span className="ml-auto text-[10px]">{playing ? t('common.play') : t('common.pause')}</span>}
            </button>
          ))}
        </div>
      ) : <p className="text-xs text-white/35">{folder ? t('settings.backgroundMusicEmpty') : t('settings.backgroundMusicChooseHint')}</p>}
      <div className="flex items-center gap-2 border-t border-white/10 pt-3">
        <button type="button" onClick={() => setPlaying(!playing)} disabled={!current} className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs disabled:opacity-30">{playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}{playing ? t('common.pause') : t('common.play')}</button>
        <button type="button" onClick={stop} disabled={!playing} className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs disabled:opacity-30"><Square className="w-3.5 h-3.5" />{t('common.stop')}</button>
        {current && <span className="ml-auto truncate text-[10px] text-white/45">{current.split(/[\\/]/).pop()}</span>}
      </div>
      {error && <p className="text-[11px] text-red-400">{error}</p>}
    </section>
  );
}
