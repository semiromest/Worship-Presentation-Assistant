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
import { createCanvas, loadImage, type Image, type SKRSContext2D } from '@napi-rs/canvas';
import { calculateFit, calculateCover, wrapCanvasText, canvasTypography, canvasLinePlacement } from '../../shared/canvasLayout';
import { getPptxService } from '../pptxService';
import { exportPresentationToPptx } from '../pptxExportService';
import { buildGpresZip } from '../../shared/mediaTree';
import { createMediaLibrary, rewriteGpresMedia } from '../mediaLibrary';
import {
  THUMB_W, THUMB_H, PLACEHOLDER_BG, EMPTY_BG,
  type ThumbSlideData,
} from '../../shared/thumbnailConfig';
import { getSlideDisplayContent } from '../../shared/slideContent';

type HeavyRequest =
  | { id: number; type: 'import-pptx'; payload: { filePath: string; mediaDir: string } }
  | { id: number; type: 'export-pptx'; payload: { content: string; filePath: string; mediaDir: string } }
  | { id: number; type: 'build-gpres'; payload: { content: string; mediaDir: string } }
  | { id: number; type: 'extract-gpres'; payload: { buffer: ArrayBuffer; mediaDir: string } }
  | { id: number; type: 'generate-thumbnail'; payload: { slide: ThumbSlideData } };

type Ctx = SKRSContext2D;
type ThumbItem = NonNullable<ThumbSlideData['items']>[number];

/** Aynı anda en fazla bu kadar küçük resim işlenir; decode edilen görseller bellekte birikmesin. */
const THUMBNAIL_CONCURRENCY = 4;
/** İlerleme mesajları en sık bu aralıkla gönderilir (son adım hariç). */
const PROGRESS_INTERVAL_MS = 50;
const IMAGE_FETCH_TIMEOUT_MS = 5_000;
/** Çözülmüş data: görsellerinden son kullanılan kadarı tutulur. */
const IMAGE_CACHE_MAX = 4;
/** Bundan büyük görseller (≈ 4K) önbelleğe alınmaz; decode edilmiş bitmap'i yüzlerce MB tutabilir. */
const IMAGE_CACHE_MAX_PIXELS = 4096 * 2304;
const FALLBACK_COLOR = 'rgba(255,255,255,0.45)';
const FALLBACK_FONT = 'bold 14px sans-serif';

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

/** Büyük içe aktarmalarda her slayt için mesaj göndermek yerine sıklığı sınırlar; son adım her zaman gider. */
function progressReporter(id: number): (current: number, total: number) => void {
  let last = 0;
  return (current, total) => {
    const now = Date.now();
    if (current < total && now - last < PROGRESS_INTERVAL_MS) return;
    last = now;
    port.postMessage({ id, type: 'progress', current, total });
  };
}

/** Slot devri ile çalışır: bekleyen varsa slot ona geçer, böylece sınır hiçbir an aşılmaz. */
function createLimiter(max: number) {
  let active = 0;
  const waiting: Array<() => void> = [];
  return async function run<T>(task: () => Promise<T>): Promise<T> {
    if (active < max) active++;
    else await new Promise<void>(resolve => waiting.push(resolve));
    try {
      return await task();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active--;
    }
  };
}
const thumbnailLimit = createLimiter(THUMBNAIL_CONCURRENCY);

async function handle(req: HeavyRequest): Promise<unknown> {
  switch (req.type) {
    case 'import-pptx': {
      // getPptxService() is process-local; the worker is kept alive so the
      // resvg WASM warm-up happens once, not per import.
      return getPptxService().importPptx(req.payload.filePath, progressReporter(req.id), req.payload.mediaDir);
    }
    case 'export-pptx': {
      const data = JSON.parse(req.payload.content);
      return exportPresentationToPptx(data, req.payload.filePath, progressReporter(req.id), req.payload.mediaDir);
    }
    case 'build-gpres': {
      const data = JSON.parse(req.payload.content);
      const { zip, embeddedCount } = await buildGpresZip(data, { mediaDir: req.payload.mediaDir });
      // toBuffer() zaten Buffer döndürüyorsa ikinci bir kopya üretme.
      const out = zip.toBuffer();
      return { embeddedCount, zipBuffer: Buffer.isBuffer(out) ? out : Buffer.from(out) };
    }
    case 'extract-gpres': {
      const zip = new AdmZip(Buffer.from(req.payload.buffer)); // ArrayBuffer'dan Buffer.from kopyalamaz.
      const jsonEntry = zip.getEntry('presentation.json');
      if (!jsonEntry) throw new Error('Corrupt .gpres file: missing presentation.json');
      const data = JSON.parse(zip.readAsText(jsonEntry));
      const mediaCount = await rewriteGpresMedia(zip, data, createMediaLibrary(req.payload.mediaDir));
      return { data, mediaCount };
    }
    case 'generate-thumbnail':
      return thumbnailLimit(() => generateThumbnail(req.payload.slide));
    default:
      throw new Error(`Unknown heavy request type: ${(req as { type: string }).type}`);
  }
}

