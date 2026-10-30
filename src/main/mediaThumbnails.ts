/**
 * On-demand, disk-cached UI thumbnails for the media browser panel (MediaLoopTab.tsx).
 *
 * Separate from mediaLibrary.ts: that one is the persistent, content-hash-addressed store used
 * when embedding media into a .gpres. This is a *disposable* cache of small previews for browsing
 * arbitrary paths, keyed by (path, size, mtime, edge) via stat() so a 20MB source is never read
 * just to learn whether a thumbnail exists. Deleting the cache loses nothing; it regenerates lazily.
 *
 * Pure Node module (electron is required lazily) so it stays unit-testable outside Electron.
 *
 * Integration (wire by hand in main.ts / preload.ts):
 *   ipcMain.handle('media:getThumbnail', async (_e, filePath: string, maxEdge: number) => {
 *     try { return await getOrCreateThumbnail(filePath, { maxEdge }); } catch { return null; }
 *   });
 *   // local-resource protocol resolver: for 'local-resource://thumbs/' use thumbRefToPath(url)
 *   // and net.fetch(pathToFileURL(p).toString()).
 *   app.whenReady().then(() => { void pruneThumbnailCache(); });
 *   // preload: getMediaThumbnail: (p, edge) => ipcRenderer.invoke('media:getThumbnail', p, edge)
 *
 * Optional dependency: `sharp` (fast, cross-platform, broad formats). Without it, Electron's
 * nativeImage.createThumbnailFromPath is used (Windows/macOS only, common formats). If neither
 * works this returns null and the renderer's own downscale fallback takes over.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { execFile } from 'node:child_process';

export const THUMB_REF_PREFIX = 'local-resource://thumbs/';

// Grid cards can be as narrow as 375px with object-fit:cover, so 400 stays just above that floor
// without going to a 2x-retina target. Keep in sync with THUMB_MAX_EDGE in MediaLoopTab.tsx.
const DEFAULT_MAX_EDGE = 400;
const MIN_EDGE = 32;
const MAX_EDGE = 2048;
const DEFAULT_WEBP_QUALITY = 65;
// The nativeImage fallback outputs PNG (toPNG) rather than JPEG so transparent images are not flattened.

const VIDEO_EXTS = new Set(['.mp4', '.webm', '.mov', '.mkv', '.avi', '.m4v', '.wmv', '.flv', '.mpeg', '.mpg']);
/** Seek to ~8% into the video: usually past any black fade-in, early enough to avoid artifacts. */
const VIDEO_SEEK_PCT = 0.08;
const FFMPEG_TIMEOUT_MS = 15_000;

// Hangi uzantının olabileceği kaynağın türünden bellidir; önbellek aramasında boşuna dosya yoklanmaz.
const IMAGE_CACHE_EXTS = ['.webp', '.png'] as const; // sharp: webp, nativeImage yedeği: png
const VIDEO_CACHE_EXTS = ['.jpg'] as const;
const THUMB_NAME_RE = /^[a-f0-9]{20}\.(?:webp|png|jpg)$/;

// ─── sharp (optional) ───────────────────────────────────────
// `any` on purpose: sharp may not be installed, and a missing @types/sharp must not break the build.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let sharpModule: any | null | undefined; // undefined = not attempted yet
function loadSharp(): any | null {
  if (sharpModule !== undefined) return sharpModule;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sharp = require('sharp');
    // Binlerce farklı dosya işlenirken sharp'ın dosya önbelleği boşuna tutamaç ve bellek tutar;
    // Windows'ta açık tutamaçlar kullanıcının dosyayı taşımasını/silmesini engelleyebilir.
    sharp.cache(false);
    sharpModule = sharp;
  } catch {
    sharpModule = null;
  }
  return sharpModule;
}

