import { useEffect, useRef, useState, useCallback, useMemo, memo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Image as ImageIcon,
  Video,
  Trash2,
  Plus,
  Film,
  FolderOpen,
  ChevronDown,
  RefreshCw,
  X,
  Check,
} from 'lucide-react';
import { loadMediaFolderSettings, saveMediaFolderSettings, type MediaFolderSettings } from './mediaFolderSettings';
import { replaceFolderItems } from './mediaFolderItems';

// ─── Types ────────────────────────────────────────────────
type MediaKind = 'image' | 'video';

interface MediaItem {
  id: string;
  type: MediaKind;
  path: string;
  name: string;
  origin: 'manual' | 'folder';
}

interface MediaTabProps {
  onAddMediaToPresentation: (type: MediaKind, path: string, thumbnailUrl?: string) => void;
}

// ─── Constants ────────────────────────────────────────────
const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tif', 'tiff', 'avif', 'svg']);

const VIDEO_EXTS = new Set(['mp4', 'webm', 'mov', 'mkv', 'avi', 'm4v', 'wmv', 'flv', 'mpeg', 'mpg']);

const THUMBNAIL_TIMEOUT_MS = 8_000;

// Thumbnails are generated at most this size on the long edge. This is the
// single biggest perf lever in this file: the old code pointed <img src>
// straight at the original file, so a 24MP/20MB photo was fully decoded and
// held as a full-resolution bitmap just to be shown in a 375x215 box. Every
// thumbnail path below (main-process cache or in-renderer fallback) instead
// produces something close to display resolution.
//
// 400, not lower: the grid's minmax(375px, 1fr) means a card's *rendered*
// width can be as small as 375px, and with object-fit:cover the wider
// dimension usually has to cover that width. A 320px thumbnail is therefore
// an *upscale* (320/375 = 0.85x) at the grid's own minimum card width —
// visibly softer, not free headroom. 400 keeps a small margin above that
// floor instead of falling under it. It still won't fully cover a 2x retina
// display, but going that far (750px+) would undo most of the size win this
// was meant to capture. Keep this in sync with DEFAULT_MAX_EDGE in
// mediaThumbnails.ts: if they drift apart, the main-process cache and the
// renderer fallback would produce different-looking previews for the same
// file depending on which path served it.
const THUMB_MAX_EDGE = 400;
const THUMB_CACHE_LIMIT = 800; // bounded in-memory LRU, see cacheThumb()

// Virtualization: must match the actual rendered card size (thumb + footer +
// border) so the fixed-row-height windowing math lines up with the DOM.
// If you change s.thumb.height, s.cardFoot padding, or s.card border below,
// update CARD_HEIGHT to match.
const MIN_CARD_WIDTH = 375;
const GRID_GAP = 7;
const CARD_HEIGHT = 253; // 215 (thumb) + 36 (footer) + 2 (border)
const ROW_HEIGHT = CARD_HEIGHT + GRID_GAP;
const OVERSCAN_ROWS = 2;

// ─── Helpers ──────────────────────────────────────────────
const normalizePath = (p: string) => p.replace(/\\/g, '/');

const toFileUrl = (p: string) => {
  const n = normalizePath(p);
  const prefix = n.startsWith('/') ? 'file://' : 'file:///';
  return encodeURI(`${prefix}${n}`);
};

// Stream a media file through the main process's local-resource protocol
// (Range-capable). Unlike file:// URLs this works from the dev-server origin
// (http://localhost:5173), where webSecurity blocks file:// subresources —
// which is exactly why the old <video src="file://..."> thumbnails never
// loaded in dev. Falls back to file:// when the protocol isn't reachable.
// encodeURIComponent: unicode-safe and needs no Buffer polyfill in the
// renderer (nodeIntegration is off); the main-process handler decodes it.
const toMediaStreamUrl = (p: string) => `local-resource://mediafile/${encodeURIComponent(normalizePath(p))}`;

const getFileName = (p: string) => normalizePath(p).split('/').pop() ?? 'Untitled';

const getExtension = (p: string) => getFileName(p).split('.').pop()?.toLowerCase() ?? '';

const detectMediaType = (p: string): MediaKind | null => {
  const ext = getExtension(p);
  if (IMAGE_EXTS.has(ext)) return 'image';
  if (VIDEO_EXTS.has(ext)) return 'video';
  return null;
};

const isMediaFile = (p: string) => detectMediaType(p) !== null;

