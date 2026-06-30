import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Monitor, RefreshCw, Plus, Play, Square } from 'lucide-react';
import { Skeleton } from './components/Skeleton';

// ─── Types ───────────────────────────────────────────────────────────────────

interface ScreenSource {
  id: string;
  name: string;
  thumbnail: string;
  display_id: string;
  appIcon?: string;
}

interface ScreenCaptureTabProps {
  onAddScreenToPresentation: (sourceId: string, sourceName: string) => void;
}

type StreamStatus = 'idle' | 'starting' | 'active' | 'error';

// ─── Custom Hooks ────────────────────────────────────────────────────────────

/**
 * Manages screen sources fetching and caching
 */
function useScreenSources() {
  const [sources, setSources] = useState<ScreenSource[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSources = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      const api = (window as any).electronAPI;
      if (!api?.getScreenSources) {
        throw new Error('Screen capture API not available');
      }
      
      const result = await api.getScreenSources();
      setSources(result ?? []);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch sources';
      console.error('[ScreenCapture] fetchSources error:', err);
      setError(message);
      setSources([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSources();
  }, [fetchSources]);

  return { sources, isLoading, error, fetchSources };
}

/**
 * Manages media stream lifecycle with proper cleanup
 */
function useMediaStream() {
  const [status, setStatus] = useState<StreamStatus>('idle');
  const streamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const cleanup = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.srcObject = null;
    }
    
    setStatus('idle');
  }, []);

  const startStream = useCallback(async (sourceId: string) => {
    cleanup();
    setStatus('starting');

    try {
      const stream = await (navigator.mediaDevices as any).getUserMedia({
        audio: false,
        video: {
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: sourceId,
            minFrameRate: 24,
            maxFrameRate: 60,
          },
        },
      });

      if (!videoRef.current) {
        stream.getTracks().forEach((track: { stop: () => any; }) => track.stop());
        throw new Error('Video element not available');
      }

      streamRef.current = stream;
      videoRef.current.srcObject = stream;

      // Handle stream ended event
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.addEventListener('ended', () => {
          setStatus('error');
        }, { once: true });
      }

      await videoRef.current.play();
      setStatus('active');
    } catch (err) {
      console.error('[ScreenCapture] Stream error:', err);
      cleanup();
      setStatus('error');
    }
  }, [cleanup]);

  const captureFrame = useCallback((): string | null => {
    const video = videoRef.current;
    if (!video || video.readyState < 2) return null;

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return null;
    
    ctx.drawImage(video, 0, 0);
    return canvas.toDataURL('image/jpeg', 0.92);
  }, []);

  // Cleanup on unmount
  useEffect(() => cleanup, [cleanup]);

  return {
    status,
    videoRef,
    startStream,
    stopStream: cleanup,
    captureFrame,
    isActive: status === 'active',
    isStarting: status === 'starting',
  };
}

/**
 * Manages source selection state
 */
function useSourceSelection(sources: ScreenSource[]) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  
  const selectedSource = sources.find(s => s.id === selectedId) ?? null;
  
  const selectSource = useCallback((source: ScreenSource) => {
    setSelectedId(prevId => prevId === source.id ? prevId : source.id);
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedId(null);
  }, []);

  return {
    selectedId,
    selectedSource,
    selectSource,
    clearSelection,
  };
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function Header({ onRefresh, isLoading, t }: { onRefresh: () => void; isLoading: boolean; t: (key: string) => string }) {
  return (
    <div className="flex items-center justify-between p-4 border-b border-white/10">
      <div className="flex items-center gap-2">
        <Monitor size={16} className="text-blue-500" />
        <span className="text-sm font-semibold text-white">{t('common.screenTitle')}</span>
      </div>
      <button
        onClick={onRefresh}
        disabled={isLoading}
        className="flex items-center gap-2 px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white text-xs hover:bg-white/10 transition-colors disabled:opacity-50"
      >
        <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
        <span>{t('common.screenRefresh')}</span>
      </button>
    </div>
  );
}

