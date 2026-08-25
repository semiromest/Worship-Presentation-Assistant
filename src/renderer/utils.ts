import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { useEffect, useState, useRef } from 'react';
import type { Slide, WatermarkConfig, Position } from './types';
import { useWatermarkStore } from './state/useWatermarkStore';
import { parseCountdownContent, getCountdownRemaining } from './countdownUtils';
import { rendererPerf } from './perf';

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

// ─── Search normalization ─────────────────────────────────────────────────
// Lowercases, strips diacritics (İ→i, ü→u, …) and removes punctuation so a
// search like "isa egemensin" also matches a title like "İsa, Egemensin".
export function normalizeSearchText(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

// ─── Source-number matching ───────────────────────────────────────────────
// Matches hymn source codes like "TY527, RT38". Tolerant of case, diacritics,
// punctuation and stray whitespace, so "ty 527" also hits "TY527" (and "RT6"
// hits "RT6").
export function sourceTextMatches(source: string, query: string): boolean {
  const src = normalizeSearchText(source);
  const q = normalizeSearchText(query);
  if (!src || !q) return false;
  if (src.includes(q)) return true;
  // Allow whitespace differences for compact codes, e.g. "ty 527" vs "TY527".
  return src.replace(/\s+/g, '').includes(q.replace(/\s+/g, ''));
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

  // ── Faithful replica of the LIVE projector text rendering (LivePreview) ──
  // Live reference canvas is 1920×1080; every value is scaled from it exactly
  // like the on-screen renderer, so phone broadcasts match the projector.
  const outScale = ctx.getTransform().a; // output px per base px (1 or 4)

  // Background (color / image) — same as the live container.
  ctx.fillStyle = slide.styles?.backgroundColor || '#000000';
  ctx.fillRect(0, 0, W, H);
  if (slide.styles?.backgroundImage) {
    const bgImg = await loadImage(slide.styles.backgroundImage, { applyCors: true });
    if (bgImg) drawImageSafe(ctx, bgImg, 'cover', W, H);
  }

  const styles = (slide.styles ?? {}) as Record<string, any>;
  const displayContent =
    slide.partsMode && slide.parts?.length
      ? (slide.parts[slide.activePart ?? 0] ?? slide.content)
      : slide.content;
  if (!displayContent) return true;

  const ff =
    styles.fontFamily && styles.fontFamily !== 'inherit'
      ? styles.fontFamily.split(',')[0].trim()
      : 'sans-serif';
  const baseScale = W / 1920;
  const fontSize = Math.max(8 / outScale, (styles.fontSize || 48) * baseScale);
  const fontWeight = styles.fontWeight || 'bold';
  const fontStyle = styles.fontStyle || 'normal';
  const textAlign = styles.textAlign || 'center';
  const verticalAlign = styles.verticalAlign || 'center';
  const lineHeight = (styles.lineHeight ?? 1.3) * fontSize;
  const padding = 20 * baseScale;
  const textTransform = styles.textTransform || 'none';

  let text = displayContent;
  if (textTransform === 'uppercase') text = text.toUpperCase();
  else if (textTransform === 'lowercase') text = text.toLowerCase();

  ctx.font = `${fontStyle === 'italic' ? 'italic ' : ''}${fontWeight} ${fontSize}px ${ff}`;
  // Hymn/scripture slides use textColor: '' (inherits the app's light text on
  // the live screen) — an empty string is an invalid canvas fillStyle and is
  // silently ignored, leaving the previous (black) fill → invisible text.
  ctx.fillStyle = styles.textColor || '#ffffff';
  ctx.textBaseline = 'top';

  const maxWidth = W - padding * 2;
  const lines = wrapCanvasText(ctx, text, maxWidth);
  if (lines.length === 0) return true;

  const totalH = lines.length * lineHeight;
  let startY: number;
  if (verticalAlign === 'top') startY = padding;
  else if (verticalAlign === 'bottom') startY = H - padding - totalH;
  else startY = (H - totalH) / 2;

  if (textAlign === 'left') ctx.textAlign = 'left';
  else if (textAlign === 'right') ctx.textAlign = 'right';
  else ctx.textAlign = 'center';
  const x =
    textAlign === 'center' ? W / 2
    : textAlign === 'right' ? W - padding
    : padding;

  // Half-leading so each line sits like a CSS line box (baseline 'top').
  const leading = (lineHeight - fontSize) / 2;
  for (let i = 0; i < lines.length; i++) {
    const y = startY + i * lineHeight + leading;
    if (y + lineHeight < 0 || y > H) continue; // off-canvas, skip
    ctx.fillText(lines[i], x, y);
  }
  return true;
}

/** Word-wrap text onto lines (white-space: pre-wrap equivalent). */
function wrapCanvasText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    if (paragraph.trim().length === 0) {
      lines.push('');
      continue;
    }
    const words = paragraph.split(/\s+/).filter(Boolean);
    let current = '';
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (current && ctx.measureText(candidate).width > maxWidth) {
        lines.push(current);
        current = word;
      } else {
        current = candidate;
      }
    }
    if (current) lines.push(current);
  }
  return lines;
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
    // Live remaining time (counts down from startTime), so phone broadcasts
    // and thumbnails show the current value instead of the frozen initial one.
    const data = parseCountdownContent(slide.content);
    const left = Math.max(0, Math.round(getCountdownRemaining(data)));
    const mm = String(Math.floor(left / 60)).padStart(2, '0');
    const ss = String(left % 60).padStart(2, '0');
    const fs = Math.max(8, Math.min(40, (slide.styles?.fontSize ?? 120) * 0.32));
    ctx.fillStyle = slide.styles?.textColor || '#ffffff';
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

