// Shared by the desktop main process (sharp image pass), the renderer (video pass and the
// one-click flow) and the tests. Pure: no Node, DOM or Electron imports.

export const IMAGE_MAX_EDGE = 2560;
export const IMAGE_MIN_BYTES = 150 * 1024;
/** A re-encode must save at least this share, otherwise the original stays. */
export const IMAGE_MIN_SAVING = 0.05;
export const JPEG_QUALITY = 80;
export const PNG_QUALITY = 80;
export const OPTIMIZABLE_IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.tif', '.tiff']);
export const OPTIMIZABLE_VIDEO_EXTS = new Set(['.mp4', '.m4v', '.mov', '.webm', '.mkv', '.avi', '.wmv', '.mpg', '.mpeg', '.flv']);

export const VIDEO_MAX_HEIGHT = 1080;
export const VIDEO_MIN_BYTES = 4 * 1024 * 1024;
export const VIDEO_MIN_SAVING = 0.1;

export interface ImageOptimizeResult { from: string; to: string; before: number; after: number }

export type MediaKind = 'image' | 'video';

const LIBRARY_PREFIX = 'local-resource://media/';
const MEDIA_KEYS = new Set(['mediaUrl', 'thumbnailUrl', 'backgroundImage', 'backgroundVideo']);

export function libraryRefExt(ref: string): string {
  const match = /\.[a-z0-9]+$/i.exec(ref);
  return match ? match[0].toLowerCase() : '';
}

export function mediaKindOf(ref: string): MediaKind | null {
  if (!ref.startsWith(LIBRARY_PREFIX)) return null;
  const ext = libraryRefExt(ref);
  if (OPTIMIZABLE_IMAGE_EXTS.has(ext)) return 'image';
  if (OPTIMIZABLE_VIDEO_EXTS.has(ext)) return 'video';
  return null;
}

/** Every distinct optimizable library media ref a presentation (or any JSON-like tree) uses. */
export function collectOptimizableMedia(tree: unknown): { image: string[]; video: string[] } {
  const image = new Set<string>();
  const video = new Set<string>();
  walkMedia(tree, (value) => {
    const kind = mediaKindOf(value);
    if (kind === 'image') image.add(value);
    else if (kind === 'video') video.add(value);
    return value;
  });
  return { image: [...image], video: [...video] };
}

/** Returns a copy of `tree` with media refs swapped according to `map`; untouched branches are shared. */
export function replaceMediaRefs<T>(tree: T, map: ReadonlyMap<string, string>): T {
  if (map.size === 0) return tree;
  return walkMedia(tree, (value) => map.get(value) ?? value) as T;
}

function walkMedia(node: unknown, visit: (value: string) => string): unknown {
  if (Array.isArray(node)) {
    let changed = false;
    const next = node.map((item) => {
      const value = walkMedia(item, visit);
      if (value !== item) changed = true;
      return value;
    });
    return changed ? next : node;
  }
  if (!node || typeof node !== 'object') return node;
  let copy: Record<string, unknown> | null = null;
  const source = node as Record<string, unknown>;
  for (const key of Object.keys(source)) {
    const child = source[key];
    let value = child;
    if (typeof child === 'string') {
      if (MEDIA_KEYS.has(key)) value = visit(child);
    } else if (child && typeof child === 'object') {
      value = walkMedia(child, visit);
    }
    if (value !== child) {
      copy ??= { ...source };
      copy[key] = value;
    }
  }
  return copy ?? node;
}

/** Target bitrate for a video of the given size: enough for projection, far below camera/phone output. */
export function videoTargetBitrate(width: number, height: number, frameRate: number): number {
  const fps = Math.min(Math.max(frameRate || 30, 15), 60);
  return Math.round(Math.max(1_200_000, Math.min(8_000_000, width * height * fps * 0.07)));
}
