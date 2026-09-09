/**
 * On-demand, disk-cached UI thumbnails for the media browser panel
 * (MediaTab.tsx) — Phase 7 perf work.
 *
 * This is deliberately a separate concern from mediaLibrary.ts:
 *   - mediaLibrary.ts is the persistent, content-hash-addressed store used
 *     when *embedding* media into a saved .gpres (correctness-critical,
 *     keyed by file bytes so identical content is never duplicated).
 *   - mediaThumbnails.ts is a *disposable* cache of small preview images for
 *     browsing arbitrary file-system paths before anything is added to a
 *     presentation. It's keyed by (path, size, mtime) — a stat() call,
 *     not a content hash — because the whole point is to avoid reading a
 *     20MB source photo just to answer "do we already have a thumbnail?".
 *     If the cache is deleted entirely, nothing is lost; it just regenerates
 *     lazily on next use (same "graceful degradation" philosophy as
 *     mediaLibrary.ts).
 *
 * Pure Node module (no electron import at the top level) so it stays unit
 * -testable outside Electron; the app/nativeImage modules are lazily
 * required, matching the pattern in mediaLibrary.ts's getMediaLibrary().
 *
 * ── Integration (not wired automatically — this repo's main.ts / preload.ts
 *    weren't part of this change, so wire these by hand) ──────────────────
 *
 * main.ts:
 *   import { getOrCreateThumbnail, thumbRefToPath, pruneThumbnailCache } from './mediaThumbnails';
 *
 *   ipcMain.handle('media:getThumbnail', async (_evt, filePath: string, maxEdge: number) => {
 *     try { return await getOrCreateThumbnail(filePath, { maxEdge }); }
 *     catch { return null; }
 *   });
 *
 *   // Extend your existing local-resource protocol resolver with a branch
 *   // for the thumbs/ prefix (it already has one for media/ refs):
 *   //   if (url.startsWith('local-resource://thumbs/')) {
 *   //     const p = thumbRefToPath(url);
 *   //     if (p) return net.fetch(pathToFileURL(p).toString());
 *   //   }
 *
 *   // Optional: bound disk usage growth over time (renamed/moved/edited
 *   // source files leave orphaned cache entries otherwise).
 *   app.whenReady().then(() => { void pruneThumbnailCache(); });
 *
 * preload.ts (add to the object passed to contextBridge.exposeInMainWorld):
 *   getMediaThumbnail: (filePath: string, maxEdge: number) =>
 *     ipcRenderer.invoke('media:getThumbnail', filePath, maxEdge),
 *
 * Everything on the renderer side (MediaTab.tsx) already calls
 * `window.electronAPI?.getMediaThumbnail?.(...)` defensively and falls back
 * to an in-renderer createImageBitmap downscale when it's absent, so this
 * module is an optional-but-recommended upgrade, not a hard dependency —
 * drop it in whenever convenient.
 *
 * Optional dependency: `npm install sharp` for fast, cross-platform,
 * broad-format (incl. TIFF/AVIF/HEIC) thumbnailing via libvips. Without it,
 * this falls back to Electron's nativeImage.createThumbnailFromPath, which
 * only covers common raster formats and is NOT available on Linux (Electron
 * compiles it out on that platform) — sharp is the only reliable
 * cross-platform path. If neither is available/succeeds, this returns null
 * and the renderer's own fallback takes over; nothing breaks either way.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { execFile } from 'node:child_process';

export const THUMB_REF_PREFIX = 'local-resource://thumbs/';
// The browser's grid uses minmax(375px, 1fr), so a card can render as
// narrow as 375px with object-fit:cover — meaning the thumbnail's long edge
// needs to be at or above 375px just to avoid upscaling on the *smallest*
// card, before even considering retina displays. 400 keeps a small margin
// above that floor without going all the way to a full 2x-retina target
// (750px+), which would erase most of the size/decode win this is for.
// At WebP quality 65, cropped-and-shrunk photo content at this size shows
// no visible banding or blocking — well above WebP's "obviously lossy"
// threshold, which sits lower, around 40-50 for photographic content.
// Keep in sync with THUMB_MAX_EDGE in MediaTab.tsx's renderer fallback so
// both paths produce comparably-sized/looking previews for the same file.
const DEFAULT_MAX_EDGE = 400;
const DEFAULT_WEBP_QUALITY = 65;
// Note: no JPEG quality constant here — the nativeImage fallback below
// outputs PNG via toPNG() (no quality knob) rather than toJPEG(), because
// switching it to JPEG would flatten transparent PNGs to an opaque
// background. That's an acceptable trade for the *primary* sharp path
// (which already avoids the problem by choosing WebP, alpha and all) but
// not worth it for a secondary, best-effort, Windows/macOS-only fallback.

const VIDEO_EXTS = new Set(['.mp4', '.webm', '.mov', '.mkv', '.avi', '.m4v', '.wmv', '.flv', '.mpeg', '.mpg']);

// Timestamp (seconds) to seek to for the thumbnail frame. 8% into the video
// is usually past any black fade-in while still being early enough to avoid
// encoding artifacts on very long files.
const VIDEO_SEEK_PCT = 0.08;

// ─── sharp (optional) ───────────────────────────────────────
// `any` on purpose: sharp may not be a declared dependency at all, and we
// don't want a missing @types/sharp (or missing sharp itself) to break the
// TypeScript build for people who choose the nativeImage/renderer fallback
// path instead.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let sharpModule: any | null | undefined; // undefined = not attempted yet
function loadSharp(): any | null {
  if (sharpModule !== undefined) return sharpModule;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    sharpModule = require('sharp');
  } catch {
    sharpModule = null;
  }
  return sharpModule;
}

// ─── Bounded concurrency queue ────────────────────────────────
// Sized to the machine, not to how many files were dropped in a folder: a
// 5,000-image folder scan should not try to spin up 5,000 sharp jobs at
// once. In practice the renderer only ever asks for thumbnails of currently
// -mounted (i.e. visible) cards, so the natural request rate is already
// small — this is a second line of defense.
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
          const next = queue.shift();
          if (next) next();
        });
    };
    if (active < CONCURRENCY) run();
    else queue.push(run);
  });
}

// ─── Thumbnail directory (lazy electron singleton, mirrors mediaLibrary.ts) ─
let thumbDirCache: string | null = null;
function getThumbDir(): string {
  if (thumbDirCache) return thumbDirCache;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { app } = require('electron') as typeof import('electron');
  thumbDirCache = path.join(app.getPath('userData'), 'thumbnails');
  return thumbDirCache;
}

function cacheKey(filePath: string, size: number, mtimeMs: number, maxEdge: number): string {
  return crypto
    .createHash('sha1')
    .update(`${filePath}:${size}:${mtimeMs}:${maxEdge}`)
    .digest('hex')
    .slice(0, 20);
}

/** True for `local-resource://thumbs/<name>` refs. */
export function thumbRefToPath(url: string): string | null {
  if (!url.startsWith(THUMB_REF_PREFIX)) return null;
  const name = url.slice(THUMB_REF_PREFIX.length);
  if (name === '..' || name.includes('..') || !/^[a-zA-Z0-9._-]+$/.test(name)) return null;
  return path.join(getThumbDir(), name);
}

