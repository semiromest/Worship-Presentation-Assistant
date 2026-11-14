/**
 * Image text translation (desktop, main process).
 *
 *   library image ─sharp→ RGBA ─Tesseract.js→ paragraphs ─anylang (Google, free endpoints)→ translations
 *                       └─ colour split + stroke mask ─OpenCV inpaint (Telea)→ clean picture
 *                          └─ @napi-rs/canvas draws the translation into the original boxes ─sharp→ library
 *
 * Works on any local image the editor references (library ref, local-resource:// or file:// URL).
 * The original file is never touched: the result is stored as a new content-addressed library file
 * and the caller swaps the reference (one undo step), like the media optimizer.
 *
 * Heavy modules load on first use. OCR runs in Tesseract's worker thread; inpainting only touches
 * the small area around each text block, so the main thread is blocked for milliseconds.
 */
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileUrlToPath } from '../shared/mediaTree';
import { isLocalImageSource, ocrLangsFor, TRANSLATABLE_IMAGE_EXTS, type ImageTranslateRequest, type ImageTranslateResult } from '../shared/imageTranslate';
import {
  buildTextMask, estimateColors, fitText, padBox, selectRegions, weightFromStroke,
  type OcrParagraph, type Rgb, type TextRegion,
} from './imageTextLayout';

export type OcrFn = (png: Buffer, langs: string[]) => Promise<OcrParagraph[]>;
export type TranslateFn = (texts: string[], from: string, to: string) => Promise<string[]>;

export interface ImageTranslateDeps {
  /** Media library folder and writer (same contract as the optimizer). */
  dir: string;
  storeBytes: (data: Buffer, ext: string) => Promise<string | null>;
  /** Where Tesseract keeps downloaded language data. */
  cacheDir: string;
  ocr?: OcrFn;
  translate?: TranslateFn;
  /** JSON index of finished translations (source content + languages → library ref). */
  indexPath?: string;
}

const MAX_EDGE = 3000;
const FONT_STACK = '"Segoe UI", "Helvetica Neue", Arial, "Noto Sans", "Malgun Gothic", sans-serif';

/* eslint-disable @typescript-eslint/no-require-imports */
function loadSharp(): any {
  const sharp = require('sharp');
  sharp.cache(false);
  return sharp;
}

// The Emscripten module is itself a thenable that resolves to itself: never return it from an
// async function or `await` it directly (that loops forever). Keep it boxed.
let cvPromise: Promise<{ cv: any }> | null = null;
function loadOpenCv(): Promise<{ cv: any }> {
  cvPromise ??= new Promise((resolve) => {
    const cv = require('@techstark/opencv-js');
    if (cv.Mat) resolve({ cv });
    else cv.onRuntimeInitialized = () => resolve({ cv });
  });
  return cvPromise;
}

/** In a packaged app the worker script must be read from app.asar.unpacked (see asarUnpack). */
function unpackedPath(p: string): string {
  return p.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
}

// One Tesseract worker per language set, closed after a quiet minute.
let ocrWorker: { key: string; worker: Promise<any>; timer?: NodeJS.Timeout } | null = null;
async function getOcrWorker(langs: string[], cacheDir: string): Promise<any> {
  const key = langs.join('+');
  if (ocrWorker && ocrWorker.key !== key) {
    const old = ocrWorker;
    ocrWorker = null;
    void old.worker.then((w) => w.terminate()).catch(() => undefined);
  }
  if (!ocrWorker) {
    const { createWorker } = require('tesseract.js');
    const root = path.dirname(require.resolve('tesseract.js/package.json'));
    await fs.mkdir(cacheDir, { recursive: true });
    const worker: Promise<any> = createWorker(langs, 1, {
      cachePath: cacheDir,
      workerPath: unpackedPath(path.join(root, 'src', 'worker-script', 'node', 'index.js')),
    }).then(async (w: any) => {
      // Screen images carry no DPI; without a hint Tesseract guesses a tiny one and warns.
      await w.setParameters({ user_defined_dpi: '150' });
      return w;
    });
    ocrWorker = { key, worker };
    worker.catch(() => { if (ocrWorker?.worker === worker) ocrWorker = null; });
  }
  const entry = ocrWorker;
  if (entry.timer) clearTimeout(entry.timer);
  entry.timer = setTimeout(() => {
    if (ocrWorker === entry) ocrWorker = null;
    void entry.worker.then((w) => w.terminate()).catch(() => undefined);
  }, 60_000);
  entry.timer.unref?.();
  return entry.worker;
}

