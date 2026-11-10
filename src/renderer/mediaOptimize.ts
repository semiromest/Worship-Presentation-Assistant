// One-click media optimizer: finds the images and videos the open presentation uses, shrinks
// them and swaps the references in a single undo step.
//   images: sharp in the main process (mozjpeg / palette PNG / WebP, capped at 2560 px)
//   videos: WebCodecs through mediabunny, here in the renderer (H.264 when the machine can
//           encode it, otherwise VP9), capped at 1080p and a projection-grade bitrate.
// Originals stay in the media library until the user cleans unused media.
import { useStore } from './state/useStore';
import {
  VIDEO_MAX_HEIGHT, VIDEO_MIN_BYTES, VIDEO_MIN_SAVING, collectOptimizableMedia, replaceMediaRefs, videoTargetBitrate,
} from '../shared/mediaOptimize';

type Mediabunny = typeof import('mediabunny');

export interface OptimizeScan {
  images: string[];
  videos: string[];
  bytes: number;
  sizes: Record<string, number>;
}

export interface OptimizeProgress {
  /** 0..1 over the whole job. */
  fraction: number;
  kind: 'image' | 'video';
  index: number;
  total: number;
}

export interface OptimizeOutcome {
  before: number;
  after: number;
  images: number;
  videos: number;
  /** Files looked at but left alone (already lean, unsupported or no gain). */
  kept: number;
  failed: number;
  cancelled: boolean;
}

export const mediaOptimizeAvailable = () =>
  typeof window !== 'undefined' && typeof window.electronAPI?.mediaOptimizeImage === 'function';

function loopItemRefs() {
  return useStore.getState().loopItems;
}

export async function scanOptimizable(): Promise<OptimizeScan> {
  const state = useStore.getState();
  const found = collectOptimizableMedia({ presentation: state.presentation, loop: loopItemRefs() });
  const all = [...found.image, ...found.video];
  const sizes = all.length ? await window.electronAPI.mediaOptimizeSizes!(all) : {};
  const present = (refs: string[]) => refs.filter((ref) => (sizes[ref] ?? 0) > 0);
  const images = present(found.image);
  const videos = present(found.video);
  return { images, videos, sizes, bytes: [...images, ...videos].reduce((sum, ref) => sum + (sizes[ref] ?? 0), 0) };
}

let mediabunny: Promise<Mediabunny> | undefined;
function loadMediabunny(): Promise<Mediabunny> {
  mediabunny ??= import('mediabunny').catch((error) => {
    mediabunny = undefined; // a failed chunk load must stay retryable
    throw error;
  });
  return mediabunny;
}

const even = (value: number) => Math.max(2, Math.round(value / 2) * 2);

/** Returns the new library ref and size, or null when the video is already lean or nothing is gained. */
async function transcodeVideo(
  ref: string, originalBytes: number, signal: AbortSignal, onProgress: (fraction: number) => void,
): Promise<{ ref: string; bytes: number } | null> {
  if (originalBytes < VIDEO_MIN_BYTES) return null;
  const lib = await loadMediabunny();
  const api = window.electronAPI;
  const input = new lib.Input({ formats: lib.ALL_FORMATS, source: new lib.UrlSource(ref, { getRetryDelay: () => null }) });
  let sink: string | null = null;
  let conversion: Awaited<ReturnType<Mediabunny['Conversion']['init']>> | null = null;
  const onAbort = () => { void conversion?.cancel(); };
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) return null;
    const [width, height] = await Promise.all([track.getDisplayWidth(), track.getDisplayHeight()]);
    const stats = await track.computePacketStats(60).catch(() => null);
    const fps = stats?.averagePacketRate || 30;
    const outHeight = even(Math.min(height, VIDEO_MAX_HEIGHT));
    const outWidth = even(width * (outHeight / height));
    const bitrate = videoTargetBitrate(outWidth, outHeight, fps);
    // Already small and lean: re-encoding would only cost quality.
    if (height <= VIDEO_MAX_HEIGHT && stats && stats.averageBitrate <= bitrate * 1.25) return null;

    const codec = await lib.getFirstEncodableVideoCodec(['avc', 'vp9'], { width: outWidth, height: outHeight, bitrate });
    if (!codec) return null;
    const webm = codec !== 'avc';
    sink = await api.mediaOptimizeVideoBegin!();
    const id = sink;
    const writable = new WritableStream<{ data: Uint8Array; position: number }>({
      write: (chunk) => api.mediaOptimizeVideoWrite!(id, chunk.position, chunk.data),
    });
    const output = new lib.Output({
      format: webm ? new lib.WebMOutputFormat() : new lib.Mp4OutputFormat({ fastStart: false }),
      target: new lib.StreamTarget(writable as WritableStream<import('mediabunny').StreamTargetChunk>, { chunked: true, chunkSize: 8 * 1024 * 1024 }),
    });
    conversion = await lib.Conversion.init({
      input,
      output,
      video: { codec, bitrate, ...(height > VIDEO_MAX_HEIGHT ? { height: outHeight } : {}), ...(fps > 60 ? { frameRate: 60 } : {}) },
    });
    if (!conversion.isValid) return null;
    conversion.onProgress = (fraction) => onProgress(fraction);
    await conversion.execute();
    signal.throwIfAborted();
    const done = await api.mediaOptimizeVideoFinish!(id, webm ? '.webm' : '.mp4');
    sink = null;
    if (!done || done.bytes > originalBytes * (1 - VIDEO_MIN_SAVING)) return null;
    return done;
  } finally {
    signal.removeEventListener('abort', onAbort);
    input.dispose();
    if (sink) await api.mediaOptimizeVideoAbort!(sink).catch(() => {});
  }
}