// ─── ffmpeg video thumbnail ──────────────────────────────────
// Resolves to the path of the ffmpeg binary. Tries (in order):
//   1. The ffmpeg-static npm package bundled with the app (if installed)
//   2. The system ffmpeg on PATH
// Returns null if neither is found.
function findFfmpeg(): string | null {
  // 1. ffmpeg-static (optional npm dep)
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const p = require('ffmpeg-static') as string | null;
    if (p) return p;
  } catch {
    /* not installed */
  }
  // 2. System PATH
  const candidates =
    process.platform === 'win32' ? ['ffmpeg.exe', 'ffmpeg'] : ['ffmpeg'];
  for (const name of candidates) {
    try {
      // Synchronous check: resolvePathSync is not available, so we try
      // spawnSync with a cheap flag to confirm it exists.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { spawnSync } = require('node:child_process') as typeof import('node:child_process');
      const r = spawnSync(name, ['-version'], { timeout: 3000 });
      if (r.status === 0 || r.status === 1) return name; // 1 on some builds
    } catch {
      /* keep trying */
    }
  }
  return null;
}

// Get video duration in seconds via ffprobe / ffmpeg itself.
function getVideoDuration(ffmpegPath: string, videoPath: string): Promise<number> {
  return new Promise((resolve) => {
    // Try ffprobe first (same dir as ffmpeg)
    const dir = path.dirname(ffmpegPath);
    const probeNames = process.platform === 'win32'
      ? [path.join(dir, 'ffprobe.exe'), 'ffprobe.exe', 'ffprobe']
      : [path.join(dir, 'ffprobe'), 'ffprobe'];

    const tryNext = (idx: number) => {
      if (idx >= probeNames.length) { resolve(0); return; }
      execFile(probeNames[idx], [
        '-v', 'error',
        '-show_entries', 'format=duration',
        '-of', 'default=noprint_wrappers=1:nokey=1',
        videoPath,
      ], { timeout: 5000 }, (err, stdout) => {
        if (err) { tryNext(idx + 1); return; }
        const d = parseFloat(stdout.trim());
        resolve(Number.isFinite(d) && d > 0 ? d : 0);
      });
    };
    tryNext(0);
  });
}

