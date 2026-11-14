/**
 * Pictures a slide shows (image slides, image items, background images) — the inputs of image
 * text translation for the bulk tool and the phone broadcast. Pure: unit-tested with tsx.
 */
import type { Slide } from './types';
import { isImageTranslateLang, isLocalImageSource, type ImageTranslateLang } from '../shared/imageTranslate';

export interface SlideImage {
  url: string;
  /** Rough share of the slide it covers (0–1): the biggest picture is shown first on phones. */
  area: number;
}

/** Local pictures on a slide, largest first, without duplicates. */
export function collectSlideImages(slide: Slide | undefined | null): SlideImage[] {
  if (!slide) return [];
  const found = new Map<string, number>();
  const add = (url: string | undefined, area: number) => {
    if (!url || !isLocalImageSource(url)) return;
    found.set(url, Math.max(found.get(url) ?? 0, area));
  };
  if (slide.type === 'image') add(slide.mediaUrl, 1);
  add(slide.styles?.backgroundImage, 1);
  for (const item of slide.items ?? []) {
    if (item.type !== 'image' || item.visible === false) continue;
    add(item.mediaUrl, Math.max(0, Math.min(1, (item.width * item.height) / 10000)));
  }
  return [...found].map(([url, area]) => ({ url, area })).sort((a, b) => b.area - a.area);
}

/** A copy of the slide with pictures swapped (`from` url → translated ref); untouched otherwise. */
export function withReplacedImages(slide: Slide, replacements: ReadonlyMap<string, string>): Slide {
  const swap = (url: string | undefined) => (url && replacements.get(url)) || url;
  return {
    ...slide,
    mediaUrl: slide.type === 'image' ? swap(slide.mediaUrl) : slide.mediaUrl,
    styles: slide.styles?.backgroundImage ? { ...slide.styles, backgroundImage: swap(slide.styles.backgroundImage) } : slide.styles,
    items: slide.items?.map((item) => (item.type === 'image' && item.mediaUrl && replacements.has(item.mediaUrl) ? { ...item, mediaUrl: swap(item.mediaUrl) } : item)),
  };
}

/** Phone languages that image translation supports (the STT target list, or the single target). */
export function phoneImageLanguages(targetLanguages: string[], targetLanguage: string): ImageTranslateLang[] {
  const list = targetLanguages.length ? targetLanguages : [targetLanguage];
  return [...new Set(list.filter(isImageTranslateLang))];
}

/** Phone pictures in slide order, only those with at least one translated copy. */
export function translatedPhoneImages(urls: string[], found: ReadonlyMap<string, Record<string, string>>): { original: string; translations: Record<string, string> }[] {
  return urls
    .filter((url) => Object.keys(found.get(url) ?? {}).length > 0)
    .map((url) => ({ original: url, translations: { ...found.get(url) } }));
}
