import { useEffect } from 'react';
import { useStore } from '../state/useStore';
import { captureThumbnailContext, generateSlideThumbnail, type ThumbnailStatus } from '../utils';
import { IS_PROJECTOR_MODE } from '../constants';
import { useSttStore } from '../state/useSttStore';
import { useWatermarkStore } from '../state/useWatermarkStore';
import { layoutCaptions, measureCaptionText, paintCaptionsLayout } from '../captionDisplay';
import { encodePreview } from '../previewEncoding';
import { canCacheScene, resumedVideoTime, sceneKey, type ScreenFrameScene } from '../screenFrameScene';
import { LatestFrameQueue } from '../latestFrameQueue';
import { videoAudio, videoRange } from '../videoPlayback';
import { rendererPerf } from '../perf';
import i18n from '../i18n';

const WIDTH = 1280, HEIGHT = 720, QUALITY = .75;
const REFRESH_MS = 2000, VIDEO_REFRESH_MS = 500;

/** Control-only phone output: one render in flight, immutable scenes, bounded cache. */
export function useLiveScreenShare(): void {
  useEffect(() => {
    if (IS_PROJECTOR_MODE) return;
    let alive = true, fontRevision = 0, cacheEnabled = false;
    let identity = '', cache: { key: string; frame: string } | undefined;
    let video: HTMLVideoElement | undefined, videoSource = '';
    let timeline: { key: string; started: number } | undefined;
    let canvas: HTMLCanvasElement | undefined;
    let timer: ReturnType<typeof setInterval> | undefined, cadence = 0;
    let captionTimer: ReturnType<typeof setTimeout> | undefined;
    let abort: AbortController | undefined;
    const cleanups = new Set<() => void>();
    const record = (label: string, started = performance.now()) => rendererPerf.push({
      kind: 'screen-frame', label, ms: performance.now() - started, bytes: 0, t: Date.now(),
    });
    const scene = (): ScreenFrameScene | undefined => {
      const state = useStore.getState();
      const slide = state.presentation.slides[state.liveIndex] ?? state.presentation.slides[0];
      return slide && structuredClone({ documentId: state.presentation.id ?? '', slide, blackout: state.isBlackout,
        width: WIDTH, height: HEIGHT, quality: QUALITY, context: captureThumbnailContext(),
        ...(slide.type === 'captions' ? { captions: layoutCaptions(slide, useSttStore.getState(), measureCaptionText) } : {}),
        environment: { language: i18n.language, theme: document.documentElement.getAttribute('data-theme') ?? '', fontRevision } });
    };
    const wanted = () => alive && useStore.getState().screenShareActive && useStore.getState().screenShareClientCount > 0;
    const videoTarget = (value: Pick<ScreenFrameScene, 'slide' | 'blackout'>) => value.blackout ? undefined : value.slide.type === 'video'
      ? { source: value.slide.mediaUrl ?? '', fit: value.slide.styles?.objectFit, settings: value.slide.videoPlayback }
      : value.slide.type === 'loop' && value.slide.loopItems?.[0]?.type === 'video'
        ? { source: value.slide.loopItems[0].mediaUrl ?? '', fit: 'contain', settings: undefined } : undefined;
    const releaseVideo = () => {
      video?.pause(); video?.removeAttribute('src'); video?.load(); video = undefined; videoSource = '';
    };
    const waitMedia = (element: HTMLVideoElement, event: 'loadeddata' | 'seeked', signal: AbortSignal): Promise<void> =>
      new Promise(resolve => {
        let timeout: ReturnType<typeof setTimeout>;
        const done = () => { clearTimeout(timeout); element.removeEventListener(event, done); element.removeEventListener('error', done);
          signal.removeEventListener('abort', done); cleanups.delete(done); resolve(); };
        cleanups.add(done); element.addEventListener(event, done); element.addEventListener('error', done);
        signal.addEventListener('abort', done, { once: true }); timeout = setTimeout(done, 5000);
        if (signal.aborted || (event === 'loadeddata' ? element.readyState >= 2 : !element.seeking)) done();
      });
    const getCanvas = () => { canvas ??= document.createElement('canvas');
      if (canvas.width !== WIDTH || canvas.height !== HEIGHT) { canvas.width = WIDTH; canvas.height = HEIGHT; } return canvas; };
    const queue = new LatestFrameQueue<ScreenFrameScene>(async (snapshot, current) => {
      const key = sceneKey(snapshot);
      const valid = () => current() && wanted() && identity === key;
      if (!valid()) return;
      abort = new AbortController(); const signal = abort.signal;
      let frame: string | null = null;
      const started = performance.now();
      let cacheable = cacheEnabled && canCacheScene(snapshot);
      if (cacheable && cache?.key === key) { frame = cache.frame; record('cache-hit'); }
      else {
        const target = videoTarget(snapshot);
        if (snapshot.blackout) {
          video?.pause(); const targetCanvas = getCanvas(), ctx = targetCanvas.getContext('2d'); if (!ctx) return;
          ctx.fillStyle = '#000'; ctx.fillRect(0, 0, WIDTH, HEIGHT); frame = await encodePreview(targetCanvas, .7);
        } else if (target) {
          video ??= document.createElement('video'); const element = video;
          element.muted = true; element.playsInline = true; element.preload = 'auto';
          if (videoSource !== target.source) { videoSource = target.source; element.src = target.source; element.load(); }
          await waitMedia(element, 'loadeddata', signal);
          if (!valid() || !element.videoWidth) return;
          const range = videoRange(target.settings, element.duration), audio = videoAudio(target.settings);
          const time = resumedVideoTime(range.start, (performance.now() - (timeline?.started ?? performance.now())) / 1000,
            element.duration, range.start, range.end, audio.playbackRate, range.loop);
          element.playbackRate = audio.playbackRate; element.loop = range.loop && range.start === 0 && range.end === element.duration;
          const ended = !range.loop && time >= range.end;
          if (element.paused || Math.abs(element.currentTime - time) > .2) {
            element.currentTime = Math.min(time, Math.max(range.start, range.end - .001));
            await waitMedia(element, 'seeked', signal);
          }
          if (!valid()) return;
          if (ended) element.pause(); else await element.play().catch(() => {});
          if (!valid()) { element.pause(); return; }
          const targetCanvas = getCanvas(), ctx = targetCanvas.getContext('2d', { alpha: false }); if (!ctx) return;
          ctx.fillStyle = '#000'; ctx.fillRect(0, 0, WIDTH, HEIGHT);
          const scale = target.fit === 'cover' ? Math.max(WIDTH / element.videoWidth, HEIGHT / element.videoHeight)
            : Math.min(WIDTH / element.videoWidth, HEIGHT / element.videoHeight);
          const w = element.videoWidth * scale, h = element.videoHeight * scale;
          ctx.drawImage(element, (WIDTH - w) / 2, (HEIGHT - h) / 2, w, h);
          frame = await encodePreview(targetCanvas, snapshot.quality);
        } else if (snapshot.captions) {
          video?.pause(); const targetCanvas = getCanvas(); paintCaptionsLayout(targetCanvas, snapshot.captions);
          frame = await encodePreview(targetCanvas, .85);
        } else {
          video?.pause(); const status: ThumbnailStatus = {};
          frame = await generateSlideThumbnail(snapshot.slide, { scale: snapshot.width / 320, quality: snapshot.quality,
            context: snapshot.context, eligible: valid, status });
          if (status.usedFallback) cacheable = false;
        }
        if (!valid()) return;
        record('encoded', started);
        if (frame && cacheable) cache = { key, frame };
      }
      if (frame && valid()) { window.electronAPI.screenShareFrame(frame); record('sent'); }
    });
    const request = () => {
      if (!useStore.getState().screenShareActive) {
        clearInterval(timer); cadence = 0; queue.invalidate(); abort?.abort();
        releaseVideo(); timeline = undefined; cache = undefined; identity = ''; return;
      }
      const state = useStore.getState(), slide = state.presentation.slides[state.liveIndex] ?? state.presentation.slides[0];
      const target = slide && videoTarget({ slide, blackout: state.isBlackout });
      const videoKey = target && slide && sceneKey([state.presentation.id, slide.id, target.source, target.settings]);
      if (videoKey !== timeline?.key) { timeline = videoKey ? { key: videoKey, started: performance.now() } : undefined; video?.pause(); }
      if (!wanted()) {
        clearInterval(timer); cadence = 0; queue.invalidate(); abort?.abort(); video?.pause(); return;
      }
      const snapshot = scene();
      const key = snapshot ? sceneKey(snapshot) : '';
      if (key !== identity) { identity = key; queue.invalidate(); abort?.abort(); cache = undefined; }
      const nextCadence = wanted() && snapshot ? target ? VIDEO_REFRESH_MS : REFRESH_MS : 0;
      if (nextCadence !== cadence) {
        clearInterval(timer); cadence = nextCadence;
        if (cadence) timer = setInterval(request, cadence);
      }
      if (!wanted() || !snapshot) {
        queue.invalidate(); abort?.abort(); video?.pause();
        if (!useStore.getState().screenShareActive) { releaseVideo(); timeline = undefined; cache = undefined; }
        return;
      }
      queue.request(snapshot);
    };
    const offStore = useStore.subscribe(state => [state.presentation.id, state.liveIndex,
      state.presentation.slides[state.liveIndex], state.isBlackout, state.screenShareActive, state.screenShareClientCount],
      request, { equalityFn: (a, b) => a.every((value, index) => Object.is(value, b[index])) });
    const offWatermark = useWatermarkStore.subscribe(request);
    const offCaptions = useSttStore.subscribe(() => {
      if (wanted() && !captionTimer && useStore.getState().presentation.slides[useStore.getState().liveIndex]?.type === 'captions') {
        captionTimer = setTimeout(() => { captionTimer = undefined; request(); }, 100);
      }
    });
    const fonts = () => { fontRevision++; request(); };
    document.fonts.addEventListener('loadingdone', fonts); document.fonts.addEventListener('loadingerror', fonts);
    window.addEventListener('presenter-font-loaded', fonts); window.addEventListener('storage', request);
    i18n.on('languageChanged', request);
    const theme = new MutationObserver(request); theme.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    void window.electronAPI.getOptimizationFlags?.().then(flags => {
      if (alive) { cacheEnabled = flags?.screenFrameCache === true; cache = undefined; request(); }
    }).catch(() => {});
    request();
    return () => {
      alive = false; clearInterval(timer); clearTimeout(captionTimer); queue.close(); abort?.abort();
      cleanups.forEach(done => done()); offStore(); offWatermark(); offCaptions(); theme.disconnect();
      document.fonts.removeEventListener('loadingdone', fonts); document.fonts.removeEventListener('loadingerror', fonts);
      window.removeEventListener('presenter-font-loaded', fonts); window.removeEventListener('storage', request); i18n.off('languageChanged', request);
      releaseVideo(); canvas = undefined; cache = undefined;
    };
  }, []);
}