// ─── Image loading ──────────────────────────────────────────────────────────

/** Asla reddetmez; çözülemeyen kaynak null olur. */
async function decodeSource(src: string): Promise<Image | null> {
  try {
    if (src.startsWith('data:')) {
      const comma = src.indexOf(','); // split(',') tüm veriyi parçalara bölerdi
      if (comma < 0) return null;
      const payload = src.slice(comma + 1);
      if (!payload) return null;
      const isBase64 = /;base64$/i.test(src.slice(0, comma));
      return await loadImage(isBase64 ? Buffer.from(payload, 'base64') : Buffer.from(decodeURIComponent(payload)));
    }
    if (src.startsWith('http://') || src.startsWith('https://')) {
      const res = await fetch(src, { signal: AbortSignal.timeout(IMAGE_FETCH_TIMEOUT_MS) });
      if (!res.ok) return null;
      return await loadImage(Buffer.from(await res.arrayBuffer()));
    }
  } catch { /* undecodable or unreachable: caller falls back */ }
  // local-resource:// or file paths — skip in worker, renderer handles fallback
  return null;
}

// data: URL'ler içerik adresli olduğu için güvenle önbelleğe alınır. Promise saklandığı için
// aynı görseli isteyen eşzamanlı küçük resimler tek decode'u paylaşır. http(s) kaynaklar değişebilir, önbelleğe alınmaz.
const imageCache = new Map<string, Promise<Image | null>>();

function loadImageFromSource(src: string | null | undefined): Promise<Image | null> {
  if (typeof src !== 'string' || !src) return Promise.resolve(null);
  if (!src.startsWith('data:')) return decodeSource(src);

  let pending = imageCache.get(src);
  if (pending) imageCache.delete(src); // en son kullanılana taşı
  else {
    const created = decodeSource(src);
    created.then(img => {
      if (!img || img.width * img.height > IMAGE_CACHE_MAX_PIXELS) imageCache.delete(src);
    });
    pending = created;
  }
  imageCache.set(src, pending);
  while (imageCache.size > IMAGE_CACHE_MAX) imageCache.delete(imageCache.keys().next().value!);
  return pending;
}

// ─── Thumbnail rendering (utility process, @napi-rs/canvas) ────────────────

function fillBackground(ctx: Ctx, color: string, W: number, H: number): void {
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, W, H);
}

function drawCenteredText(ctx: Ctx, text: string, color: string, font: string, W: number, H: number): void {
  ctx.fillStyle = color;
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, W / 2, H / 2, W - 24);
}

/** Düz renk arka plan + ortada tek satır etiket: ekran, altyazı, döngü ve yedek slaytların ortak çizimi. */
function paintLabelSlide(ctx: Ctx, W: number, H: number, background: string, label: string, color: string, font: string): void {
  fillBackground(ctx, background, W, H);
  drawCenteredText(ctx, label, color, font, W, H);
}

function drawImageSafe(ctx: Ctx, img: Image, fit: 'contain' | 'cover', W: number, H: number): void {
  if (img.width === 0 || img.height === 0) return;
  if (fit === 'cover') {
    const { sx, sy, sw, sh } = calculateCover(img.width, img.height, W, H);
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, W, H);
  } else {
    const { dx, dy, dw, dh } = calculateFit(img.width, img.height, W, H);
    ctx.drawImage(img, dx, dy, dw, dh);
  }
}

function applyTextTransform(text: string, transform: unknown): string {
  return transform === 'uppercase' ? text.toUpperCase() : transform === 'lowercase' ? text.toLowerCase() : text;
}

