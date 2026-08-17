/**
 * PPTX export service: converts an in-app Presentation (text / image / editor
 * slides) into a real .pptx file using PptxGenJS. Runs in the Electron main
 * process so the renderer stays responsive and dialogs/file I/O stay native.
 *
 * Faithfulness notes (known limitations):
 *  - Gradients (slide background, item fills) are exported as a solid color.
 *  - CSS image filters (brightness, contrast, blur, grayscale, sepia) and
 *    text strokes are not representable in PPTX and are skipped.
 *  - Video / screen-capture / loop slides are dynamic in the app; they are
 *    exported as a static frame (thumbnail, first loop item, or placeholder).
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath as nodeFileURLToPath } from 'node:url';
import PptxGenJS from 'pptxgenjs';
import type { Presentation, Slide, SlideItem } from '../renderer/types';

// ─── Geometry ──────────────────────────────────────────────────────────────

/** 16:9 slide size in inches (matches PptxGenJS LAYOUT_16x9). */
const SLIDE_W = 10;
const SLIDE_H = 5.625;
/** Renderer reference canvas width (see src/renderer/constants.ts). */
const REF_W = 1920;
/** 1 renderer px → inches on the slide. */
const PX_TO_IN = SLIDE_W / REF_W;
/** 1 renderer px → points (font sizes, borders, shadows). */
const PX_TO_PT = PX_TO_IN * 72;
/** Default text padding inside editor items (8px in the app). */
const ITEM_PAD = 8 * PX_TO_IN;

const MIME_BY_EXT: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.png': 'image/png', '.gif': 'image/gif',
  '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp', '.avif': 'image/avif',
  '.tif': 'image/tiff', '.tiff': 'image/tiff',
};

// ─── Types ─────────────────────────────────────────────────────────────────

export interface PptxExportOk {
  success: true;
  filePath: string;
  slideCount: number;
  warnings: string[];
}

export interface PptxExportFail {
  success: false;
  error: string;
}

export type PptxExportResult = PptxExportOk | PptxExportFail;
export type ExportProgressCallback = (current: number, total: number) => void;

// ─── Small helpers ─────────────────────────────────────────────────────────

