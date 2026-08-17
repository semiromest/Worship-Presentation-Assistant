import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { useEffect, useState, useRef } from 'react';
import type { Slide, WatermarkConfig, Position } from './types';
import { useWatermarkStore } from './state/useWatermarkStore';

// Precompiled regexes (compiled once, not per call)
const SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;
const WINDOWS_DRIVE_RE = /^[a-zA-Z]:[\\/]/;
const WINDOWS_DRIVE_ONLY_RE = /^[a-zA-Z]:$/;
const HTTP_RE = /^https?:\/\//i;
const LEADING_SLASHES_RE = /^\/+/;

// ─── Tailwind merge helper ────────────────────────────────────────────────
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

// ─── ID / path helpers ────────────────────────────────────────────────────
export function makeSlideId(): string {
  return Math.random().toString(36).substring(2, 11);
}

export function toFileUrl(filePath: string): string {
  const hasScheme = SCHEME_RE.test(filePath);
  const isWindowsDrivePath = WINDOWS_DRIVE_RE.test(filePath);
  if (hasScheme && !isWindowsDrivePath) return filePath;

  const cleanPath = filePath.replace(/\\/g, '/').replace(LEADING_SLASHES_RE, '/');
  const encodedPath = cleanPath
    .split('/')
    .map((seg, i) => (i === 0 && WINDOWS_DRIVE_ONLY_RE.test(seg) ? seg : encodeURIComponent(seg)))
    .join('/');
  return `file:///${encodedPath}`;
}

// ─── Image loading helpers (tek seferde CORS + Promise + error handling) ─
async function loadImage(
  src: string,
  opts: { useFileUrl?: boolean; applyCors?: boolean } = {},
): Promise<HTMLImageElement | null> {
  if (!src) return null;
  const img = new Image();
  if (opts.applyCors !== false && HTTP_RE.test(src)) {
    img.crossOrigin = 'anonymous';
  }
  img.src = opts.useFileUrl && !src.startsWith('data:') ? toFileUrl(src) : src;

  return new Promise((resolve) => {
    if (img.complete && img.naturalWidth > 0) {
      resolve(img);
      return;
    }
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
  });
}

// ─── Aspect ratio fit helpers ─────────────────────────────────────────────
interface FitRect { dx: number; dy: number; dw: number; dh: number }
interface CoverRect { sx: number; sy: number; sw: number; sh: number }

function calculateFit(imgW: number, imgH: number, canvasW: number, canvasH: number): FitRect {
  const imgAr = imgW / imgH;
  const cAr = canvasW / canvasH;
  if (imgAr > cAr) {
    const dh = canvasW / imgAr;
    return { dx: 0, dy: (canvasH - dh) / 2, dw: canvasW, dh };
  }
  const dw = canvasH * imgAr;
  return { dx: (canvasW - dw) / 2, dy: 0, dw, dh: canvasH };
}

function calculateCover(imgW: number, imgH: number, canvasW: number, canvasH: number): CoverRect {
  const imgAr = imgW / imgH;
  const cAr = canvasW / canvasH;
  if (imgAr > cAr) {
    const sw = imgH * cAr;
    return { sx: (imgW - sw) / 2, sy: 0, sw, sh: imgH };
  }
  const sh = imgW / cAr;
  return { sx: 0, sy: (imgH - sh) / 2, sw: imgW, sh };
}

function drawImageSafe(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  fit: 'contain' | 'cover',
  W: number,
  H: number,
): void {
  if (img.naturalWidth === 0 || img.naturalHeight === 0) return;
  const iw = img.naturalWidth;
  const ih = img.naturalHeight;
  if (fit === 'cover') {
    const { sx, sy, sw, sh } = calculateCover(iw, ih, W, H);
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, W, H);
  } else {
    const { dx, dy, dw, dh } = calculateFit(iw, ih, W, H);
    ctx.drawImage(img, dx, dy, dw, dh);
  }
}

// ─── React Hooks ──────────────────────────────────────────────────────────
export function useDebounce<T>(value: T, delay = 200): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

export function useThrottle<T>(value: T, limit = 200): T {
  const [throttled, setThrottled] = useState(value);
  const lastRaf = useRef(0);

  useEffect(() => {
    const elapsed = Date.now() - lastRaf.current;
    const wait = Math.max(0, limit - elapsed);
    const id = setTimeout(() => {
      setThrottled(value);
      lastRaf.current = Date.now();
    }, wait);
    return () => clearTimeout(id);
  }, [value, limit]);

  return throttled;
}