/**
 * Generates a JPEG thumbnail for a video file using ffmpeg.
 * Returns null if ffmpeg is not found or fails.
 */
async function generateVideoThumbnailBytes(
  sourcePath: string,
  maxEdge: number,
  tempDir: string,
): Promise<{ data: Buffer; ext: string } | null> {
  const ffmpegPath = findFfmpeg();
  if (!ffmpegPath) return null;

  // Get duration so we can seek to a good frame
  const duration = await getVideoDuration(ffmpegPath, sourcePath);
  // Use 8% into the video, or at least 1s, but not past (dur-0.5)
  let seekSec = duration > 0 ? Math.min(Math.max(duration * VIDEO_SEEK_PCT, 0.5), Math.max(duration - 0.5, 0)) : 0;
  // For very short clips (<2s), seek to a small but non-zero timestamp
  if (seekSec <= 0 && duration > 0) seekSec = Math.min(0.1, duration);

  const tempFile = path.join(tempDir, `vthumb-${process.pid}-${Date.now()}.jpg`);

  const args = [
    '-ss', String(seekSec),
    '-i', sourcePath,
    '-vframes', '1',
    '-vf', `scale='if(gt(iw,ih),${maxEdge},-2)':'if(gt(iw,ih),-2,${maxEdge})'`,
    '-q:v', '3',
    '-y',
    tempFile,
  ];

  const ok = await new Promise<boolean>((resolve) => {
    execFile(ffmpegPath, args, { timeout: 15000 }, (err) => {
      resolve(!err);
    });
  });

  if (!ok) {
    // Retry at frame 0 (no -ss) — handles files with no seekable index
    const args0 = [
      '-i', sourcePath,
      '-vframes', '1',
      '-vf', `scale='if(gt(iw,ih),${maxEdge},-2)':'if(gt(iw,ih),-2,${maxEdge})'`,
      '-q:v', '3',
      '-y',
      tempFile,
    ];
    const ok0 = await new Promise<boolean>((resolve) => {
      execFile(ffmpegPath, args0, { timeout: 15000 }, (err) => resolve(!err));
    });
    if (!ok0) return null;
  }

  try {
    const data = await fs.readFile(tempFile);
    await fs.rm(tempFile, { force: true });
    return { data, ext: '.jpg' };
  } catch {
    return null;
  }
}