function localResourceUrlToPath(url: string): string {
  return nodeFileURLToPath(url.replace(/^local-resource:\/\//, 'file://'));
}

/** '#abc' → 'AABBCC', drops alpha channel, invalid → undefined. */
function normalizeColor(color?: string): string | undefined {
  if (!color) return undefined;
  let hex = color.trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{8}$/.test(hex)) hex = hex.slice(0, 6);
  if (/^[0-9a-fA-F]{3}$/.test(hex)) hex = hex.split('').map((c) => c + c).join('');
  return /^[0-9a-fA-F]{6}$/.test(hex) ? hex : undefined;
}

function mapVAlign(verticalAlign?: string): 'top' | 'middle' | 'bottom' {
  if (verticalAlign === 'top') return 'top';
  if (verticalAlign === 'bottom') return 'bottom';
  return 'middle';
}

function transformText(text: string, transform?: string): string {
  if (!text) return text;
  if (transform === 'uppercase') return text.toUpperCase();
  if (transform === 'lowercase') return text.toLowerCase();
  return text;
}

/**
 * Resolves a media reference (local-resource://, file://, http(s)://, data:,
 * or a plain path) to a base64 data URI so PptxGenJS can embed it.
 */
async function resolveImageData(url?: string): Promise<string | null> {
  if (!url) return null;
  try {
    if (url.startsWith('data:')) return url;
    if (url.startsWith('http://') || url.startsWith('https://')) {
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      const mime = (res.headers.get('content-type') ?? 'image/png').split(';')[0];
      return `data:${mime};base64,${buf.toString('base64')}`;
    }
    const filePath = url.startsWith('local-resource://')
      ? localResourceUrlToPath(url)
      : url.startsWith('file://')
        ? nodeFileURLToPath(url)
        : url;
    const buf = await fs.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    return `data:${MIME_BY_EXT[ext] ?? 'image/png'};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

/** addImage that degrades gracefully (missing dims, unsupported formats). */
function safeAddImage(
  pptxSlide: PptxGenJS.Slide,
  opts: PptxGenJS.ImageProps,
  label: string,
  warnings: string[],
): void {
  try {
    pptxSlide.addImage(opts);
  } catch {
    const rest = { ...opts } as PptxGenJS.ImageProps & { sizing?: unknown };
    delete rest.sizing;
    try {
      pptxSlide.addImage(rest as PptxGenJS.ImageProps);
    } catch {
      warnings.push(`${label}: image could not be embedded`);
    }
  }
}

// ─── Slide background ──────────────────────────────────────────────────────

async function applyBackground(
  pptxSlide: PptxGenJS.Slide,
  slide: Slide,
  warnings: string[],
): Promise<void> {
  const styles = (slide.styles ?? {}) as Record<string, any>;
  let bgImageAdded = false;

  if (styles.backgroundColor) {
    pptxSlide.background = { color: normalizeColor(styles.backgroundColor) ?? '000000' };
  }

  const gradient = styles.backgroundGradient as
    | { type?: string; angle?: number; stops?: Array<{ color: string; position: number }> }
    | undefined;
  if (gradient) {
    const stops = Array.isArray(gradient.stops) ? gradient.stops : [];
    if (gradient.type === 'radial' || stops.length === 0) {
      warnings.push('slide: radial gradients are exported as a solid color');
      if (stops.length > 0) {
        pptxSlide.background = { color: normalizeColor(stops[0].color) ?? '000000' };
      }
    } else {
      warnings.push('slide: gradients are exported as a solid color');
      pptxSlide.background = { color: normalizeColor(stops[0].color) ?? '000000' };
    }
  }

  if (styles.backgroundImage) {
    const data = await resolveImageData(styles.backgroundImage);
    if (data) {
      safeAddImage(
        pptxSlide,
        { data, x: 0, y: 0, w: SLIDE_W, h: SLIDE_H, sizing: { type: 'cover', w: SLIDE_W, h: SLIDE_H } },
        'Background image',
        warnings,
      );
      bgImageAdded = true;
    } else {
      warnings.push('slide: background image could not be loaded');
    }
  }

  if (styles.backgroundVideo) {
    warnings.push('slide: background video is not exported');
  }
  if (styles.backgroundBlur && Number(styles.backgroundBlur) > 0) {
    warnings.push('slide: background blur is not exported');
  }
  void bgImageAdded;
}

// ─── Slide renderers ───────────────────────────────────────────────────────

function addTextSlide(pptxSlide: PptxGenJS.Slide, slide: Slide): void {
  const styles = (slide.styles ?? {}) as Record<string, any>;
  const fontSize = Number(styles.fontSize) || 48;
  const text = transformText(String(slide.content ?? '').trim(), styles.textTransform);

  pptxSlide.addText(text || ' ', {
    x: 0,
    y: 0,
    w: SLIDE_W,
    h: SLIDE_H,
    align: styles.textAlign || 'center',
    valign: mapVAlign(styles.verticalAlign || 'center'),
    fontSize: fontSize * PX_TO_PT,
    bold: (styles.fontWeight || 'bold') === 'bold',
    italic: styles.fontStyle === 'italic',
    fontFace: styles.fontFamily || undefined,
    color: normalizeColor(styles.textColor) ?? 'FFFFFF',
    lineSpacing: fontSize * PX_TO_PT * (Number(styles.lineHeight) || 1.3),
    charSpacing: styles.letterSpacing != null ? Number(styles.letterSpacing) * PX_TO_PT : undefined,
    underline: styles.textDecoration === 'underline' ? { style: 'sng' } : undefined,
    strike: styles.textDecoration === 'line-through',
    fit: 'shrink',
  });
}

async function addImageSlide(
  pptxSlide: PptxGenJS.Slide,
  slide: Slide,
  warnings: string[],
): Promise<void> {
  const styles = (slide.styles ?? {}) as Record<string, any>;
  const data = await resolveImageData(slide.mediaUrl);
  if (!data) {
    warnings.push('image slide: image could not be loaded');
    return;
  }

  const fit = styles.objectFit;
  const sizing =
    fit === 'cover'
      ? { type: 'cover' as const, w: SLIDE_W, h: SLIDE_H }
      : fit === 'contain'
        ? { type: 'contain' as const, w: SLIDE_W, h: SLIDE_H }
        : undefined;

  safeAddImage(
    pptxSlide,
    {
      data,
      x: 0,
      y: 0,
      w: SLIDE_W,
      h: SLIDE_H,
      sizing,
      transparency: styles.opacity != null ? Math.round((1 - Number(styles.opacity)) * 100) : undefined,
      flipH: !!styles.imageFlipX,
      flipV: !!styles.imageFlipY,
    },
    'Image slide',
    warnings,
  );

  const filtered =
    (styles.imageBrightness != null && styles.imageBrightness !== 1) ||
    (styles.imageContrast != null && styles.imageContrast !== 1) ||
    Number(styles.imageBlur) > 0 ||
    Number(styles.imageGrayscale) > 0 ||
    Number(styles.imageSepia) > 0;
  if (filtered) warnings.push('image slide: brightness/contrast/blur filters are not exported');
}

async function addVideoSlide(
  pptxSlide: PptxGenJS.Slide,
  slide: Slide,
  warnings: string[],
): Promise<void> {
  warnings.push('video slide: exported as a static frame');
  const data = await resolveImageData(slide.thumbnailUrl ?? slide.mediaUrl);
  if (data) {
    safeAddImage(
      pptxSlide,
      {
        data,
        x: 0,
        y: 0,
        w: SLIDE_W,
        h: SLIDE_H,
        sizing: { type: 'contain', w: SLIDE_W, h: SLIDE_H },
      },
      'Video frame',
      warnings,
    );
  } else {
    pptxSlide.addText('Video', {
      x: 0, y: 0, w: SLIDE_W, h: SLIDE_H,
      align: 'center', valign: 'middle', color: '888888', fontSize: 18,
    });
  }
}

function addCountdownSlide(pptxSlide: PptxGenJS.Slide, slide: Slide): void {
  const styles = (slide.styles ?? {}) as Record<string, any>;
  let minutes = 0;
  let seconds = 0;
  try {
    const data = JSON.parse(slide.content || '{}') as { minutes?: number; seconds?: number };
    minutes = data.minutes ?? 0;
    seconds = data.seconds ?? 0;
  } catch {
    /* malformed content, show 00:00 */
  }
  const time = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

  pptxSlide.addText(time, {
    x: 0,
    y: 0,
    w: SLIDE_W,
    h: SLIDE_H,
    align: 'center',
    valign: 'middle',
    fontSize: (Number(styles.fontSize) || 120) * PX_TO_PT,
    bold: true,
    fontFace: 'Consolas',
    color: normalizeColor(styles.textColor) ?? 'FFFFFF',
  });
}

function addScreenSlide(pptxSlide: PptxGenJS.Slide, slide: Slide, warnings: string[]): void {
  warnings.push('screen capture slide: exported as a placeholder');
  pptxSlide.addText(slide.content || 'Screen Capture', {
    x: 0.5,
    y: 0,
    w: SLIDE_W - 1,
    h: SLIDE_H,
    align: 'center',
    valign: 'middle',
    color: '888888',
    fontSize: 18,
  });
}

async function addLoopSlide(
  pptxSlide: PptxGenJS.Slide,
  slide: Slide,
  warnings: string[],
): Promise<void> {
  const items = slide.loopItems ?? [];
  if (items.length === 0) {
    pptxSlide.addText('Loop', {
      x: 0, y: 0, w: SLIDE_W, h: SLIDE_H,
      align: 'center', valign: 'middle', color: '888888', fontSize: 18,
    });
    return;
  }
  if (items.length > 1) warnings.push('loop slide: animated; only the first item was exported');

  const first = items[0];
  if (first.type === 'image') {
    const data = await resolveImageData(first.mediaUrl);
    if (data) {
      safeAddImage(
        pptxSlide,
        {
          data,
          x: 0,
          y: 0,
          w: SLIDE_W,
          h: SLIDE_H,
          sizing: { type: 'cover', w: SLIDE_W, h: SLIDE_H },
        },
        'Loop item',
        warnings,
      );
    } else {
      warnings.push('loop slide: first image could not be loaded');
    }
  } else {
    warnings.push('loop slide: video items are exported as a static placeholder');
    pptxSlide.addText('Loop Video', {
      x: 0, y: 0, w: SLIDE_W, h: SLIDE_H,
      align: 'center', valign: 'middle', color: '888888', fontSize: 18,
    });
  }
}

// ─── Editor (items) slides ─────────────────────────────────────────────────

function addTextItem(
  pptxSlide: PptxGenJS.Slide,
  item: SlideItem,
  box: { x: number; y: number; w: number; h: number; rotation: number },
  warnings: string[],
): void {
  const ts = (item.textStyles ?? {}) as Record<string, any>;
  const fontSize = Number(ts.fontSize) || 32;
  const pad = ITEM_PAD;
  const hasContent = Boolean(item.content?.trim());
  const hasFill = Boolean(ts.backgroundColor);
  const hasBorder = Number(item.borderWidth) > 0;

  // A bare shape (no text) renders as a filled/outlined rectangle in the app.
  if (item.type === 'shape' && !hasContent && (hasFill || hasBorder)) {
    const shapeName = Number(item.borderRadius) > 0 ? 'roundRect' : 'rect';
    pptxSlide.addShape(shapeName, {
      x: box.x,
      y: box.y,
      w: box.w,
      h: box.h,
      rotate: box.rotation || undefined,
      fill: hasFill ? { color: normalizeColor(ts.backgroundColor) ?? '000000' } : { type: 'none' },
      line: hasBorder
        ? {
            color: normalizeColor(item.borderColor) ?? 'FFFFFF',
            width: Math.max(0.5, Number(item.borderWidth) * PX_TO_PT),
          }
        : undefined,
      rectRadius: Number(item.borderRadius) > 0 ? Math.min(Number(item.borderRadius) * PX_TO_IN, box.w / 2, box.h / 2) : undefined,
    });
    return;
  }

  const text = transformText(String(item.content ?? '').trim(), ts.textTransform);
  const shadow = ts.textShadow as
    | { color?: string; blur?: number; offsetX?: number; offsetY?: number }
    | undefined;

  pptxSlide.addText(text || ' ', {
    x: box.x + pad,
    y: box.y + pad,
    w: Math.max(0.05, box.w - 2 * pad),
    h: Math.max(0.05, box.h - 2 * pad),
    rotate: box.rotation || undefined,
    align: ts.textAlign || 'center',
    valign: mapVAlign(ts.verticalAlign || 'center'),
    fontSize: fontSize * PX_TO_PT,
    bold: ts.fontWeight === 'bold',
    italic: ts.fontStyle === 'italic',
    fontFace: ts.fontFamily || undefined,
    color: normalizeColor(ts.textColor) ?? 'FFFFFF',
    lineSpacing: fontSize * PX_TO_PT * (Number(ts.lineHeight) || 1.25),
    charSpacing: ts.letterSpacing != null ? Number(ts.letterSpacing) * PX_TO_PT : undefined,
    underline: ts.textDecoration === 'underline' ? { style: 'sng' } : undefined,
    strike: ts.textDecoration === 'line-through',
    fill: hasFill ? { color: normalizeColor(ts.backgroundColor) ?? '000000' } : undefined,
    line: hasBorder
      ? {
          color: normalizeColor(item.borderColor) ?? 'FFFFFF',
          width: Math.max(0.5, Number(item.borderWidth) * PX_TO_PT),
        }
      : undefined,
    shadow: shadow
      ? {
          type: 'outer',
          color: normalizeColor(shadow.color) ?? '000000',
          blur: Math.round((Number(shadow.blur) || 0) * PX_TO_PT),
          offset: Math.round(Math.hypot(Number(shadow.offsetX) || 0, Number(shadow.offsetY) || 0) * PX_TO_PT),
          angle:
            Number(shadow.offsetX) === 0 && Number(shadow.offsetY) === 0
              ? 90
              : (Math.atan2(Number(shadow.offsetY) || 0, Number(shadow.offsetX) || 0) * 180) / Math.PI,
        }
      : undefined,
    fit: 'shrink',
  });

  if (ts.textStroke) warnings.push('item: text stroke is not exported');
}

async function addImageItem(
  pptxSlide: PptxGenJS.Slide,
  item: SlideItem,
  box: { x: number; y: number; w: number; h: number; rotation: number },
  warnings: string[],
): Promise<void> {
  const imgStyles = (item.imageStyles ?? {}) as Record<string, any>;
  const data = await resolveImageData(item.mediaUrl);
  if (!data) {
    warnings.push('item: image could not be loaded');
    return;
  }

  if (Number(item.borderWidth) > 0) {
    pptxSlide.addShape('rect', {
      x: box.x,
      y: box.y,
      w: box.w,
      h: box.h,
      fill: { type: 'none' },
      line: {
        color: normalizeColor(item.borderColor) ?? 'FFFFFF',
        width: Math.max(0.5, Number(item.borderWidth) * PX_TO_PT),
      },
    });
  }

  const fit = imgStyles.objectFit;
  const sizing =
    fit === 'cover'
      ? { type: 'cover' as const, w: box.w, h: box.h }
      : fit === 'contain'
        ? { type: 'contain' as const, w: box.w, h: box.h }
        : undefined;

  safeAddImage(
    pptxSlide,
    {
      data,
      x: box.x,
      y: box.y,
      w: box.w,
      h: box.h,
      rotate: box.rotation || undefined,
      sizing,
      transparency: imgStyles.opacity != null ? Math.round((1 - Number(imgStyles.opacity)) * 100) : undefined,
      flipH: !!imgStyles.flipX,
      flipV: !!imgStyles.flipY,
    },
    'Image item',
    warnings,
  );

  const filtered =
    (imgStyles.brightness != null && imgStyles.brightness !== 1) ||
    (imgStyles.contrast != null && imgStyles.contrast !== 1) ||
    Number(imgStyles.blur) > 0 ||
    Number(imgStyles.grayscale) > 0 ||
    Number(imgStyles.sepia) > 0 ||
    imgStyles.hueRotate;
  if (filtered) warnings.push('item: image filters are not exported');
  if (imgStyles.crop) warnings.push('item: image crop is not exported');
  if (Number(item.borderRadius) > 0) warnings.push('item: rounded corners are not exported');
}

async function addItems(
  pptxSlide: PptxGenJS.Slide,
  items: SlideItem[],
  warnings: string[],
  parentX = 0,
  parentY = 0,
  parentRotation = 0,
): Promise<void> {
  const sorted = [...items].sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0));

  for (const item of sorted) {
    const x = ((item.x ?? 0) + parentX) / 100 * SLIDE_W;
    const y = ((item.y ?? 0) + parentY) / 100 * SLIDE_H;
    const w = (item.width ?? 0) / 100 * SLIDE_W;
    const h = (item.height ?? 0) / 100 * SLIDE_H;
    const rotation = ((item.rotation ?? 0) + parentRotation) % 360;

    if (item.type === 'group' && item.groupItems?.length) {
      await addItems(
        pptxSlide,
        item.groupItems,
        warnings,
        (item.x ?? 0) + parentX,
        (item.y ?? 0) + parentY,
        rotation,
      );
      continue;
    }

    if (item.type === 'image') {
      await addImageItem(pptxSlide, item, { x, y, w, h, rotation }, warnings);
    } else {
      addTextItem(pptxSlide, item, { x, y, w, h, rotation }, warnings);
    }
  }
}

// ─── Main entry ────────────────────────────────────────────────────────────

async function addSlide(
  pptx: PptxGenJS,
  slide: Slide,
  warnings: string[],
): Promise<void> {
  const pptxSlide = pptx.addSlide();
  // Default black background (matches the projector), overridden below.
  pptxSlide.background = { color: '000000' };
  await applyBackground(pptxSlide, slide, warnings);

  if (slide.items?.length) {
    await addItems(pptxSlide, slide.items, warnings);
    return;
  }

  switch (slide.type) {
    case 'image':
      await addImageSlide(pptxSlide, slide, warnings);
      break;
    case 'video':
      await addVideoSlide(pptxSlide, slide, warnings);
      break;
    case 'countdown':
      addCountdownSlide(pptxSlide, slide);
      break;
    case 'screen':
      addScreenSlide(pptxSlide, slide, warnings);
      break;
    case 'loop':
      await addLoopSlide(pptxSlide, slide, warnings);
      break;
    default:
      addTextSlide(pptxSlide, slide);
  }
}

/** partsMode slides render one part at a time in the app → one slide per part. */
function expandParts(slides: Slide[]): Slide[] {
  const expanded: Slide[] = [];
  for (const slide of slides) {
    if (slide.partsMode && Array.isArray(slide.parts) && slide.parts.length > 0) {
      for (const part of slide.parts) {
        expanded.push({ ...slide, content: part, partsMode: false, activePart: undefined });
      }
    } else {
      expanded.push(slide);
    }
  }
  return expanded;
}

export async function exportPresentationToPptx(
  presentation: Presentation,
  filePath: string,
  onProgress?: ExportProgressCallback,
): Promise<PptxExportResult> {
  try {
    const pptx = new PptxGenJS();
    pptx.layout = 'LAYOUT_16x9';
    pptx.author = 'Worship Presentation Assistant';
    pptx.title = presentation.name || 'Presentation';

    const warnings: string[] = [];
    const slides = expandParts(presentation.slides ?? []);
    const total = slides.length;

    for (let i = 0; i < total; i++) {
      await addSlide(pptx, slides[i], warnings);
      onProgress?.(i + 1, total);
    }

    await pptx.writeFile({ fileName: filePath });
    return { success: true, filePath, slideCount: total, warnings };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[PptxExportService] export failed:', error);
    return { success: false, error: message };
  }
}
