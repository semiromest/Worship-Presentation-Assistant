import type { Slide, WatermarkConfig, Position } from './types';
import type { CaptionLayout } from './captionDisplay';

/** The same immutable input is used for drawing, cache identity and publication guards. */
export interface ThumbnailRenderContext {
  watermark: WatermarkConfig;
  authorPosition: Position;
  authorSize: number;
}
export interface ScreenFrameScene {
  documentId: string;
  slide: Slide;
  blackout: boolean;
  width: number;
  height: number;
  quality: number;
  context: ThumbnailRenderContext;
  captions?: CaptionLayout;
  environment: { language: string; theme: string; fontRevision: number };
}

/** Exact canonical content key: no collision-prone hash and no event invalidation list. */
export function sceneKey(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(sceneKey).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.entries(value)
    .filter(([, child]) => child !== undefined).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, child]) => JSON.stringify(key) + ':' + sceneKey(child)).join(',') + '}';
  return JSON.stringify(value) ?? 'null';
}

function hasResource(value: unknown): boolean {
  if (typeof value === 'string') return /(?:^(?:data:|blob:|file:|local-resource:|https?:|[a-z]:[\\/]|[\\/])|\.(?:png|jpe?g|bmp|gif|webp|svg|mp4|webm)(?:[?#]|$))/i.test(value);
  if (Array.isArray(value)) return value.some(hasResource);
  return !!value && typeof value === 'object' && Object.values(value).some(hasResource);
}

export function canCacheScene(scene: ScreenFrameScene): boolean {
  if (scene.blackout) return true;
  const slide = scene.slide;
  // Files and animated/unknown scenes remain fresh. Never trust just a filename or mtime.
  return slide.type === 'text' && !slide.items?.length && !hasResource(scene)
    && !slide.styles?.backgroundImage && !slide.styles?.backgroundGradient && !slide.styles?.generatedBackground;
}

/** Preserve elapsed playback across a period with no viewers, including trimmed loops. */
export function resumedVideoTime(time: number, elapsedSeconds: number, duration: number,
  start = 0, end = duration, rate = 1, loop = true): number {
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  const lo = Math.max(0, Math.min(start, duration));
  const hi = Math.max(lo, Math.min(end, duration));
  const next = Math.max(lo, time) + Math.max(0, elapsedSeconds) * rate;
  return loop && hi > lo ? lo + ((next - lo) % (hi - lo) + hi - lo) % (hi - lo) : Math.min(next, hi);
}
