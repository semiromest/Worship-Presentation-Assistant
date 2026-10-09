import type { InputVideoTrack } from 'mediabunny';

export interface VideoAnalysis {
  frames: string[];
  width: number;
  height: number;
  fps: number;
  codec: string;
}

type Mediabunny = typeof import('mediabunny');

const FRAME_COUNT = 8;
const THUMB_WIDTH = 144;
const THUMB_HEIGHT = 81;
const JPEG_QUALITY = 0.65;
const TIMEOUT_MS = 20_000;
const CACHE_LIMIT = 6;
const SOURCE_CACHE_BYTES = 8 * 1024 * 1024;
const FRAME_RATE_PROBE_PACKETS = 60;

/* -------------------------------------------------------------------------- */
/* Result cache (LRU)                                                          */
/* -------------------------------------------------------------------------- */

const cache = new Map<string, VideoAnalysis>();

function cacheGet(key: string): VideoAnalysis | undefined {
  const hit = cache.get(key);
  if (hit) {
    // Re-insert so the most recently used entry is the last to be evicted.
    cache.delete(key);
    cache.set(key, hit);
  }
  return hit;
}

function cacheSet(key: string, value: VideoAnalysis) {
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    cache.delete(oldest.value);
  }
}

/* -------------------------------------------------------------------------- */
/* Public API: shared, cancellable jobs                                        */
/* -------------------------------------------------------------------------- */

type Job = {
  key: string;
  controller: AbortController;
  /** Callers currently waiting on this job; the work is cancelled only when the last one leaves. */
  waiters: number;
  promise: Promise<VideoAnalysis>;
};

const inflight = new Map<string, Job>();

/**
 * Read-only, on-demand analysis. No encoder, audio playback or disk output.
 *
 * Identical concurrent requests share one analysis. Each caller's `signal` only cancels the
 * shared work when no other caller still needs it.
 */
export function analyzeVideo(source: string, duration: number, signal: AbortSignal): Promise<VideoAnalysis> {
  if (signal.aborted) return Promise.reject(signal.reason);
  if (!Number.isFinite(duration) || duration <= 0) return Promise.reject(new RangeError('Invalid video duration'));

  const key = `${source}:${duration}`;
  const cached = cacheGet(key);
  if (cached) return Promise.resolve(cached);

  const job = inflight.get(key) ?? startJob(key, source, duration);
  return join(job, signal);
}

function startJob(key: string, source: string, duration: number): Job {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new DOMException('Video analysis timed out', 'TimeoutError')),
    TIMEOUT_MS
  );
  const job = { key, controller, waiters: 0 } as Job;
  job.promise = runAnalysis(source, duration, controller.signal)
    .then((result) => {
      // Unsupported/empty results must remain retryable, so they are never cached.
      if (result.frames.some(Boolean)) cacheSet(key, result);
      return result;
    })
    .finally(() => {
      clearTimeout(timer);
      if (inflight.get(key) === job) inflight.delete(key);
    });
  inflight.set(key, job);
  return job;
}

function join(job: Job, signal: AbortSignal): Promise<VideoAnalysis> {
  return new Promise<VideoAnalysis>((resolve, reject) => {
    job.waiters++;
    let left = false;
    const leave = () => {
      if (left) return false;
      left = true;
      signal.removeEventListener('abort', onAbort);
      job.waiters--;
      return true;
    };
    function onAbort() {
      if (!leave()) return;
      if (job.waiters === 0) {
        // Detach first, so a retry right after an abort starts a fresh job instead of joining a dying one.
        if (inflight.get(job.key) === job) inflight.delete(job.key);
        job.controller.abort(signal.reason);
      }
      reject(signal.reason);
    }
    signal.addEventListener('abort', onAbort, { once: true });
    job.promise.then(
      (result) => {
        if (leave()) resolve(result);
      },
      (error) => {
        if (leave()) reject(error);
      }
    );
  });
}

/* -------------------------------------------------------------------------- */
/* The analysis itself                                                         */
/* -------------------------------------------------------------------------- */