function tesseractOcr(cacheDir: string): OcrFn {
  return async (png, langs) => {
    const worker = await getOcrWorker(langs, cacheDir);
    const { data } = await worker.recognize(png, {}, { blocks: true, text: false });
    const paragraphs: OcrParagraph[] = [];
    for (const block of data.blocks ?? []) for (const p of block.paragraphs ?? []) paragraphs.push(p);
    return paragraphs;
  };
}

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

/** Google's two free endpoints in turn; a string either one leaves untranslated stays as is. */
export function freeTranslate(): TranslateFn {
  return async (texts, from, to) => {
    const { GoogleTranslator, GoogleTranslatorTokenFree } = require('anylang/translators');
    const translators = [
      new GoogleTranslator({ headers: { 'User-Agent': USER_AGENT } }),
      new GoogleTranslatorTokenFree({ headers: { 'User-Agent': USER_AGENT } }),
    ];
    let lastError: unknown;
    for (const translator of translators) {
      try {
        const out: (string | null)[] = await translator.translateBatch(texts, from, to);
        if (out.some((s) => typeof s === 'string' && s.trim())) return texts.map((t, i) => out[i]?.trim() || t);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error('Translation service unavailable');
  };
}
/* eslint-enable @typescript-eslint/no-require-imports */

/** Paints out one region's strokes with OpenCV Telea inpainting, in place, inside its bounds. */
function inpaintRegion(cv: any, rgba: Uint8Array, width: number, height: number, mask: Uint8Array, region: TextRegion, bounds: { x0: number; y0: number; x1: number; y1: number }): void {
  const roi = padBox(bounds, Math.max(8, Math.round(region.lineHeight * 0.5)), width, height);
  const w = roi.x1 - roi.x0;
  const h = roi.y1 - roi.y0;
  if (w <= 0 || h <= 0) return;
  const src = new cv.Mat(h, w, cv.CV_8UC3);
  const m = new cv.Mat(h, w, cv.CV_8UC1);
  const dst = new cv.Mat();
  try {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = (y + roi.y0) * width + x + roi.x0;
        const o = y * w + x;
        src.data[o * 3] = rgba[p * 4];
        src.data[o * 3 + 1] = rgba[p * 4 + 1];
        src.data[o * 3 + 2] = rgba[p * 4 + 2];
        m.data[o] = mask[p];
      }
    }
    cv.inpaint(src, m, dst, Math.max(3, Math.round(region.lineHeight * 0.15)), cv.INPAINT_TELEA);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const o = y * w + x;
        if (!m.data[o]) continue;
        const p = (y + roi.y0) * width + x + roi.x0;
        rgba[p * 4] = dst.data[o * 3];
        rgba[p * 4 + 1] = dst.data[o * 3 + 1];
        rgba[p * 4 + 2] = dst.data[o * 3 + 2];
      }
    }
  } finally {
    src.delete(); m.delete(); dst.delete();
  }
}

const MEDIAFILE_REF_PREFIX = 'local-resource://mediafile/';