// ─── Bounded concurrency queue ──────────────────────────────
const CONCURRENCY = Math.max(2, Math.min(6, os.cpus().length || 4));
let active = 0;
const queue: Array<() => void> = [];
function schedule<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const run = () => {
      active++;
      fn()
        .then(resolve, reject)
        .finally(() => {
          active--;
          queue.shift()?.();
        });
    };
    if (active < CONCURRENCY) run();
    else queue.push(run);
  });
}

// ─── Thumbnail directory (lazy electron singleton) ──────────
let thumbDirCache: string | null = null;
function getThumbDir(): string {
  if (thumbDirCache) return thumbDirCache;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { app } = require('electron') as typeof import('electron');
  thumbDirCache = path.join(app.getPath('userData'), 'thumbnails');
  return thumbDirCache;
}

function cacheKey(filePath: string, size: number, mtimeMs: number, maxEdge: number): string {
  return crypto.createHash('sha1').update(`${filePath}:${size}:${mtimeMs}:${maxEdge}`).digest('hex').slice(0, 20);
}

/** Renderer'dan gelen değer güvenilmez: sayı değilse varsayılan, aralık dışıysa kıstırılır. */
function normalizeEdge(value: unknown): number {
  const edge = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : DEFAULT_MAX_EDGE;
  return Math.min(MAX_EDGE, Math.max(MIN_EDGE, edge));
}

/** `local-resource://thumbs/<name>` ref'ini dosya yoluna çevirir; yalnızca bu modülün ürettiği adlar kabul edilir. */
export function thumbRefToPath(url: string): string | null {
  if (typeof url !== 'string' || !url.startsWith(THUMB_REF_PREFIX)) return null;
  const name = url.slice(THUMB_REF_PREFIX.length);
  return THUMB_NAME_RE.test(name) ? path.join(getThumbDir(), name) : null;
}

// ─── ffmpeg video thumbnail ─────────────────────────────────
// Tries, in order: the bundled ffmpeg-static binary, then the system ffmpeg on PATH.
let ffmpegDiscovery: Promise<string | null> | undefined;
function findFfmpeg(): Promise<string | null> {
  return (ffmpegDiscovery ??= (async () => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const bundled = require('ffmpeg-static') as string | null;
      if (bundled) {
        // Paketlenmiş uygulamada asar içindeki ikili çalıştırılamaz; açılmış kopyası kullanılır.
        const real = bundled.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
        await fs.access(real);
        return real;
      }
    } catch {
      /* optional dependency, or binary missing: fall back to PATH */
    }
    const candidates = process.platform === 'win32' ? ['ffmpeg.exe', 'ffmpeg'] : ['ffmpeg'];
    for (const name of candidates) {
      const found = await new Promise<boolean>((resolve) => {
        execFile(name, ['-version'], { timeout: 3000, windowsHide: true }, (error) => resolve(!error));
      });
      if (found) return name;
    }
    return null;
  })());
}

/**
 * Süreyi ffmpeg'in kendisinden okur (`ffmpeg -i dosya` stderr'e "Duration: ..." yazar ve hata koduyla çıkar).
 * ffprobe ayrı bir ikili olduğundan ffmpeg-static ile gelmeyebilir; bu yol ek bağımlılık gerektirmez.
 */
function getVideoDuration(ffmpegPath: string, videoPath: string): Promise<number> {
  return new Promise((resolve) => {
    execFile(
      ffmpegPath,
      ['-hide_banner', '-nostdin', '-i', videoPath],
      { timeout: 5000, windowsHide: true },
      (_error, _stdout, stderr) => {
        const match = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(String(stderr));
        resolve(match ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) : 0);
      },
    );
  });
}

function pickSeekSeconds(duration: number): number {
  if (duration <= 0) return 0;
  const seek = Math.min(Math.max(duration * VIDEO_SEEK_PCT, 0.5), Math.max(duration - 0.5, 0));
  return seek > 0 ? seek : Math.min(0.1, duration); // very short clips: small but non-zero
}

