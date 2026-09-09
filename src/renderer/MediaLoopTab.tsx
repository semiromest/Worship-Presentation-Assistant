import { useState, useCallback, useRef, useMemo, useEffect, memo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Image as ImageIcon,
  Video,
  Trash2,
  Plus,
  Film,
  FolderOpen,
  ChevronDown,
  Repeat,
  Clock,
  GripVertical,
  RefreshCw,
  X,
  Check,
} from 'lucide-react';
import type { LoopItem, MediaItem, MediaKind } from './types';
import { LOOP_DEFAULT_DURATION } from './constants';
import { cn } from './utils';
import { confirmDialog } from './dialogs';
import { useStore } from './state/useStore';
import { loadMediaFolderSettings, saveMediaFolderSettings, type MediaFolderSettings } from './mediaFolderSettings';

// ─── Constants (Virtualization + Thumbnails) ────────────────────────────────

const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tif', 'tiff', 'avif', 'svg']);
const VIDEO_EXTS = new Set(['mp4', 'webm', 'mov', 'mkv', 'avi', 'm4v', 'wmv', 'flv', 'mpeg', 'mpg']);
const THUMBNAIL_TIMEOUT_MS = 8_000;
const MIN_DURATION_MS = 1_000;
const MAX_DURATION_MS = 300_000;

const THUMB_MAX_EDGE = 400;
const THUMB_CACHE_LIMIT = 800;

const MIN_CARD_WIDTH = 320;
const GRID_GAP = 8;
const CARD_HEIGHT = 228;
const ROW_HEIGHT = CARD_HEIGHT + GRID_GAP;
const OVERSCAN_ROWS = 2;

// ─── Helpers ────────────────────────────────────────────────────────────────

const normalizePath = (p: string) => p.replace(/\\/g, '/');

const toFileUrl = (p: string) => {
  const n = normalizePath(p);
  return encodeURI(`${n.startsWith('/') ? 'file://' : 'file:///'}${n}`);
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

function parseDurationSecs(value: string | number): number {
  const n = typeof value === 'string' ? parseFloat(value) : value;
  if (!isFinite(n) || n < 1) return 1;
  if (n > 300) return 300;
  return Math.round(n);
}

function formatTotalTime(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r > 0 ? `${m}m ${r}s` : `${m}m`;
}

// ─── Virtualization Math ────────────────────────────────────────────────────

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
  return { startRow: Math.max(0, rawStart), endRow: Math.min(totalRows - 1, rawEnd) };
}

// ─── Concurrency Limiter ────────────────────────────────────────────────────

function createLimiter(concurrency: number) {
  let active = 0;
  const queue: Array<{ run: () => void }> = [];
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
      const entry = {
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
          if (!queued) return;
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
const limitVideoThumb = createLimiter(2);

// ─── Shared Thumbnail Cache ─────────────────────────────────────────────────

interface ThumbEntry {
  url: string;
  isBlob: boolean;
}
const thumbnailCache = new Map<string, ThumbEntry>();

function cacheThumb(key: string, entry: ThumbEntry) {
  if (thumbnailCache.has(key)) thumbnailCache.delete(key);
  thumbnailCache.set(key, entry);
  if (thumbnailCache.size > THUMB_CACHE_LIMIT) {
    const oldestKey = thumbnailCache.keys().next().value;
    if (oldestKey !== undefined) {
      const oldest = thumbnailCache.get(oldestKey);
      if (oldest?.isBlob) URL.revokeObjectURL(oldest.url);
      thumbnailCache.delete(oldestKey);
    }
  }
}

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
  const res = await fetch(toFileUrl(filePath), { signal });
  const blob = await res.blob();
  if (signal.aborted) return null;
  const bitmap = await createImageBitmap(blob, { resizeWidth: THUMB_MAX_EDGE, resizeQuality: 'medium' });
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
  const outBlob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.65));
  if (!outBlob || signal.aborted) return null;
  return { url: URL.createObjectURL(outBlob), isBlob: true };
}