// ─── Slide thumbnail renderer ─────────────────────────────────────────────
const THUMB_W = 320;
const THUMB_H = 180;
const PLACEHOLDER_BG = '#1a1a2e';
const EMPTY_BG = '#111111';

function fillFallbackText(
  ctx: CanvasRenderingContext2D,
  text: string,
  color = 'rgba(255,255,255,0.45)',
  font = 'bold 14px sans-serif',
  W = THUMB_W,
  H = THUMB_H,
): void {
  ctx.fillStyle = color;
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, W / 2, H / 2, W - 24);
}

async function renderTextSlide(
  ctx: CanvasRenderingContext2D,
  slide: Slide,
  W: number,
  H: number,
): Promise<boolean> {
  if (slide.items?.length) return false; // item-based text slides handled in another branch

  if (slide.styles?.backgroundImage) {
    const bgImg = await loadImage(slide.styles.backgroundImage, { applyCors: true });
    if (bgImg) drawImageSafe(ctx, bgImg, 'cover', W, H);
  }

  const ff =
    slide.styles?.fontFamily && slide.styles.fontFamily !== 'inherit'
      ? slide.styles.fontFamily.split(',')[0].trim()
      : 'sans-serif';

  ctx.fillStyle = slide.styles?.textColor || '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const displayContent =
    slide.partsMode && slide.parts?.length
      ? (slide.parts[slide.activePart ?? 0] ?? slide.content)
      : slide.content;

  const FIXED_FS = 11;
  const MAX_LINES = 3;
  const PADDING_H = 20;
  const usableW = W - PADDING_H * 2;
  const LH = FIXED_FS * 1.45;

  const allLines = (displayContent || '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (allLines.length === 0) return true;

  const hasMore = allLines.length > MAX_LINES;
  const visLines = allLines.slice(0, MAX_LINES);
  if (hasMore) {
    const last = visLines[visLines.length - 1];
    visLines[visLines.length - 1] = last.replace(/\s+\S+$/, '') + '\u2026';
  }

  const totalH = visLines.length * LH;
  const startY = H / 2 - totalH / 2 + LH / 2;
  ctx.font = `bold ${FIXED_FS}px ${ff}`;
  visLines.forEach((line, i) => {
    ctx.fillText(line, W / 2, startY + i * LH, usableW);
  });
  return true;
}

async function renderImageSlide(
  ctx: CanvasRenderingContext2D,
  slide: Slide,
  W: number,
  H: number,
): Promise<boolean> {
  const sources = [slide.thumbnailUrl, slide.mediaUrl].filter(Boolean) as string[];
  for (const src of sources) {
    const img = await loadImage(src, { useFileUrl: true, applyCors: true });
    if (!img) continue;
    const fit = slide.styles?.objectFit === 'cover' ? 'cover' : 'contain';
    drawImageSafe(ctx, img, fit, W, H);
    return true;
  }
  ctx.fillStyle = EMPTY_BG;
  ctx.fillRect(0, 0, W, H);
  fillFallbackText(ctx, slide.content?.slice(0, 40) || '🖼 Görsel');
  return true;
}

async function renderVideoSlide(
  ctx: CanvasRenderingContext2D,
  slide: Slide,
  W: number,
  H: number,
): Promise<boolean> {
  if (slide.thumbnailUrl) {
    const img = await loadImage(slide.thumbnailUrl, { applyCors: true });
    if (img) {
      drawImageSafe(ctx, img, 'contain', W, H);
      return true;
    }
  }
  ctx.fillStyle = EMPTY_BG;
  ctx.fillRect(0, 0, W, H);
  fillFallbackText(ctx, slide.content?.slice(0, 40) || '▶ Video', 'rgba(255,255,255,0.25)', '18px sans-serif');
  return true;
}

function renderCountdownSlide(
  ctx: CanvasRenderingContext2D,
  slide: Slide,
  W: number,
  H: number,
): boolean {
  try {
    const data = JSON.parse(slide.content);
    const mm = String(data.minutes || 0).padStart(2, '0');
    const ss = String(data.seconds || 0).padStart(2, '0');
    const fs = Math.max(8, Math.min(40, (slide.styles?.fontSize ?? 120) * 0.32));
    ctx.fillStyle = slide.styles?.textColor ?? '#ffffff';
    ctx.font = `bold ${fs}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${mm}:${ss}`, W / 2, H / 2);
  } catch {
    fillFallbackText(ctx, 'Geri Sayım', slide.styles?.textColor ?? '#ffffff', 'bold 20px sans-serif');
  }
  return true;
}