function runFfmpeg(ffmpegPath: string, args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(ffmpegPath, args, { timeout: FFMPEG_TIMEOUT_MS, windowsHide: true }, (error) => resolve(!error));
  });
}

/** Generates a JPEG thumbnail for a video using ffmpeg. Returns null if ffmpeg is missing or fails. */
async function generateVideoThumbnailBytes(
  sourcePath: string,
  maxEdge: number,
  tempDir: string,
): Promise<{ data: Buffer; ext: string } | null> {
  const ffmpegPath = await findFfmpeg();
  if (!ffmpegPath) return null;

  const seek = pickSeekSeconds(await getVideoDuration(ffmpegPath, sourcePath));
  const tempFile = path.join(tempDir, `vthumb-${crypto.randomUUID()}.jpg`);
  const scale = `scale='if(gt(iw,ih),${maxEdge},-2)':'if(gt(iw,ih),-2,${maxEdge})'`;

  try {
    // Önce hesaplanan karede, olmazsa 0. karede dener. Seek dosyanın ötesine düşerse ffmpeg 0 koduyla
    // çıkıp kare üretmeyebilir; bu yüzden başarı ölçütü çıkış kodu değil, çıktının okunabilmesidir.
    for (const at of seek > 0 ? [seek, 0] : [0]) {
      const args = [
        '-hide_banner', '-loglevel', 'error', '-nostdin',
        ...(at > 0 ? ['-ss', String(at)] : []),
        '-i', sourcePath,
        '-frames:v', '1',
        '-vf', scale,
        '-q:v', '3',
        '-y', tempFile,
      ];
      if (!(await runFfmpeg(ffmpegPath, args))) continue;
      try {
        return { data: await fs.readFile(tempFile), ext: '.jpg' };
      } catch {
        /* no frame produced at this position: try the next one */
      }
    }
    return null;
  } finally {
    await fs.rm(tempFile, { force: true }).catch(() => {});
  }
}

async function generateThumbnailBytes(
  sourcePath: string,
  maxEdge: number,
): Promise<{ data: Buffer; ext: string } | null> {
  const sharp = loadSharp();
  if (sharp) {
    try {
      const data: Buffer = await sharp(sourcePath, { failOn: 'none' }) // hafif bozuk dosyadan da küçük resim çıkar
        .rotate() // respect EXIF orientation
        .resize({
          width: maxEdge,
          height: maxEdge,
          fit: 'inside',
          withoutEnlargement: true,
          // JPEG/WebP kaynaklarda libvips küçültülmüş DCT ölçeğinde çözer (sharp varsayılanı; açıkça yazıldı).
          fastShrinkOnLoad: true,
          // 'lanczos3' en kaliteli ve en yavaş çekirdek; bu boyutta 'linear'dan fark algılanmaz.
          kernel: 'linear',
        })
        .webp({ quality: DEFAULT_WEBP_QUALITY })
        .toBuffer();
      return { data, ext: '.webp' };
    } catch (err) {
      console.warn(`[thumbnails] sharp failed for ${sourcePath}: ${(err as Error)?.message ?? err}`);
      // fall through to nativeImage
    }
  }

  // createThumbnailFromPath is compiled out on Linux and covers only common raster formats elsewhere.
  if (process.platform !== 'linux') {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { nativeImage } = require('electron') as typeof import('electron');
      if (typeof nativeImage.createThumbnailFromPath === 'function') {
        const img = await nativeImage.createThumbnailFromPath(sourcePath, { width: maxEdge, height: maxEdge });
        if (!img.isEmpty()) return { data: img.toPNG(), ext: '.png' };
      }
    } catch (err) {
      console.warn(`[thumbnails] nativeImage fallback failed for ${sourcePath}: ${(err as Error)?.message ?? err}`);
    }
  }

  return null; // renderer falls back to its own downscale path
}

