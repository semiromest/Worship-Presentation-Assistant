import { createPosterQueue } from './components/mediaPosterQueue';
import { resolveCanvasSource, toOsPath } from './canvasSource';
import type { Slide, SlideItem } from './types';
import { imagePreviewConcurrency } from './scrollPreviewPolicy';

/** A few stable sizes avoid a new disk/cache entry for every resize pixel. */
export function imagePreviewEdge(width: number, pixelRatio = 1): number {
  const pixels = Math.max(1, Number.isFinite(width) ? width : 320) * Math.min(2, Math.max(1, pixelRatio || 1));
  return [256, 512, 1024, 2048].find(edge => edge >= pixels) ?? 2048;
}

export function isLocalPreviewSource(source: string): boolean {
  return source.startsWith('local-resource://') || toOsPath(source) !== null;
}

/** Cache holds small file references, never decoded originals or base64 images.
 * Expiry rechecks source stat in main on remount after an external file edit. */
export function createImagePreviewSource(load: (source: string, edge: number) => Promise<string | null>) {
  const queue = createPosterQueue(async key => {
    const [source, edge] = JSON.parse(key) as [string, number];
    return load(source, edge);
  }, imagePreviewConcurrency, { maxEntries: 256, maxBytes: 512 * 1024, maxWaiting: 128, successTtlMs: 60_000, failureTtlMs: 5_000 });
  const key = (source: string, edge: number) => JSON.stringify([source, edge]);
  return {
    peek: (source: string, edge: number) => queue.peek(key(source, edge)),
    request: (source: string, edge: number, eligible: () => boolean = () => true, priority = 0) => queue.request(key(source, edge), eligible, priority),
    snapshot: queue.snapshot,
    subscribe: queue.subscribe,
  };
}

export const imagePreviewSources = createImagePreviewSource((source, edge) => window.electronAPI.getMediaThumbnail(source, edge));

export function canResizePreview(source: string): boolean {
  return !source.startsWith('local-resource://thumbs/') && typeof window !== 'undefined' && !!window.electronAPI?.getMediaThumbnail && isLocalPreviewSource(source);
}

export async function previewImageSource(source: string | undefined, edge: number, eligible?: () => boolean): Promise<string | undefined> {
  if (!source) return undefined;
  if (!canResizePreview(source)) return resolveCanvasSource(source, false).url;
  while (!eligible || eligible()) {
    const value = await imagePreviewSources.request(source, edge, eligible, 1);
    if (value || imagePreviewSources.peek(source, edge) !== undefined) return value ?? undefined;
    if (eligible && !eligible()) return undefined;
    // Admission pressure is temporary, unlike a cached decoder/file failure.
    await new Promise<void>(resolve => {
      const off = imagePreviewSources.subscribe(() => { off(); resolve(); });
      if (imagePreviewSources.snapshot().waiting < 128) { off(); resolve(); }
    });
  }
  return undefined;
}

/** Ephemeral render input only: original media references in the document are
 * never replaced. A failed thumbnail does not fan out into full-size decodes. */
export async function preparePreviewImages(slide: Slide, edge: number, eligible?: () => boolean): Promise<Slide> {
  const image = (source?: string) => previewImageSource(source, edge, eligible);
  const item = async (entry: SlideItem): Promise<SlideItem> => ({ ...entry,
    ...(entry.type === 'image' ? { mediaUrl: await image(entry.mediaUrl) } : {}),
    ...(entry.groupItems ? { groupItems: await Promise.all(entry.groupItems.map(item)) } : {}),
  });
  return { ...slide,
    ...(slide.type === 'image' ? { mediaUrl: await image(slide.mediaUrl), thumbnailUrl: await image(slide.thumbnailUrl) } : {}),
    ...(slide.styles?.backgroundImage ? { styles: { ...slide.styles, backgroundImage: await image(slide.styles.backgroundImage) } } : {}),
    ...(slide.items ? { items: await Promise.all(slide.items.map(item)) } : {}),
    ...(slide.loopItems ? { loopItems: await Promise.all(slide.loopItems.map(async entry => entry.type === 'image' ? { ...entry, mediaUrl: (await image(entry.mediaUrl)) ?? '' } : entry)) } : {}),
  };
}
