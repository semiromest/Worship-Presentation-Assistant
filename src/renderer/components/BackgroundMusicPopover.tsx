import { useEffect, useRef, useState } from 'react';
import { FolderOpen, Loader2, Music, Pause, Play, RefreshCw, Search, Square, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useStore } from '../state/useStore';
import { cn, toFileUrl } from '../utils';
import AudioSeekBar from './AudioSeekBar';
import type { YouTubeMusicResult } from '../../shared/youtubeMusic';

export default function BackgroundMusicPopover() {
  const { t } = useTranslation();
  const audioRef = useRef<HTMLAudioElement>(null);
  const streamRef = useRef<string>();
  const playRequest = useRef(0);
  const searchRequest = useRef(0);
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState<'local' | 'youtube'>('local');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<YouTubeMusicResult[]>([]);
  const [searched, setSearched] = useState(false);
  const [searching, setSearching] = useState(false);
  const [loading, setLoading] = useState(false);
  const [track, setTrack] = useState<YouTubeMusicResult | null>(null);
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
    setFolder(path); await scan(path);
  };

  useEffect(() => {
    const requests = { play: playRequest, search: searchRequest };
    const initialFolder = useStore.getState().backgroundMusicFolder;
    if (initialFolder) void window.electronAPI?.readAudioFolder(initialFolder, true).then(result => {
      if (result && !result.missing) useStore.getState().setBackgroundMusicFiles(result.paths);
    });
    return () => {
      requests.play.current++; requests.search.current++;
      void window.electronAPI?.youtubeMusicStop().catch(() => {});
    };
  }, []);
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    if (current) audio.src = /^https?:\/\//i.test(current) ? current : toFileUrl(current);
    else { audio.removeAttribute('src'); audio.load(); }
  }, [current]);
  useEffect(() => {
    if (audioRef.current) { audioRef.current.volume = volume; audioRef.current.muted = muted; }
  }, [volume, muted]);
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !current) return;
    let cancelled = false;
    if (playing) void audio.play().catch(() => {
      if (cancelled) return;
      setPlaying(false); setError(t('settings.backgroundMusicPlayError'));
      void window.electronAPI?.youtubeMusicStop(streamRef.current).catch(() => {});
    });
    else audio.pause();
    return () => { cancelled = true; };
  }, [current, playing, setPlaying, t]);

  const stop = () => {
    playRequest.current++; setLoading(false);
    audioRef.current?.pause(); setPlaying(false);
    void window.electronAPI?.youtubeMusicStop().catch(() => {});
    if (streamRef.current || loading) { setCurrent(null); streamRef.current = undefined; }
    else if (audioRef.current) audioRef.current.currentTime = 0;
  };
  const playFile = (file: string) => {
    playRequest.current++; setLoading(false); streamRef.current = undefined; setTrack(null);
    void window.electronAPI?.youtubeMusicStop().catch(() => {});
    setCurrent(file); setPlaying(true); setError(null);
  };
  const search = async () => {
    if (!query.trim()) return;
    const request = ++searchRequest.current;
    setSearching(true); setError(null);
    try {
      const response = await window.electronAPI.youtubeMusicSearch(query.trim());
      if (request !== searchRequest.current) return;
      setSearched(true);
      if (response.ok) setResults(response.results);
      else { setResults([]); setError(t('settings.youtubeSearchError')); }
    } catch { if (request === searchRequest.current) setError(t('settings.youtubeSearchError')); }
    finally { if (request === searchRequest.current) setSearching(false); }
  };
  const playYouTube = async (video: YouTubeMusicResult) => {
    const request = ++playRequest.current;
    setLoading(true); setPlaying(false); setCurrent(null); streamRef.current = undefined;
    setTrack(video); setError(null);
    try {
      await window.electronAPI.youtubeMusicStop();
      if (request !== playRequest.current) return;
      const response = await window.electronAPI.youtubeMusicPlay(video.id);
      if (request !== playRequest.current) {
        if (response.ok) void window.electronAPI.youtubeMusicStop(response.streamId);
        return;
      }
      if (!response.ok) { setError(t('settings.youtubePlayError')); return; }
      streamRef.current = response.streamId;
      setCurrent(response.url); setPlaying(true);
    } catch { if (request === playRequest.current) setError(t('settings.youtubePlayError')); }
    finally { if (request === playRequest.current) setLoading(false); }
  };
  const ended = () => {
    setPlaying(false);
    if (streamRef.current) {
      void window.electronAPI.youtubeMusicStop(streamRef.current).catch(() => {});
      streamRef.current = undefined; setCurrent(null);
    }
  };

  return (
    <div className="relative shrink-0">
      <audio ref={audioRef} data-testid="background-music-audio" onEnded={ended} onError={() => {
        if (!useStore.getState().backgroundMusicCurrent) return;
        setError(t(track ? 'settings.youtubePlayError' : 'settings.backgroundMusicPlayError')); ended();
      }} />
      <button type="button" data-testid="background-music-toggle" onClick={() => setOpen(v => !v)} title={t('settings.backgroundMusic')} aria-label={t('settings.backgroundMusic')} aria-expanded={open} className={cn('p-2.5 rounded-md border transition-colors focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none', playing ? 'bg-blue-600/20 border-blue-500/40 text-blue-300' : 'bg-white/5 hover:bg-white/10 border-white/10 text-white/60 hover:text-white')}>
        <Music className="w-4 h-4" aria-hidden="true" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-2 z-50 w-80 max-w-[calc(100vw-1rem)] rounded-xl border border-white/10 bg-[#1a1a1a] p-3 shadow-2xl" data-testid="background-music-menu">
          <div className="flex items-center justify-between mb-2"><span className="text-xs font-semibold">{t('settings.backgroundMusic')}</span><button type="button" onClick={() => setOpen(false)} aria-label={t('common.close')} className="p-1 rounded hover:bg-white/10"><X className="w-3.5 h-3.5" /></button></div>
          <div className="flex gap-1 mb-3 rounded-lg bg-black/25 p-1">
            {(['local', 'youtube'] as const).map(value => <button type="button" key={value} data-testid={`music-source-${value}`} aria-pressed={source === value} onClick={() => setSource(value)} className={cn('flex-1 rounded-md py-1.5 text-xs', source === value ? 'bg-white/10 text-white' : 'text-white/50 hover:text-white')}>{value === 'youtube' ? 'YouTube' : t('settings.backgroundMusicLocal')}</button>)}
          </div>
          {source === 'local' ? <>
            <div className="flex gap-2"><button type="button" onClick={chooseFolder} className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 px-2 py-2 text-xs font-semibold"><FolderOpen className="w-3.5 h-3.5" />{t('settings.backgroundMusicChooseFolder')}</button>{folder && <button type="button" onClick={() => void scan()} title={t('settings.backgroundMusicRefresh')} className="rounded-lg border border-white/10 px-2 text-white/60 hover:bg-white/10"><RefreshCw className="w-3.5 h-3.5" /></button>}</div>
            {folder && <div className="mt-2 text-[10px] text-white/35 truncate" title={folder}>{folder}</div>}
            <div className="mt-2 max-h-44 overflow-y-auto space-y-1">{files.length ? files.map(file => <button key={file} type="button" onClick={() => playFile(file)} className={cn('w-full flex items-center gap-2 rounded-lg px-2 py-2 text-left text-xs', current === file ? 'bg-blue-600/20 text-blue-200' : 'bg-white/5 text-white/70 hover:bg-white/10')}><Music className="w-3.5 h-3.5 shrink-0" /><span className="truncate">{file.split(/[\\/]/).pop()}</span>{current === file && playing && <span className="ml-auto text-[10px]">▶</span>}</button>) : <div className="py-4 text-center text-[11px] text-white/35">{folder ? t('settings.backgroundMusicEmpty') : t('settings.backgroundMusicChooseHint')}</div>}</div>
          </> : <>
            <form onSubmit={event => { event.preventDefault(); void search(); }} className="flex gap-2">
              <input data-testid="youtube-music-query" aria-label={t('settings.youtubeSearch')} value={query} onChange={event => setQuery(event.target.value)} maxLength={200} placeholder={t('settings.youtubeSearchPlaceholder')} className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/25 px-2 py-2 text-xs focus:outline-none focus:border-blue-500" />
              <button type="submit" disabled={searching || !query.trim()} aria-label={t('settings.youtubeSearch')} className="rounded-lg bg-blue-600 px-3 hover:bg-blue-500 disabled:opacity-40">{searching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}</button>
            </form>
            <div className="mt-2 max-h-56 overflow-y-auto space-y-1" data-testid="youtube-music-results">
              {results.map(video => <button type="button" key={video.id} data-testid={`youtube-result-${video.id}`} onClick={() => void playYouTube(video)} className={cn('w-full flex items-center gap-2 rounded-lg px-2 py-2 text-left text-xs', track?.id === video.id ? 'bg-blue-600/20 text-blue-200' : 'bg-white/5 text-white/70 hover:bg-white/10')}>
                <Music className="w-3.5 h-3.5 shrink-0" /><span className="min-w-0 flex-1 line-clamp-2">{video.title}</span>{video.duration > 0 && <span className="shrink-0 text-[10px] text-white/40">{Math.floor(video.duration / 60)}:{String(video.duration % 60).padStart(2, '0')}</span>}
              </button>)}
              {searched && !searching && !results.length && !error && <p className="py-4 text-center text-xs text-white/40">{t('settings.youtubeNoResults')}</p>}
            </div>
          </>}
          {(track || loading) && <div className="mt-2 flex gap-2 items-center text-[11px] text-white/60" data-testid="youtube-music-status">{loading && <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />}<span className="truncate">{loading ? t('settings.youtubeLoading') : track?.title}</span></div>}
          <div className="mt-3"><AudioSeekBar audioRef={audioRef} trackKey={current} /></div>
          <div className="mt-2 pt-2 border-t border-white/10 flex gap-2">
            <button type="button" data-testid="background-music-play-pause" onClick={() => setPlaying(!playing)} disabled={!current || loading} className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-2 py-1.5 text-xs disabled:opacity-30">{playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}{playing ? t('common.pause') : t('common.play')}</button>
            <button type="button" data-testid="background-music-stop" onClick={stop} disabled={!current && !loading} className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-2 py-1.5 text-xs disabled:opacity-30"><Square className="w-3.5 h-3.5" />{t('common.stop')}</button>
          </div>
          {error && <div role="alert" className="mt-2 text-[11px] text-red-400">{error}</div>}
        </div>
      )}
    </div>
  );
}