/** Local file behind an image URL, or null when it is not a readable local image. */
export async function resolveSourcePath(ref: string, mediaDir: string): Promise<string | null> {
  if (!isLocalImageSource(ref)) return null;
  let file: string;
  try {
    file = ref.startsWith(MEDIAFILE_REF_PREFIX)
      ? decodeURIComponent(ref.slice(MEDIAFILE_REF_PREFIX.length).split(/[?#]/)[0])
      : fileUrlToPath(ref.split(/[?#]/)[0], mediaDir);
  } catch {
    return null;
  }
  const isLibrary = ref.startsWith('local-resource://media/');
  if (!isLibrary && !TRANSLATABLE_IMAGE_EXTS.includes(path.extname(file).toLowerCase())) return null;
  try {
    return (await fs.stat(file)).isFile() ? file : null;
  } catch {
    return null;
  }
}

/** Names and casing-only changes ("ARKE KİLİSESİ" → "ARKE Kilisesi") are left as drawn. */
export function sameText(a: string, b: string): boolean {
  const norm = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  return norm(a) === norm(b);
}

/**
 * A lone capitalised word that translates to another lone word is usually a name or a logo
 * ("ARKE" → "ARCHE"): leave it. Phrases ("KİLİSE ADIMIZ") and single words that become phrases
 * ("WELCOME" → "HOŞ GELDİNİZ") are still translated.
 */
export function looksLikeName(original: string, translated: string): boolean {
  const words = (s: string) => s.trim().split(/\s+/).filter((w) => /\p{L}/u.test(w));
  const source = words(original);
  if (source.length !== 1 || words(translated).length !== 1) return false;
  return source[0] === source[0].toLocaleUpperCase() || /^\p{Lu}/u.test(source[0]);
}

function keepTranslation(original: string, translated: string): boolean {
  return !!translated && !sameText(translated, original) && !looksLikeName(original, translated);
}

const css = (c: Rgb) => `rgb(${c[0]}, ${c[1]}, ${c[2]})`;

// ── Persistent results ──────────────────────────────────────────────────────
// Every finished translation is remembered by the SOURCE CONTENT (not its path) and the language
// pair, so the same picture is never processed twice and a result is never lost: the editor, the
// bulk tool and the phone broadcast all get the stored copy instantly. Bump PIPELINE_VERSION when
// the rendering changes so stale results are redone.
const PIPELINE_VERSION = 3;
interface IndexEntry { ref?: string; noText?: true; regions?: { original: string; translated: string }[]; at: number }
interface TranslationIndex { version: 1; entries: Record<string, IndexEntry> }

const indexCache = new Map<string, Promise<TranslationIndex>>();
function readIndex(file: string): Promise<TranslationIndex> {
  let cached = indexCache.get(file);
  if (!cached) {
    cached = fs.readFile(file, 'utf8').then(
      (text) => {
        const parsed = JSON.parse(text);
        return parsed && parsed.version === 1 && parsed.entries && typeof parsed.entries === 'object' ? parsed : { version: 1, entries: {} };
      },
      () => ({ version: 1, entries: {} }) as TranslationIndex,
    );
    indexCache.set(file, cached);
  }
  return cached;
}
const indexWrites = new Map<string, Promise<void>>();
async function writeIndexEntry(file: string, key: string, entry: IndexEntry): Promise<void> {
  const index = await readIndex(file);
  index.entries[key] = entry;
  const previous = indexWrites.get(file) ?? Promise.resolve();
  const next = previous.then(async () => {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const temp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(temp, JSON.stringify(index));
    await fs.rename(temp, file);
  }).catch(() => undefined);
  indexWrites.set(file, next);
  await next;
}

async function contentKey(file: string, request: ImageTranslateRequest): Promise<string> {
  const hash = crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex').slice(0, 24);
  return `v${PIPELINE_VERSION}|${hash}|${request.source}|${request.target}`;
}

async function libraryRefExists(ref: string, dir: string): Promise<boolean> {
  const file = await resolveSourcePath(ref, dir);
  return !!file;
}

/** Translations in progress, so the editor and the phone broadcast never run the same job twice. */
const inFlight = new Map<string, Promise<ImageTranslateResult>>();

export async function translateLibraryImage(deps: ImageTranslateDeps, request: ImageTranslateRequest): Promise<ImageTranslateResult> {
  const source = typeof request.ref === 'string' ? await resolveSourcePath(request.ref, deps.dir) : null;
  if (!source) return { ok: false, reason: 'not-found' };
  const key = deps.indexPath ? await contentKey(source, request) : null;
  if (key && deps.indexPath) {
    const hit = (await readIndex(deps.indexPath)).entries[key];
    if (hit?.noText) return { ok: false, reason: 'no-text' };
    if (hit?.ref && (await libraryRefExists(hit.ref, deps.dir))) return { ok: true, ref: hit.ref, regions: hit.regions ?? [], cached: true };
  }
  if (request.cachedOnly) return { ok: false, reason: 'not-cached' };
  const jobKey = key ?? `${source}|${request.source}|${request.target}`;
  let job = inFlight.get(jobKey);
  if (!job) {
    job = runTranslation(deps, request, source).finally(() => inFlight.delete(jobKey));
    inFlight.set(jobKey, job);
  }
  const result = await job;
  if (key && deps.indexPath) {
    if (result.ok) await writeIndexEntry(deps.indexPath, key, { ref: result.ref, regions: result.regions, at: Date.now() });
    else if (result.reason === 'no-text') await writeIndexEntry(deps.indexPath, key, { noText: true, at: Date.now() });
  }
  return result;
}

async function runTranslation(deps: ImageTranslateDeps, request: ImageTranslateRequest, source: string): Promise<ImageTranslateResult> {
  try {
    const sharp = loadSharp();
    const meta = await sharp(source, { failOn: 'none' }).metadata();
    let pipeline = sharp(source, { failOn: 'none', pages: 1 }).rotate();
    if (Math.max(meta.width ?? 0, meta.height ?? 0) > MAX_EDGE) {
      pipeline = pipeline.resize({ width: MAX_EDGE, height: MAX_EDGE, fit: 'inside', withoutEnlargement: true });
    }
    const { data, info } = await pipeline.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const width: number = info.width;
    const height: number = info.height;
    const rgba = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    const png: Buffer = await sharp(data, { raw: { width, height, channels: 4 } }).png({ compressionLevel: 1 }).toBuffer();

    const ocr = deps.ocr ?? tesseractOcr(deps.cacheDir);
    const regions = selectRegions(await ocr(png, ocrLangsFor(request.source)), width, request.source === 'auto' ? undefined : request.source);
    if (!regions.length) return { ok: false, reason: 'no-text' };

    let translations: string[];
    try {
      translations = await (deps.translate ?? freeTranslate())(regions.map((r) => r.text), request.source, request.target);
    } catch (error) {
      return { ok: false, reason: 'translate-failed', message: error instanceof Error ? error.message : String(error) };
    }
    const work = regions
      .map((region, i) => ({ region, translated: (translations[i] ?? '').trim() }))
      .filter((item) => keepTranslation(item.region.text, item.translated));
    if (!work.length) return { ok: false, reason: 'no-text' };

    // Colours and masks come from the untouched pixels; inpainting then edits a working copy.
    const original = Uint8Array.from(rgba);
    const prepared = work.map((item) => {
      const colors = estimateColors(original, width, height, item.region);
      return { ...item, colors, mask: buildTextMask(original, width, height, item.region, colors) };
    });
    const { cv } = await loadOpenCv();
    for (const item of prepared) inpaintRegion(cv, rgba, width, height, item.mask.mask, item.region, item.mask.bounds);

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createCanvas } = require('@napi-rs/canvas');
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    const image = ctx.createImageData(width, height);
    image.data.set(rgba);
    ctx.putImageData(image, 0, 0);
    for (const { region, translated, colors, mask } of prepared) {
      const weight = weightFromStroke(mask.strokeRatio);
      const measure = (text: string, size: number) => {
        ctx.font = `${weight}${size}px ${FONT_STACK}`;
        return ctx.measureText(text).width;
      };
      const fitted = fitText(measure, translated, region);
      ctx.font = `${weight}${fitted.fontSize}px ${FONT_STACK}`;
      ctx.fillStyle = css(colors.text);
      ctx.textBaseline = 'top';
      ctx.textAlign = region.align;
      const boxH = region.bbox.y1 - region.bbox.y0;
      const totalH = fitted.lines.length * fitted.lineHeight - (fitted.lineHeight - fitted.fontSize);
      let y = region.bbox.y0 + (boxH - totalH) / 2;
      const x = region.align === 'left' ? region.bbox.x0 : region.align === 'right' ? region.bbox.x1 : (region.bbox.x0 + region.bbox.x1) / 2;
      for (const line of fitted.lines) {
        ctx.fillText(line, x, y);
        y += fitted.lineHeight;
      }
    }

    const raw = Buffer.from(ctx.getImageData(0, 0, width, height).data.buffer);
    const out = sharp(raw, { raw: { width, height, channels: 4 } });
    // Many opaque PNGs still carry an alpha channel: keep PNG only when something is see-through.
    let transparent = false;
    if (meta.hasAlpha) for (let i = 3; i < original.length && !transparent; i += 4) transparent = original[i] < 255;
    const [ext, bytes]: [string, Buffer] = transparent
      ? ['.png', await out.png({ compressionLevel: 9 }).toBuffer()]
      : ['.jpg', await out.flatten().jpeg({ quality: 92, mozjpeg: true }).toBuffer()];
    const ref = await deps.storeBytes(bytes, ext);
    if (!ref) return { ok: false, reason: 'failed', message: 'Could not store the translated image' };
    return { ok: true, ref, regions: prepared.map((p) => ({ original: p.region.text, translated: p.translated })) };
  } catch (error) {
    return { ok: false, reason: 'failed', message: error instanceof Error ? error.message : String(error) };
  }
}