function renderScreenSlide(
  ctx: CanvasRenderingContext2D,
  slide: Slide,
  W: number,
  H: number,
): boolean {
  ctx.fillStyle = PLACEHOLDER_BG;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(59,130,246,0.15)';
  ctx.font = 'bold 14px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('🖥️ Ekran Yakalama', W / 2, H / 2 - 10);
  ctx.font = '12px sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.fillText(slide.content || 'Canlı Ekran', W / 2, H / 2 + 15);
  return true;
}

async function renderLoopSlide(
  ctx: CanvasRenderingContext2D,
  slide: Slide,
  W: number,
  H: number,
): Promise<boolean> {
  const first = slide.loopItems?.[0];
  if (first?.type === 'image' && first.mediaUrl) {
    const img = await loadImage(first.mediaUrl, { useFileUrl: true, applyCors: true });
    if (img) {
      drawImageSafe(ctx, img, 'contain', W, H);
      return true;
    }
  }
  ctx.fillStyle = EMPTY_BG;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(168,85,247,0.2)';
  ctx.font = 'bold 14px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('🔄 Loop', W / 2, H / 2 - 8);
  ctx.font = '11px sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.fillText(`${slide.loopItems?.length ?? 0} öğe`, W / 2, H / 2 + 10);
  return true;
}

async function renderItemsSlide(
  ctx: CanvasRenderingContext2D,
  slide: Slide,
  W: number,
  H: number,
): Promise<boolean> {
  if (!slide.items?.length) return false;

  ctx.fillStyle = slide.styles?.backgroundColor ?? '#000000';
  ctx.fillRect(0, 0, W, H);

  let drewAny = false;
  for (const item of slide.items) {
    if (item.type !== 'image' || !item.mediaUrl) continue;
    const img = await loadImage(item.mediaUrl, { useFileUrl: true, applyCors: true });
    if (!img) continue;
    const x = (item.x / 100) * W;
    const y = (item.y / 100) * H;
    const iw = (item.width / 100) * W;
    const ih = (item.height / 100) * H;
    ctx.drawImage(img, x, y, iw, ih);
    drewAny = true;
  }

  if (!drewAny) {
    fillFallbackText(ctx, slide.content?.slice(0, 40) || 'Düzen Slaytı', 'rgba(255,255,255,0.45)', 'bold 11px sans-serif');
  }
  return true;
}

export function isHymnSlide(slide: Slide): boolean {
  return slide.type === 'text' && slide.partsMode === true;
}

export function isScriptureSlide(slide: Slide): boolean {
  return !!slide.group;
}

export function isTargetSlide(slide: Slide | undefined): boolean {
  if (!slide) return false;
  return isHymnSlide(slide) || isScriptureSlide(slide);
}

export function shouldRenderWatermark(
  slide: Slide,
  config: WatermarkConfig,
): boolean {
  if (!config.enabled) return false;
  if (!config.logoDataUrl) return false;

  const appliesToHymn = config.applyToHymns && isHymnSlide(slide);
  const appliesToScripture = config.applyToScriptures && isScriptureSlide(slide);

  return appliesToHymn || appliesToScripture;
}

function getWatermarkCanvasPosition(
  position: Position,
  W: number,
  H: number,
  logoW: number,
  logoH: number,
  margin: number,
): { x: number; y: number } {
  switch (position) {
    case 'top-left':
      return { x: margin, y: margin };
    case 'top-center':
      return { x: (W - logoW) / 2, y: margin };
    case 'top-right':
      return { x: W - logoW - margin, y: margin };
    case 'bottom-left':
      return { x: margin, y: H - logoH - margin };
    case 'bottom-center':
      return { x: (W - logoW) / 2, y: H - logoH - margin };
    case 'bottom-right':
    default:
      return { x: W - logoW - margin, y: H - logoH - margin };
  }
}