function renderCaptionsSlide(
  ctx: CanvasRenderingContext2D,
  slide: Slide,
  W: number,
  H: number,
): boolean {
  ctx.fillStyle = slide.styles?.backgroundColor ?? '#000000';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(147,197,253,0.18)';
  ctx.font = 'bold 16px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('🎤 Canlı Çeviri', W / 2, H / 2 - 8);
  ctx.font = '12px sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.fillText('Soniox gerçek zamanlı çeviri', W / 2, H / 2 + 18);
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

  const outScale = ctx.getTransform().a;
  const baseScale = W / 1920; // live reference is 1920×1080

  ctx.fillStyle = slide.styles?.backgroundColor || '#000000';
  ctx.fillRect(0, 0, W, H);

  let drewAny = false;
  const sorted = [...slide.items].sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0));
  for (const item of sorted) {
    const x = (item.x / 100) * W;
    const y = (item.y / 100) * H;
    const iw = (item.width / 100) * W;
    const ih = (item.height / 100) * H;

    ctx.save();
    if (item.rotation) {
      ctx.translate(x + iw / 2, y + ih / 2);
      ctx.rotate((item.rotation * Math.PI) / 180);
      ctx.translate(-(x + iw / 2), -(y + ih / 2));
    }

    // Border (live renderer: solid border, optional radius).
    if (item.borderWidth && item.borderWidth > 0) {
      ctx.beginPath();
      const r = (item.borderRadius ?? 0) * baseScale;
      if (r > 0) {
        ctx.roundRect(x, y, iw, ih, r);
      } else {
        ctx.rect(x, y, iw, ih);
      }
      ctx.strokeStyle = item.borderColor || '#ffffff';
      ctx.lineWidth = item.borderWidth * baseScale;
      ctx.stroke();
    }

    if (item.type === 'image' && item.mediaUrl) {
      const img = await loadImage(item.mediaUrl, { useFileUrl: true, applyCors: true });
      if (img) {
        const fit = item.imageStyles?.objectFit === 'cover' ? 'cover' : 'contain';
        ctx.beginPath();
        ctx.rect(x, y, iw, ih);
        ctx.clip();
        ctx.translate(x, y);
        drawImageSafe(ctx, img, fit, iw, ih);
        drewAny = true;
      }
    } else if (item.type === 'text' && item.content) {
      // Text item — mirror the live renderer (centered, wrapping, styled).
      const ts = (item.textStyles ?? {}) as Record<string, any>;
      const fontSize = Math.max(4 / outScale, (ts.fontSize || 32) * baseScale);
      const lineHeight = (ts.lineHeight ?? 1.25) * fontSize;
      const padding = 8 * baseScale;
      const align = ts.textAlign || 'center';
      const ff = ts.fontFamily ? ts.fontFamily.split(',')[0].trim() : 'sans-serif';

      let text = item.content;
      if (ts.textTransform === 'uppercase') text = text.toUpperCase();
      else if (ts.textTransform === 'lowercase') text = text.toLowerCase();

      ctx.font = `${ts.fontStyle === 'italic' ? 'italic ' : ''}${ts.fontWeight || 'normal'} ${fontSize}px ${ff}`;
      // Empty textColor (hymn/scripture default) inherits light text live.
      ctx.fillStyle = ts.textColor || '#ffffff';
      ctx.textBaseline = 'top';
      if (align === 'left') ctx.textAlign = 'left';
      else if (align === 'right') ctx.textAlign = 'right';
      else ctx.textAlign = 'center';

      const maxWidth = iw - padding * 2;
      const lines = wrapCanvasText(ctx, text, maxWidth);
      if (lines.length > 0) {
        const totalH = lines.length * lineHeight;
        const startY = y + (ih - totalH) / 2;
        const tx = align === 'center' ? x + iw / 2 : align === 'right' ? x + iw - padding : x + padding;
        const leading = (lineHeight - fontSize) / 2;

        if (ts.textShadow) {
          ctx.shadowColor = ts.textShadow.color || '#000000';
          ctx.shadowOffsetX = (ts.textShadow.offsetX || 0) * baseScale;
          ctx.shadowOffsetY = (ts.textShadow.offsetY || 0) * baseScale;
          ctx.shadowBlur = (ts.textShadow.blur || 0) * baseScale;
        }

        for (let i = 0; i < lines.length; i++) {
          const ly = startY + i * lineHeight + leading;
          if (ly + lineHeight < y || ly > y + ih) continue;
          if (ts.textStroke) {
            ctx.strokeStyle = ts.textStroke.color;
            ctx.lineWidth = (ts.textStroke.width || 0) * baseScale;
            ctx.strokeText(lines[i], tx, ly);
          }
          ctx.fillText(lines[i], tx, ly);
        }
        drewAny = true;
      }
    }
    ctx.restore();
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

async function generateSlideThumbnailInner(
  slide: Slide,
  opts?: { scale?: number; quality?: number },
): Promise<string | null> {
  // High-resolution output for phone broadcasts: draw everything in the base
  // 320×180 coordinate space and let ctx.scale upscale uniformly, so every
  // font/position stays proportionally correct at any size.
  const scale = Math.max(1, Math.round(opts?.scale ?? 1));
  const BASE_W = THUMB_W;
  const BASE_H = THUMB_H;
  const W = BASE_W * scale;
  const H = BASE_H * scale;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  if (scale > 1) ctx.scale(scale, scale);

  try {
    // Default background (text/image-empty slides)
    ctx.fillStyle = slide.styles?.backgroundColor || '#000000';
    ctx.fillRect(0, 0, BASE_W, BASE_H);

    let rendered = false;

    // Dispatch by type / structure (all draw in base 320×180 coords).
    // Item-based text slides (e.g. the QR slide: image + URL text) must route
    // to renderItemsSlide — renderTextSlide declines them by design.
    if (slide.type === 'text' && slide.items?.length) {
      rendered = await renderItemsSlide(ctx, slide, BASE_W, BASE_H);
    } else if (slide.type === 'text') {
      rendered = await renderTextSlide(ctx, slide, BASE_W, BASE_H);
    } else if (slide.type === 'image') {
      rendered = await renderImageSlide(ctx, slide, BASE_W, BASE_H);
    } else if (slide.type === 'video') {
      rendered = await renderVideoSlide(ctx, slide, BASE_W, BASE_H);
    } else if (slide.type === 'countdown') {
      rendered = renderCountdownSlide(ctx, slide, BASE_W, BASE_H);
    } else if (slide.type === 'screen') {
      rendered = renderScreenSlide(ctx, slide, BASE_W, BASE_H);
    } else if (slide.type === 'loop') {
      rendered = await renderLoopSlide(ctx, slide, BASE_W, BASE_H);
    } else if (slide.type === 'captions') {
      rendered = renderCaptionsSlide(ctx, slide, BASE_W, BASE_H);
    } else if (slide.items?.length) {
      rendered = await renderItemsSlide(ctx, slide, BASE_W, BASE_H);
    }

    if (!rendered) {
      ctx.fillStyle = PLACEHOLDER_BG;
      ctx.fillRect(0, 0, BASE_W, BASE_H);
      fillFallbackText(ctx, slide.content?.slice(0, 60) || slide.type);
    }
  } catch {
    // Render pipeline failed — fallback placeholder
    ctx.fillStyle = PLACEHOLDER_BG;
    ctx.fillRect(0, 0, BASE_W, BASE_H);
    fillFallbackText(ctx, slide.content?.slice(0, 40) || slide.type || 'Slayt', 'rgba(255,255,255,0.25)', 'bold 12px sans-serif');
  }

  try {
    if (typeof useWatermarkStore === 'function') {
      const wmConfig: WatermarkConfig = useWatermarkStore.getState().config;
      if (shouldRenderWatermark(slide, wmConfig)) {
        await drawWatermarkOnCanvas(ctx, wmConfig, BASE_W, BASE_H);
      }
    }
  } catch (err) {
    console.warn('generateSlideThumbnail watermark aşaması hatası:', err);
  }

  try {
    return canvas.toDataURL('image/jpeg', opts?.quality ?? 0.65);
  } catch (err) {
    console.error('generateSlideThumbnail: toDataURL failed (canvas tainted?):', err);
    return null;
  }
}

/** Phase 0: times thumbnail generation (dev-only, zero overhead in prod). */
export async function generateSlideThumbnail(
  slide: Slide,
  opts?: { scale?: number; quality?: number },
): Promise<string | null> {
  if (!rendererPerf.enabled) return generateSlideThumbnailInner(slide, opts);
  const t0 = performance.now();
  const result = await generateSlideThumbnailInner(slide, opts);
  rendererPerf.push({
    kind: 'thumbnail',
    label: slide.type,
    ms: performance.now() - t0,
    bytes: result ? result.length * 2 : 0,
    t: Date.now(),
  });
  return result;
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
      // Phase 6: imageData is a persistent media-library ref
      // (local-resource://media/<hash>.png) or a data URI fallback; either
      // stays intact through local save, autosave/presets, Drive and reopening.
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