const makeId = () =>
  globalThis.crypto?.randomUUID?.() ?? `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;

// ─── Virtualization math (pure, unit-testable) ─────────────
// Mirrors CSS `grid-template-columns: repeat(auto-fill, minmax(minCardWidth, 1fr))`:
// the number of tracks that fit is the largest N with N*min + (N-1)*gap <= width.
function computeColumns(containerWidth: number, minCardWidth: number, gap: number): number {
  if (containerWidth <= 0) return 1;
  const cols = Math.floor((containerWidth + gap) / (minCardWidth + gap));
  return Math.max(1, cols);
}

function computeVisibleRange(
  scrollTop: number,
  viewportHeight: number,
  rowHeight: number,
  totalRows: number,
  overscanRows: number
): { startRow: number; endRow: number } {
  if (totalRows <= 0 || rowHeight <= 0) return { startRow: 0, endRow: -1 };
  const rawStart = Math.floor(scrollTop / rowHeight) - overscanRows;
  const rawEnd = Math.ceil((scrollTop + viewportHeight) / rowHeight) + overscanRows;
  const startRow = Math.max(0, rawStart);
  const endRow = Math.min(totalRows - 1, rawEnd);
  return { startRow, endRow };
}

// ─── Concurrency limiter ────────────────────────────────────
// Bounds how many thumbnail jobs run at once. Signal-aware: a job that is
// still queued (never started) when its AbortSignal fires is removed from
// the queue and its promise rejected immediately — it never consumes a
// concurrency slot. Without this, fast scrolling would leave a queue full
// of jobs for cards that already scrolled away, delaying the ones that are
// actually still on screen. Once a job has started, the limiter leaves it
// alone; cancelling in-flight work is the task function's own job (see
// generateImageThumbnail / createVideoThumbnailBlob, which both honor the
// same AbortSignal internally).
function createLimiter(concurrency: number) {
  let active = 0;
  interface QueueEntry {
    run: () => void;
  }
  const queue: QueueEntry[] = [];

  const runNext = () => {
    if (active >= concurrency) return;
    const entry = queue.shift();
    if (!entry) return;
    active++;
    entry.run();
  };

  return function limit<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (signal?.aborted) {
        reject(new DOMException('Aborted', 'AbortError'));
        return;
      }

      let queued = true;
      const entry: QueueEntry = {
        run: () => {
          queued = false;
          fn()
            .then(resolve, reject)
            .finally(() => {
              active--;
              runNext();
            });
        },
      };

      if (signal) {
        const onAbort = () => {
          if (!queued) return; // already started — nothing left to cancel here
          const idx = queue.indexOf(entry);
          if (idx !== -1) queue.splice(idx, 1);
          queued = false;
          reject(new DOMException('Aborted', 'AbortError'));
        };
        signal.addEventListener('abort', onAbort, { once: true });
      }

      queue.push(entry);
      runNext();
    });
  };
}

const limitImageThumb = createLimiter(4);
const limitVideoThumb = createLimiter(2); // video decode is heavier per-job

// ─── Shared thumbnail cache ─────────────────────────────────
// Keyed by normalized path, shared across every mounted MediaCard. This is
// what makes scrolling back to an already-seen card instant instead of
// re-decoding: the virtualization above mounts/unmounts cards constantly,
// but the cache outlives any single card's mount.
interface ThumbEntry {
  url: string;
  isBlob: boolean;
}
const thumbnailCache = new Map<string, ThumbEntry>();

function cacheThumb(key: string, entry: ThumbEntry) {
  if (thumbnailCache.has(key)) thumbnailCache.delete(key);
  thumbnailCache.set(key, entry); // Map preserves insertion order -> FIFO/LRU-ish
  if (thumbnailCache.size > THUMB_CACHE_LIMIT) {
    const oldestKey = thumbnailCache.keys().next().value;
    if (oldestKey !== undefined) {
      const oldest = thumbnailCache.get(oldestKey);
      if (oldest?.isBlob) URL.revokeObjectURL(oldest.url);
      thumbnailCache.delete(oldestKey);
    }
  }
}

// Optional main-process, disk-cached thumbnail generator. See
// mediaThumbnails.ts for the implementation and the main.ts / preload.ts
// wiring notes at the top of that file. Everything here works without it —
// it just falls back to the in-renderer path below — but the IPC path is
// faster and persists across app restarts.
type ExtendedElectronAPI = NonNullable<typeof window.electronAPI> & {
  getMediaThumbnail?: (filePath: string, maxEdge: number) => Promise<string | null>;
};

async function generateImageThumbnail(filePath: string, signal: AbortSignal): Promise<ThumbEntry | null> {
  const api = window.electronAPI as ExtendedElectronAPI | undefined;
  if (api?.getMediaThumbnail) {
    const url = await api.getMediaThumbnail(filePath, THUMB_MAX_EDGE);
    if (signal.aborted) return null;
    return url ? { url, isBlob: false } : null;
  }

  // Fallback: decode+downscale in the renderer. createImageBitmap's decode
  // step runs off the main thread regardless of Worker use; only the small
  // draw+encode below touch it, both cheap at this target size.
  const res = await fetch(toFileUrl(filePath), { signal });
  const blob = await res.blob();
  if (signal.aborted) return null;

  const bitmap = await createImageBitmap(blob, {
    resizeWidth: THUMB_MAX_EDGE,
    resizeQuality: 'medium',
  });
  if (signal.aborted) {
    bitmap.close();
    return null;
  }

  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    return null;
  }
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();

  const outBlob: Blob | null = await new Promise((resolve) =>
    // Quality 65: at 320px this is well above WebP/JPEG's visible-artifact
    // threshold for photographic content, and matches DEFAULT_WEBP_QUALITY
    // in mediaThumbnails.ts so both paths produce comparable file sizes.
    canvas.toBlob(resolve, 'image/jpeg', 0.65)
  );
  if (!outBlob || signal.aborted) return null;
  return { url: URL.createObjectURL(outBlob), isBlob: true };
}

function createVideoThumbnailBlobAttempt(
  filePath: string,
  signal: AbortSignal,
  useCors: boolean,
  timeout: number
): Promise<string | null> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve(null);
      return;
    }
    const video = document.createElement('video');
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;
    video.setAttribute('muted', '');
    video.setAttribute('playsinline', '');
    video.setAttribute('webkit-playsinline', '');
    if (useCors) {
      // The video is loaded from local-resource:// while the renderer usually
      // runs on http://localhost. Without CORS mode, drawing that cross-origin
      // video to canvas taints the canvas; the subsequent getImageData/toBlob
      // calls then throw and every card falls back to the camera icon.
      video.crossOrigin = 'anonymous';
    }
    // Prefer the main-process stream when IPC exists (Electron dev+packaged);
    // the file:// form is only a last resort for non-Electron environments.
    video.src = window.electronAPI ? toMediaStreamUrl(filePath) : toFileUrl(filePath);
    video.load();

    let settled = false;
    let retries = 0;
    const cleanup = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      video.removeAttribute('src');
      try {
        video.load();
      } catch {
        /* noop */
      }
    };
    const done = (result: string | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };
    const onAbort = () => done(null);
    signal.addEventListener('abort', onAbort);

    const timer = setTimeout(() => done(null), timeout);

    const tryCapture = () => {
      try {
        const vw = video.videoWidth || 640;
        const vh = video.videoHeight || 360;
        if (!vw || !vh) {
          done(null);
          return;
        }
        const c = document.createElement('canvas');
        c.width = Math.min(vw, THUMB_MAX_EDGE);
        const scale = c.width / vw;
        c.height = Math.max(1, Math.round(vh * scale));
        const ctx = c.getContext('2d');
        if (!ctx) {
          done(null);
          return;
        }
        try {
          ctx.drawImage(video, 0, 0, c.width, c.height);
        } catch (drawErr) {
          // SecurityError = canvas tainted by cross-origin content.
          // Signal CORS failure so the outer wrapper can retry without crossOrigin.
          if (drawErr instanceof DOMException && drawErr.name === 'SecurityError') {
            done('__cors_error__');
          } else {
            done(null);
          }
          return;
        }
        // All-black frame detection (Chrome/Chromium bug on non-IDR seek)
        const isEmpty = (() => {
          try {
            const imgData = ctx.getImageData(0, 0, Math.min(c.width, 40), Math.min(c.height, 40)).data;
            let sumR = 0,
              sumG = 0,
              sumB = 0,
              samples = 0;
            for (let i = 0; i < imgData.length; i += 4 * 17) {
              sumR += imgData[i];
              sumG += imgData[i + 1];
              sumB += imgData[i + 2];
              samples++;
            }
            return samples > 0 && (sumR + sumG + sumB) / (samples * 3) < 12;
          } catch (pixelErr) {
            // getImageData SecurityError: canvas is tainted (cross-origin without CORS headers)
            if (pixelErr instanceof DOMException && pixelErr.name === 'SecurityError') {
              // Tainted canvas — signal CORS failure for retry
              done('__cors_error__');
              return true; // prevent toBlob below
            }
            return false;
          }
        })();
        if (isEmpty && retries < 5) {
          retries++;
          const dur = video.duration || 3;
          // Spread retries across the first half of the video with increasing steps
          const next = Math.min(dur * 0.9, Math.max(0.5, dur * 0.1 * retries));
          try {
            video.currentTime = next;
          } catch {
            done(null);
          }
          return;
        }
        c.toBlob(
          (blob) => {
            if (settled || !blob) {
              done(null);
              return;
            }
            done(URL.createObjectURL(blob));
          },
          'image/jpeg',
          0.72
        );
      } catch {
        done(null);
      }
    };

    const afterSeek = () => {
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          if (settled) return;
          tryCapture();
        })
      );
    };

    video.onloadedmetadata = () => {
      const dur = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
      // Seeking to 1 second breaks short clips (<1s). Use a small, valid
      // timestamp for those files and capture frame 0 when seeking is not
      // available yet.
      const seekTo = dur > 0 ? Math.min(Math.max(dur * 0.08, 0.01), Math.max(0, dur - 0.01)) : 0;
      try {
        if (seekTo <= 0) afterSeek();
        else video.currentTime = seekTo;
      } catch {
        afterSeek();
      }
    };

    video.onseeked = afterSeek;
    video.onerror = () => done(null);
    // Backup: MP4 files with broken metadata atoms never fire events
    setTimeout(() => {
      if (!settled && video.readyState >= 1 && video.videoWidth && video.videoHeight) {
        try {
          video.currentTime = Math.max(0.5, Math.min(video.duration || 2, 1.5));
        } catch {
          /* noop */
        }
      }
    }, 2500);
  });
}

function createVideoThumbnailBlob(
  filePath: string,
  signal: AbortSignal,
  timeout = THUMBNAIL_TIMEOUT_MS
): Promise<string | null> {
  // First attempt with CORS mode (required for canvas pixel reads when
  // the renderer origin differs from the local-resource:// protocol origin).
  return createVideoThumbnailBlobAttempt(filePath, signal, true, timeout).then((result) => {
    if (result === '__cors_error__') {
      // CORS headers missing or browser refused — retry without crossOrigin.
      // Canvas reads will be skipped (no black-frame detection) but toBlob
      // still works for an opaque canvas, giving us *some* thumbnail rather
      // than nothing.
      return createVideoThumbnailBlobAttempt(filePath, signal, false, timeout).then((r) =>
        r === '__cors_error__' ? null : r
      );
    }
    return result;
  });
}

async function generateVideoThumbnail(filePath: string, signal: AbortSignal): Promise<ThumbEntry | null> {
  // Try main-process IPC path first (ffmpeg-based, disk-cached, persistent across restarts)
  const api = window.electronAPI as ExtendedElectronAPI | undefined;
  if (api?.getMediaThumbnail) {
    try {
      const url = await api.getMediaThumbnail(filePath, THUMB_MAX_EDGE);
      if (signal.aborted) return null;
      if (url) return { url, isBlob: false };
    } catch {
      /* fall through to renderer-side canvas approach */
    }
  }

  // Renderer-side canvas fallback
  const url = await createVideoThumbnailBlob(filePath, signal);
  return url ? { url, isBlob: true } : null;
}

/**
 * Loads (and caches) a small preview for one media item. Runs once per card
 * mount; because the grid below only mounts cards that are actually visible
 * (+ a small overscan buffer), this hook doubles as the "only load what's on
 * screen" mechanism — no separate IntersectionObserver needed.
 */
function useThumbnail(type: MediaKind, filePath: string): string | undefined {
  const [url, setUrl] = useState<string | undefined>(() => thumbnailCache.get(filePath)?.url);

  useEffect(() => {
    const cached = thumbnailCache.get(filePath);
    if (cached) {
      setUrl(cached.url);
      return;
    }

    // SVGs are vector and already lightweight; rendering the file directly
    // costs nothing like a multi-megapixel raster photo would.
    if (type === 'image' && getExtension(filePath) === 'svg') {
      setUrl(toFileUrl(filePath));
      return;
    }

    const controller = new AbortController();
    let alive = true;

    const limiter = type === 'video' ? limitVideoThumb : limitImageThumb;
    const task =
      type === 'video'
        ? () => generateVideoThumbnail(filePath, controller.signal)
        : () => generateImageThumbnail(filePath, controller.signal);

    // Passing the signal into the limiter means a job still sitting in the
    // queue when the card scrolls away is dropped and rejected immediately
    // — it never starts, never occupies a concurrency slot, and doesn't
    // delay the jobs for cards that are actually still on screen.
    limiter(task, controller.signal)
      .then((entry) => {
        if (!entry) return;
        // Cache unconditionally, even if this card already unmounted: the
        // work is done, the bytes exist, and the shared LRU cache is bounded
        // — throwing a finished thumbnail away just means regenerating it
        // from scratch the next time the user scrolls back to it. Only the
        // *local* setUrl is gated on `alive`, since calling it after unmount
        // would be a no-op warning at best.
        cacheThumb(filePath, entry);
        if (alive) setUrl(entry.url);
      })
      .catch(() => {
        /* aborted (queued or in-flight) or failed — no retry storm */
      });

    return () => {
      alive = false;
      controller.abort(); // still-queued jobs are dropped by the limiter; in-flight ones are told to stop via the signal
    };
  }, [filePath, type]);

  return url;
}

// ─── Main Component ───────────────────────────────────────
export default function MediaTab({ onAddMediaToPresentation }: MediaTabProps) {
  const { t } = useTranslation();
  const [items, setItems] = useState<MediaItem[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const [folderSettings, setFolderSettings] = useState<MediaFolderSettings>(() => loadMediaFolderSettings());
  const [scanLoading, setScanLoading] = useState(false);
  const [folderMissing, setFolderMissing] = useState(false);
  const [scanError, setScanError] = useState(false);
  const [folderCount, setFolderCount] = useState<number | null>(null);
  const scanGeneration = useRef(0);

  // Click-outside to close dropdown
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Add file paths to the library (dedup by normalized path). Thumbnail
  // generation is no longer done here — each MediaCard loads (and caches)
  // its own preview on mount via useThumbnail, so this stays a cheap,
  // synchronous metadata update no matter how many paths come in.
  const addPaths = useCallback(async (paths: string[], origin: 'manual' | 'folder' = 'manual') => {
    const incoming = paths
      .filter((p) => p && isMediaFile(p))
      .map((p) => {
        const type = detectMediaType(p)!;
        return {
          id: makeId(),
          type,
          path: p,
          name: getFileName(p),
          origin,
        } satisfies MediaItem;
      });

    if (!incoming.length) return;

    setItems((prev) => {
      const seen = new Set(prev.map((i) => normalizePath(i.path)));
      const unique = incoming.filter((i) => {
        const key = normalizePath(i.path);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      return unique.length ? [...prev, ...unique] : prev;
    });
  }, []);

  const importFiles = useCallback(
    async (type: MediaKind) => {
      const api = window.electronAPI;
      if (!api) return;

      if (api.selectMediaFiles) {
        const r = await api.selectMediaFiles(type);
        if (r) await addPaths(Array.isArray(r) ? r : [r]);
        return;
      }
      if (api.selectMediaFile) {
        const r = await api.selectMediaFile(type);
        if (r) addPaths([r]);
      }
    },
    [addPaths]
  );

  const scanFolder = useCallback(
    async (settings: MediaFolderSettings) => {
      const generation = ++scanGeneration.current;
      const api = window.electronAPI;
      if (!settings.path) return;
      setScanLoading(true);
      setScanError(false);
      setFolderMissing(false);
      setFolderCount(null);
      try {
        if (!api?.readMediaFolder) throw new Error('Media API unavailable');
        const result = await api.readMediaFolder(settings.path, {
          recursive: settings.recursive,
          includeImages: settings.includeImages,
          includeVideos: settings.includeVideos,
        });
        if (generation !== scanGeneration.current) return;
        if (!result) throw new Error('Media scan failed');
        setFolderMissing(result.missing);
        const incoming: MediaItem[] = result.missing ? [] : result.paths.filter(isMediaFile).map((path) => ({
          id: makeId(), path, name: getFileName(path), type: detectMediaType(path)!, origin: 'folder',
        }));
        setFolderCount(incoming.length);
        setItems((prev) => replaceFolderItems(prev, incoming));
      } catch {
        if (generation === scanGeneration.current) setScanError(true);
      } finally {
        if (generation === scanGeneration.current) setScanLoading(false);
      }
    },
    []
  );

  const updateFolderSettings = useCallback((patch: Partial<MediaFolderSettings>) => {
    ++scanGeneration.current;
    setFolderSettings((prev) => {
      const next = { ...prev, ...patch };
      saveMediaFolderSettings(next);
      return next;
    });
  }, []);

  const chooseFolder = useCallback(async () => {
    const api = window.electronAPI;
    if (!api?.selectMediaFolder) return;
    const folder = await api.selectMediaFolder();
    if (!folder) return;
    setFolderMissing(false);
    updateFolderSettings({ path: folder });
  }, [updateFolderSettings]);

  const clearFolder = useCallback(() => {
    updateFolderSettings({ path: '', recursive: false, includeImages: true, includeVideos: true });
    setItems((prev) => prev.filter((i) => i.origin !== 'folder'));
    setScanLoading(false);
    setScanError(false);
    setFolderCount(null);
  }, [updateFolderSettings]);

  // Auto-scan when folder settings change (including initial load)
  useEffect(() => {
    if (folderSettings.path) void scanFolder(folderSettings);
    return () => {
      // This is an async generation counter, not a DOM ref. Invalidate late responses.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      ++scanGeneration.current;
    };
  }, [folderSettings, scanFolder]);

  const removeItem = useCallback((id: string) => {
    setItems((prev) => prev.filter((i) => i.id !== id));
  }, []);

  const addItemToPresentation = useCallback(
    (item: MediaItem, thumbnailUrl?: string) => {
      onAddMediaToPresentation(item.type, item.path, thumbnailUrl);
    },
    [onAddMediaToPresentation]
  );

  return (
    <div style={s.root}>
      {/* Static CSS for hover states — keeps hover purely compositor-side
          (no React state, no re-renders) even with thousands of cards. */}
      <style>{CARD_CSS}</style>

      {/* Header */}
      <div style={s.header}>
        <div style={s.headerLabel}>
          <Film size={12} style={{ color: '#9c7c38', flexShrink: 0 }} />
          <span style={s.headerText}>{t('common.mediaLibrary')}</span>
          {items.length > 0 && <span style={s.countBadge}>{items.length}</span>}
        </div>

        {/* Dropdown */}
        <div ref={menuRef} style={s.dropdownWrap}>
          <button type="button" onClick={() => setMenuOpen((v) => !v)} style={s.dropdownBtn}>
            <span style={s.dropdownBtnLeft}>
              <Plus size={13} />
              <span style={s.dropdownBtnText}>{t('common.mediaAdd')}</span>
            </span>
            <ChevronDown size={13} style={{ opacity: 0.8 }} />
          </button>

          {menuOpen && (
            <div style={s.dropdownMenu}>
              <DropItem
                icon={<ImageIcon size={14} />}
                title={t('common.mediaSelectImages')}
                desc={t('common.mediaSelectImagesDesc')}
                onClick={() => {
                  setMenuOpen(false);
                  importFiles('image');
                }}
              />
              <DropItem
                icon={<Video size={14} />}
                title={t('common.mediaSelectVideos')}
                desc={t('common.mediaSelectVideosDesc')}
                onClick={() => {
                  setMenuOpen(false);
                  importFiles('video');
                }}
              />
              <DropItem
                icon={<FolderOpen size={14} />}
                title={t('common.mediaSelectFolder')}
                desc={t('common.mediaSelectFolderDesc')}
                onClick={() => {
                  setMenuOpen(false);
                  chooseFolder();
                }}
              />
            </div>
          )}
        </div>

        {/* Saved media folder */}
        {folderSettings.path && (
          <div style={s.folderBar}>
            <div style={s.folderBarRow}>
              <FolderOpen size={12} style={{ color: '#9c7c38', flexShrink: 0 }} />
              <span style={s.folderPathText} title={folderSettings.path}>
                {folderSettings.path}
              </span>
              {folderMissing && <span style={s.folderWarn}>{t('common.mediaFolderMissing')}</span>}
            </div>
            <div style={s.folderBarRow}>
              <div style={s.segmented}>
                <SegBtn
                  active={!folderSettings.recursive}
                  onClick={() => updateFolderSettings({ recursive: false })}
                  label={t('common.mediaFolderOnlyThis')}
                />
                <SegBtn
                  active={folderSettings.recursive}
                  onClick={() => updateFolderSettings({ recursive: true })}
                  label={t('common.mediaFolderWithSubs')}
                />
              </div>
              <CheckChip
                checked={folderSettings.includeImages}
                onChange={(v) => updateFolderSettings({ includeImages: v })}
                label={t('common.mediaFolderImages')}
              />
              <CheckChip
                checked={folderSettings.includeVideos}
                onChange={(v) => updateFolderSettings({ includeVideos: v })}
                label={t('common.mediaFolderVideos')}
              />
              <button type="button" style={s.folderBtnMain} onClick={chooseFolder} disabled={scanLoading}>
                {t('common.mediaFolderChange')}
              </button>
              <button
                type="button"
                style={s.folderBtnIcon}
                onClick={() => scanFolder(folderSettings)}
                disabled={scanLoading}
                title={t('common.mediaFolderRefresh')}
              >
                {scanLoading ? (
                  <span style={s.folderLoadingText}>{t('common.mediaFolderLoading')}</span>
                ) : (
                  <RefreshCw size={11} />
                )}
              </button>
              <button type="button" style={s.folderBtnIcon} onClick={clearFolder} title={t('common.mediaFolderClear')}>
                <X size={11} />
              </button>
            </div>
          </div>
        )}
      </div>

      <div style={s.divider} />
      {folderSettings.path && (
        <p role={scanError || folderMissing ? 'alert' : 'status'} className="px-5 py-3 text-sm text-white/70">
          {scanLoading ? t('common.mediaFolderLoading')
            : scanError ? t('common.mediaScanFailed')
            : folderMissing ? t('common.mediaFolderMissing')
            : !folderSettings.includeImages && !folderSettings.includeVideos ? t('common.mediaFiltersOff')
            : folderCount === 0 ? t('common.mediaFolderNoMatches')
            : folderCount !== null ? t('common.mediaFolderFound', { count: folderCount }) : ''}
        </p>
      )}

      {/* Content — isolated in its own memoized component so that scrolling
          (which updates state ~60x/sec while dragging) only ever re-renders
          this subtree, never the header/dropdown/folder-bar above. Within
          it, only the rows actually on screen (+ overscan) are mounted,
          regardless of whether `items` holds a dozen entries or fifty
          thousand. */}
      <MediaGrid items={items} onAdd={addItemToPresentation} onRemove={removeItem} />
    </div>
  );
}

// ─── Media Grid (isolated, virtualized) ────────────────────
// Split out from MediaTab so that scroll-driven state updates never touch
// the header/dropdown/folder-bar tree above. Scroll is throttled to one
// update per animation frame: React's onScroll fires on every native scroll
// event, which on a 120Hz+ trackpad/mouse can be well over 60/sec — piping
// that straight into setState would mean *more* renders than this rAF gate,
// not fewer. The rAF callback itself is cheap (a few property reads); what's
// expensive is the render it triggers, and that's bounded to this isolated
// component regardless.
const MediaGrid = memo(function MediaGrid({
  items,
  onAdd,
  onRemove,
}: {
  items: MediaItem[];
  onAdd: (item: MediaItem, thumbnailUrl?: string) => void;
  onRemove: (id: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0, scrollTop: 0 });

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => setViewport({ width: el.clientWidth, height: el.clientHeight, scrollTop: el.scrollTop });

    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);

    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        update();
      });
    };
    el.addEventListener('scroll', onScroll, { passive: true });

    return () => {
      ro.disconnect();
      el.removeEventListener('scroll', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  const { visibleItems, topOffset, totalHeight, cols } = useMemo(() => {
    const columns = computeColumns(viewport.width, MIN_CARD_WIDTH, GRID_GAP);
    const totalRows = items.length > 0 ? Math.ceil(items.length / columns) : 0;
    const height = totalRows > 0 ? totalRows * ROW_HEIGHT - GRID_GAP : 0;
    const { startRow, endRow } = computeVisibleRange(
      viewport.scrollTop,
      viewport.height,
      ROW_HEIGHT,
      totalRows,
      OVERSCAN_ROWS
    );
    const startIndex = startRow * columns;
    const endIndex = Math.min(items.length, (endRow + 1) * columns);
    return {
      visibleItems: items.slice(startIndex, endIndex),
      topOffset: startRow * ROW_HEIGHT,
      totalHeight: height,
      cols: columns,
    };
  }, [items, viewport]);

  if (items.length === 0) {
    return (
      <div ref={scrollRef} style={s.content}>
        <EmptyState />
      </div>
    );
  }

  return (
    <div ref={scrollRef} style={s.content}>
      <div style={{ position: 'relative', width: '100%', height: totalHeight }}>
        <div
          style={{
            ...s.grid,
            position: 'absolute',
            top: topOffset,
            left: 0,
            right: 0,
            gridTemplateColumns: `repeat(${cols}, 1fr)`,
          }}
        >
          {visibleItems.map((item) => (
            <MediaCard key={item.id} item={item} onAdd={onAdd} onRemove={onRemove} />
          ))}
        </div>
      </div>
    </div>
  );
});

// ─── Dropdown Item ────────────────────────────────────────
const DropItem = memo(function DropItem({
  icon,
  title,
  desc,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  desc: string;
  onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} className="mtab-drop-item" style={s.dropItem}>
      <div style={s.dropItemIcon}>{icon}</div>
      <div>
        <div style={s.dropItemTitle}>{title}</div>
        <div style={s.dropItemDesc}>{desc}</div>
      </div>
    </button>
  );
});

// ─── Folder bar helpers ───────────────────────────────────
const SegBtn = memo(function SegBtn({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        ...s.segBtn,
        background: active ? 'rgba(184,134,11,0.22)' : 'transparent',
        color: active ? '#e8c766' : 'rgba(255,255,255,0.5)',
        borderColor: active ? 'rgba(184,134,11,0.45)' : 'transparent',
      }}
    >
      {label}
    </button>
  );
});

const CheckChip = memo(function CheckChip({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      style={{
        ...s.chip,
        background: checked ? 'rgba(184,134,11,0.18)' : 'rgba(255,255,255,0.04)',
        borderColor: checked ? 'rgba(184,134,11,0.4)' : 'rgba(255,255,255,0.12)',
        color: checked ? '#e8c766' : 'rgba(255,255,255,0.5)',
      }}
    >
      <span
        style={{
          ...s.chipBox,
          background: checked ? 'rgba(184,134,11,0.9)' : 'transparent',
          borderColor: checked ? 'transparent' : 'rgba(255,255,255,0.3)',
        }}
      >
        {checked && <Check size={9} color="#1a1405" strokeWidth={3.5} />}
      </span>
      {label}
    </button>
  );
});

// ─── Media Card ───────────────────────────────────────────
// Hover is pure CSS (see CARD_CSS) and the thumbnail is owned locally via
// useThumbnail, so with `item` itself being immutable after creation, this
// memoized card only ever re-renders once — when its own thumbnail arrives.
// Sibling cards are completely unaffected by that, by hover, or by scrolling.
const MediaCard = memo(function MediaCard({
  item,
  onAdd,
  onRemove,
}: {
  item: MediaItem;
  onAdd: (item: MediaItem, thumbnailUrl?: string) => void;
  onRemove: (id: string) => void;
}) {
  const { t } = useTranslation();
  const isImage = item.type === 'image';
  const ext = getExtension(item.path).toUpperCase();
  const thumbUrl = useThumbnail(item.type, item.path);

  return (
    <div className={`mtab-card ${isImage ? 'mtab-card--image' : 'mtab-card--video'}`} style={s.card}>
      {/* Thumbnail area */}
      <div style={s.thumb}>
        {thumbUrl ? (
          <img
            className="mtab-thumb-img"
            src={thumbUrl}
            alt={item.name}
            style={s.thumbImg}
            loading="lazy"
            decoding="async"
          />
        ) : (
          <div className="mtab-media-fallback" style={s.videoFallback}>
            {isImage ? <ImageIcon size={16} /> : <Video size={16} />}
          </div>
        )}
        <span
          style={{
            ...s.typePill,
            background: isImage ? 'rgba(184,134,11,0.85)' : 'rgba(106,79,200,0.85)',
          }}
        >
          {ext || (isImage ? 'IMG' : 'VID')}
        </span>
      </div>

      {/* Footer */}
      <div style={s.cardFoot}>
        <span style={s.fileName} title={item.name}>
          {item.name}
        </span>
        <div style={s.cardActions}>
          <button
            type="button"
            title={t('common.mediaAddToSlide')}
            className="mtab-foot-btn mtab-foot-btn--add"
            onClick={(e) => {
              e.stopPropagation();
              onAdd(item, thumbUrl);
            }}
            style={s.footBtn}
          >
            <Plus size={11} />
          </button>
          <button
            type="button"
            title={t('common.mediaRemove')}
            className="mtab-foot-btn mtab-foot-btn--remove"
            onClick={(e) => {
              e.stopPropagation();
              onRemove(item.id);
            }}
            style={s.footBtn}
          >
            <Trash2 size={11} />
          </button>
        </div>
      </div>
    </div>
  );
});

// ─── Empty State ──────────────────────────────────────────
function EmptyState() {
  const { t } = useTranslation();
  return (
    <div style={s.empty}>
      <div style={s.emptyIconWrap}>
        <Film size={28} style={{ color: 'rgba(255,255,255,0.1)' }} />
        <div style={s.emptyIconRing} />
      </div>
      <p style={s.emptyTitle}>{t('common.mediaEmpty')}</p>
      <p style={s.emptyDesc}>{t('common.mediaEmptyDesc')}</p>
    </div>
  );
}

// ─── Hover / interaction CSS ────────────────────────────────
// Replaces the old per-item `useState` hover tracking (a hoveredId in the
// parent plus a `hov` state in every DropItem/FootBtn) with plain :hover
// rules. Hover then costs the compositor a style recalculation on one
// element, not a React re-render.
const CARD_CSS = `
.mtab-drop-item { background: transparent; transition: background 0.15s ease; }
.mtab-drop-item:hover { background: rgba(255,255,255,0.06); }

