import { useTranslation } from 'react-i18next';
import {
  Globe, Undo2, Redo2, ChevronUp, ChevronDown, Trash2, HelpCircle, Monitor, Play, Smartphone, PanelRightClose, PanelRightOpen, Music, Volume2, Pause, Disc3
} from 'lucide-react';
import { useStore } from '../state/useStore';
import { cn, toFileUrl } from '../utils';
import { useState, useRef, useCallback, useEffect } from 'react';

interface ToolbarProps {
  moveSelectedSlides: (direction: -1 | 1) => void;
  deleteSelectedSlides: () => void;
  openLive: () => Promise<void>;
  closeLive: () => Promise<void>;
}

export default function Toolbar({ moveSelectedSlides, deleteSelectedSlides, openLive, closeLive }: ToolbarProps) {
  const { t, i18n } = useTranslation();

  const {
    presentation,
    panels,
    setPanels,
    remoteQr,
    remoteUrl,
    undoState,
    dispatchUndo,
    selectedSlideIds,
    setIsCheatsheetOpen,
    isProjectorWindowOpen,
    setPresentationName,
    isRightPanelOpen,
    setIsRightPanelOpen,
  } = useStore();

  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Background music
  const [audioFile, setAudioFile] = useState<string | null>(null);
  const [audioPlaying, setAudioPlaying] = useState(false);
  const [audioVolume, setAudioVolume] = useState(0.5);
  const [audioPanelOpen, setAudioPanelOpen] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [audioFileName, setAudioFileName] = useState('');
  const [audioCurrentTime, setAudioCurrentTime] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  // Cleanup audio on unmount
  useEffect(() => {
    return () => {
      audioRef.current?.pause();
      audioRef.current = null;
    };
  }, []);

  const startEditing = useCallback(() => {
    setDraftName(presentation.name);
    setEditingName(true);
    requestAnimationFrame(() => inputRef.current?.select());
  }, [presentation.name]);

  const commitName = useCallback(() => {
    const trimmed = draftName.trim();
    if (trimmed && trimmed !== presentation.name) {
      setPresentationName(trimmed);
    }
    setEditingName(false);
  }, [draftName, presentation.name, setPresentationName]);

  const cancelEditing = useCallback(() => {
    setEditingName(false);
  }, []);

  const startLive = async () => {
    if (isProjectorWindowOpen) {
      await closeLive();
    } else {
      await openLive();
    }
  };

  return (
    <header className="h-14 bg-surface-raised border-b border-white/10 flex items-center justify-between px-6 flex-shrink-0">
      <div className="flex items-center gap-2 min-w-0">
        {editingName ? (
          <input
            ref={inputRef}
            type="text"
            value={draftName}
            onChange={e => setDraftName(e.target.value)}
            onBlur={commitName}
            onKeyDown={e => {
              if (e.key === 'Enter') commitName();
              if (e.key === 'Escape') cancelEditing();
            }}
            aria-label={t('common.presetName')}
            className="font-semibold text-blue-400 bg-transparent border-b border-blue-400/50 outline-none max-w-[300px]"
          />
        ) : (
          <button
            onClick={startEditing}
            className="group flex items-center gap-1.5 font-semibold text-blue-400 truncate max-w-[300px] hover:text-blue-300 transition-colors text-left cursor-pointer focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none rounded px-2 py-0.5 -ml-2 hover:bg-white/5 active:scale-[0.98]"
            title={t('common.clickToRename')}
            aria-label={t('common.clickToRename')}
          >
            <span className="truncate">{presentation.name}</span>
            <svg className="w-3.5 h-3.5 text-white/20 group-hover:text-white/40 transition-colors shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
            </svg>
            </button>
          )}
      </div>

      <div className="flex items-center gap-2">
        {/* Language Switcher */}
        <div className="relative shrink-0">
          <button
            onClick={() => {
              const langs = Object.keys(i18n.options.resources ?? {});
              const next = langs[(langs.indexOf(i18n.language) + 1) % langs.length];
              i18n.changeLanguage(next);
            }}
            className="flex items-center justify-center w-12 py-1.5 rounded-md bg-white/5 hover:bg-white/10 text-white border border-white/10 transition-colors text-sm font-medium focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none active:scale-[0.96]"
            title={Object.keys(i18n.options.resources ?? {}).map(l => t(`language.${l}`)).join(' / ')}
            aria-label={t('common.switchLanguage')}
          >
            <Globe className="w-4 h-4 shrink-0" />
            <span className="truncate">{i18n.language.toUpperCase()}</span>
          </button>
        </div>

        <div className="w-px h-6 bg-white/10 mx-1" />

        {/* Remote Panel */}
        <div className="relative shrink-0">
          <button
            onClick={() => setPanels((p) => ({ ...p, remote: !p.remote }))}
            aria-expanded={panels.remote}
            aria-controls="remote-panel"
            aria-haspopup="true"
            className={cn(
              'flex items-center justify-center w-[150px] py-1.5 rounded-md transition-colors text-sm font-medium focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none active:scale-[0.97]',
              panels.remote ? 'bg-blue-600 text-white' : 'bg-white/5 hover:bg-white/10 text-white'
            )}
          >
            <Smartphone className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span className="truncate">{t('common.remoteControl')}</span>
          </button>

          {panels.remote && (
            <div
              id="remote-panel"
              role="region"
              aria-label={t('common.remoteTitle')}
              className="absolute right-0 top-full mt-2 w-[320px] max-h-[520px] overflow-hidden rounded-2xl border border-white/10 bg-[#121212] shadow-2xl shadow-black/50 z-50"
            >
              <div className="p-4 border-b border-white/10">
                <p className="text-sm font-semibold mb-1">{t('common.remoteTitle')}</p>
                <p className="text-[11px] text-white/50">{t('common.remoteDesc')}</p>
              </div>
              <div className="p-4 space-y-4">
                {remoteQr ? (
                  <>
                    <div className="flex justify-center">
                      <div className="bg-white p-3 rounded-lg">
                        <img src={remoteQr} alt={t('common.remoteQrAlt')} className="w-40 h-40" />
                      </div>
                    </div>
                    {remoteUrl && (
                      <div className="space-y-1.5">
                        <p className="text-[10px] text-white/40 uppercase font-bold">{t('common.remoteUrlLabel')}</p>
                        <div className="text-xs text-white/70 bg-black/20 p-2.5 rounded-lg border border-white/10 break-all font-mono">
                          {remoteUrl}
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="rounded-lg bg-yellow-600/10 border border-yellow-500/30 p-3 space-y-1.5">
                    <p className="text-[10px] font-bold text-yellow-400 uppercase">⚠ {t('common.remoteLoading')}</p>
                    <p className="text-[11px] text-yellow-300/80">{t('common.remoteLoadingDesc')}</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="w-px h-6 bg-white/10 mx-1" />

        <button
          onClick={() => dispatchUndo({ type: 'UNDO' })}
          disabled={undoState.past.length === 0}
          title={t('common.undo')}
          aria-label={t('common.undo')}
          className="p-2.5 rounded-md bg-white/5 hover:bg-white/10 border border-white/10 disabled:opacity-30 disabled:hover:bg-white/5 transition-colors focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none active:scale-[0.92] disabled:active:scale-100"
        >
          <Undo2 className="w-4 h-4" aria-hidden="true" />
        </button>
        <button
          onClick={() => dispatchUndo({ type: 'REDO' })}
          disabled={undoState.future.length === 0}
          title={t('common.redo')}
          aria-label={t('common.redo')}
          className="p-2.5 rounded-md bg-white/5 hover:bg-white/10 border border-white/10 disabled:opacity-30 disabled:hover:bg-white/5 transition-colors focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none active:scale-[0.92] disabled:active:scale-100"
        >
          <Redo2 className="w-4 h-4" aria-hidden="true" />
        </button>

        {selectedSlideIds.size > 1 && (
          <>
            <div className="w-px h-6 bg-white/10 mx-1" aria-hidden="true" />
            <span className="text-xs text-white/55 font-medium" aria-live="polite">
              {selectedSlideIds.size} {t('common.selected')}
            </span>
            <button
              onClick={() => moveSelectedSlides(-1)}
              title={t('common.moveSelectedUp')}
              aria-label={t('common.moveSelectedUp')}
              className="p-2.5 rounded-md bg-white/5 hover:bg-white/10 border border-white/10 transition-colors focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none active:scale-[0.92]"
            >
              <ChevronUp className="w-4 h-4" aria-hidden="true" />
            </button>
            <button
              onClick={() => moveSelectedSlides(1)}
              title={t('common.moveSelectedDown')}
              aria-label={t('common.moveSelectedDown')}
              className="p-2.5 rounded-md bg-white/5 hover:bg-white/10 border border-white/10 transition-colors focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none active:scale-[0.92]"
            >
              <ChevronDown className="w-4 h-4" aria-hidden="true" />
            </button>
            <button
              onClick={deleteSelectedSlides}
              title={t('common.deleteSelected')}
              aria-label={t('common.deleteSelected')}
              className="p-2.5 rounded-md bg-red-600/20 hover:bg-red-600/30 border border-red-500/30 text-red-400 transition-colors focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:outline-none active:scale-[0.92]"
            >
              <Trash2 className="w-4 h-4" aria-hidden="true" />
            </button>
          </>
        )}

        <div className="w-px h-6 bg-white/10 mx-1" />

        <button
          onClick={() => setIsCheatsheetOpen(true)}
          title={t('common.keyboardShortcuts')}
          aria-label={t('common.keyboardShortcuts')}
          className="p-2.5 rounded-md bg-white/5 hover:bg-white/10 border border-white/10 transition-colors focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none active:scale-[0.92]"
        >
          <HelpCircle className="w-4 h-4" aria-hidden="true" />
        </button>

        {/* Background Music */}
        <div className="relative shrink-0">
          <button
            onClick={() => setAudioPanelOpen(v => !v)}
              className={cn(
                'p-2.5 rounded-md border transition-colors focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none active:scale-[0.92]',
              audioPlaying
                ? 'bg-green-600/20 border-green-500/40 text-green-400'
                : audioFile
                  ? 'bg-white/10 hover:bg-white/15 border-white/15 text-white'
                  : 'bg-white/5 hover:bg-white/10 border-white/10 text-white/60'
            )}
            title={audioFile ? audioFileName : t('audio.backgroundMusic')}
            aria-label={audioFile ? audioFileName : t('audio.backgroundMusic')}
          >
            {audioPlaying ? <Disc3 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Music className="w-4 h-4" aria-hidden="true" />}
          </button>

          {audioPanelOpen && (
            <div
              className="absolute right-0 top-full mt-2 w-[280px] rounded-2xl border border-white/10 bg-[#121212] shadow-2xl shadow-black/50 z-50 p-4 space-y-3"
            >
              <p className="text-[10px] text-white/40 uppercase font-bold tracking-widest">{t('audio.backgroundMusic')}</p>

              {audioFile ? (
                <div className="text-xs text-white/70 truncate bg-white/5 rounded-lg px-3 py-2" title={audioFileName}>
                  {audioFileName}
                </div>
              ) : (
                <p className="text-xs text-white/45">{t('audio.noFile')}</p>
              )}

              {audioFile && (
                <>
                  <div className="flex items-center gap-2 text-[11px] text-white/50">
                    <span className="w-8 text-right tabular-nums shrink-0">{formatTime(audioCurrentTime)}</span>
                    <input
                      type="range"
                      min="0"
                      max={audioDuration || 1}
                      step="1"
                      value={audioCurrentTime}
                      onChange={e => {
                        const t = parseFloat(e.target.value);
                        setAudioCurrentTime(t);
                        if (audioRef.current) audioRef.current.currentTime = t;
                      }}
                      aria-label={t('audio.seek')}
                      className="w-full h-1 accent-blue-500 cursor-pointer"
                    />
                    <span className="w-8 tabular-nums shrink-0">{formatTime(audioDuration)}</span>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        if (!audioRef.current) return;
                        if (audioPlaying) {
                          audioRef.current.pause();
                          setAudioPlaying(false);
                        } else {
                          audioRef.current.play().catch(() => {});
                          setAudioPlaying(true);
                        }
                      }}
                      className="p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
                      aria-label={audioPlaying ? t('common.pause') : t('common.play')}
                    >
                      {audioPlaying ? <Pause className="w-4 h-4" aria-hidden="true" /> : <Play className="w-4 h-4 fill-current" aria-hidden="true" />}
                    </button>
                    <Volume2 className="w-4 h-4 text-white/40 shrink-0" />
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.05"
                      value={audioVolume}
                      onChange={e => {
                        const v = parseFloat(e.target.value);
                        setAudioVolume(v);
                        if (audioRef.current) audioRef.current.volume = v;
                      }}
                      aria-label={t('audio.volume')}
                      className="w-full h-1 accent-blue-500 cursor-pointer"
                    />
                  </div>
                </>
              )}

              <button
                onClick={async () => {
                  const path = await (window as any).electronAPI?.selectAudioFile?.();
                  if (!path) return;
                  setAudioFile(path);
                  setAudioCurrentTime(0);
                  setAudioDuration(0);
                  const name = path.split('\\').pop()?.split('/').pop() ?? path;
                  setAudioFileName(name);
                  if (!audioRef.current) {
                    audioRef.current = new Audio();
                    audioRef.current.loop = true;
                  }
                  const el = audioRef.current;
                  const onTime = () => { setAudioCurrentTime(el.currentTime); };
                  const onMeta = () => { setAudioDuration(el.duration); };
                  el.addEventListener('timeupdate', onTime);
                  el.addEventListener('loadedmetadata', onMeta);
                  el.addEventListener('durationchange', onMeta);
                  el.src = toFileUrl(path);
                  el.volume = audioVolume;
                  el.play().catch(() => {});
                  setAudioPlaying(true);
                }}
                className="w-full text-xs py-2 rounded-lg bg-blue-600 hover:bg-blue-700 transition-colors font-semibold"
              >
                {t('audio.selectFile')}
              </button>

              {audioFile && (
                <button
                  onClick={() => {
                    audioRef.current?.pause();
                    audioRef.current = null;
                    setAudioFile(null);
                    setAudioPlaying(false);
                    setAudioFileName('');
                    setAudioCurrentTime(0);
                    setAudioDuration(0);
                  }}
                  className="w-full text-xs py-1.5 text-red-400 hover:bg-red-600/20 rounded-lg transition-colors"
                >
                  {t('audio.removeMusic')}
                </button>
              )}
            </div>
          )}
        </div>

        <div className="w-px h-6 bg-white/10 mx-1" />

        <button
          onClick={startLive}
          aria-label={isProjectorWindowOpen ? t('common.stopBroadcast') : t('common.startBroadcast')}
            className={cn(
              'flex items-center justify-center w-[190px] py-1.5 rounded-md transition-colors text-sm font-bold shadow-lg focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-[#1e1e1e] focus-visible:outline-none active:scale-[0.97]',
            isProjectorWindowOpen
              ? 'bg-red-600 hover:bg-red-700 shadow-red-900/20 focus-visible:ring-red-400'
              : 'bg-green-600 hover:bg-green-700 shadow-green-900/20 focus-visible:ring-green-400'
          )}
        >
          {isProjectorWindowOpen ? (
            <>
              <Monitor className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span className="truncate">{t('common.stopBroadcast').toUpperCase()}</span>
            </>
          ) : (
            <>
              <Play className="w-4 h-4 shrink-0 fill-current" aria-hidden="true" />
              <span className="truncate">{t('common.startBroadcast').toUpperCase()}</span>
            </>
          )}
        </button>

        <div className="w-px h-6 bg-white/10 mx-1" />

        <button
          onClick={() => setIsRightPanelOpen(!isRightPanelOpen)}
          title={isRightPanelOpen ? t('common.panelClose') : t('common.panelOpen')}
          aria-label={isRightPanelOpen ? t('common.panelClose') : t('common.panelOpen')}
          aria-pressed={isRightPanelOpen}
          className={cn(
            'p-2.5 rounded-md transition-colors border focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none active:scale-[0.92]',
            isRightPanelOpen
              ? 'bg-white/10 hover:bg-white/15 border-white/15 text-white'
              : 'bg-white/5 hover:bg-white/10 border-white/10 text-white/60'
          )}
        >
          {isRightPanelOpen ? <PanelRightClose className="w-4 h-4" /> : <PanelRightOpen className="w-4 h-4" />}
        </button>
      </div>
    </header>
  );
}