function createVideoThumbnailBlob(
  filePath: string,
  signal: AbortSignal,
  timeout = THUMBNAIL_TIMEOUT_MS
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
    // The file is served by the local-resource protocol while the renderer
    // normally runs from http://localhost (dev) or file:// (packaged). Tell
    // Chromium that this media is intentionally CORS-readable; otherwise
    // drawImage() may work but getImageData()/toBlob() fails with a tainted
    // canvas and the card falls back to the camera icon.
    video.crossOrigin = 'anonymous';
    video.setAttribute('muted', '');
    video.setAttribute('playsinline', '');
    video.setAttribute('webkit-playsinline', '');
    // Prefer the main-process stream when IPC exists (Electron dev+packaged);
    // the file:// form is only a last resort for non-Electron environments.
    video.src = window.electronAPI ? toMediaStreamUrl(filePath) : toFileUrl(filePath);

    let settled = false;
    let retries = 0;
    const cleanup = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      video.removeAttribute('src');
      try {
        video.load();
      } catch {}
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
        } catch (e) {
          done(null);
          return;
        }
        // Check for all-black / empty frame (Chrome decodes black on some codecs)
        const isEmpty = (() => {
          try {
            const data = ctx.getImageData(0, 0, Math.min(c.width, 40), Math.min(c.height, 40)).data;
            let sumR = 0,
              sumG = 0,
              sumB = 0,
              samples = 0;
            for (let i = 0; i < data.length; i += 4 * 17) {
              sumR += data[i];
              sumG += data[i + 1];
              sumB += data[i + 2];
              samples++;
            }
            return samples > 0 && (sumR + sumG + sumB) / (samples * 3) < 12;
          } catch {
            return false;
          }
        })();
        if (isEmpty && retries < 3) {
          retries++;
          const dur = video.duration || 3;
          const next = Math.min(dur, Math.max(1, dur * 0.05 * (retries + 2)));
          video.currentTime = next;
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
      const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
      // Keep the timestamp valid for short clips; seeking to exactly 1s would
      // otherwise fail for videos shorter than one second.
      const seekTo = duration > 0 ? Math.min(Math.max(duration * 0.08, 0.01), Math.max(0, duration - 0.01)) : 0;
      try {
        if (seekTo > 0) video.currentTime = seekTo;
        else afterSeek();
      } catch {
        afterSeek();
      }
    };

    video.onseeked = afterSeek;
    video.onerror = () => done(null);
    // Defensive: some MP4s never fire onloadedmetadata due to bad atom layout
    setTimeout(() => {
      if (!settled && video.readyState >= 1 && video.videoWidth && video.videoHeight) {
        try {
          video.currentTime = Math.max(0.5, Math.min(video.duration || 2, 1.5));
        } catch {}
      }
    }, 2500);
  });
}

async function generateVideoThumbnail(filePath: string, signal: AbortSignal): Promise<ThumbEntry | null> {
  const url = await createVideoThumbnailBlob(filePath, signal);
  return url ? { url, isBlob: true } : null;
}

function useThumbnail(type: MediaKind, filePath: string): string | undefined {
  const [url, setUrl] = useState<string | undefined>(() => thumbnailCache.get(filePath)?.url);
  useEffect(() => {
    const cached = thumbnailCache.get(filePath);
    if (cached) {
      setUrl(cached.url);
      return;
    }
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
    limiter(task, controller.signal)
      .then((entry) => {
        if (!entry) return;
        cacheThumb(filePath, entry);
        if (alive) setUrl(entry.url);
      })
      .catch(() => {});
    return () => {
      alive = false;
      controller.abort();
    };
  }, [filePath, type]);
  return url;
}

// ─── DurationInput ──────────────────────────────────────────────────────────

