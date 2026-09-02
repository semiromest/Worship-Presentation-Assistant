/**
 * Heavy-work UtilityProcess entry (Phase 7).
 *
 * Runs PPTX import/export, .gpres ZIP build/extract, and thumbnail generation
 * in a separate OS process so the main event loop is never blocked by
 * multi-second CPU work. Spawned lazily by heavyWorkerClient.ts and kept alive
 * for the app lifetime so the resvg warm-up is paid only once.
 *
 * Protocol over process.parentPort (Electron ≥ 27):
 *   request:  { id, type, payload }
 *   progress: { id, type: 'progress', current, total }
 *   response: { id, ok: true, result } | { id, ok: false, error }
 *
 * The worker is a plain Node environment: fs + path work, and media bytes are
 * written content-addressed into the passed mediaDir (same algorithm as main).
 */

import AdmZip from 'adm-zip';
import { createCanvas, loadImage, GlobalFonts } from '@napi-rs/canvas';
import { getPptxService } from '../pptxService';
import { exportPresentationToPptx } from '../pptxExportService';
import { buildGpresZip } from '../../shared/mediaTree';
import { createMediaLibrary, rewriteGpresMedia } from '../mediaLibrary';
import {
  THUMB_W, THUMB_H, PLACEHOLDER_BG, EMPTY_BG,
  type ThumbSlideData,
} from '../../shared/thumbnailConfig';

type HeavyRequest =
  | { id: number; type: 'import-pptx'; payload: { filePath: string; mediaDir: string } }
  | { id: number; type: 'export-pptx'; payload: { content: string; filePath: string; mediaDir: string } }
  | { id: number; type: 'build-gpres'; payload: { content: string; mediaDir: string } }
  | { id: number; type: 'extract-gpres'; payload: { buffer: ArrayBuffer; mediaDir: string } }
  | { id: number; type: 'generate-thumbnail'; payload: { slide: ThumbSlideData } };

interface ProgressMsg { id: number; type: 'progress'; current: number; total: number }

// UtilityProcess child side: Electron exposes process.parentPort (a
// MessagePortMain) — not worker_threads' parentPort. @types/node's Process
// lacks the property, so access it through a cast.
interface ParentPortLike {
  on: (event: 'message', cb: (e: { data: HeavyRequest }) => void) => void;
  postMessage: (message: unknown, transfer?: Transferable[]) => void;
}
const rawPort = (process as unknown as { parentPort?: ParentPortLike }).parentPort;
if (!rawPort) throw new Error('heavyWorker: process.parentPort unavailable — not running in a UtilityProcess');
// Non-optional alias so closures see a narrowed type.
const port: ParentPortLike = rawPort;

function postProgress(id: number, current: number, total: number): void {
  const msg: ProgressMsg = { id, type: 'progress', current, total };
  port.postMessage(msg);
}

async function handle(req: HeavyRequest): Promise<unknown> {
  switch (req.type) {
    case 'import-pptx': {
      // getPptxService() is process-local; the worker is kept alive so the
      // resvg WASM warm-up happens once, not per import.
      return getPptxService().importPptx(
        req.payload.filePath,
        (current, total) => postProgress(req.id, current, total),
        req.payload.mediaDir,
      );
    }
    case 'export-pptx': {
      const data = JSON.parse(req.payload.content);
      return exportPresentationToPptx(
        data,
        req.payload.filePath,
        (current, total) => postProgress(req.id, current, total),
        req.payload.mediaDir,
      );
    }
    case 'build-gpres': {
      const data = JSON.parse(req.payload.content);
      const { zip, embeddedCount } = await buildGpresZip(data, { mediaDir: req.payload.mediaDir });
      const buffer = Buffer.from(zip.toBuffer());
      return { embeddedCount, zipBuffer: buffer };
    }
    case 'extract-gpres': {
      const buffer = Buffer.from(req.payload.buffer);
      const zip = new AdmZip(buffer);
      const jsonEntry = zip.getEntry('presentation.json');
      if (!jsonEntry) throw new Error('Corrupt .gpres file: missing presentation.json');
      const data = JSON.parse(zip.readAsText(jsonEntry));
      const mediaCount = await rewriteGpresMedia(zip, data, createMediaLibrary(req.payload.mediaDir));
      return { data, mediaCount };
    }
    case 'generate-thumbnail': {
      return generateThumbnail(req.payload.slide);
    }
    default:
      throw new Error(`Unknown heavy request type: ${(req as HeavyRequest & { type: string }).type}`);
  }
}