/** Optimizes everything `scan` found and applies the new references to the store (one undo step). */
export async function runOptimize(
  scan: OptimizeScan, onProgress: (progress: OptimizeProgress) => void, signal: AbortSignal,
): Promise<OptimizeOutcome> {
  const api = window.electronAPI;
  const outcome: OptimizeOutcome = { before: 0, after: 0, images: 0, videos: 0, kept: 0, failed: 0, cancelled: false };
  const map = new Map<string, string>();
  const total = scan.images.length + scan.videos.length;
  // Weigh progress by bytes so one big video does not look like one of many tiny steps.
  const weight = (ref: string) => Math.max(1, scan.sizes[ref] ?? 1);
  const totalWeight = [...scan.images, ...scan.videos].reduce((sum, ref) => sum + weight(ref), 0) || 1;
  let doneWeight = 0;
  let index = 0;
  const report = (kind: 'image' | 'video', inner = 0, current = 0) =>
    onProgress({ fraction: Math.min(1, (doneWeight + inner * current) / totalWeight), kind, index, total });

  const finish = (ref: string, kind: 'image' | 'video') => { doneWeight += weight(ref); index++; report(kind); };

  // Images: libvips is fast and parallel-safe; a few at a time keeps the UI responsive.
  const queue = [...scan.images];
  const worker = async () => {
    for (let ref = queue.shift(); ref && !signal.aborted; ref = queue.shift()) {
      try {
        const result = await api.mediaOptimizeImage!(ref);
        if (result) {
          map.set(ref, result.to);
          outcome.images++;
          outcome.before += result.before;
          outcome.after += result.after;
        } else outcome.kept++;
      } catch (error) {
        console.warn('[media optimize] image', error);
        outcome.failed++;
      }
      finish(ref, 'image');
    }
  };
  await Promise.all([worker(), worker(), worker()]);

  // Videos: one at a time, the encoder already uses the hardware.
  for (const ref of scan.videos) {
    if (signal.aborted) break;
    const bytes = scan.sizes[ref] ?? 0;
    try {
      const result = await transcodeVideo(ref, bytes, signal, (fraction) => report('video', weight(ref), fraction));
      if (result) {
        map.set(ref, result.ref);
        outcome.videos++;
        outcome.before += bytes;
        outcome.after += result.bytes;
      } else outcome.kept++;
    } catch (error) {
      if (!signal.aborted) {
        console.warn('[media optimize] video', error);
        outcome.failed++;
      }
    }
    finish(ref, 'video');
  }

  outcome.cancelled = signal.aborted;
  if (map.size) {
    const state = useStore.getState();
    state.dispatchUndo({ type: 'SET', payload: replaceMediaRefs(state.presentation, map) });
    state.setLoopItems((items) => replaceMediaRefs(items, map));
  }
  return outcome;
}