let mediabunny: Promise<Mediabunny> | undefined;
function loadMediabunny(): Promise<Mediabunny> {
  if (!mediabunny) {
    mediabunny = import('mediabunny').catch((error) => {
      mediabunny = undefined; // a failed chunk load must stay retryable
      throw error;
    });
  }
  return mediabunny;
}

/** Packaged-app `file://` URLs are not readable by fetch; route them through the local-resource protocol. */
function toReadableUrl(source: string): string {
  if (!source.startsWith('file://') || !window.electronAPI) return source;
  let path = decodeURIComponent(new URL(source).pathname);
  if (/^\/[a-zA-Z]:\//.test(path)) path = path.slice(1);
  return `local-resource://mediafile/${encodeURIComponent(path)}`;
}

async function runAnalysis(source: string, duration: number, signal: AbortSignal): Promise<VideoAnalysis> {
  const lib = await loadMediabunny();
  signal.throwIfAborted();

  const input = new lib.Input({
    formats: lib.ALL_FORMATS,
    source: new lib.UrlSource(toReadableUrl(source), {
      maxCacheSize: SOURCE_CACHE_BYTES,
      parallelism: 1,
      getRetryDelay: () => null,
    }),
  });
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    input.dispose();
  };
  signal.addEventListener('abort', dispose, { once: true });

  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new Error('No video track');
    const [width, height, codec, metrics] = await Promise.all([
      track.getDisplayWidth(),
      track.getDisplayHeight(),
      track.getCodec(),
      track.computeFrameRateMetrics({ targetPacketCount: FRAME_RATE_PROBE_PACKETS }).catch(() => null),
    ]);
    const result: VideoAnalysis = {
      frames: [],
      width,
      height,
      codec: codec ?? '',
      // Best guess snaps to the intended rate (e.g. 29.97) instead of being skewed by dropped frames.
      fps: metrics?.bestGuessFrameRate ?? 0,
    };
    if (await track.canDecode()) result.frames = await extractFrames(lib, track, duration, signal);
    signal.throwIfAborted();
    return result;
  } catch (error) {
    // Disposing the input on abort makes pending reads fail with unrelated errors; surface the real cause.
    if (signal.aborted) throw signal.reason;
    throw error;
  } finally {
    signal.removeEventListener('abort', dispose);
    dispose();
  }
}

async function extractFrames(
  lib: Mediabunny,
  track: InputVideoTrack,
  duration: number,
  signal: AbortSignal
): Promise<string[]> {
  // No canvas pool: every yielded canvas is its own object, so nothing can be overwritten
  // while the pipeline decodes ahead. At 144 × 81 the allocations are negligible.
  const sink = new lib.CanvasSink(track, { width: THUMB_WIDTH, height: THUMB_HEIGHT, fit: 'contain' });
  // Sorted timestamps let the sink decode each packet at most once and still seek sparsely
  // (no decoding of the whole video between thumbnails).
  const timestamps = Array.from({ length: FRAME_COUNT }, (_, index) => (duration * (index + 0.5)) / FRAME_COUNT);

  const frames: string[] = [];
  for await (const frame of sink.canvasesAtTimestamps(timestamps)) {
    signal.throwIfAborted();
    frames.push(frame ? encodeFrame(frame.canvas) : '');
  }
  while (frames.length < FRAME_COUNT) frames.push('');
  return frames;
}

function encodeFrame(canvas: HTMLCanvasElement | OffscreenCanvas): string {
  // The sink already produced a THUMB_WIDTH × THUMB_HEIGHT canvas (letterboxed on black), so no copy is needed.
  if (canvas instanceof HTMLCanvasElement) return canvas.toDataURL('image/jpeg', JPEG_QUALITY);
  // OffscreenCanvas has no synchronous encoder: copy it onto a regular canvas first.
  const copy = document.createElement('canvas');
  copy.width = THUMB_WIDTH;
  copy.height = THUMB_HEIGHT;
  copy.getContext('2d')?.drawImage(canvas, 0, 0);
  return copy.toDataURL('image/jpeg', JPEG_QUALITY);
}