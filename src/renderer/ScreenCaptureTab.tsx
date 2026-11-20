import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, AppWindow, Check, Loader2, Monitor, Play, Plus, RefreshCw, Square } from 'lucide-react';
import { Skeleton } from './components/Skeleton';
import { usePractice } from './hooks/usePractice';
import { playSfx } from './sfx';
import './screen-capture.css';

type ScreenSource = Awaited<ReturnType<NonNullable<Window['electronAPI']>['getScreenSources']>>[number];
type StreamStatus = 'idle' | 'starting' | 'active' | 'error';

interface ScreenCaptureTabProps {
  onAddScreenToPresentation: (sourceId: string, sourceName: string) => void;
}

function useScreenSources() {
  const [sources, setSources] = useState<ScreenSource[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const requestRef = useRef(0);

  const refresh = useCallback(async () => {
    const request = ++requestRef.current;
    setIsLoading(true);
    setFailed(false);
    try {
      const api = window.electronAPI;
      if (!api?.getScreenSources) throw new Error('Screen capture API not available');
      const result = await api.getScreenSources();
      if (request === requestRef.current) setSources(result ?? []);
    } catch (error) {
      if (request !== requestRef.current) return;
      console.error('[ScreenCapture] Could not fetch sources:', error);
      setFailed(true);
    } finally {
      if (request === requestRef.current) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    return () => { requestRef.current += 1; };
  }, [refresh]);

  return { sources, isLoading, failed, refresh };
}

function useScreenPreview() {
  const [status, setStatus] = useState<StreamStatus>('idle');
  const streamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const requestRef = useRef(0);

  const release = useCallback(() => {
    requestRef.current += 1;
    const stream = streamRef.current;
    streamRef.current = null;
    stream?.getTracks().forEach(track => track.stop());
    const video = videoRef.current;
    if (video) {
      video.pause();
      video.srcObject = null;
    }
  }, []);

  const stop = useCallback(() => {
    release();
    setStatus('idle');
  }, [release]);

  const start = useCallback(async (sourceId: string) => {
    release();
    const request = requestRef.current;
    setStatus('starting');

    try {
      const videoConstraints = {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: sourceId,
          minFrameRate: 24,
          maxFrameRate: 60,
        },
      };
      const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: videoConstraints as MediaTrackConstraints });
      const video = videoRef.current;
      if (request !== requestRef.current || !video) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }

      streamRef.current = stream;
      video.srcObject = stream;
      stream.getVideoTracks()[0]?.addEventListener('ended', () => {
        if (streamRef.current !== stream) return;
        release();
        setStatus('error');
      }, { once: true });
      await video.play();
      if (request !== requestRef.current) return;
      setStatus('active');
      playSfx('start');
    } catch (error) {
      if (request !== requestRef.current) return;
      console.error('[ScreenCapture] Preview failed:', error);
      release();
      setStatus('error');
      playSfx('error');
    }
  }, [release]);

  useEffect(() => release, [release]);

  return { status, videoRef, start, stop };
}

function SourceCard({ source, selected, onSelect }: {
  source: ScreenSource;
  selected: boolean;
  onSelect: () => void;
}) {
  const { t } = useTranslation();
  const isDisplay = source.id.startsWith('screen:');
  const Icon = isDisplay ? Monitor : AppWindow;
  return (
    <button type="button" className="screen-source-card" aria-pressed={selected} onClick={onSelect} title={source.name}>
      <span className="screen-source-thumb">
        <Icon size={20} aria-hidden="true" />
        {source.thumbnail && <img src={source.thumbnail} alt="" loading="lazy" />}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-xs font-semibold">{source.name}</span>
        <span className="block text-[11px] text-white/60">{t(isDisplay ? 'common.screenDisplaySource' : 'common.screenWindowSource')}</span>
      </span>
      {selected && <Check className="screen-source-check" size={16} aria-hidden="true" />}
    </button>
  );
}