async function renderTextSlide(ctx: Ctx, slide: ThumbSlideData, W: number, H: number): Promise<boolean> {
  const styles = (slide.styles ?? {}) as Record<string, any>;

  if (styles.backgroundImage) {
    const bg = await loadImageFromSource(styles.backgroundImage);
    if (bg) drawImageSafe(ctx, bg, 'cover', W, H);
  }

  const content = getSlideDisplayContent(slide);
  if (!content) return true;

  const typography = canvasTypography(styles, W, 8);
  const { lineHeight, padding, textAlign } = typography;
  const textColor = styles.textColor || '#ffffff';
  ctx.font = typography.font;
  ctx.fillStyle = textColor;
  ctx.textBaseline = 'top';

  const lines = wrapCanvasText(ctx, applyTextTransform(content, styles.textTransform), W - padding * 2);
  if (lines.length === 0) return true;

  const { startY, x, leading } = canvasLinePlacement(typography, lines.length, W, H);
  ctx.textAlign = textAlign === 'left' || textAlign === 'right' ? textAlign : 'center';
  const highlight = styles.textHighlight && styles.textHighlight !== 'transparent' ? styles.textHighlight : null;

  for (let i = 0; i < lines.length; i++) {
    const y = startY + i * lineHeight + leading;
    if (y + lineHeight < 0 || y > H) continue;
    if (highlight) {
      const { width } = ctx.measureText(lines[i]);
      const highlightX = textAlign === 'center' ? x - width / 2 : textAlign === 'right' ? x - width : x;
      ctx.fillStyle = highlight;
      ctx.fillRect(highlightX, y - leading, width, lineHeight);
      ctx.fillStyle = textColor;
    }
    ctx.fillText(lines[i], x, y);
  }
  return true;
}

async function renderImageSlide(ctx: Ctx, slide: ThumbSlideData, W: number, H: number): Promise<boolean> {
  // Only render if we have inline data (base64)
  for (const src of [slide.thumbnailUrl, slide.mediaUrl]) {
    if (!src?.startsWith('data:')) continue;
    const img = await loadImageFromSource(src);
    if (img) {
      drawImageSafe(ctx, img, slide.styles?.objectFit === 'cover' ? 'cover' : 'contain', W, H);
      return true;
    }
  }
  paintLabelSlide(ctx, W, H, EMPTY_BG, slide.content?.slice(0, 40) || 'Image', FALLBACK_COLOR, FALLBACK_FONT);
  return true;
}

async function renderLoopSlide(ctx: Ctx, slide: ThumbSlideData, W: number, H: number): Promise<boolean> {
  const img = await loadImageFromSource(slide.loopItems?.[0]?.mediaData);
  if (img) {
    drawImageSafe(ctx, img, 'contain', W, H);
    return true;
  }
  paintLabelSlide(ctx, W, H, EMPTY_BG, 'Loop', 'rgba(168,85,247,0.2)', FALLBACK_FONT);
  return true;
}

function drawItemText(ctx: Ctx, item: ThumbItem, x: number, y: number, iw: number, ih: number, baseScale: number): boolean {
  const ts = (item.textStyles ?? {}) as Record<string, any>;
  const fontSize = Math.max(4, (ts.fontSize || 32) * baseScale);
  const lineHeight = (ts.lineHeight ?? 1.25) * fontSize;
  const padding = 8 * baseScale;
  const align = ts.textAlign === 'left' || ts.textAlign === 'right' ? ts.textAlign : 'center';
  const family = ts.fontFamily ? ts.fontFamily.split(',')[0].trim() : 'sans-serif';

  ctx.font = `${ts.fontStyle === 'italic' ? 'italic ' : ''}${ts.fontWeight || 'normal'} ${fontSize}px ${family}`;
  ctx.fillStyle = ts.textColor || '#ffffff';
  ctx.textBaseline = 'top';
  ctx.textAlign = align;

  const lines = wrapCanvasText(ctx, applyTextTransform(item.content ?? '', ts.textTransform), iw - padding * 2);
  if (lines.length === 0) return false;

  const startY = y + (ih - lines.length * lineHeight) / 2;
  const tx = align === 'center' ? x + iw / 2 : align === 'right' ? x + iw - padding : x + padding;
  const leading = (lineHeight - fontSize) / 2;
  for (let i = 0; i < lines.length; i++) {
    const ly = startY + i * lineHeight + leading;
    if (ly + lineHeight < y || ly > y + ih) continue;
    ctx.fillText(lines[i], tx, ly);
  }
  return true;
}