.mtab-card { transition: border-color 0.18s ease, background 0.18s ease; }
.mtab-card--image:hover { border-color: rgba(200,146,10,0.55); background: rgba(184,134,11,0.07); }
.mtab-card--video:hover { border-color: rgba(124,92,191,0.55); background: rgba(106,79,200,0.07); }

.mtab-thumb-img { opacity: 0.72; transition: opacity 0.2s ease; }
.mtab-card:hover .mtab-thumb-img { opacity: 1; }

.mtab-media-fallback { background: #0f0a1a; transition: background 0.18s; }
.mtab-card--video:hover .mtab-media-fallback { background: #160d2a; }
.mtab-media-fallback svg { color: rgba(255,255,255,0.18); transition: color 0.18s; }
.mtab-card--video:hover .mtab-media-fallback svg { color: rgba(156,120,230,0.7); }
.mtab-card--image:hover .mtab-media-fallback svg { color: rgba(232,199,102,0.7); }

.mtab-foot-btn { border-color: rgba(255,255,255,0.13); background: rgba(255,255,255,0.06); color: rgba(255,255,255,0.55); transform: scale(1); transition: all 0.13s ease; }
.mtab-foot-btn:hover { border-color: transparent; color: #fff; transform: scale(1.1); }
.mtab-foot-btn--add:hover { background: rgba(200,146,10,0.85); }
.mtab-foot-btn--remove:hover { background: rgba(180,40,40,0.85); }
`;

// ─── Styles ───────────────────────────────────────────────
const s: Record<string, React.CSSProperties> = {
  root: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    background: '#181818',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  },

  // Header
  header: {
    padding: '14px 14px 12px',
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  headerLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  headerText: {
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: 0.13,
    textTransform: 'uppercase',
    color: 'rgba(255,255,255,0.3)',
  },
  countBadge: {
    marginLeft: 2,
    fontSize: 9,
    fontWeight: 700,
    letterSpacing: 0.05,
    color: '#9c7c38',
    background: 'rgba(184,134,11,0.15)',
    border: '1px solid rgba(184,134,11,0.3)',
    borderRadius: 3,
    padding: '1px 5px',
  },

  // Dropdown
  dropdownWrap: { position: 'relative', width: '100%' },
  dropdownBtn: {
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    padding: '8px 10px',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: 8,
    background: 'rgba(255,255,255,0.04)',
    color: '#fff',
    cursor: 'pointer',
    transition: 'all 0.15s ease',
  },
  dropdownBtnLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    minWidth: 0,
  },
  dropdownBtnText: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: 0.08,
    textTransform: 'uppercase',
    whiteSpace: 'nowrap',
  },
  dropdownMenu: {
    position: 'absolute',
    top: 'calc(100% + 8px)',
    left: 0,
    right: 0,
    zIndex: 20,
    padding: 6,
    borderRadius: 12,
    border: '1px solid rgba(255,255,255,0.10)',
    background: 'rgba(20,20,20,0.98)',
    boxShadow: '0 12px 40px rgba(0,0,0,0.45)',
    backdropFilter: 'blur(10px)',
  },
  dropItem: {
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '10px',
    border: 'none',
    borderRadius: 10,
    color: '#fff',
    cursor: 'pointer',
    textAlign: 'left',
  },
  dropItemIcon: {
    width: 26,
    height: 26,
    borderRadius: 8,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(255,255,255,0.06)',
    color: 'rgba(255,255,255,0.85)',
    flexShrink: 0,
  },
  dropItemTitle: {
    fontSize: 12,
    fontWeight: 600,
    color: 'rgba(255,255,255,0.92)',
    marginBottom: 2,
  },
  dropItemDesc: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.42)',
    lineHeight: 1.4,
  },

  // Folder bar
  folderBar: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    padding: 8,
    borderRadius: 10,
    border: '1px solid rgba(184,134,11,0.25)',
    background: 'rgba(184,134,11,0.06)',
  },
  folderBarRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
    minWidth: 0,
  },
  folderPathText: {
    flex: 1,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 10,
    fontWeight: 600,
    color: 'rgba(255,255,255,0.65)',
    fontFamily: 'monospace',
  },
  folderWarn: {
    fontSize: 9,
    fontWeight: 700,
    letterSpacing: 0.05,
    color: '#ff9a8a',
    background: 'rgba(200,60,50,0.14)',
    border: '1px solid rgba(200,60,50,0.35)',
    borderRadius: 3,
    padding: '1px 5px',
    whiteSpace: 'nowrap',
  },
  segmented: {
    display: 'flex',
    padding: 2,
    borderRadius: 7,
    border: '1px solid rgba(255,255,255,0.1)',
    background: 'rgba(0,0,0,0.25)',
  },
  segBtn: {
    border: '1px solid',
    borderRadius: 5,
    padding: '4px 8px',
    fontSize: 10,
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'all 0.15s ease',
  },
  chip: {
    display: 'flex',
    alignItems: 'center',
    gap: 5,
    border: '1px solid',
    borderRadius: 7,
    padding: '4px 8px',
    fontSize: 10,
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'all 0.15s ease',
  },
  chipBox: {
    width: 12,
    height: 12,
    borderRadius: 3,
    border: '1px solid',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  folderBtnMain: {
    border: '1px solid rgba(184,134,11,0.4)',
    borderRadius: 7,
    padding: '4px 10px',
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: 0.05,
    background: 'rgba(184,134,11,0.14)',
    color: '#e8c766',
    cursor: 'pointer',
    transition: 'all 0.15s ease',
  },
  folderBtnIcon: {
    width: 24,
    height: 24,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: '1px solid rgba(255,255,255,0.14)',
    borderRadius: 6,
    background: 'rgba(255,255,255,0.05)',
    color: 'rgba(255,255,255,0.6)',
    cursor: 'pointer',
    transition: 'all 0.15s ease',
  },
  folderLoadingText: {
    fontSize: 9,
    fontWeight: 700,
    whiteSpace: 'nowrap',
    padding: '0 2px',
  },

  // Divider
  divider: {
    height: 1,
    background:
      'linear-gradient(90deg, transparent, rgba(255,255,255,0.07) 20%, rgba(255,255,255,0.07) 80%, transparent)',
    marginBottom: 2,
  },

  // Content area
  content: {
    flex: 1,
    overflowY: 'auto',
    padding: '10px 10px 16px',
  },
  grid: {
    display: 'grid',
    gap: GRID_GAP,
  },

  // Media card
  card: {
    borderRadius: 6,
    border: '1px solid rgba(255,255,255,0.08)',
    background: 'rgba(255,255,255,0.03)',
    overflow: 'hidden',
    cursor: 'default',
    contain: 'layout paint style',
    contentVisibility: 'auto',
    containIntrinsicSize: `auto ${MIN_CARD_WIDTH}px ${CARD_HEIGHT}px`,
  },
  thumb: {
    position: 'relative',
    height: 215,
    background: '#0d0d0d',
    overflow: 'hidden',
    aspectRatio: `${MIN_CARD_WIDTH} / 215`,
  },
  thumbImg: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    display: 'block',
  },
  videoFallback: {
    width: '100%',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  typePill: {
    position: 'absolute',
    top: 4,
    left: 4,
    fontSize: 7,
    fontWeight: 700,
    fontFamily: 'monospace',
    letterSpacing: 0.08,
    color: '#fff',
    padding: '1px 5px',
    borderRadius: 3,
  },
  cardFoot: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    padding: '4px 6px',
    background: 'rgba(0,0,0,0.3)',
  },
  fileName: {
    fontSize: 9.5,
    color: 'rgba(255,255,255,0.45)',
    fontWeight: 600,
    flex: 1,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  cardActions: {
    display: 'flex',
    gap: 4,
    flexShrink: 0,
  },
  footBtn: {
    width: 28,
    height: 28,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: '1px solid',
    borderRadius: 4,
    cursor: 'pointer',
  },

  // Empty
  empty: {
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    textAlign: 'center',
    padding: 20,
  },
  emptyIconWrap: {
    position: 'relative',
    width: 60,
    height: 60,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  emptyIconRing: {
    position: 'absolute',
    inset: 0,
    borderRadius: 9999,
    border: '1px solid rgba(255,255,255,0.05)',
  },
  emptyTitle: {
    margin: 0,
    fontSize: 14,
    fontWeight: 700,
    color: 'rgba(255,255,255,0.75)',
  },
  emptyDesc: {
    margin: '6px 0 0',
    fontSize: 11,
    lineHeight: 1.5,
    color: 'rgba(255,255,255,0.35)',
  },
};