// ─── Thumbnail rendering (utility process, @napi-rs/canvas) ────────────────

function fillFallbackText(
  ctx: any, text: string, color = 'rgba(255,255,255,0.45)',
  font = 'bold 14px sans-serif', W = THUMB_W, H = THUMB_H,
): void {
  ctx.fillStyle = color;
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, W / 2, H / 2, W - 24);
}

function calculateFit(imgW: number, imgH: number, canvasW: number, canvasH: number) {
  const imgAr = imgW / imgH;
  const cAr = canvasW / canvasH;
  if (imgAr > cAr) {
    const dh = canvasW / imgAr;
    return { dx: 0, dy: (canvasH - dh) / 2, dw: canvasW, dh };
  }
  const dw = canvasH * imgAr;
  const dh = canvasH;
  return { dx: (canvasW - dw) / 2, dy: 0, dw, dh };
}

function calculateCover(imgW: number, imgH: number, canvasW: number, canvasH: number) {
  const imgAr = imgW / imgH;
  const cAr = canvasW / canvasH;
  if (imgAr > cAr) {
    const sw = imgH * cAr;
    return { sx: (imgW - sw) / 2, sy: 0, sw, sh: imgH };
  }
  const sh = imgW / cAr;
  return { sx: 0, sy: (imgH - sh) / 2, sw: imgW, sh };
}

function drawImageSafe(ctx: any, img: any, fit: 'contain' | 'cover', W: number, H: number): void {
  if (!img || img.width === 0 || img.height === 0) return;
  const iw = img.width;
  const ih = img.height;
  if (fit === 'cover') {
    const { sx, sy, sw, sh } = calculateCover(iw, ih, W, H);
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, W, H);
  } else {
    const { dx, dy, dw, dh } = calculateFit(iw, ih, W, H);
    ctx.drawImage(img, dx, dy, dw, dh);
  }
}

