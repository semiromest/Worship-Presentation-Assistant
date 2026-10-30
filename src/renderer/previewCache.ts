import type { Slide } from './types';

export interface PreviewCacheEntry {
  url: string;
  slide: Slide;
  watermark: unknown;
  fontEpoch: number;
}
export interface PreviewSource { slides: readonly Slide[]; watermark: unknown; fontEpoch: number }
/** Throttling may lag behind the authoritative store. Recheck at publication,
 * not only when the throttled effect eventually cleans up. */
export function previewSourceGuard(snapshot: PreviewSource, readCurrent: () => PreviewSource): () => boolean {
  return () => {
    const current = readCurrent();
    const sameSlides = snapshot.slides === current.slides || (snapshot.slides.length === current.slides.length && snapshot.slides.every((slide, i) => slide === current.slides[i]));
    return sameSlides && snapshot.watermark === current.watermark && snapshot.fontEpoch === current.fontEpoch;
  };
}

function stylesEqual(a: Slide['styles'], b: Slide['styles']): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(key => (a as Record<string, unknown>)[key] === (b as Record<string, unknown>)[key]);
}

/** Compare against the snapshot that actually produced this URL, including
 * partially completed generations. Slides follow the store's immutable updates. */
export function previewCacheMatches(entry: PreviewCacheEntry | undefined, slide: Slide, watermark: unknown, fontEpoch: number): entry is PreviewCacheEntry {
  if (!entry || entry.watermark !== watermark || entry.fontEpoch !== fontEpoch) return false;
  if (entry.slide === slide) return true;
  const previous = entry.slide as unknown as Record<string, unknown>;
  const current = slide as unknown as Record<string, unknown>;
  const keys = Object.keys(previous);
  return keys.length === Object.keys(current).length && keys.every(key => key === 'styles'
    ? stylesEqual(entry.slide.styles, slide.styles)
    : previous[key] === current[key]);
}

/** A cancelled generation can add IDs absent from the last completed deck. */
export function prunePreviewCache(cache: Map<string, PreviewCacheEntry>, retries: Set<string>, currentIds: Set<string>): void {
  for (const id of cache.keys()) if (!currentIds.has(id)) cache.delete(id);
  for (const id of retries) if (!currentIds.has(id)) retries.delete(id);
}