async function renderItemsSlide(ctx: Ctx, slide: ThumbSlideData, W: number, H: number): Promise<boolean> {
  const items = [...(slide.items ?? [])].sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0));
  const baseScale = W / 1920;

  // Görseller sırayla değil paralel çözülür; çizim sonra senkron yapılır.
  const images = await Promise.all(
    items.map(item => (item.type === 'image' && item.mediaData ? loadImageFromSource(item.mediaData) : null)),
  );

  let drewAny = false;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const x = (item.x / 100) * W;
    const y = (item.y / 100) * H;
    const iw = (item.width / 100) * W;
    const ih = (item.height / 100) * H;

    ctx.save();
    try {
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

      const img = images[i];
      if (img) {
        ctx.beginPath();
        ctx.rect(x, y, iw, ih);
        ctx.clip();
        ctx.translate(x, y);
        drawImageSafe(ctx, img, item.imageStyles?.objectFit === 'cover' ? 'cover' : 'contain', iw, ih);
        drewAny = true;
      } else if (item.type === 'text' && item.content) {
        if (drawItemText(ctx, item, x, y, iw, ih, baseScale)) drewAny = true;
      }
    } finally {
      ctx.restore(); // Hata olsa bile dönüşüm/klip durumu sızmaz.
    }
  }

  if (!drewAny) {
    drawCenteredText(ctx, slide.content?.slice(0, 40) || 'Layout Slide', FALLBACK_COLOR, 'bold 11px sans-serif', W, H);
  }
  return true;
}

/** Çizilemeyen (bilinmeyen) türde false döner; çağıran yedek görünümü basar. */
async function renderSlide(ctx: Ctx, slide: ThumbSlideData, W: number, H: number): Promise<boolean> {
  const hasItems = !!slide.items?.length;
  switch (slide.type) {
    case 'text':
      return hasItems ? renderItemsSlide(ctx, slide, W, H) : renderTextSlide(ctx, slide, W, H);
    case 'image':
      return renderImageSlide(ctx, slide, W, H);
    case 'screen':
      paintLabelSlide(ctx, W, H, PLACEHOLDER_BG, 'Screen Capture', 'rgba(59,130,246,0.15)', FALLBACK_FONT);
      return true;
    case 'loop':
      return renderLoopSlide(ctx, slide, W, H);
    case 'captions':
      paintLabelSlide(ctx, W, H, '#000000', 'Live Captions', 'rgba(147,197,253,0.18)', 'bold 16px sans-serif');
      return true;
    default:
      return hasItems ? renderItemsSlide(ctx, slide, W, H) : false;
  }
}

async function generateThumbnail(slide: ThumbSlideData): Promise<string | null> {
  const W = THUMB_W;
  const H = THUMB_H;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  try {
    fillBackground(ctx, slide.styles?.backgroundColor || '#000000', W, H);
    if (!(await renderSlide(ctx, slide, W, H))) {
      paintLabelSlide(ctx, W, H, PLACEHOLDER_BG, slide.content?.slice(0, 60) || slide.type, FALLBACK_COLOR, FALLBACK_FONT);
    }
  } catch {
    paintLabelSlide(ctx, W, H, PLACEHOLDER_BG, slide.content?.slice(0, 40) || slide.type || 'Slide', 'rgba(255,255,255,0.25)', 'bold 12px sans-serif');
  }

  try {
    // Asenkron kodlama libuv iş parçacığında çalışır; bu sırada başka küçük resimlerin görselleri çözülebilir.
    const buf = await canvas.encode('webp');
    return `data:image/webp;base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

// ─── Messaging ──────────────────────────────────────────────────────────────

function reply(id: number, result: unknown): void {
  const zip = (result as { zipBuffer?: Buffer } | undefined)?.zipBuffer;
  // Yalnızca kendi ArrayBuffer'ının tamamını kaplayan tampon devredilir. Havuzdan gelen (pool) küçük bir
  // Buffer'ın .buffer'ını devretmek, Node'un paylaşılan havuzunu ve alıcıya giden dilimi bozar.
  const owned = zip && zip.byteOffset === 0 && zip.byteLength === zip.buffer.byteLength;
  port.postMessage({ id, ok: true, result }, owned ? [zip.buffer as Transferable] : undefined);
}

port.on('message', ({ data: req }) => {
  if (!req || typeof req.id !== 'number') return;
  void (async () => {
    try {
      reply(req.id, await handle(req));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[heavyWorker] ${req.type} failed:`, message);
      port.postMessage({ id: req.id, ok: false, error: message });
    }
  })();
});

console.info('[heavyWorker] ready');