function wrapCanvasText(ctx: any, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    if (paragraph.trim().length === 0) { lines.push(''); continue; }
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

async function renderTextSlide(ctx: any, slide: ThumbSlideData, W: number, H: number): Promise<boolean> {
  if (slide.items?.length) return false;
  ctx.fillStyle = slide.styles?.backgroundColor || '#000000';
  ctx.fillRect(0, 0, W, H);

  if (slide.styles?.backgroundImage) {
    try {
      const bgImg = await loadImageFromSource(slide.styles.backgroundImage);
      if (bgImg) drawImageSafe(ctx, bgImg, 'cover', W, H);
    } catch { /* skip bg image */ }
  }

  const styles = (slide.styles ?? {}) as Record<string, any>;
  const displayContent =
    slide.partsMode && slide.parts?.length
      ? (slide.parts[slide.activePart ?? 0] ?? slide.content)
      : slide.content;
  if (!displayContent) return true;

  const ff = styles.fontFamily && styles.fontFamily !== 'inherit'
    ? styles.fontFamily.split(',')[0].trim() : 'sans-serif';
  const baseScale = W / 1920;
  const fontSize = Math.max(8, (styles.fontSize || 48) * baseScale);
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
  const x = textAlign === 'center' ? W / 2 : textAlign === 'right' ? W - padding : padding;

  const leading = (lineHeight - fontSize) / 2;
  for (let i = 0; i < lines.length; i++) {
    const y = startY + i * lineHeight + leading;
    if (y + lineHeight < 0 || y > H) continue;
    if (styles.textHighlight && styles.textHighlight !== 'transparent') {
      const metrics = ctx.measureText(lines[i]);
      const highlightX = textAlign === 'center' ? x - metrics.width / 2 : textAlign === 'right' ? x - metrics.width : x;
      ctx.save();
      ctx.fillStyle = styles.textHighlight;
      ctx.fillRect(highlightX, y - leading, metrics.width, lineHeight);
      ctx.restore();
      ctx.fillStyle = styles.textColor || '#ffffff';
    }
    ctx.fillText(lines[i], x, y);
  }
  return true;
}

async function loadImageFromSource(src: string): Promise<any | null> {
  if (!src) return null;
  if (src.startsWith('data:')) {
    const base64 = src.split(',')[1];
    if (!base64) return null;
    const buf = Buffer.from(base64, 'base64');
    return loadImage(buf);
  }
  if (src.startsWith('http://') || src.startsWith('https://')) {
    try {
      const res = await fetch(src);
      const buf = Buffer.from(await res.arrayBuffer());
      return loadImage(buf);
    } catch { return null; }
  }
  // local-resource:// or file paths — skip in worker, renderer handles fallback
  return null;
}

async function renderImageSlide(ctx: any, slide: ThumbSlideData, W: number, H: number): Promise<boolean> {
  const sources = [slide.thumbnailUrl, slide.mediaUrl].filter(Boolean);
  for (const src of sources) {
    if (!src) continue;
    // Only render if we have inline data (base64)
    if (src.startsWith('data:')) {
      try {
        const img = await loadImageFromSource(src);
        if (img) {
          const fit = slide.styles?.objectFit === 'cover' ? 'cover' : 'contain';
          drawImageSafe(ctx, img, fit, W, H);
          return true;
        }
      } catch { /* continue */ }
    }
  }
  ctx.fillStyle = EMPTY_BG;
  ctx.fillRect(0, 0, W, H);
  fillFallbackText(ctx, slide.content?.slice(0, 40) || 'Image');
  return true;
}

function renderScreenSlide(ctx: any, _slide: ThumbSlideData, W: number, H: number): boolean {
  ctx.fillStyle = PLACEHOLDER_BG;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(59,130,246,0.15)';
  ctx.font = 'bold 14px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('Screen Capture', W / 2, H / 2);
  return true;
}

function renderCaptionsSlide(ctx: any, _slide: ThumbSlideData, W: number, H: number): boolean {
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(147,197,253,0.18)';
  ctx.font = 'bold 16px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('Live Captions', W / 2, H / 2);
  return true;
}

async function renderLoopSlide(ctx: any, slide: ThumbSlideData, W: number, H: number): Promise<boolean> {
  const first = slide.loopItems?.[0];
  if (first?.mediaData) {
    try {
      const img = await loadImageFromSource(first.mediaData);
      if (img) { drawImageSafe(ctx, img, 'contain', W, H); return true; }
    } catch { /* continue */ }
  }
  ctx.fillStyle = EMPTY_BG;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(168,85,247,0.2)';
  ctx.font = 'bold 14px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('Loop', W / 2, H / 2);
  return true;
}

async function renderItemsSlide(ctx: any, slide: ThumbSlideData, W: number, H: number): Promise<boolean> {
  if (!slide.items?.length) return false;
  const baseScale = W / 1920;

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

    if (item.borderWidth && item.borderWidth > 0) {
      ctx.beginPath();
      const r = (item.borderRadius ?? 0) * baseScale;
      if (r > 0) ctx.roundRect(x, y, iw, ih, r);
      else ctx.rect(x, y, iw, ih);
      ctx.strokeStyle = item.borderColor || '#ffffff';
      ctx.lineWidth = item.borderWidth * baseScale;
      ctx.stroke();
    }

    if (item.type === 'image' && item.mediaData) {
      try {
        const img = await loadImageFromSource(item.mediaData);
        if (img) {
          const fit = item.imageStyles?.objectFit === 'cover' ? 'cover' : 'contain';
          ctx.beginPath();
          ctx.rect(x, y, iw, ih);
          ctx.clip();
          ctx.translate(x, y);
          drawImageSafe(ctx, img, fit, iw, ih);
          drewAny = true;
        }
      } catch { /* skip */ }
    } else if (item.type === 'text' && item.content) {
      const ts = (item.textStyles ?? {}) as Record<string, any>;
      const fontSize = Math.max(4, (ts.fontSize || 32) * baseScale);
      const lineHeight = (ts.lineHeight ?? 1.25) * fontSize;
      const padding = 8 * baseScale;
      const align = ts.textAlign || 'center';
      const ff = ts.fontFamily ? ts.fontFamily.split(',')[0].trim() : 'sans-serif';

      let text = item.content;
      if (ts.textTransform === 'uppercase') text = text.toUpperCase();
      else if (ts.textTransform === 'lowercase') text = text.toLowerCase();

      ctx.font = `${ts.fontStyle === 'italic' ? 'italic ' : ''}${ts.fontWeight || 'normal'} ${fontSize}px ${ff}`;
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

        for (let i = 0; i < lines.length; i++) {
          const ly = startY + i * lineHeight + leading;
          if (ly + lineHeight < y || ly > y + ih) continue;
          ctx.fillText(lines[i], tx, ly);
        }
        drewAny = true;
      }
    }
    ctx.restore();
  }

  if (!drewAny) {
    fillFallbackText(ctx, slide.content?.slice(0, 40) || 'Layout Slide', 'rgba(255,255,255,0.45)', 'bold 11px sans-serif');
  }
  return true;
}

