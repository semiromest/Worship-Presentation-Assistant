import { useEffect, useRef, useState } from 'react';
import { FolderOpen, Loader2, Music, Pause, Play, Plus, RefreshCw, Search, Square, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useStore } from '../state/useStore';
import { cn } from '../utils';
import AudioSeekBar from './AudioSeekBar';
import type { YouTubeMusicResult } from '../../shared/youtubeMusic';
import { useBackgroundMusicPlayback } from '../hooks/useBackgroundMusicPlayback';
import { useMusicPreparation } from '../hooks/useMusicPreparation';

export default function BackgroundMusicPopover({ onAddSlide }: { onAddSlide?: (track: YouTubeMusicResult) => void }) {
  useMusicPreparation();
  const { t } = useTranslation();
  const searchRequest = useRef(0);
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState<'local' | 'youtube'>('local');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<YouTubeMusicResult[]>([]);
  const [searched, setSearched] = useState(false);
  const [searching, setSearching] = useState(false);
  const [added, setAdded] = useState<string | null>(null);
  const { audioRef, loading, track, error, setError, liveSlide, current, playing,
    playYouTube, playFile, playPause, stop, onPlaying, ended, onError } = useBackgroundMusicPlayback();
  const folder = useStore(s => s.backgroundMusicFolder);
  const files = useStore(s => s.backgroundMusicFiles);
  const setFolder = useStore(s => s.setBackgroundMusicFolder);
  const setFiles = useStore(s => s.setBackgroundMusicFiles);
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
    const requests = searchRequest;
    const initialFolder = useStore.getState().backgroundMusicFolder;
    if (initialFolder) void window.electronAPI?.readAudioFolder(initialFolder, true).then(result => {
      if (result && !result.missing) useStore.getState().setBackgroundMusicFiles(result.paths);
    });
    return () => { requests.current++; };
  }, []);
  useEffect(() => { if (liveSlide) setSource('youtube'); }, [liveSlide]);
  useEffect(() => { if (error && liveSlide) setOpen(true); }, [error, liveSlide]);
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

  return (
    <div className="relative shrink-0">
      <audio ref={audioRef} data-testid="background-music-audio" onEnded={ended} onPlaying={onPlaying} onError={onError} />
      <button type="button" data-testid="background-music-toggle" onClick={() => setOpen(v => !v)} title={t('settings.backgroundMusic')} aria-label={t('settings.backgroundMusic')} aria-expanded={open} className={cn('p-2.5 rounded-md border transition-colors focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none', playing ? 'bg-blue-600/20 border-blue-500/40 text-blue-300' : 'bg-white/5 hover:bg-white/10 border-white/10 text-white/60 hover:text-white')}>
        <Music className="w-4 h-4" aria-hidden="true" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-2 z-50 w-80 max-w-[calc(100vw-1rem)] max-h-[calc(100dvh-5rem)] overflow-y-auto overscroll-contain rounded-xl border border-white/10 bg-[#1a1a1a] p-3 shadow-2xl" data-testid="background-music-menu">
          <div className="flex items-center justify-between mb-2"><span className="text-xs font-semibold">{t('settings.backgroundMusic')}</span><button type="button" onClick={() => setOpen(false)} aria-label={t('common.close')} className="p-1 rounded hover:bg-white/10"><X className="w-3.5 h-3.5" /></button></div>
          <div className="flex gap-1 mb-3 rounded-lg bg-black/25 p-1">
            {(['local', 'youtube'] as const).map(value => <button type="button" key={value} data-testid={`music-source-${value}`} aria-pressed={source === value} onClick={() => setSource(value)} className={cn('flex-1 rounded-md py-1.5 text-xs', source === value ? 'bg-white/10 text-white' : 'text-white/50 hover:text-white')}>{value === 'youtube' ? 'YouTube' : t('settings.backgroundMusicLocal')}</button>)}
          </div>
          {source === 'local' ? <>
            <div className="flex gap-2"><button type="button" onClick={chooseFolder} className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 px-2 py-2 text-xs font-semibold"><FolderOpen className="w-3.5 h-3.5" />{t('settings.backgroundMusicChooseFolder')}</button>{folder && <button type="button" onClick={() => void scan()} title={t('settings.backgroundMusicRefresh')} className="rounded-lg border border-white/10 px-2 text-white/60 hover:bg-white/10"><RefreshCw className="w-3.5 h-3.5" /></button>}</div>
            {folder && <div className="mt-2 text-[10px] text-white/35 truncate" title={folder}>{folder}</div>}
            <div className="mt-2 max-h-44 overflow-y-auto space-y-1">{files.length ? files.map(file => <button key={file} type="button" disabled={!!liveSlide} onClick={() => playFile(file)} className={cn('w-full flex items-center gap-2 rounded-lg px-2 py-2 text-left text-xs disabled:opacity-40', current === file ? 'bg-blue-600/20 text-blue-200' : 'bg-white/5 text-white/70 hover:bg-white/10')}><Music className="w-3.5 h-3.5 shrink-0" /><span className="truncate">{file.split(/[\\/]/).pop()}</span>{current === file && playing && <span className="ml-auto text-[10px]">▶</span>}</button>) : <div className="py-4 text-center text-[11px] text-white/35">{folder ? t('settings.backgroundMusicEmpty') : t('settings.backgroundMusicChooseHint')}</div>}</div>
          </> : <>
            <form onSubmit={event => { event.preventDefault(); void search(); }} className="flex gap-2">
              <input data-testid="youtube-music-query" aria-label={t('settings.youtubeSearch')} value={query} onChange={event => setQuery(event.target.value)} maxLength={200} placeholder={t('settings.youtubeSearchPlaceholder')} className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/25 px-2 py-2 text-xs focus:outline-none focus:border-blue-500" />
              <button type="submit" disabled={searching || !query.trim()} aria-label={t('settings.youtubeSearch')} className="rounded-lg bg-blue-600 px-3 hover:bg-blue-500 disabled:opacity-40">{searching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}</button>
            </form>
            <div className="mt-2 max-h-56 overflow-y-auto space-y-1" data-testid="youtube-music-results">
              {results.map(video => <div key={video.id} className={cn('rounded-lg border border-white/10 overflow-hidden', track?.id === video.id ? 'bg-blue-600/20' : 'bg-white/5')}>
                <button type="button" disabled={!!liveSlide} data-testid={`youtube-result-${video.id}`} onClick={() => void playYouTube(video)} className="w-full flex items-center gap-2 px-2 py-2 text-left text-xs text-white/80 hover:bg-white/10 disabled:opacity-40">
                  <Play className="w-3.5 h-3.5 shrink-0" /><span className="min-w-0 flex-1 line-clamp-2">{video.title}</span>{video.duration > 0 && <span className="shrink-0 text-[10px] text-white/40">{Math.floor(video.duration / 60)}:{String(video.duration % 60).padStart(2, '0')}</span>}
                </button>
                {onAddSlide && <button type="button" data-testid={`youtube-add-slide-${video.id}`} onClick={() => { onAddSlide(video); setAdded(video.title); }} className="flex w-full items-center justify-center gap-1.5 border-t border-white/10 bg-blue-600/15 px-2 py-2 text-xs font-medium text-blue-200 hover:bg-blue-600/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-400"><Plus className="h-3.5 w-3.5" />{t('settings.youtubeAddMusicSlide')}</button>}
              </div>)}
              {searched && !searching && !results.length && !error && <p className="py-4 text-center text-xs text-white/40">{t('settings.youtubeNoResults')}</p>}
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-white/50">{t('settings.youtubeMusicSlideHint')}</p>
            {added && <p role="status" className="mt-2 text-xs text-emerald-300">{t('settings.youtubeMusicSlideAdded', { title: added })}</p>}
          </>}
          {(track || loading) && <div className="mt-2 flex gap-2 items-center text-[11px] text-white/60" data-testid="youtube-music-status">{loading && <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />}<span className="truncate">{loading ? t('settings.youtubeLoading') : track?.title}</span></div>}
          <div className="mt-3"><AudioSeekBar audioRef={audioRef} trackKey={current} /></div>
          <div className="mt-2 pt-2 border-t border-white/10 flex gap-2">
            <button type="button" data-testid="background-music-play-pause" onClick={playPause} disabled={(!current && !liveSlide) || loading} className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-2 py-1.5 text-xs disabled:opacity-30">{playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}{playing ? t('common.pause') : t('common.play')}</button>
            <button type="button" data-testid="background-music-stop" onClick={stop} disabled={!current && !loading} className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-2 py-1.5 text-xs disabled:opacity-30"><Square className="w-3.5 h-3.5" />{t('common.stop')}</button>
          </div>
          {liveSlide && <p data-testid="music-slide-live-status" role="status" className="mt-2 rounded-lg border border-blue-500/30 bg-blue-500/10 p-2 text-[11px] leading-relaxed text-blue-200">{t('settings.youtubeMusicSlideLive')}</p>}
          {error && <div role="alert" className="mt-2 text-[11px] text-red-400">{error}</div>}
        </div>
      )}
    </div>
  );
}
