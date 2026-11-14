import type { Slide } from './types';
import { getActivePartIndex, getSlideDisplayContent } from '../shared/slideContent';

/**
 * What the NDI Lyrics output shows for a live slide.
 *
 * - Text slides: their text (the active part for hymn-part slides).
 * - Designed slides (text/image with positioned items): visible text items, back to front.
 * - Everything else (image, video, countdown, screen, loop, captions) and empty text: nothing, so
 *   the key layer is fully transparent and the camera stays clean.
 */
export function lyricsText(slide: Slide | undefined): string {
  if (!slide) return '';
  if ((slide.type === 'text' || slide.type === 'image') && slide.items?.length) {
    return slide.items
      .filter((item) => item.type === 'text' && item.visible !== false && typeof item.content === 'string')
      .sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0))
      .map((item) => String(item.content).trim())
      .filter(Boolean)
      .join('\n');
  }
  if (slide.type !== 'text') return '';
  return (getSlideDisplayContent(slide) ?? '').trim();
}

/** Changes whenever the visible lines change, so the layer cross-fades between them. */
export function lyricsKey(slide: Slide | undefined): string {
  if (!slide) return '';
  return slide.partsMode ? `${slide.id}:${getActivePartIndex(slide)}` : slide.id;
}

/** Font size (px at 1920 wide) that keeps long verses inside the lower third. */
export function lyricsFontSize(text: string): number {
  const lines = text.split('\n').length;
  const longest = text.split('\n').reduce((max, line) => Math.max(max, line.length), 0);
  let size = lines <= 2 ? 64 : lines <= 3 ? 54 : lines <= 4 ? 46 : 38;
  // Very long lines wrap; shrink so they still fit roughly two wrapped rows.
  if (longest > 48) size = Math.min(size, Math.max(34, Math.round(size * 48 / longest)));
  return size;
}
