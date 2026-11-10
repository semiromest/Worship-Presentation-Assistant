/**
 * One-click media optimizer (desktop).
 *
 * Images are re-encoded here with sharp (libvips: mozjpeg, libimagequant palette PNG) — the same
 * codecs Squoosh ships as WebAssembly, run natively so a whole deck takes seconds. Videos are
 * transcoded in the renderer (WebCodecs, hardware encoders); this module only receives the
 * finished bytes through a chunked sink so a large video never crosses IPC in one piece.
 *
 * Originals are never touched: results go into the content-addressed media library under a new
 * name and the caller swaps the references (one undo step).
 *
 * Pure Node module (no electron import) so it can be unit-tested with tsx.
 */
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { mediaRefToName, MEDIA_REF_PREFIX } from '../shared/mediaTree';
import { renameWithRetry } from './atomicFile';
import {
  IMAGE_MAX_EDGE, IMAGE_MIN_BYTES, IMAGE_MIN_SAVING, JPEG_QUALITY, PNG_QUALITY,
  OPTIMIZABLE_IMAGE_EXTS, OPTIMIZABLE_VIDEO_EXTS, type ImageOptimizeResult,
} from '../shared/mediaOptimize';

export interface OptimizerLibrary {
  dir: string;
  storeBytes: (data: Buffer, ext: string) => Promise<string | null>;
}

/** sharp is a native module and most sessions never optimize anything: load it on demand. */
function loadSharp(): any {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const sharp = require('sharp');
  sharp.cache(false); // no open handles on files the user may want to move or delete
  return sharp;
}

/** Re-encodes one library image; null when it is not worth replacing (already small / no gain). */
export async function optimizeLibraryImage(lib: OptimizerLibrary, ref: string): Promise<ImageOptimizeResult | null> {
  const name = typeof ref === 'string' ? mediaRefToName(ref) : null;
  if (!name) return null;
  const ext = path.extname(name).toLowerCase();
  if (!OPTIMIZABLE_IMAGE_EXTS.has(ext)) return null;
  const source = path.join(lib.dir, name);
  const before = (await fs.stat(source)).size;
  if (before < IMAGE_MIN_BYTES) return null;

  const sharp = loadSharp();
  const options = { failOn: 'none', limitInputPixels: 268_402_689 };
  const meta = await sharp(source, options).metadata();
  if (!meta.width || !meta.height || (meta.pages ?? 1) > 1) return null; // animated: leave alone
  let pipeline = sharp(source, options).rotate();
  if (Math.max(meta.width, meta.height) > IMAGE_MAX_EDGE) {
    pipeline = pipeline.resize({ width: IMAGE_MAX_EDGE, height: IMAGE_MAX_EDGE, fit: 'inside', withoutEnlargement: true });
  }

  let outExt: string;
  let data: Buffer;
  if (meta.hasAlpha) {
    outExt = '.png';
    data = await pipeline.png({ palette: true, quality: PNG_QUALITY, effort: 8, compressionLevel: 9 }).toBuffer();
  } else if (ext === '.webp') {
    outExt = '.webp';
    data = await pipeline.webp({ quality: 80, effort: 5 }).toBuffer();
  } else {
    outExt = '.jpg';
    data = await pipeline.jpeg({ quality: JPEG_QUALITY, mozjpeg: true }).toBuffer();
  }
  if (data.length > before * (1 - IMAGE_MIN_SAVING)) return null;
  const stored = await lib.storeBytes(data, outExt);
  return stored ? { from: ref, to: stored, before, after: data.length } : null;
}

/** Size of one library media ref in bytes (0 when it is not a library file). */
export async function libraryFileSize(lib: OptimizerLibrary, ref: string): Promise<number> {
  const name = typeof ref === 'string' ? mediaRefToName(ref) : null;
  if (!name) return 0;
  try { return (await fs.stat(path.join(lib.dir, name))).size; } catch { return 0; }
}

// ── chunked sink for renderer-side video transcodes ─────────────────────────

interface Sink { file: string; handle: import('node:fs/promises').FileHandle }

export function createVideoSinks(dir: string) {
  const sinks = new Map<string, Sink>();
  const tmpDir = path.join(dir, '.optimize');
  const find = (id: string): Sink => {
    const sink = sinks.get(id);
    if (!sink) throw new Error('Unknown optimize session');
    return sink;
  };
  const drop = async (id: string) => {
    const sink = sinks.get(id);
    if (!sink) return;
    sinks.delete(id);
    await sink.handle.close().catch(() => {});
    await fs.rm(sink.file, { force: true }).catch(() => {});
  };

  return {
    async begin(): Promise<string> {
      await fs.mkdir(tmpDir, { recursive: true });
      const id = crypto.randomUUID();
      const file = path.join(tmpDir, `${id}.part`);
      sinks.set(id, { file, handle: await fs.open(file, 'w') });
      return id;
    },
    /** Random-access writes: MP4 patches its header at the end, so positions are honoured. */
    async write(id: string, position: number, bytes: unknown): Promise<void> {
      const sink = find(id);
      if (!Number.isSafeInteger(position) || position < 0 || !(bytes instanceof Uint8Array)) throw new Error('Bad chunk');
      await sink.handle.write(bytes, 0, bytes.byteLength, position);
    },
    /** Moves the finished file into the media library (content-addressed). Null for an empty file. */
    async finish(id: string, ext: string): Promise<{ ref: string; bytes: number } | null> {
      const sink = find(id);
      const cleanExt = String(ext).toLowerCase();
      if (!OPTIMIZABLE_VIDEO_EXTS.has(cleanExt)) {
        await drop(id);
        throw new Error('Unsupported output type');
      }
      await sink.handle.close();
      sinks.delete(id);
      try {
        const bytes = (await fs.stat(sink.file)).size;
        if (bytes === 0) return null;
        const hash = crypto.createHash('sha256');
        for await (const chunk of createReadStream(sink.file)) hash.update(chunk as Buffer);
        const name = `${hash.digest('hex').slice(0, 16)}${cleanExt}`;
        const target = path.join(dir, name);
        try {
          await fs.access(target);
        } catch {
          await fs.mkdir(dir, { recursive: true });
          await renameWithRetry(sink.file, target);
        }
        return { ref: `${MEDIA_REF_PREFIX}${name}`, bytes };
      } finally {
        await fs.rm(sink.file, { force: true }).catch(() => {});
      }
    },
    abort: drop,
    /** Leftovers of an interrupted session (app closed mid-transcode). */
    async clean(): Promise<void> {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    },
  };
}