async function generateThumbnail(slide: ThumbSlideData): Promise<string | null> {
  const W = THUMB_W;
  const H = THUMB_H;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  try {
    ctx.fillStyle = slide.styles?.backgroundColor || '#000000';
    ctx.fillRect(0, 0, W, H);

    let rendered = false;

    if (slide.type === 'text' && slide.items?.length) {
      rendered = await renderItemsSlide(ctx, slide, W, H);
    } else if (slide.type === 'text') {
      rendered = await renderTextSlide(ctx, slide, W, H);
    } else if (slide.type === 'image') {
      rendered = await renderImageSlide(ctx, slide, W, H);
    } else if (slide.type === 'screen') {
      rendered = renderScreenSlide(ctx, slide, W, H);
    } else if (slide.type === 'loop') {
      rendered = await renderLoopSlide(ctx, slide, W, H);
    } else if (slide.type === 'captions') {
      rendered = renderCaptionsSlide(ctx, slide, W, H);
    } else if (slide.items?.length) {
      rendered = await renderItemsSlide(ctx, slide, W, H);
    }

    if (!rendered) {
      ctx.fillStyle = PLACEHOLDER_BG;
      ctx.fillRect(0, 0, W, H);
      fillFallbackText(ctx, slide.content?.slice(0, 60) || slide.type);
    }
  } catch {
    ctx.fillStyle = PLACEHOLDER_BG;
    ctx.fillRect(0, 0, W, H);
    fillFallbackText(ctx, slide.content?.slice(0, 40) || slide.type || 'Slide', 'rgba(255,255,255,0.25)', 'bold 12px sans-serif');
  }

  try {
    const buf = canvas.toBuffer('image/webp');
    return `data:image/webp;base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

port.on('message', (e) => {
  const req = e.data;
  void (async () => {
    try {
      const result = await handle(req);
      // Transfer the zip buffer instead of copying it across processes.
      const zipBuffer = (result as { zipBuffer?: Buffer } | undefined)?.zipBuffer;
      const transfer = zipBuffer ? [zipBuffer.buffer as Transferable] : undefined;
      port.postMessage({ id: req.id, ok: true, result }, transfer);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[heavyWorker] ${req.type} failed:`, message);
      port.postMessage({ id: req.id, ok: false, error: message });
    }
  })();
});

console.info('[heavyWorker] ready');