async function generateThumbnailBytes(
  sourcePath: string,
  maxEdge: number,
): Promise<{ data: Buffer; ext: string } | null> {
  const sharp = loadSharp();
  if (sharp) {
    try {
      const data: Buffer = await sharp(sourcePath)
        .rotate() // respect EXIF orientation instead of baking in a sideways thumbnail
        .resize({
          width: maxEdge,
          height: maxEdge,
          fit: 'inside',
          withoutEnlargement: true,
          // For JPEG/WebP sources, libvips can decode at a reduced DCT
          // scale (1/2, 1/4, 1/8) instead of decoding at full resolution
          // and immediately throwing most of it away here — free speedup,
          // zero quality cost since we're downscaling anyway. This is
          // sharp's own default; spelled out explicitly so it doesn't
          // silently regress if a future sharp version changes it.
          fastShrinkOnLoad: true,
          // 'lanczos3' (the default) is the highest-quality kernel and the
          // slowest. At thumbnail size — a fixed 215px-tall card, itself
          // further scaled by the browser via object-fit — the difference
          // vs. 'linear' is not perceptible, and linear is noticeably
          // cheaper to compute, especially from larger source resolutions.
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

  // nativeImage.createThumbnailFromPath is compiled out on Linux and only
  // covers common raster formats elsewhere — best-effort fallback only.
  if (process.platform !== 'linux') {
    try {
      const { nativeImage } = require('electron') as typeof import('electron');
      if (typeof nativeImage.createThumbnailFromPath === 'function') {
        const img = await nativeImage.createThumbnailFromPath(sourcePath, {
          width: maxEdge,
          height: maxEdge,
        });
        if (!img.isEmpty()) {
          return { data: img.toPNG(), ext: '.png' };
        }
      }
    } catch (err) {
      console.warn(
        `[thumbnails] nativeImage fallback failed for ${sourcePath}: ${(err as Error)?.message ?? err}`,
      );
    }
  }

  return null; // caller (renderer) will fall back to its own downscale path
}

/**
 * Returns a `local-resource://thumbs/<name>` ref for a small preview of
 * `filePath`, generating and disk-caching it on first request. Returns null
 * if the file is missing or generation failed on every available path (sharp
 * absent/failed, nativeImage absent/unsupported) — never throws, so a bad
 * or unreadable file just means "no thumbnail today", not a crashed scan.
 */
export async function getOrCreateThumbnail(
  filePath: string,
  opts?: { maxEdge?: number },
): Promise<string | null> {
  const maxEdge = opts?.maxEdge ?? DEFAULT_MAX_EDGE;

  let stat;
  try {
    stat = await fs.stat(filePath);
  } catch {
    return null; // file doesn't exist (e.g. removable media unplugged) — not our problem to solve here
  }

  const key = cacheKey(filePath, stat.size, stat.mtimeMs, maxEdge);
  const dir = getThumbDir();

  // Fast path: already generated under either possible extension. No
  // concurrency slot consumed, no re-encode — this is the common case once
  // a folder has been browsed once.
  for (const ext of ['.webp', '.png']) {
    const candidate = path.join(dir, `${key}${ext}`);
    try {
      await fs.access(candidate);
      return `${THUMB_REF_PREFIX}${key}${ext}`;
    } catch {
      /* keep looking */
    }
  }

  return schedule(async () => {
    const dir = getThumbDir();
    await fs.mkdir(dir, { recursive: true });

    // Video files: use ffmpeg to extract a frame, skip the sharp/nativeImage path
    const ext = path.extname(filePath).toLowerCase();
    if (VIDEO_EXTS.has(ext)) {
      const result = await generateVideoThumbnailBytes(filePath, maxEdge, dir);
      if (!result) return null;

      const destName = `${key}${result.ext}`;
      const dest = path.join(dir, destName);
      const temp = `${dest}.${process.pid}.${Date.now()}.tmp`;
      try {
        await fs.writeFile(temp, result.data);
        await fs.rename(temp, dest);
        return `${THUMB_REF_PREFIX}${destName}`;
      } catch (err) {
        try { await fs.rm(temp, { force: true }); } catch { /* best-effort */ }
        console.warn(`[thumbnails] video write failed for ${filePath}: ${(err as Error)?.message ?? err}`);
        return null;
      }
    }

    const result = await generateThumbnailBytes(filePath, maxEdge);
    if (!result) return null;

    const destName = `${key}${result.ext}`;
    const dest = path.join(dir, destName);
    const temp = `${dest}.${process.pid}.${Date.now()}.tmp`;
    try {
      await fs.writeFile(temp, result.data);
      await fs.rename(temp, dest); // atomic swap — never serve a half-written thumbnail
      return `${THUMB_REF_PREFIX}${destName}`;
    } catch (err) {
      try {
        await fs.rm(temp, { force: true });
      } catch {
        /* best-effort cleanup */
      }
      console.warn(`[thumbnails] write failed for ${filePath}: ${(err as Error)?.message ?? err}`);
      return null;
    }
  });
}

/**
 * Deletes cached thumbnails untouched for longer than `maxAgeMs` (default
 * 30 days). Safe to call on every app start — cheap when the cache is
 * small, and prevents unbounded disk growth from thumbnails of files that
 * were later moved, edited, or deleted (their old cache entries become
 * orphaned since the key includes the original stat, but nothing ever
 * proactively removes them otherwise).
 */
export async function pruneThumbnailCache(maxAgeMs = 30 * 24 * 60 * 60 * 1000): Promise<void> {
  const dir = getThumbDir();
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return; // no cache directory yet — nothing to prune
  }

  const now = Date.now();
  await Promise.all(
    entries.map(async name => {
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