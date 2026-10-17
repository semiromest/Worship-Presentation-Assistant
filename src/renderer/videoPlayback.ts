import type { VideoPlaybackSettings } from '../shared/videoPlayback';
export type { VideoPlaybackSettings } from '../shared/videoPlayback';
export interface VideoRange {
  start: number;
  end: number;
  loop: boolean;
  muted: boolean;
}

/** The trim start is kept at least this far (seconds) before the end of the clip. */
const MIN_REMAINING = 0.001;
const MIN_PLAYBACK_RATE = 0.25;
const MAX_PLAYBACK_RATE = 4;
/** How often the end boundary is checked while the video plays. */
const BOUNDARY_POLL_MS = 25;

const clampNumber = (value: number | undefined, fallback: number, min: number, max: number) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;

export function videoRange(settings: VideoPlaybackSettings | undefined, duration: number): VideoRange {
  const length = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const rawStart = settings?.startSeconds;
  const start =
    typeof rawStart === 'number' && Number.isFinite(rawStart)
      ? Math.max(0, Math.min(rawStart, Math.max(0, length - MIN_REMAINING)))
      : 0;
  const rawEnd = settings?.endSeconds;
  const end =
    typeof rawEnd === 'number' && Number.isFinite(rawEnd) && rawEnd > start ? Math.min(rawEnd, length) : length;
  return { start, end, loop: settings?.loop ?? true, muted: settings?.muted ?? false };
}

export function videoAudio(settings: VideoPlaybackSettings | undefined, globalVolume = 1) {
  return {
    playbackRate: clampNumber(settings?.playbackRate, 1, MIN_PLAYBACK_RATE, MAX_PLAYBACK_RATE),
    volume: clampNumber(globalVolume, 1, 0, 1) * clampNumber(settings?.volume, 1, 0, 1),
  };
}

/** One controller shared by previews and projection. No native full-file loop. */
export function attachVideoPlayback(
  video: HTMLVideoElement,
  settings: VideoPlaybackSettings | undefined,
  options: {
    active: boolean;
    autoplay: boolean;
    muted: boolean;
    volume: number;
    allowOutsideRangeWhilePaused?: boolean;
    onPosition?: (seconds: number) => void;
  }
) {
  let disposed = false;
  let seeking = false;
  let frame: number | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let stoppedAtEnd = false;
  let lastPlaying = false;
  const hasFrameCallback = typeof video.requestVideoFrameCallback === 'function';

  video.loop = false;
  video.muted = options.muted || (settings?.muted ?? false);
  const audio = videoAudio(settings, options.volume);
  video.volume = audio.volume;
  video.playbackRate = audio.playbackRate;

  // The range only depends on the (rarely changing) duration, but it is read on every poll,
  // so it is memoized instead of allocating a new object up to ~100 times per second.
  let cachedDuration = Number.NaN;
  let cachedRange: VideoRange | undefined;
  const range = (): VideoRange => {
    const duration = video.duration;
    if (!cachedRange || !Object.is(duration, cachedDuration)) {
      cachedDuration = duration;
      cachedRange = videoRange(settings, duration);
    }
    return cachedRange;
  };

  const seek = (time: number) => {
    seeking = true;
    video.currentTime = time;
  };
  const play = () => {
    if (options.active && !disposed) video.play().catch(() => {});
  };
  const report = () => {
    if (!disposed && options.active) options.onPosition?.(video.currentTime);
  };

  const checkBoundary = (resume: boolean) => {
    if (disposed || !options.active) return;
    if (options.allowOutsideRangeWhilePaused && video.paused && !resume) return;
    if (seeking && video.seeking) return;
    seeking = false;
    const { start, end, loop } = range();
    if (!end) return;
    if (video.currentTime < start) {
      seek(start);
      return;
    }
    if (video.currentTime >= end) {
      video.pause();
      stoppedAtEnd = !loop;
      seek(loop ? start : Math.max(start, end - MIN_REMAINING));
      if (loop && resume) play();
    }
  };
  const check = () => {
    checkBoundary(!video.paused);
    report();
  };
  // With frame callbacks, positions are reported once per presented frame by the callback below,
  // so the boundary poll only has to guard the boundary and must not report a second time.
  const poll = () => (hasFrameCallback ? checkBoundary(!video.paused) : check());

  // A paused video cannot cross a boundary by itself, and every seek fires seeked/timeupdate,
  // so the poll only runs while the video plays instead of waking up 40 times a second forever.
  const startPolling = () => {
    if (timer === undefined && !disposed && options.active) timer = setInterval(poll, BOUNDARY_POLL_MS);
  };
  const stopPolling = () => {
    if (timer === undefined) return;
    clearInterval(timer);
    timer = undefined;
  };

  const metadata = () => {
    if (disposed || !options.active) return;
    const { start, end } = range();
    if (!end) return;
    stoppedAtEnd = false;
    seek(start);
    if (options.autoplay) play();
  };
  const seeked = () => {
    seeking = false;
    check();
  };
  const onPlay = () => {
    if (!options.active) {
      video.pause();
      return;
    }
    lastPlaying = true;
    startPolling();
    const { start, end } = range();
    if (stoppedAtEnd || video.currentTime < start || video.currentTime >= end) {
      stoppedAtEnd = false;
      seek(start);
    }
  };
  const onEnded = () => {
    seeking = false;
    checkBoundary(lastPlaying);
  };
  const onPause = () => {
    if (!video.ended) lastPlaying = false;
    // A pause()+play() pair (loop restart) queues both events; only stop if playback really is paused now.
    if (video.paused) stopPolling();
  };
  const onSeeking = () => {
    seeking = true;
  };

  video.addEventListener('loadedmetadata', metadata);
  video.addEventListener('seeked', seeked);
  video.addEventListener('seeking', onSeeking);
  video.addEventListener('play', onPlay);
  video.addEventListener('pause', onPause);
  video.addEventListener('timeupdate', check);
  video.addEventListener('ended', onEnded);

  if (options.active) {
    if (!video.paused) startPolling();
    if (hasFrameCallback) {
      const tick: VideoFrameRequestCallback = () => {
        check();
        if (!disposed) frame = video.requestVideoFrameCallback(tick);
      };
      frame = video.requestVideoFrameCallback(tick);
    }
    if (video.readyState >= 1) metadata();
  } else video.pause();

  return () => {
    disposed = true;
    stopPolling();
    if (frame !== undefined) video.cancelVideoFrameCallback?.(frame);
    video.pause();
    video.removeEventListener('loadedmetadata', metadata);
    video.removeEventListener('seeked', seeked);
    video.removeEventListener('seeking', onSeeking);
    video.removeEventListener('play', onPlay);
    video.removeEventListener('pause', onPause);
    video.removeEventListener('timeupdate', check);
    video.removeEventListener('ended', onEnded);
  };
}