async function drawWatermarkOnCanvas(
  ctx: CanvasRenderingContext2D,
  config: WatermarkConfig,
  W: number,
  H: number,
): Promise<void> {
  if (!config.logoDataUrl) return;
  try {
    const img = new Image();
    img.src = config.logoDataUrl;
    await new Promise<void>((resolve, reject) => {
      if (img.complete && img.naturalWidth > 0) resolve();
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('logo load'));
    });

    const logoW = Math.max(1, Math.round((W * config.size) / 100));
    const ratio = img.naturalWidth > 0 ? img.naturalHeight / img.naturalWidth : 1;
    const logoH = Math.max(1, Math.round(logoW * ratio));
    const margin = Math.max(1, Math.round(W * 0.02));
    const { x, y } = getWatermarkCanvasPosition(config.position, W, H, logoW, logoH, margin);

    ctx.save();
    ctx.globalAlpha = Math.min(1, Math.max(0, config.opacity / 100));
    ctx.drawImage(img, x, y, logoW, logoH);
    ctx.restore();
  } catch (err) {
    console.warn('Thumbnail watermark çizilemedi, logosuz devam ediliyor:', err);
  }
}

export async function generateSlideThumbnail(slide: Slide): Promise<string | null> {
  const W = THUMB_W;
  const H = THUMB_H;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  try {
    // Default background (text/image-empty slides)
    ctx.fillStyle = slide.styles?.backgroundColor || '#000000';
    ctx.fillRect(0, 0, W, H);

    let rendered = false;

    // Dispatch by type / structure
    if (slide.type === 'text') {
      rendered = await renderTextSlide(ctx, slide, W, H);
    } else if (slide.type === 'image') {
      rendered = await renderImageSlide(ctx, slide, W, H);
    } else if (slide.type === 'video') {
      rendered = await renderVideoSlide(ctx, slide, W, H);
    } else if (slide.type === 'countdown') {
      rendered = renderCountdownSlide(ctx, slide, W, H);
    } else if (slide.type === 'screen') {
      rendered = renderScreenSlide(ctx, slide, W, H);
    } else if (slide.type === 'loop') {
      rendered = await renderLoopSlide(ctx, slide, W, H);
    } else if (slide.items?.length) {
      rendered = await renderItemsSlide(ctx, slide, W, H);
    }

    if (!rendered) {
      ctx.fillStyle = PLACEHOLDER_BG;
      ctx.fillRect(0, 0, W, H);
      fillFallbackText(ctx, slide.content?.slice(0, 60) || slide.type);
    }
  } catch {
    // Render pipeline failed — fallback placeholder
    ctx.fillStyle = PLACEHOLDER_BG;
    ctx.fillRect(0, 0, W, H);
    fillFallbackText(ctx, slide.content?.slice(0, 40) || slide.type || 'Slayt', 'rgba(255,255,255,0.25)', 'bold 12px sans-serif');
  }

  try {
    if (typeof useWatermarkStore === 'function') {
      const wmConfig: WatermarkConfig = useWatermarkStore.getState().config;
      if (shouldRenderWatermark(slide, wmConfig)) {
        await drawWatermarkOnCanvas(ctx, wmConfig, W, H);
      }
    }
  } catch (err) {
    console.warn('generateSlideThumbnail watermark aşaması hatası:', err);
  }

  try {
    return canvas.toDataURL('image/jpeg', 0.65);
  } catch (err) {
    console.error('generateSlideThumbnail: toDataURL failed (canvas tainted?):', err);
    return null;
  }
}

// ─── PPTX Import Helpers ──────────────────────────────────────────────────
export interface PptxSlideResult {
  slideNumber: number;
  /** Base64 data URI of the rendered slide (self-contained, survives saves). */
  imageData: string;
  width: number;
  height: number;
  format: 'png';
}

export interface PptxImportResult {
  success: boolean;
  slides?: PptxSlideResult[];
  error?: string;
  presentationName: string;
}

export function convertPptxToSlides(
  pptxResult: PptxImportResult,
  makeId: () => string = makeSlideId,
): Slide[] {
  if (!pptxResult.success || !pptxResult.slides?.length) return [];

  // toSorted() avoids mutating the input (ES2023)
  return pptxResult.slides
    .toSorted((a, b) => a.slideNumber - b.slideNumber)
    .map((pptx): Slide => ({
      id: makeId(),
      type: 'image',
      content: `Slayt ${pptx.slideNumber}`,
      // Data URI (not a temp-file path): stays intact through local save,
      // autosave/presets, Drive and reopening.
      mediaUrl: pptx.imageData,
      thumbnailUrl: pptx.imageData,
      styles: {
        fontSize: 48,
        backgroundColor: '#000000',
        textColor: '#ffffff',
        objectFit: 'contain',
      },
    }));
}