const DurationInput = memo(function DurationInput({
  valueSecs,
  onChange,
  'aria-label': ariaLabel,
}: {
  valueSecs: number;
  onChange: (secs: number) => void;
  'aria-label'?: string;
}) {
  const [local, setLocal] = useState(String(valueSecs));
  const isFocused = useRef(false);
  useEffect(() => {
    if (!isFocused.current) setLocal(String(valueSecs));
  }, [valueSecs]);
  const commit = useCallback(() => {
    const parsed = parseDurationSecs(local);
    setLocal(String(parsed));
    onChange(parsed);
  }, [local, onChange]);
  return (
    <div className="flex items-center gap-1 shrink-0">
      <input
        type="number"
        min={1}
        max={300}
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        onFocus={() => {
          isFocused.current = true;
        }}
        onBlur={() => {
          isFocused.current = false;
          commit();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
        onClick={(e) => e.stopPropagation()}
        aria-label={ariaLabel}
        className="w-12 bg-zinc-900 border border-zinc-700 rounded px-1 py-0.5 text-[11px] text-white text-center font-mono focus:outline-none focus:border-amber-500/70 transition-colors"
      />
      <span className="text-[10px] text-zinc-500 select-none">s</span>
    </div>
  );
});

// ─── Loop Item Row ──────────────────────────────────────────────────────────

const LoopItemRow = memo(function LoopItemRow({
  item,
  index,
  isDragOver,
  onDragStart,
  onDragEnter,
  onDragEnd,
  onRemove,
  onDurationChange,
}: {
  item: LoopItem;
  index: number;
  isDragOver: boolean;
  onDragStart: (i: number) => void;
  onDragEnter: (i: number) => void;
  onDragEnd: () => void;
  onRemove: (id: string) => void;
  onDurationChange: (id: string, ms: number) => void;
}) {
  const { t } = useTranslation();
  const [imgErr, setImgErr] = useState(false);
  const handleDur = useCallback((secs: number) => onDurationChange(item.id, secs * 1000), [item.id, onDurationChange]);
  return (
    <div
      draggable
      onDragStart={() => onDragStart(index)}
      onDragEnter={() => onDragEnter(index)}
      onDragEnd={onDragEnd}
      onDragOver={(e) => e.preventDefault()}
      className={cn(
        'group flex items-center gap-2 px-2 py-1.5 rounded-lg',
        'bg-zinc-800/60 hover:bg-zinc-800 transition-all duration-150 select-none',
        isDragOver && 'ring-1 ring-amber-500/50 bg-zinc-800 scale-[1.01]'
      )}
    >
      <div
        className="text-zinc-600 hover:text-zinc-400 cursor-grab active:cursor-grabbing shrink-0"
        title={t('common.loopDragToReorder')}
      >
        <GripVertical className="w-3.5 h-3.5" />
      </div>
      <span className="text-[10px] font-mono text-zinc-600 w-5 shrink-0">{String(index + 1).padStart(2, '0')}</span>
      <div className="relative w-10 h-10 rounded-md overflow-hidden bg-zinc-900 shrink-0 ring-1 ring-white/5">
        {item.type === 'video' ? (
          <>
            <video src={item.mediaUrl} className="w-full h-full object-cover" muted preload="metadata" />
            <div className="absolute inset-0 flex items-center justify-center bg-black/50">
              <Film className="w-3.5 h-3.5 text-amber-400" />
            </div>
          </>
        ) : imgErr ? (
          <div className="w-full h-full flex items-center justify-center bg-zinc-800">
            <ImageIcon className="w-4 h-4 text-zinc-600" />
          </div>
        ) : (
          <img src={item.mediaUrl} className="w-full h-full object-cover" alt="" onError={() => setImgErr(true)} />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-xs text-zinc-200 truncate font-medium leading-tight" title={item.fileName}>
          {item.fileName}
        </div>
        <div className="flex items-center gap-1 text-[10px] text-zinc-500 mt-0.5">
          {item.type === 'video' ? (
            <>
              <Film className="w-2.5 h-2.5" />
              {t('common.loopVideo')}
            </>
          ) : (
            <>
              <ImageIcon className="w-2.5 h-2.5" />
              {t('common.loopImage')}
            </>
          )}
        </div>
      </div>
      <DurationInput
        valueSecs={Math.round(item.duration / 1000)}
        onChange={handleDur}
        aria-label={t('common.loopDuration')}
      />
      <button
        onClick={() => onRemove(item.id)}
        className="text-zinc-600 hover:text-red-400 opacity-60 hover:opacity-100 focus-visible:opacity-100 transition-all shrink-0"
        title={t('common.loopRemove')}
        aria-label={t('common.loopRemove')}
      >
        <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
      </button>
    </div>
  );
});

// ─── Media Card ─────────────────────────────────────────────────────────────

const MediaCard = memo(function MediaCard({
  item,
  selected,
  onAdd,
  onRemove,
  onToggleSelect,
}: {
  item: MediaItem;
  selected: boolean;
  onAdd: (item: MediaItem, thumbnailUrl?: string) => void;
  onRemove: (id: string) => void;
  onToggleSelect: (id: string) => void;
}) {
  const { t } = useTranslation();
  const isImage = item.type === 'image';
  const ext = getExtension(item.path).toUpperCase();
  const thumbUrl = useThumbnail(item.type, item.path);
  const pillBg = isImage ? 'rgba(184,134,11,0.85)' : 'rgba(106,79,200,0.85)';
  return (
    <div
      onClick={() => onToggleSelect(item.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onToggleSelect(item.id);
        }
      }}
      className="group rounded-lg border overflow-hidden cursor-pointer media-card"
      role="button"
      tabIndex={0}
      style={{
        height: CARD_HEIGHT,
        contain: 'layout paint style',
        contentVisibility: 'auto',
        containIntrinsicSize: `auto ${MIN_CARD_WIDTH}px ${CARD_HEIGHT}px`,
        borderColor: selected ? (isImage ? 'rgba(200,146,10,0.9)' : 'rgba(124,92,191,0.9)') : undefined,
        background: selected ? (isImage ? 'rgba(184,134,11,0.15)' : 'rgba(106,79,200,0.15)') : undefined,
      }}
    >
      <div className="relative h-[180px] bg-black overflow-hidden" style={{ aspectRatio: `${MIN_CARD_WIDTH} / 180` }}>
        {thumbUrl ? (
          <img
            src={thumbUrl}
            alt={item.name}
            loading="lazy"
            decoding="async"
            className="w-full h-full object-cover opacity-72 group-hover:opacity-100 transition-opacity duration-200"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-[#0f0a1a] group-hover:bg-[#160d2a] transition-colors">
            {isImage ? (
              <ImageIcon
                size={18}
                className="text-white/[0.18] group-hover:text-[rgba(232,199,102,0.7)] transition-colors"
              />
            ) : (
              <Video
                size={18}
                className="text-white/[0.18] group-hover:text-[rgba(156,120,230,0.7)] transition-colors"
              />
            )}
          </div>
        )}
        <span
          className="absolute top-1 left-1 text-[7px] font-bold font-mono tracking-wider text-white px-1.5 py-0.5 rounded"
          style={{ background: pillBg }}
        >
          {ext || (isImage ? 'IMG' : 'VID')}
        </span>
        {selected ? (
          <div className="absolute top-1 right-1 w-5 h-5 rounded-full bg-amber-500 flex items-center justify-center shadow-lg">
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="white"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
        ) : (
          <div className="absolute top-1 right-1 w-5 h-5 rounded-full border-2 border-white/0 group-hover:border-white/50 flex items-center justify-center" />
        )}
      </div>
      <div className="flex items-center gap-1 px-2 py-1.5 bg-black/30" style={{ height: CARD_HEIGHT - 180 - 2 }}>
        <span className="text-[10px] text-white/45 font-semibold flex-1 min-w-0 truncate" title={item.name}>
          {item.name}
        </span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onAdd(item, thumbUrl);
          }}
          className="w-7 h-7 flex items-center justify-center rounded border border-white/[0.13] bg-white/[0.06] text-white/55 hover:bg-amber-500 hover:text-white hover:border-transparent transition-colors shrink-0"
          title={t('common.mediaAddToSlide')}
          aria-label={t('common.mediaAddToSlide')}
        >
          <Plus size={11} aria-hidden="true" />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove(item.id);
          }}
          className="w-7 h-7 flex items-center justify-center rounded border border-white/[0.13] bg-white/[0.06] text-white/55 hover:bg-red-600 hover:text-white hover:border-transparent transition-colors shrink-0"
          title={t('common.mediaRemove')}
          aria-label={t('common.mediaRemove')}
        >
          <Trash2 size={11} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
});

// ─── MediaGrid (Virtualized) ────────────────────────────────────────────────

const VirtualizedMediaGrid = memo(function VirtualizedMediaGrid({
  items,
  children,
}: {
  items: MediaItem[];
  children: (item: MediaItem) => ReactNode;
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

  if (items.length === 0) return null;

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 pb-4" role="list">
      <div style={{ position: 'relative', width: '100%', height: totalHeight }}>
        <div
          style={{
            position: 'absolute',
            top: topOffset,
            left: 0,
            right: 0,
            display: 'grid',
            gridTemplateColumns: `repeat(${cols}, 1fr)`,
            gap: GRID_GAP,
          }}
        >
          {visibleItems.map((item) => (
            <div
              key={item.id}
              style={{ height: CARD_HEIGHT, minWidth: 0, contain: 'layout paint style' }}
              // minWidth:0 — a grid item's default automatic minimum is its
              // content's min-content size; without this an oversized child
              // (e.g. a wide intrinsic image) could stretch its track and
              // make columns unequal. 1fr tracks are equal only when every
              // item can shrink below the track width.
            >
              {children(item)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
});

// ─── Drop Item ──────────────────────────────────────────────────────────────

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
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center gap-2.5 p-2.5 rounded-lg hover:bg-white/[0.06] transition-colors text-left outline-none"
    >
      <div className="w-7 h-7 rounded-lg flex items-center justify-center bg-white/[0.06] text-white/85 shrink-0">
        {icon}
      </div>
      <div>
        <div className="text-xs font-semibold text-white/90">{title}</div>
        <div className="text-[10px] text-white/40 leading-snug">{desc}</div>
      </div>
    </button>
  );
});

// ─── Main Component ─────────────────────────────────────────────────────────

interface MediaLoopTabProps {
  onAddMediaToPresentation: (type: MediaKind, path: string, thumbnailUrl?: string) => void;
  onAddAllMediaToPresentation: (items: Array<{ type: MediaKind; path: string; thumbnailUrl?: string }>) => void;
  onAddLoopToPresentation: (items: LoopItem[], defaultDuration: number) => void;
}

export default function MediaLoopTab({
  onAddMediaToPresentation,
  onAddAllMediaToPresentation,
  onAddLoopToPresentation,
}: MediaLoopTabProps) {
  const { t } = useTranslation();
  const [activeSub, setActiveSub] = useState<'media' | 'loop'>('media');

  const mediaItems = useStore((s) => s.mediaItems);
  const setMediaItems = useStore((s) => s.setMediaItems);
  const loopItems = useStore((s) => s.loopItems);
  const setLoopItems = useStore((s) => s.setLoopItems);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const [folderSettings, setFolderSettings] = useState<MediaFolderSettings>(() => loadMediaFolderSettings());
  const [scanLoading, setScanLoading] = useState(false);
  const [folderMissing, setFolderMissing] = useState(false);

  const [defaultDuration, setDefaultDuration] = useState(LOOP_DEFAULT_DURATION / 1000);
  const [isLoading, setIsLoading] = useState(false);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const dragItemIndex = useRef<number | null>(null);

  const totalMs = useMemo(() => loopItems.reduce((acc, i) => acc + i.duration, 0), [loopItems]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const addMediaPaths = useCallback(
    async (paths: string[], origin: 'manual' | 'folder' = 'manual') => {
      const incoming = paths
        .filter((p) => p && isMediaFile(p))
        .map((p) => {
          const type = detectMediaType(p)!;
          return { id: makeId(), type, path: p, name: getFileName(p), preview: undefined, origin } satisfies MediaItem;
        });
      if (!incoming.length) return;
      setMediaItems((prev) => {
        const seen = new Set(prev.map((i) => normalizePath(i.path)));
        const unique = incoming.filter((i) => {
          const k = normalizePath(i.path);
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        });
        return [...prev, ...unique];
      });
    },
    [setMediaItems]
  );

  const importFiles = useCallback(
    async (type: MediaKind) => {
      const api = window.electronAPI as
        | (NonNullable<typeof window.electronAPI> & {
            selectMediaFiles?: (type: string) => Promise<string | string[] | null>;
          })
        | undefined;
      if (!api) return;
      if (api.selectMediaFiles) {
        const r = await api.selectMediaFiles(type);
        if (r) await addMediaPaths(Array.isArray(r) ? r : [r]);
        return;
      }
      if (api.selectMediaFile) {
        const r = await api.selectMediaFile(type);
        if (r) addMediaPaths([r]);
      }
    },
    [addMediaPaths]
  );

  const scanFolder = useCallback(
    async (settings: MediaFolderSettings) => {
      const api = window.electronAPI as
        | (NonNullable<typeof window.electronAPI> & {
            readMediaFolder?: (
              folder: string,
              options?: { recursive?: boolean; includeImages?: boolean; includeVideos?: boolean }
            ) => Promise<{ paths: string[]; missing: boolean } | null>;
          })
        | undefined;
      if (!api?.readMediaFolder || !settings.path) return;
      setScanLoading(true);
      try {
        const result = await api.readMediaFolder(settings.path, {
          recursive: settings.recursive,
          includeImages: settings.includeImages,
          includeVideos: settings.includeVideos,
        });
        if (!result) return;
        setFolderMissing(result.missing);
        if (result.missing) {
          setMediaItems((prev) => prev.filter((i) => i.origin !== 'folder'));
        } else {
          const keep = new Set(result.paths.map(normalizePath));
          setMediaItems((prev) => prev.filter((i) => i.origin !== 'folder' || keep.has(normalizePath(i.path))));
          if (result.paths.length) await addMediaPaths(result.paths, 'folder');
        }
      } finally {
        setScanLoading(false);
      }
    },
    [addMediaPaths, setMediaItems]
  );

  const updateFolderSettings = useCallback((patch: Partial<MediaFolderSettings>) => {
    setFolderSettings((prev) => {
      const next = { ...prev, ...patch };
      saveMediaFolderSettings(next);
      return next;
    });
  }, []);

  const chooseFolder = useCallback(async () => {
    const api = window.electronAPI as
      | (NonNullable<typeof window.electronAPI> & { selectMediaFolder?: () => Promise<string | null> })
      | undefined;
    if (!api?.selectMediaFolder) return;
    const folder = await api.selectMediaFolder();
    if (!folder) return;
    setFolderMissing(false);
    updateFolderSettings({ path: folder });
  }, [updateFolderSettings]);

  const clearFolder = useCallback(() => {
    updateFolderSettings({ path: '', recursive: false, includeImages: true, includeVideos: true });
    setMediaItems((prev) => prev.filter((i) => i.origin !== 'folder'));
  }, [updateFolderSettings, setMediaItems]);

  useEffect(() => {
    if (folderSettings.path) scanFolder(folderSettings);
  }, [folderSettings, scanFolder]);

  const removeMediaItem = useCallback(
    (id: string) => setMediaItems((prev) => prev.filter((i) => i.id !== id)),
    [setMediaItems]
  );
  const addMediaToPres = useCallback(
    (item: MediaItem, thumb?: string) => {
      onAddMediaToPresentation(item.type, item.path, thumb);
    },
    [onAddMediaToPresentation]
  );
  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }, []);
  const clearSelection = useCallback(() => setSelectedIds([]), []);

  const handleAddSelected = useCallback(() => {
    if (selectedIds.length === 0) return;
    const items = mediaItems.filter((m) => selectedIds.includes(m.id));
    onAddAllMediaToPresentation(
      items.map((item) => ({ type: item.type, path: item.path, thumbnailUrl: thumbnailCache.get(item.path)?.url }))
    );
    setSelectedIds([]);
  }, [mediaItems, selectedIds, onAddAllMediaToPresentation]);

  const handleAddAllMediaClick = useCallback(async () => {
    if (mediaItems.length === 0) return;
    const confirmed = await confirmDialog(`${mediaItems.length} medya dosyasının tamamı slayt olarak eklensin mi?`);
    if (!confirmed) return;
    onAddAllMediaToPresentation(
      mediaItems.map((item) => ({ type: item.type, path: item.path, thumbnailUrl: thumbnailCache.get(item.path)?.url }))
    );
  }, [mediaItems, onAddAllMediaToPresentation]);

  const addLoopFiles = useCallback(async () => {
    const api = (window as any).electronAPI as
      | (NonNullable<typeof window.electronAPI> & {
          selectMediaFilesAll?: () => Promise<string | string[] | null>;
        })
      | undefined;
    if (!api) return;
    setIsLoading(true);
    try {
      let paths: string[] = [];
      if (api.selectMediaFilesAll) {
        const r = await api.selectMediaFilesAll();
        if (r) paths = Array.isArray(r) ? r : [r];
      } else if (api.selectMediaFile) {
        const r = await api.selectMediaFile('image');
        if (r) paths = [r];
      }
      if (paths.length === 0) return;
      const newItems: LoopItem[] = paths.map((p) => ({
        id: crypto.randomUUID(),
        type: VIDEO_EXTS.has(getExtension(p)) ? 'video' : 'image',
        mediaUrl: toFileUrl(p),
        fileName: getFileName(p),
        duration: defaultDuration * 1000,
      }));
      setLoopItems((prev) => [...prev, ...newItems]);
    } finally {
      setIsLoading(false);
    }
  }, [defaultDuration, setLoopItems]);

  const removeLoopItem = useCallback(
    (id: string) => setLoopItems((prev) => prev.filter((i) => i.id !== id)),
    [setLoopItems]
  );
  const clearLoop = useCallback(() => setLoopItems([]), [setLoopItems]);
  const updateLoopDuration = useCallback(
    (id: string, ms: number) => {
      const clamped = Math.max(MIN_DURATION_MS, Math.min(MAX_DURATION_MS, ms));
      setLoopItems((prev) => prev.map((i) => (i.id === id ? { ...i, duration: clamped } : i)));
    },
    [setLoopItems]
  );

  const handleDragStart = useCallback((index: number) => {
    dragItemIndex.current = index;
  }, []);
  const handleDragEnter = useCallback((index: number) => setDragOverIndex(index), []);
  const handleDragEnd = useCallback(() => {
    const from = dragItemIndex.current;
    const to = dragOverIndex;
    if (from !== null && to !== null && from !== to) {
      setLoopItems((prev) => {
        const next = [...prev];
        const [moved] = next.splice(from, 1);
        next.splice(to, 0, moved);
        return next;
      });
    }
    dragItemIndex.current = null;
    setDragOverIndex(null);
  }, [dragOverIndex, setLoopItems]);

  const handleAddLoop = useCallback(() => {
    if (loopItems.length === 0) return;
    onAddLoopToPresentation(loopItems, defaultDuration * 1000);
    setLoopItems([]);
  }, [loopItems, defaultDuration, onAddLoopToPresentation]);

  const handleDefaultDuration = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setDefaultDuration(parseDurationSecs(e.target.value));
  }, []);

  return (
    <div className="flex flex-col h-full bg-[#181818] text-white overflow-hidden">
      <div className="shrink-0 px-3 pt-3 pb-2 border-b border-white/[0.07]">
        <div
          role="tablist"
          aria-label={t('common.mediaTabs')}
          className="flex items-center gap-1.5 p-1 rounded-xl bg-white/[0.03] border border-white/[0.06]"
        >
          <button
            role="tab"
            aria-selected={activeSub === 'media'}
            id="media-tab"
            aria-controls="media-panel"
            onClick={() => setActiveSub('media')}
            className={cn(
              'flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold transition-all',
              activeSub === 'media'
                ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/30'
                : 'text-zinc-500 hover:text-zinc-300 hover:bg-white/[0.04]'
            )}
          >
            <ImageIcon className="w-3.5 h-3.5" />
            {t('common.mediaLibrary')}
            {mediaItems.length > 0 && (
              <span
                className={cn(
                  'text-[9px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center',
                  activeSub === 'media'
                    ? 'bg-white/20 text-white'
                    : 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                )}
              >
                {mediaItems.length}
              </span>
            )}
          </button>
          <button
            role="tab"
            aria-selected={activeSub === 'loop'}
            id="loop-tab"
            aria-controls="loop-panel"
            onClick={() => setActiveSub('loop')}
            className={cn(
              'flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold transition-all',
              activeSub === 'loop'
                ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/30'
                : 'text-zinc-500 hover:text-zinc-300 hover:bg-white/[0.04]'
            )}
          >
            <Repeat className="w-3.5 h-3.5" />
            {t('common.loopTitle')}
            {loopItems.length > 0 && (
              <span
                className={cn(
                  'text-[9px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center',
                  activeSub === 'loop'
                    ? 'bg-white/20 text-white'
                    : 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                )}
              >
                {loopItems.length}
              </span>
            )}
          </button>
        </div>
      </div>

      {activeSub === 'media' && (
        <div
          role="tabpanel"
          id="media-panel"
          aria-labelledby="media-tab"
          className="flex flex-col flex-1 overflow-hidden"
        >
          <div className="shrink-0 px-3 py-2.5 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5">
                <Film className="w-3 h-3 text-amber-500" />
                <span className="text-[10px] font-bold uppercase tracking-widest text-white/45">
                  {t('common.mediaLibrary')}
                </span>
              </div>
              {selectedIds.length > 0 ? (
                <>
                  <button
                    onClick={handleAddSelected}
                    className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-amber-500 hover:bg-amber-400 active:bg-amber-600 text-black text-[10px] font-bold uppercase tracking-wider transition-all"
                  >
                    <Plus size={11} /> Seçilenleri Slayta Ekle ({selectedIds.length})
                  </button>
                  <button
                    onClick={clearSelection}
                    className="text-[10px] text-white/30 hover:text-white/60 transition-colors px-1"
                  >
                    Seçimi Temizle
                  </button>
                </>
              ) : (
                mediaItems.length > 0 && (
                  <button
                    onClick={handleAddAllMediaClick}
                    className="flex items-center gap-1.5 px-2 py-1 rounded-lg border border-white/[0.08] bg-white/[0.03] hover:bg-white/[0.08] text-[10px] font-bold uppercase tracking-wider text-white/40 hover:text-white/70 transition-all"
                  >
                    <Plus size={11} /> Tümünü Slayta Ekle
                  </button>
                )
              )}
            </div>
            <div ref={menuRef} className="relative">
              <button
                onClick={() => setMenuOpen((v) => !v)}
                className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-white/[0.12] bg-white/[0.04] hover:bg-white/[0.08] text-[11px] font-bold uppercase tracking-wider transition-all"
              >
                <Plus size={13} /> {t('common.mediaAdd')} <ChevronDown size={12} className="opacity-60" />
              </button>
              {menuOpen && (
                <div className="absolute right-0 top-[calc(100%+6px)] w-[280px] z-20 p-1.5 rounded-xl border border-white/10 bg-[#141414]/[0.98] shadow-2xl shadow-black/50 backdrop-blur-xl">
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
          </div>

          {folderSettings.path && (
            <div className="shrink-0 mx-3 mb-2 px-2.5 py-2 rounded-xl border border-amber-500/25 bg-amber-500/[0.06] space-y-2">
              <div className="flex items-center gap-1.5 min-w-0">
                <FolderOpen className="w-3 h-3 text-amber-600 shrink-0" />
                <span
                  className="flex-1 min-w-0 truncate font-mono text-[10px] font-semibold text-white/65"
                  title={folderSettings.path}
                >
                  {folderSettings.path}
                </span>
                {folderMissing && (
                  <span className="shrink-0 text-[9px] font-bold text-red-300 bg-red-500/15 border border-red-500/35 rounded px-1.5 py-0.5 whitespace-nowrap">
                    {t('common.mediaFolderMissing')}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                <div className="flex p-0.5 rounded-lg border border-white/10 bg-black/25">
                  <button
                    type="button"
                    onClick={() => updateFolderSettings({ recursive: false })}
                    className={cn(
                      'px-2 py-1 rounded-md text-[10px] font-semibold transition-all',
                      !folderSettings.recursive ? 'bg-amber-500/20 text-amber-300' : 'text-white/45 hover:text-white/70'
                    )}
                  >
                    {t('common.mediaFolderOnlyThis')}
                  </button>
                  <button
                    type="button"
                    onClick={() => updateFolderSettings({ recursive: true })}
                    className={cn(
                      'px-2 py-1 rounded-md text-[10px] font-semibold transition-all',
                      folderSettings.recursive ? 'bg-amber-500/20 text-amber-300' : 'text-white/45 hover:text-white/70'
                    )}
                  >
                    {t('common.mediaFolderWithSubs')}
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => updateFolderSettings({ includeImages: !folderSettings.includeImages })}
                  className={cn(
                    'flex items-center gap-1.5 px-2 py-1 rounded-lg text-[10px] font-semibold border transition-all',
                    folderSettings.includeImages
                      ? 'bg-amber-500/20 border-amber-500/40 text-amber-300'
                      : 'border-white/10 bg-white/[0.04] text-white/45'
                  )}
                >
                  <span
                    className={cn(
                      'w-3 h-3 rounded-[3px] border flex items-center justify-center',
                      folderSettings.includeImages ? 'bg-amber-500 border-transparent' : 'border-white/30'
                    )}
                  >
                    {folderSettings.includeImages && <Check className="w-2 h-2 text-black" strokeWidth={3.5} />}
                  </span>
                  {t('common.mediaFolderImages')}
                </button>
                <button
                  type="button"
                  onClick={() => updateFolderSettings({ includeVideos: !folderSettings.includeVideos })}
                  className={cn(
                    'flex items-center gap-1.5 px-2 py-1 rounded-lg text-[10px] font-semibold border transition-all',
                    folderSettings.includeVideos
                      ? 'bg-amber-500/20 border-amber-500/40 text-amber-300'
                      : 'border-white/10 bg-white/[0.04] text-white/45'
                  )}
                >
                  <span
                    className={cn(
                      'w-3 h-3 rounded-[3px] border flex items-center justify-center',
                      folderSettings.includeVideos ? 'bg-amber-500 border-transparent' : 'border-white/30'
                    )}
                  >
                    {folderSettings.includeVideos && <Check className="w-2 h-2 text-black" strokeWidth={3.5} />}
                  </span>
                  {t('common.mediaFolderVideos')}
                </button>
                <span className="flex-1" />
                <button
                  type="button"
                  onClick={chooseFolder}
                  disabled={scanLoading}
                  className="px-2.5 py-1 rounded-lg text-[10px] font-bold tracking-wider border border-amber-500/40 bg-amber-500/15 text-amber-300 hover:bg-amber-500/25 transition-all disabled:opacity-40"
                >
                  {t('common.mediaFolderChange')}
                </button>
                <button
                  type="button"
                  onClick={() => scanFolder(folderSettings)}
                  disabled={scanLoading}
                  title={t('common.mediaFolderRefresh')}
                  className="w-6 h-6 flex items-center justify-center rounded border border-white/[0.14] bg-white/[0.05] text-white/60 hover:text-white hover:bg-white/[0.1] transition-all disabled:opacity-40"
                >
                  {scanLoading ? (
                    <span className="text-[9px] font-bold px-0.5">{t('common.mediaFolderLoading')}</span>
                  ) : (
                    <RefreshCw className="w-3 h-3" />
                  )}
                </button>
                <button
                  type="button"
                  onClick={clearFolder}
                  title={t('common.mediaFolderClear')}
                  className="w-6 h-6 flex items-center justify-center rounded border border-white/[0.14] bg-white/[0.05] text-white/60 hover:text-red-400 hover:border-red-500/40 transition-all"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            </div>
          )}

          {mediaItems.length === 0 ? (
            <div className="flex-1 overflow-y-auto px-3 pb-4">
              <div className="h-full flex flex-col items-center justify-center text-center p-6">
                <div className="relative w-16 h-16 flex items-center justify-center mb-4">
                  <Film size={28} className="text-white/10" />
                  <div className="absolute inset-0 rounded-full border border-white/[0.05]" />
                </div>
                <p className="text-sm font-bold text-white/75">{t('common.mediaEmpty')}</p>
                <p className="text-[11px] text-white/35 mt-1.5 leading-relaxed">{t('common.mediaEmptyDesc')}</p>
              </div>
            </div>
          ) : (
            <VirtualizedMediaGrid items={mediaItems}>
              {(item) => (
                <MediaCard
                  key={item.id}
                  item={item}
                  selected={selectedIds.includes(item.id)}
                  onAdd={addMediaToPres}
                  onRemove={removeMediaItem}
                  onToggleSelect={toggleSelect}
                />
              )}
            </VirtualizedMediaGrid>
          )}
        </div>
      )}

      {activeSub === 'loop' && (
        <div
          role="tabpanel"
          id="loop-panel"
          aria-labelledby="loop-tab"
          className="flex flex-col flex-1 overflow-hidden"
        >
          <div className="shrink-0 px-3 pt-2.5 pb-2 space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Repeat className="w-3 h-3 text-amber-400" />
                <span className="text-[10px] font-bold uppercase tracking-widest text-white/45">
                  {t('common.loopTitle')}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={addLoopFiles}
                  disabled={isLoading}
                  title={t('common.loopAddMedia')}
                  className="flex items-center justify-center w-7 h-7 rounded border bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border-emerald-500/20 disabled:opacity-40 transition-colors"
                >
                  {isLoading ? (
                    <span className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <Plus className="w-3.5 h-3.5" />
                  )}
                </button>
                <button
                  onClick={clearLoop}
                  disabled={loopItems.length === 0}
                  title={t('common.loopClearAll')}
                  className="flex items-center justify-center w-7 h-7 rounded border bg-red-500/10 hover:bg-red-500/20 text-red-400 border-red-500/20 disabled:opacity-40 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Clock className="w-3 h-3 text-zinc-600 shrink-0" />
              <label className="text-[10px] text-zinc-500 shrink-0">{t('common.loopDefaultDuration')}</label>
              <div className="flex items-center gap-1 ml-auto">
                <input
                  type="number"
                  min={1}
                  max={300}
                  value={defaultDuration}
                  onChange={handleDefaultDuration}
                  className="w-14 bg-zinc-900 border border-zinc-700 rounded px-2 py-0.5 text-xs text-white text-center font-mono focus:outline-none focus:border-amber-500/70 transition-colors"
                />
                <span className="text-[10px] text-zinc-500 select-none">s</span>
              </div>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {loopItems.length === 0 ? (
              <button
                onClick={addLoopFiles}
                className="w-full h-full min-h-36 flex flex-col items-center justify-center gap-2.5 border border-dashed border-zinc-700 rounded-xl text-zinc-600 hover:text-zinc-400 hover:border-zinc-500 transition-colors cursor-pointer"
              >
                <Repeat className="w-6 h-6 opacity-60" />
                <div className="text-center space-y-0.5">
                  <div className="text-xs font-medium">{t('common.loopClickToAdd')}</div>
                  <div className="text-[10px] text-zinc-600">{t('common.loopDragFiles')}</div>
                </div>
              </button>
            ) : (
              <>
                {loopItems.map((item, index) => (
                  <LoopItemRow
                    key={item.id}
                    item={item}
                    index={index}
                    isDragOver={dragOverIndex === index}
                    onDragStart={handleDragStart}
                    onDragEnter={handleDragEnter}
                    onDragEnd={handleDragEnd}
                    onRemove={removeLoopItem}
                    onDurationChange={updateLoopDuration}
                  />
                ))}
                <button
                  onClick={addLoopFiles}
                  className="w-full py-2 mt-1 flex items-center justify-center gap-1.5 border border-dashed border-zinc-700 rounded-lg text-[11px] text-zinc-500 hover:text-zinc-300 hover:border-zinc-500 transition-colors"
                >
                  <Plus className="w-3 h-3" /> {t('common.loopAddMedia')}
                </button>
              </>
            )}
          </div>

          {loopItems.length > 0 && (
            <div className="shrink-0 px-3 py-3 border-t border-white/[0.07] space-y-2">
              <div className="flex items-center justify-between text-[10px] text-zinc-500">
                <span>{t('common.loopItemCount', { count: loopItems.length })}</span>
                <span className="flex items-center gap-1" aria-live="polite">
                  <Clock className="w-2.5 h-2.5" />
                  {t('common.loopTotal')} <strong className="text-zinc-400">{formatTotalTime(totalMs)}</strong>
                </span>
              </div>
              <button
                onClick={handleAddLoop}
                className="w-full flex items-center justify-center gap-2 py-2.5 bg-amber-500 hover:bg-amber-400 active:bg-amber-600 text-black text-xs font-semibold rounded-lg transition-colors"
              >
                <Repeat className="w-3.5 h-3.5" /> {t('common.loopAddToSlide')}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
