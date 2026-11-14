/**
 * Image text translation (desktop): OCR the text baked into a picture, translate it, paint it out
 * and draw the translation back in the same place. Shared request/result types and language tables.
 */

/** Languages the feature offers. `ocr` is the Tesseract traineddata name. */
export const IMAGE_TRANSLATE_LANGUAGES = [
  { code: 'tr', ocr: 'tur' },
  { code: 'en', ocr: 'eng' },
  { code: 'de', ocr: 'deu' },
  { code: 'es', ocr: 'spa' },
  { code: 'fr', ocr: 'fra' },
  { code: 'pt', ocr: 'por' },
  { code: 'it', ocr: 'ita' },
  { code: 'ru', ocr: 'rus' },
  { code: 'ko', ocr: 'kor' },
  { code: 'ar', ocr: 'ara' },
] as const;

export type ImageTranslateLang = (typeof IMAGE_TRANSLATE_LANGUAGES)[number]['code'];

/** OCR languages used when the source is `auto`: the common Latin-script ones. */
export const AUTO_OCR_LANGS = ['eng', 'tur', 'deu', 'spa'] as const;

export function isImageTranslateLang(value: unknown): value is ImageTranslateLang {
  return IMAGE_TRANSLATE_LANGUAGES.some((lang) => lang.code === value);
}

/** Tesseract language list for a source language (`auto` → the Latin set). */
export function ocrLangsFor(source: ImageTranslateLang | 'auto'): string[] {
  if (source === 'auto') return [...AUTO_OCR_LANGS];
  const entry = IMAGE_TRANSLATE_LANGUAGES.find((lang) => lang.code === source);
  return entry ? [entry.ocr] : [...AUTO_OCR_LANGS];
}

export const TRANSLATABLE_IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.tif', '.tiff', '.avif'];

/**
 * True for images on this computer: library refs, other `local-resource://` URLs, `file://` URLs
 * picked in the editor and bare OS paths. Remote (http/data) images are not handled.
 * Renderer-safe (no node imports).
 */
export function isLocalImageSource(url: string | undefined): boolean {
  if (!url) return false;
  const local = url.startsWith('local-resource://') || url.startsWith('file://') || url.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(url);
  if (!local) return false;
  const clean = decodeURIComponentSafe(url.split(/[?#]/)[0]).toLowerCase();
  return url.startsWith('local-resource://media/') || TRANSLATABLE_IMAGE_EXTS.some((ext) => clean.endsWith(ext));
}

function decodeURIComponentSafe(value: string): string {
  try { return decodeURIComponent(value); } catch { return value; }
}

export interface ImageTranslateRequest {
  /** The image item's mediaUrl: library ref, local-resource:// or file:// URL, or OS path. */
  ref: string;
  source: ImageTranslateLang | 'auto';
  target: ImageTranslateLang;
  /** Only answer from stored results; never run OCR/translation. */
  cachedOnly?: boolean;
}

export interface ImageTranslateRegion {
  original: string;
  translated: string;
}

export type ImageTranslateResult =
  | { ok: true; ref: string; regions: ImageTranslateRegion[]; cached?: boolean }
  | { ok: false; reason: 'not-found' | 'no-text' | 'not-cached' | 'translate-failed' | 'failed'; message?: string };

/** File name of the stored-results index in userData (also read by the media storage cleaner). */
export const IMAGE_TRANSLATION_INDEX = 'image-translations.json';