function ActiveScreenCaptureTab({ onAddScreenToPresentation }: ScreenCaptureTabProps) {
  const { t } = useTranslation();
  const { sources, isLoading, failed, refresh } = useScreenSources();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = sources.find(source => source.id === selectedId);
  const { status, videoRef, start, stop } = useScreenPreview();
  const canStop = status === 'active' || status === 'starting';

  useEffect(() => {
    if (selectedId && !selected) {
      stop();
      setSelectedId(null);
    }
  }, [selectedId, selected, stop]);

  const togglePreview = () => {
    if (canStop) {
      stop();
      playSfx('stop');
    } else if (selected) {
      void start(selected.id);
    }
  };

  const selectSource = (source: ScreenSource) => {
    if (source.id === selectedId) return;
    stop();
    setSelectedId(source.id);
    playSfx('select');
  };

  return (
    <section className="screen-page" aria-labelledby="screen-heading" onKeyDown={event => {
      if ((event.key === 'Enter' || event.key === ' ') && (event.target as HTMLElement).closest('button')) event.stopPropagation();
    }}>
      <header className="screen-page-header">
        <Monitor size={16} className="text-white/65" aria-hidden="true" />
        <h2 id="screen-heading" className="text-sm font-semibold">{t('common.screenTitle')}</h2>
      </header>

      <div className="screen-layout">
        <section className="screen-panel" aria-labelledby="screen-sources-heading">
          <div className="screen-panel-header">
            <h3 id="screen-sources-heading" className="text-sm font-semibold">{t('common.screenSources')}</h3>
            <button type="button" onClick={refresh} disabled={isLoading} className="workspace-secondary-action">
              <RefreshCw size={14} className={isLoading ? 'animate-spin' : undefined} aria-hidden="true" />
              {t('common.screenRefresh')}
            </button>
          </div>
          <div className="screen-source-list" aria-busy={isLoading}>
            {failed && <p role="alert" className="screen-source-message text-red-300"><AlertCircle size={19} aria-hidden="true" />{t('common.screenErrorGeneric')}</p>}
            {!sources.length && isLoading && (
              <div className="space-y-2">
                <p role="status" className="px-1 pb-1 text-xs text-white/65">{t('common.screenLoading')}</p>
                {Array.from({ length: 3 }, (_, index) => <Skeleton key={index} className="h-11 w-full" />)}
              </div>
            )}
            {!sources.length && !isLoading && !failed && (
              <p className="screen-source-message"><AppWindow size={23} aria-hidden="true" />{t('common.screenEmpty')}</p>
            )}
            {sources.map(source => (
              <SourceCard key={source.id} source={source} selected={source.id === selectedId} onSelect={() => selectSource(source)} />
            ))}
          </div>
        </section>

        <section className="screen-panel screen-preview-panel" aria-labelledby="screen-preview-heading">
          <div className="screen-panel-header">
            <div className="screen-preview-heading">
              <h3 id="screen-preview-heading" className="text-sm font-semibold">{t('common.screenLivePreview')}</h3>
              {selected && (
                <span className="screen-selected-source" title={selected.name}>
                  <span className="screen-status-dot" data-active={status === 'active' || undefined} />
                  <span className="truncate">{selected.name}</span>
                </span>
              )}
            </div>
            <div className="screen-preview-actions">
              <button type="button" onClick={togglePreview} disabled={!canStop && !selected}
                className="workspace-secondary-action" data-stopping={canStop || undefined}>
                {canStop ? <Square size={14} aria-hidden="true" /> : <Play size={14} aria-hidden="true" />}
                {t(canStop ? 'common.screenStopLive' : 'common.screenStartLive')}
              </button>
              <button type="button" className="workspace-secondary-action" disabled={!selected}
                onClick={() => { if (selected) onAddScreenToPresentation(selected.id, selected.name); }}>
                <Plus size={14} aria-hidden="true" />
                {t('common.screenAddAsSlide')}
              </button>
            </div>
          </div>

          <div className="screen-stage">
            <video ref={videoRef} autoPlay muted playsInline disablePictureInPicture hidden={status !== 'active'} />
            {status === 'idle' && selected?.thumbnail && <img src={selected.thumbnail} alt="" className="screen-stage-thumbnail" />}
            {status !== 'active' && (
              <div className="screen-stage-message" role={status === 'error' ? 'alert' : 'status'}>
                {status === 'starting' && <Loader2 className="animate-spin" size={20} aria-hidden="true" />}
                {status === 'error' && <AlertCircle className="text-red-300" size={20} aria-hidden="true" />}
                {status === 'idle' && <Monitor size={20} aria-hidden="true" />}
                {t(status === 'starting' ? 'common.screenConnecting'
                  : status === 'error' ? 'common.screenError'
                  : selected ? 'common.screenClickStart' : 'common.screenSelectFirst')}
              </div>
            )}
          </div>
        </section>
      </div>
    </section>
  );
}

export default function ScreenCaptureTab(props: ScreenCaptureTabProps) {
  const practice = usePractice();
  const { t } = useTranslation();
  return practice ? <p className="p-6" data-testid="practice-screen-explanation">{t('practice.phase3')}</p> : <ActiveScreenCaptureTab {...props} />;
}
