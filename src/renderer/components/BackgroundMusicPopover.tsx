import { useEffect, useRef, useState } from 'react';
import { FolderOpen, Music, Pause, Play, RefreshCw, Square, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useStore } from '../state/useStore';
import { cn, toFileUrl } from '../utils';

export default function BackgroundMusicPopover() {
  const { t } = useTranslation();
  const audioRef = useRef<HTMLAudioElement>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const folder = useStore(s => s.backgroundMusicFolder);
  const files = useStore(s => s.backgroundMusicFiles);
  const current = useStore(s => s.backgroundMusicCurrent);
  const playing = useStore(s => s.backgroundMusicPlaying);
  const volume = useStore(s => s.mediaVolume);
  const muted = useStore(s => s.isMediaMuted);
  const setFolder = useStore(s => s.setBackgroundMusicFolder);
  const setFiles = useStore(s => s.setBackgroundMusicFiles);
  const setCurrent = useStore(s => s.setBackgroundMusicCurrent);
  const setPlaying = useStore(s => s.setBackgroundMusicPlaying);

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

  const playFile = (file: string) => { setCurrent(file); setPlaying(true); setError(null); };
  const stop = () => { audioRef.current?.pause(); setPlaying(false); };


  return (
    <div className="relative shrink-0">
      <audio ref={audioRef} onEnded={() => setPlaying(false)} onError={() => { if (playing) { setPlaying(false); setError(t('settings.backgroundMusicPlayError')); } }} />
      <button type="button" onClick={() => setOpen(v => !v)} title={t('settings.backgroundMusic')} aria-label={t('settings.backgroundMusic')} aria-expanded={open} className={cn('p-2.5 rounded-md border transition-colors focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none', playing ? 'bg-blue-600/20 border-blue-500/40 text-blue-300' : 'bg-white/5 hover:bg-white/10 border-white/10 text-white/60 hover:text-white')}>
        <Music className="w-4 h-4" aria-hidden="true" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-2 z-50 w-80 rounded-xl border border-white/10 bg-[#1a1a1a] p-3 shadow-2xl">
          <div className="flex items-center justify-between mb-2"><span className="text-xs font-semibold">{t('settings.backgroundMusic')}</span><button type="button" onClick={() => setOpen(false)} aria-label={t('common.close')} className="p-1 rounded hover:bg-white/10"><X className="w-3.5 h-3.5" /></button></div>
          <div className="flex gap-2"><button type="button" onClick={chooseFolder} className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 px-2 py-2 text-xs font-semibold"><FolderOpen className="w-3.5 h-3.5" />{t('settings.backgroundMusicChooseFolder')}</button>{folder && <button type="button" onClick={() => void scan()} title={t('settings.backgroundMusicRefresh')} className="rounded-lg border border-white/10 px-2 text-white/60 hover:bg-white/10"><RefreshCw className="w-3.5 h-3.5" /></button>}</div>
          {folder && <div className="mt-2 text-[10px] text-white/35 truncate" title={folder}>{folder}</div>}

          <div className="mt-2 max-h-44 overflow-y-auto space-y-1">{files.length ? files.map(file => <button key={file} type="button" onClick={() => playFile(file)} className={cn('w-full flex items-center gap-2 rounded-lg px-2 py-2 text-left text-xs', current === file ? 'bg-blue-600/20 text-blue-200' : 'bg-white/5 text-white/70 hover:bg-white/10')}><Music className="w-3.5 h-3.5 shrink-0" /><span className="truncate">{file.split(/[\\/]/).pop()}</span>{current === file && playing && <span className="ml-auto text-[10px]">▶</span>}</button>) : <div className="py-4 text-center text-[11px] text-white/35">{folder ? t('settings.backgroundMusicEmpty') : t('settings.backgroundMusicChooseHint')}</div>}</div>
          <div className="mt-2 pt-2 border-t border-white/10 flex gap-2"><button type="button" onClick={() => setPlaying(!playing)} disabled={!current} className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-2 py-1.5 text-xs disabled:opacity-30">{playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}{playing ? t('common.pause') : t('common.play')}</button><button type="button" onClick={stop} disabled={!playing} className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-2 py-1.5 text-xs disabled:opacity-30"><Square className="w-3.5 h-3.5" />{t('common.stop')}</button></div>
          {error && <div className="mt-2 text-[10px] text-red-400">{error}</div>}
        </div>
      )}
    </div>
  );
}