async function findCached(dir: string, key: string, exts: readonly string[]): Promise<string | null> {
  for (const ext of exts) {
    try {
      await fs.access(path.join(dir, `${key}${ext}`));
      return `${THUMB_REF_PREFIX}${key}${ext}`;
    } catch {
      /* try next extension */
    }
  }
  return null;
}

async function createThumbnail(filePath: string, key: string, maxEdge: number): Promise<string | null> {
  const dir = getThumbDir();
  const isVideo = VIDEO_EXTS.has(path.extname(filePath).toLowerCase());

  // Önbellek isabeti kuyruğa girmez. Aynı anahtar için eşzamanlı çağrılar zaten inFlight ile tekilleşiyor.
  const cached = await findCached(dir, key, isVideo ? VIDEO_CACHE_EXTS : IMAGE_CACHE_EXTS);
  if (cached) return cached;

  return schedule(async () => {
    // Another request/process may have populated the disk while this job was
    // waiting. Avoid decoding a large source after its thumbnail is available.
    const existing = await findCached(dir, key, isVideo ? VIDEO_CACHE_EXTS : IMAGE_CACHE_EXTS);
    if (existing) return existing;
    await fs.mkdir(dir, { recursive: true });
    const result = isVideo
      ? await generateVideoThumbnailBytes(filePath, maxEdge, dir)
      : await generateThumbnailBytes(filePath, maxEdge);
    if (!result) return null;

    const destName = `${key}${result.ext}`;
    const dest = path.join(dir, destName);
    const temp = `${dest}.${crypto.randomUUID()}.tmp`;
    try {
      await fs.writeFile(temp, result.data);
      await fs.rename(temp, dest);
    } catch (error) {
      // Başarıda temp zaten rename edildi; yalnızca hata yolunda temizle.
      await fs.rm(temp, { force: true }).catch(() => {});
      throw error;
    }
    return `${THUMB_REF_PREFIX}${destName}`;
  });
}

const inFlight = new Map<string, Promise<string | null>>();

/**
 * Returns a `local-resource://thumbs/<name>` ref for a small preview of `filePath`, generating and
 * disk-caching it on first request. Never throws: a bad or unreadable file just means "no thumbnail".
 */
export function getOrCreateThumbnail(filePath: string, opts?: { maxEdge?: number }): Promise<string | null> {
  return (async () => {
    if (typeof filePath !== 'string' || !filePath) return null;
    const maxEdge = normalizeEdge(opts?.maxEdge);

    let stat;
    try {
      stat = await fs.stat(filePath);
    } catch {
      return null; // missing file (e.g. removable media unplugged)
    }

    const key = cacheKey(filePath, stat.size, stat.mtimeMs, maxEdge);
    const pending = inFlight.get(key);
    if (pending) return pending;

    const work: Promise<string | null> = createThumbnail(filePath, key, maxEdge)
      .catch((error: unknown) => {
        console.warn(`[thumbnails] generation failed for ${filePath}: ${String(error)}`);
        return null;
      })
      .finally(() => {
        if (inFlight.get(key) === work) inFlight.delete(key);
      });
    inFlight.set(key, work);
    return work;
  })();
}

/**
 * Deletes cache files whose last write is older than `maxAgeMs` (default 30 days). Prevents unbounded
 * growth from thumbnails of moved/edited/deleted sources and also sweeps orphaned temp files.
 */
export async function pruneThumbnailCache(maxAgeMs = 30 * 24 * 60 * 60 * 1000): Promise<void> {
  const dir = getThumbDir();
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return; // no cache directory yet
  }

  const now = Date.now();
  await Promise.all(
    entries.map(async (name) => {
      const p = path.join(dir, name);
      try {
        const st = await fs.stat(p);
        if (now - st.mtimeMs > maxAgeMs) await fs.rm(p, { force: true });
      } catch {
        /* ignore races with concurrent writers */
      }
    }),
  );
}