function SourceCard({ 
  source, 
  isSelected, 
  onSelect 
}: { 
  source: ScreenSource; 
  isSelected: boolean; 
  onSelect: (source: ScreenSource) => void;
}) {
  return (
    <div
      onClick={() => onSelect(source)}
      className={`
        relative bg-white/5 border-2 rounded-xl overflow-hidden cursor-pointer
        transition-all duration-200 hover:bg-white/10
        ${isSelected 
          ? 'border-blue-500 shadow-[0_0_0_2px_rgba(59,130,246,0.3)]' 
          : 'border-white/10 hover:border-white/20'
        }
      `}
    >
      <img 
        src={source.thumbnail} 
        alt={source.name} 
        className="w-full aspect-video object-cover bg-black"
        loading="lazy"
      />
      <div className="p-2">
        <p className="text-xs font-medium text-white truncate">{source.name}</p>
      </div>
      {isSelected && (
        <div className="absolute top-2 right-2 w-6 h-6 rounded-full bg-blue-500 flex items-center justify-center text-white text-sm font-bold">
          ✓
        </div>
      )}
    </div>
  );
}

function SourceGridSkeleton() {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3 overflow-y-auto pb-2" aria-hidden="true">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="rounded-xl border border-white/10 overflow-hidden">
          <Skeleton className="w-full aspect-video rounded-none" />
          <div className="p-2">
            <Skeleton className="h-3.5 w-3/4" />
          </div>
        </div>
      ))}
    </div>
  );
}

