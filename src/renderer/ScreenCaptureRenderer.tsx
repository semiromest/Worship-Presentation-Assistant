import { useEffect, useRef, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Monitor } from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────────────────

interface ScreenCaptureRendererProps {
  sourceId: any;
  sourceName: string;
  volume?: number;
  muted?: boolean;
}

type StreamStatus = 'idle' | 'connecting' | 'streaming' | 'error';

interface StreamState {
  status: StreamStatus;
  error?: string;
}

// ─── Custom Hook ────────────────────────────────────────────────────────────

function useScreenStream(sourceId: string, captureAudio: boolean = true) {
  const [streamState, setStreamState] = useState<StreamState>({ status: 'idle' });
  const streamRef = useRef<MediaStream | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const cleanup = useCallback(() => {
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
  }, []);

  const acquireStream = useCallback(async (id: string) => {
    cleanup();
    
    abortControllerRef.current?.abort();
    abortControllerRef.current = new AbortController();

    try {
      setStreamState({ status: 'connecting' });

      const stream = await (navigator.mediaDevices as any).getUserMedia({
        audio: captureAudio ? {
          mandatory: {
            chromeMediaSource: 'desktop',
          },
        } : false,
        video: {
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: id,
            minFrameRate: 24,
            maxFrameRate: 60,
          },
        },
      });

      // Check if aborted
      if (abortControllerRef.current?.signal.aborted) {
        stream.getTracks().forEach((track: { stop: () => any; }) => track.stop());
        return;
      }

      streamRef.current = stream;
      
      // Track ended listener
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.addEventListener('ended', () => {
          setStreamState({ 
            status: 'error', 
            error: 'Stream ended unexpectedly' 
          });
        }, { once: true });
      }

      setStreamState({ status: 'streaming' });
      
      return stream;
    } catch (error) {
      if (!abortControllerRef.current?.signal.aborted) {
        const errorMessage = error instanceof Error ? error.message : 'Failed to capture screen';
        console.error('[ScreenCapture] getUserMedia failed:', error);
        setStreamState({ status: 'error', error: errorMessage });
      }
      return null;
    }
  }, [cleanup]);

  useEffect(() => {
    if (!sourceId) {
      setStreamState({ status: 'idle' });
      return;
    }

    acquireStream(sourceId);

    return () => {
      abortControllerRef.current?.abort();
      cleanup();
    };
  }, [sourceId, acquireStream, cleanup]);

  return {
    stream: streamRef.current,
    ...streamState,
    acquireStream,
    cleanup,
  };
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function ErrorState({ sourceName, error }: { sourceName: string; error?: string }) {
  const { t } = useTranslation();
  return (
    <div className="w-full h-full flex flex-col items-center justify-center bg-[#1a1a2e] text-white/60 p-4">
      <Monitor className="w-16 h-16 text-red-400 mb-4" />
      <p className="text-sm font-medium">{t('screen.captureFailed')}</p>
      <p className="text-xs text-white/40 mt-2 mb-1">{sourceName}</p>
      {error && (
        <p className="text-xs text-red-400/60 mt-2 max-w-[200px] text-center">
          {error}
        </p>
      )}
    </div>
  );
}

function ConnectingState() {
  const { t } = useTranslation();
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center text-white/40 z-10 pointer-events-none">
      <Monitor className="w-12 h-12 animate-pulse mb-2" />
      <span className="text-sm">{t('screen.connecting')}</span>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

export default function ScreenCaptureRenderer({ 
  sourceId, 
  sourceName,
  volume = 1,
  muted = false,
}: ScreenCaptureRendererProps) {
  const { t } = useTranslation();
  const videoRef = useRef<HTMLVideoElement>(null);
  const { status, error, stream } = useScreenStream(sourceId, !muted);

  // Attach stream to video element and set audio
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !stream) return;

    video.srcObject = stream;
    
    const playVideo = async () => {
      try {
        await video.play();
      } catch (err) {
        console.error('[ScreenCapture] Video play failed:', err);
      }
    };
    
    playVideo();

    return () => {
      video.pause();
      video.srcObject = null;
    };
  }, [stream]);

  // Apply volume/muted changes
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.volume = volume;
    video.muted = muted;
  }, [volume, muted]);

  // Error state
  if (status === 'error') {
    return <ErrorState sourceName={sourceName} error={error} />;
  }

  // Idle state (no source selected)
  if (status === 'idle') {
    return (
      <div className="w-full h-full flex items-center justify-center bg-[#1a1a2e] text-white/40">
        <Monitor className="w-16 h-16 mb-4" />
        <p className="text-sm">{t('screen.noSource')}</p>
      </div>
    );
  }

  return (
    <div className="w-full h-full flex items-center justify-center bg-black overflow-hidden relative">
      {status === 'connecting' && <ConnectingState />}

      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        disablePictureInPicture
        className={`
          max-w-full max-h-full object-contain
          transition-opacity duration-300
          ${status === 'streaming' ? 'opacity-100' : 'opacity-0'}
        `}
        aria-label={sourceName}
      />
    </div>
  );
}