function SourceGrid({ 
  sources, 
  selectedId, 
  onSelect 
}: { 
  sources: ScreenSource[]; 
  selectedId: string | null; 
  onSelect: (source: ScreenSource) => void;
}) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3 overflow-y-auto pb-2">
      {sources.map(source => (
        <SourceCard
          key={source.id}
          source={source}
          isSelected={selectedId === source.id}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

function PreviewPlaceholder({ 
  status, 
  hasSource,
  t,
}: { 
  status: StreamStatus; 
  hasSource: boolean;
  t: (key: string) => string;
}) {
  const getMessage = () => {
    if (status === 'starting') return t('common.screenConnecting');
    if (status === 'error') return t('common.screenError');
    if (!hasSource) return t('common.screenSelectFirst');
    return t('common.screenClickStart');
  };

  const getIconColor = () => {
    if (status === 'error') return 'text-red-400';
    if (status === 'starting') return 'text-blue-400';
    return 'text-white/45';
  };

  return (
    <div className="flex flex-col items-center gap-2 text-white/45 text-xs">
      <Monitor size={32} className={getIconColor()} />
      <span>{getMessage()}</span>
    </div>
  );
}

function PreviewSection({ 
  sourceName, 
  videoRef, 
  status,
  t,
}: { 
  sourceName: string | null; 
  videoRef: React.RefObject<HTMLVideoElement>; 
  status: StreamStatus;
  t: (key: string) => string;
}) {
  const showVideo = status === 'active' || status === 'starting';
  
  return (
    <div className="flex-1 flex flex-col gap-3 min-h-[200px]">
      <div className="text-xs font-semibold text-white/60">
        {t('common.screenLivePreview')}{sourceName ? ` — ${sourceName}` : ''}
      </div>
      <div className="flex-1 bg-black rounded-xl overflow-hidden flex items-center justify-center relative">
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          disablePictureInPicture
          className={`max-w-full max-h-full object-contain ${showVideo ? 'block' : 'hidden'}`}
        />
        
        {status !== 'active' && (
          <div className="absolute inset-0 flex items-center justify-center">
            <PreviewPlaceholder 
              status={status} 
              hasSource={!!sourceName}
              t={t}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyState({ type, t }: { type: 'loading' | 'empty' | 'error'; t: (key: string) => string }) {
  const config = {
    loading: {
      text: t('common.screenLoading'),
      className: 'text-white/40',
    },
    empty: {
      text: t('common.screenEmpty'),
      className: 'text-white/40 whitespace-pre-line',
    },
    error: {
      text: t('common.screenErrorGeneric'),
      className: 'text-red-400',
    },
  };

  const { text, className } = config[type];

  return (
    <div className={`flex items-center justify-center h-full text-sm text-center p-5 ${className}`}>
      {text}
    </div>
  );
}

function ControlButtons({ 
  isActive, 
  hasSource, 
  onToggleCapture, 
  onAddToPresentation,
  t,
}: { 
  isActive: boolean; 
  hasSource: boolean; 
  onToggleCapture: () => void; 
  onAddToPresentation: () => void;
  t: (key: string) => string;
}) {
  return (
    <div className="flex gap-2 p-3 border-t border-white/10 bg-[#181818]">
      <button
        onClick={onToggleCapture}
        disabled={!hasSource}
        className={`
          flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold
          transition-all duration-200
          ${!hasSource 
            ? 'opacity-50 cursor-not-allowed bg-white/10 text-white' 
            : isActive
              ? 'bg-red-500 text-white hover:bg-red-600'
              : 'bg-white/10 text-white hover:bg-white/20'
          }
        `}
      >
        {isActive ? (
          <>
            <Square size={14} />
            <span>{t('common.screenStopLive')}</span>
          </>
        ) : (
          <>
            <Play size={14} />
            <span>{t('common.screenStartLive')}</span>
          </>
        )}
      </button>
      
      <button
        onClick={onAddToPresentation}
        disabled={!hasSource}
        className={`
          flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold
          transition-all duration-200
          ${!hasSource 
            ? 'opacity-50 cursor-not-allowed bg-blue-500 text-white'
            : 'bg-blue-500 text-white hover:bg-blue-600'
          }
        `}
      >
        <Plus size={14} />
        <span>{t('common.screenAddAsSlide')}</span>
      </button>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

export default function ScreenCaptureTab({ onAddScreenToPresentation }: ScreenCaptureTabProps) {
  const { t } = useTranslation();
  const { sources, isLoading, error, fetchSources } = useScreenSources();
  const { selectedId, selectedSource, selectSource, clearSelection } = useSourceSelection(sources);
  const { status, videoRef, startStream, stopStream, captureFrame, isActive } = useMediaStream();

  const handleToggleCapture = useCallback(() => {
    if (isActive) {
      stopStream();
    } else if (selectedId) {
      startStream(selectedId);
    }
  }, [isActive, selectedId, startStream, stopStream]);

  const handleSourceSelect = useCallback((source: ScreenSource) => {
    if (isActive) stopStream();
    selectSource(source);
  }, [isActive, stopStream, selectSource]);

  const handleAddToPresentation = useCallback(() => {
    if (!selectedId || !selectedSource) return;

    // Try to capture live frame if available
    if (isActive) {
      const frameDataUrl = captureFrame();
      // Frame data URL could be used if needed in the future
    }

    onAddScreenToPresentation(selectedId, selectedSource.name);
  }, [selectedId, selectedSource, isActive, captureFrame, onAddScreenToPresentation]);

  const renderContent = () => {
    if (isLoading) return <SourceGridSkeleton />;
    if (error) return <EmptyState type="error" t={t} />;
    if (sources.length === 0) return <EmptyState type="empty" t={t} />;

    return (
      <>
        <SourceGrid 
          sources={sources} 
          selectedId={selectedId} 
          onSelect={handleSourceSelect} 
        />
          <PreviewSection 
          sourceName={selectedSource?.name ?? null}
          videoRef={videoRef}
          status={status}
          t={t}
        />
      </>
    );
  };

  return (
    <div className="flex flex-col h-full bg-[#121212] text-white">
      <Header onRefresh={fetchSources} isLoading={isLoading} t={t} />
      
      <div className="flex-1 flex flex-col overflow-hidden p-4 gap-4">
        {renderContent()}
      </div>

      <ControlButtons 
        isActive={isActive}
        hasSource={!!selectedId}
        onToggleCapture={handleToggleCapture}
        onAddToPresentation={handleAddToPresentation}
        t={t}
      />
    </div>
  );
}
