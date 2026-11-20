import ControlTooltip from './components/ControlTooltip';
import { Menu } from '@base-ui/react/menu';
import { isGuideActive } from './components/Tour/guideBoundary';
import { useUiMotionEnabled } from './hooks/useUiMotionEnabled';
import { uiMotion } from './uiMotion';
import { useListMotion } from './hooks/useListMotion';
import * as m from 'motion/react-m';
import { playSfx } from './sfx';
import { usePractice } from './hooks/usePractice';
import {
  useState,
  useCallback,
  useRef,
  useMemo,
  useEffect,
  useDeferredValue,
  memo,
  type ReactNode,
  type DragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
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
  GripVertical,
  RefreshCw,
  X,
  Check,
  Search,
  Grid2x2,
  Grid3x3,
  ArrowUp,
  ArrowDown,
  Minus,
  CheckCheck,
  TriangleAlert,
  Upload,
  Play,
  ListPlus,
  CircleCheck,
} from 'lucide-react';
import type { LoopItem, MediaItem, MediaKind } from './types';
import { LOOP_DEFAULT_DURATION } from './constants';
import { cn, toFileUrl as toSlideFileUrl } from './utils';
import { toOsPath } from './canvasSource';
import { confirmDialog } from './dialogs';
import { useStore } from './state/useStore';
import { loadMediaFolderSettings, saveMediaFolderSettings, type MediaFolderSettings } from './mediaFolderSettings';
import {
  CARD_META_HEIGHT,
  GRID_GAP,
  clampDurationSecs,
  computeGridMetrics,
  computeVisibleRange,
  countMediaByType,
  filterAndSortMedia,
  formatLoopTime,
  moveItem,
  parseMediaViewPrefs,
  rangeIds,
  sortMedia,
  type GridMetrics,
  type MediaDensity,
  type MediaFilter,
  type MediaSort,
  type MediaViewPrefs,
} from './mediaLibraryModel';
import './media-library.css';

// ─── Constants ──────────────────────────────────────────────────────────────

const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tif', 'tiff', 'avif', 'svg']);
const VIDEO_EXTS = new Set(['mp4', 'webm', 'mov', 'mkv', 'avi', 'm4v', 'wmv', 'flv', 'mpeg', 'mpg', 'ogg']);
const THUMBNAIL_TIMEOUT_MS = 8_000;
const MIN_DURATION_MS = 1_000;
const MAX_DURATION_MS = 300_000;
const THUMB_MAX_EDGE = 400;
const THUMB_CACHE_LIMIT = 800;
const OVERSCAN_ROWS = 2;
const VIEW_PREFS_KEY = 'wpa.media.view';
const LOOP_DURATION_KEY = 'wpa.media.loopDefaultDuration';
const LOOP_DRAG_TYPE = 'application/x-wpa-loop-item';

// ─── Helpers ────────────────────────────────────────────────────────────────

const normalizePath = (p: string) => p.replace(/\\/g, '/');

const toFileUrl = (p: string) => {
  const n = normalizePath(p);
  return encodeURI(`${n.startsWith('/') ? 'file://' : 'file:///'}${n}`);
};

/** Inverse of toFileUrl for loop items, so their previews can use the shared thumbnail cache. */
const fileUrlToPath = (url: string): string | null => (url.startsWith('file:') ? toOsPath(url) : null);

// Stream a media file through the main process's local-resource protocol
// (Range-capable). Unlike file:// URLs this works from the dev-server origin
// (http://localhost:5173), where webSecurity blocks file:// subresources.
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

function readStored<T>(key: string, parse: (raw: unknown) => T, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : parse(JSON.parse(raw));
  } catch {
    return fallback;
  }
}

function writeStored(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Preferences are a convenience; the page works without storage.
  }
}

const isFileDrag = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes('Files');

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
/** Paths whose thumbnail failed this session, so scrolling back doesn't retry forever. */
const thumbnailFailures = new Set<string>();

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

async function generateImageThumbnail(filePath: string, signal: AbortSignal): Promise<ThumbEntry | null> {
  const api = window.electronAPI;
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
    // normally runs from http://localhost (dev) or file:// (packaged). Mark the
    // media CORS-readable so getImageData()/toBlob() don't hit a tainted canvas.
    video.crossOrigin = 'anonymous';
    video.setAttribute('muted', '');
    video.setAttribute('playsinline', '');
    video.src = window.electronAPI ? toMediaStreamUrl(filePath) : toFileUrl(filePath);

    let settled = false;
    let retries = 0;
    const cleanup = () => {
      clearTimeout(timer);
      clearTimeout(metadataFallback);
      signal.removeEventListener('abort', onAbort);
      video.removeAttribute('src');
      try {
        video.load();
      } catch {
        // Ignore media cleanup failures.
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
      if (settled) return;
      try {
        const vw = video.videoWidth || 640;
        const vh = video.videoHeight || 360;
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
        } catch {
          done(null);
          return;
        }
        // Chrome decodes an all-black first frame for some codecs; seek further in.
        const isEmpty = (() => {
          try {
            const data = ctx.getImageData(0, 0, Math.min(c.width, 40), Math.min(c.height, 40)).data;
            let sum = 0;
            let samples = 0;
            for (let i = 0; i < data.length; i += 4 * 17) {
              sum += data[i] + data[i + 1] + data[i + 2];
              samples++;
            }
            return samples > 0 && sum / (samples * 3) < 12;
          } catch {
            return false;
          }
        })();
        if (isEmpty && retries < 3) {
          retries++;
          const dur = video.duration || 3;
          video.currentTime = Math.min(dur, Math.max(1, dur * 0.05 * (retries + 2)));
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
      // Wait until the decoder has actually presented the frame at the new
      // position. requestVideoFrameCallback fires exactly then; otherwise fall
      // back to a couple of frames plus a small delay.
      video.play().catch(() => {});
      video.pause();
      const rvfc = (video as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number })
        .requestVideoFrameCallback;
      if (typeof rvfc === 'function') {
        rvfc.call(video, tryCapture);
        setTimeout(tryCapture, 800);
      } else {
        requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(tryCapture, 80)));
      }
    };

    video.onloadedmetadata = () => {
      const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
      // Keep the timestamp valid for clips shorter than a second.
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
    // Some MP4s never fire onloadedmetadata due to bad atom layout.
    const metadataFallback = setTimeout(() => {
      if (!settled && video.readyState >= 1 && video.videoWidth && video.videoHeight) {
        try {
          video.currentTime = Math.max(0.5, Math.min(video.duration || 2, 1.5));
        } catch {
          // Ignore seek failures; the timeout settles the promise.
        }
      }
    }, 2500);
  });
}

async function generateVideoThumbnail(filePath: string, signal: AbortSignal): Promise<ThumbEntry | null> {
  const api = window.electronAPI;
  // The main process (ffmpeg, disk-cached) is faster and more reliable than
  // decoding in the renderer; fall back to the renderer decoder without it.
  if (api?.getMediaThumbnail) {
    try {
      const url = await api.getMediaThumbnail(filePath, THUMB_MAX_EDGE);
      if (signal.aborted) return null;
      if (url) return { url, isBlob: false };
    } catch {
      // Fall through to the renderer-side decoder.
    }
  }
  const url = await createVideoThumbnailBlob(filePath, signal);
  return url ? { url, isBlob: true } : null;
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('thumbnail conversion failed'));
    reader.onerror = () => reject(reader.error ?? new Error('thumbnail conversion failed'));
    reader.readAsDataURL(blob);
  });
}

/**
 * Create a portable thumbnail for a loop video. Data URLs are used because a
 * loop item is persisted inside the presentation and must not depend on the
 * disposable thumbnail cache surviving a save/reopen.
 */
async function generateLoopVideoThumbnail(filePath: string): Promise<string | undefined> {
  const entry = thumbnailCache.get(filePath) ?? (await generateVideoThumbnail(filePath, new AbortController().signal));
  if (!entry) return undefined;
  try {
    const response = await fetch(entry.url);
    if (!response.ok) return entry.url;
    return await blobToDataUrl(await response.blob());
  } catch {
    return entry.url;
  } finally {
    // Only revoke blobs we created here; cached ones stay owned by the cache.
    if (entry.isBlob && thumbnailCache.get(filePath) !== entry) URL.revokeObjectURL(entry.url);
  }
}

async function createLoopItems(paths: string[], durationMs: number): Promise<LoopItem[]> {
  return Promise.all(
    paths.map(async (p) => {
      const type: MediaKind = detectMediaType(p) === 'video' ? 'video' : 'image';
      return {
        id: makeId(),
        type,
        mediaUrl: toSlideFileUrl(p),
        fileName: getFileName(p),
        duration: durationMs,
        thumbnailUrl: type === 'video' ? await limitVideoThumb(() => generateLoopVideoThumbnail(p)) : undefined,
      } satisfies LoopItem;
    })
  );
}

const toPresentationItems = (items: MediaItem[]) =>
  items.map((item) => ({ type: item.type, path: item.path, thumbnailUrl: thumbnailCache.get(item.path)?.url }));

type ThumbState = { url?: string; failed: boolean };

function useThumbnail(type: MediaKind, filePath: string | null, enabled = true): ThumbState {
  const initial = (): ThumbState => ({
    url: filePath ? thumbnailCache.get(filePath)?.url : undefined,
    failed: !!filePath && thumbnailFailures.has(filePath),
  });
  const [state, setState] = useState<ThumbState>(initial);
  useEffect(() => {
    if (!enabled || !filePath) return;
    const cached = thumbnailCache.get(filePath);
    if (cached) {
      setState({ url: cached.url, failed: false });
      return;
    }
    if (thumbnailFailures.has(filePath)) {
      setState({ failed: true });
      return;
    }
    if (type === 'image' && getExtension(filePath) === 'svg') {
      setState({ url: window.electronAPI ? toMediaStreamUrl(filePath) : toFileUrl(filePath), failed: false });
      return;
    }
    setState({ failed: false });
    const controller = new AbortController();
    let alive = true;
    const limiter = type === 'video' ? limitVideoThumb : limitImageThumb;
    const task =
      type === 'video'
        ? () => generateVideoThumbnail(filePath, controller.signal)
        : () => generateImageThumbnail(filePath, controller.signal);
    limiter(task, controller.signal)
      .then((entry) => {
        if (controller.signal.aborted) return;
        if (!entry) {
          thumbnailFailures.add(filePath);
          if (alive) setState({ failed: true });
          return;
        }
        cacheThumb(filePath, entry);
        if (alive) setState({ url: entry.url, failed: false });
      })
      .catch(() => {});
    return () => {
      alive = false;
      controller.abort();
    };
  }, [filePath, type, enabled]);
  return state;
}

// ─── Duration Stepper ───────────────────────────────────────────────────────

const DurationStepper = memo(function DurationStepper({
  id,
  valueSecs,
  onChange,
  disabled = false,
  label,
}: {
  id?: string;
  valueSecs: number;
  onChange: (secs: number) => void;
  disabled?: boolean;
  label: string;
}) {
  const { t } = useTranslation();
  const [local, setLocal] = useState(String(valueSecs));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setLocal(String(valueSecs));
  }, [valueSecs]);
  const commit = (value: string | number) => {
    const parsed = clampDurationSecs(value);
    setLocal(String(parsed));
    if (parsed !== valueSecs) onChange(parsed);
  };
  return (
    <div className="media-stepper" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        disabled={disabled || valueSecs <= 1}
        onClick={() => commit(valueSecs - 1)}
        aria-label={`${label}: ${t('mediaPage.decrease')}`}
        title={t('mediaPage.decrease')}
      >
        <Minus size={13} aria-hidden="true" />
      </button>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        min={1}
        max={300}
        value={local}
        disabled={disabled}
        aria-label={label}
        onChange={(e) => setLocal(e.target.value)}
        onFocus={(e) => {
          focused.current = true;
          e.target.select();
        }}
        onBlur={() => {
          focused.current = false;
          commit(local);
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') {
            setLocal(String(valueSecs));
            (e.target as HTMLInputElement).blur();
          }
        }}
      />
      <button
        type="button"
        disabled={disabled || valueSecs >= 300}
        onClick={() => commit(valueSecs + 1)}
        aria-label={`${label}: ${t('mediaPage.increase')}`}
        title={t('mediaPage.increase')}
      >
        <Plus size={13} aria-hidden="true" />
      </button>
      <span className="media-unit" aria-hidden="true">
        s
      </span>
    </div>
  );
});

// ─── Loop Item Row ──────────────────────────────────────────────────────────

type DropPosition = 'before' | 'after';

const LoopItemRow = memo(function LoopItemRow({
  item,
  index,
  count,
  dropPosition,
  dragging,
  onDragStart,
  onDragOverRow,
  onDropRow,
  onDragEnd,
  onMove,
  onRemove,
  onDurationChange,
  onUseVideoDurationChange,
}: {
  item: LoopItem;
  index: number;
  count: number;
  dropPosition: DropPosition | null;
  dragging: boolean;
  onDragStart: (index: number) => void;
  onDragOverRow: (index: number, position: DropPosition) => void;
  onDropRow: (index: number, position: DropPosition) => void;
  onDragEnd: () => void;
  onMove: (from: number, to: number) => void;
  onRemove: (id: string) => void;
  onDurationChange: (id: string, ms: number) => void;
  onUseVideoDurationChange: (id: string, enabled: boolean) => void;
}) {
  const { t } = useTranslation();
  const path = useMemo(() => fileUrlToPath(item.mediaUrl), [item.mediaUrl]);
  const needsThumb = item.type === 'image' || !item.thumbnailUrl;
  const thumb = useThumbnail(item.type, path, needsThumb);
  const src = item.type === 'video' ? item.thumbnailUrl ?? thumb.url : thumb.url ?? (path ? undefined : item.mediaUrl);
  const handleDur = useCallback((secs: number) => onDurationChange(item.id, secs * 1000), [item.id, onDurationChange]);
  const fullVideo = item.type === 'video' && !!item.useVideoDuration;
  const positionOf = (event: DragEvent<HTMLDivElement>): DropPosition => {
    const rect = event.currentTarget.getBoundingClientRect();
    return event.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
  };
  return (
    <div
      className="loop-row"
      draggable
      data-motion-item="loop"
      data-motion-id={item.id}
      data-drop={dropPosition ?? undefined}
      data-dragging={dragging || undefined}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData(LOOP_DRAG_TYPE, item.id);
        onDragStart(index);
      }}
      onDragOver={(event) => {
        if (!Array.from(event.dataTransfer.types).includes(LOOP_DRAG_TYPE)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        onDragOverRow(index, positionOf(event));
      }}
      onDrop={(event) => {
        if (!Array.from(event.dataTransfer.types).includes(LOOP_DRAG_TYPE)) return;
        event.preventDefault();
        event.stopPropagation();
        onDropRow(index, positionOf(event));
      }}
      onDragEnd={onDragEnd}
      onKeyDown={(event) => {
        if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
        event.preventDefault();
        event.stopPropagation();
        onMove(index, event.key === 'ArrowUp' ? index - 1 : index + 1);
      }}
    >
      <span className="loop-grip" title={t('common.loopDragToReorder')} aria-hidden="true">
        <GripVertical size={15} />
      </span>
      <span className="loop-index">{index + 1}</span>
      <div className="loop-thumb">
        {src ? (
          <img src={src} alt="" loading="lazy" decoding="async" draggable={false} />
        ) : (
          <div className={cn('media-thumb-empty', !thumb.failed && needsThumb && 'media-loading')}>
            {item.type === 'video' ? <Film size={16} /> : <ImageIcon size={16} />}
          </div>
        )}
        <span className="loop-thumb-kind" aria-hidden="true">
          {item.type === 'video' ? <Play size={9} fill="currentColor" /> : <ImageIcon size={9} />}
        </span>
      </div>
      <div className="loop-info">
        <div className="media-name" title={item.fileName}>
          {item.fileName}
        </div>
        <div className="media-sub">
          {item.type === 'video' ? t('common.loopVideo') : t('common.loopImage')}
          {fullVideo && ` · ${t('mediaPage.loopVideoLength')}`}
        </div>
      </div>
      <div className="loop-controls">
        {item.type === 'video' && (
          <button
            type="button"
            className="loop-full"
            aria-pressed={fullVideo}
            onClick={() => onUseVideoDurationChange(item.id, !fullVideo)}
            title={t('common.loopUseVideoDuration')}
          >
            <Play size={11} aria-hidden="true" />
            {t('mediaPage.loopFullVideo')}
          </button>
        )}
        <DurationStepper
          valueSecs={Math.round(item.duration / 1000)}
          onChange={handleDur}
          disabled={fullVideo}
          label={`${t('common.loopDuration')} — ${item.fileName ?? index + 1}`}
        />
        <div className="loop-move">
          <button
            type="button"
            className="media-icon"
            disabled={index === 0}
            onClick={() => onMove(index, index - 1)}
            aria-label={t('common.moveUp')}
            title={t('common.moveUp')}
          >
            <ArrowUp size={14} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="media-icon"
            disabled={index === count - 1}
            onClick={() => onMove(index, index + 1)}
            aria-label={t('common.moveDown')}
            title={t('common.moveDown')}
          >
            <ArrowDown size={14} aria-hidden="true" />
          </button>
        </div>
        <button
          type="button"
          className="media-icon media-quick-danger"
          onClick={() => onRemove(item.id)}
          aria-label={t('common.loopRemove')}
          title={t('common.loopRemove')}
        >
          <Trash2 size={14} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
});

// ─── Media Card ─────────────────────────────────────────────────────────────

const MediaCard = memo(function MediaCard({
  item,
  selected,
  previewHeight,
  onActivate,
  onAdd,
  onAddToLoop,
  onRemove,
}: {
  item: MediaItem;
  selected: boolean;
  previewHeight: number;
  onActivate: (id: string, event: ReactMouseEvent) => void;
  onAdd: (item: MediaItem, thumbnailUrl?: string) => void;
  onAddToLoop: (item: MediaItem) => void;
  onRemove: (id: string) => void;
}) {
  const { t } = useTranslation();
  const isImage = item.type === 'image';
  const ext = getExtension(item.path).toUpperCase();
  const thumb = useThumbnail(item.type, item.path);
  return (
    <div
      className="media-card"
      data-selected={selected}
      onKeyDown={(event) => {
        // Let the focused button activate natively without also triggering the
        // global operator shortcuts (Enter/Space navigate or send slides).
        if (event.key === 'Enter' || event.key === ' ') event.stopPropagation();
      }}
    >
      <button
        type="button"
        className="media-hit"
        onClick={(event) => onActivate(item.id, event)}
        onDoubleClick={() => onAdd(item, thumb.url)}
        aria-label={t(selected ? 'tooltipText.unselectMedia' : 'tooltipText.selectMedia', { name: item.name })}
        aria-pressed={selected}
        title={item.name}
      />
      <div className="media-thumb" style={{ height: previewHeight }}>
        {thumb.url ? (
          <img src={thumb.url} alt="" loading="lazy" decoding="async" draggable={false} />
        ) : (
          <div className={cn('media-thumb-empty', !thumb.failed && 'media-loading')}>
            {isImage ? <ImageIcon size={22} /> : <Video size={22} />}
          </div>
        )}
        <span className="media-kind">
          {isImage ? <ImageIcon size={10} aria-hidden="true" /> : <Play size={10} fill="currentColor" aria-hidden="true" />}
          {ext || (isImage ? 'IMG' : 'VID')}
        </span>
        <span className="media-check" aria-hidden="true">
          {selected && <Check size={13} strokeWidth={3} className="ui-choice-mark" />}
        </span>
      </div>
      <div className="media-quick">
        <button
          type="button"
          onClick={() => onAddToLoop(item)}
          aria-label={`${t('mediaPage.addToLoop')}: ${item.name}`}
          title={t('mediaPage.addToLoop')}
        >
          <ListPlus size={15} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="media-quick-danger"
          onClick={() => onRemove(item.id)}
          aria-label={`${t('common.mediaRemove')}: ${item.name}`}
          title={t('common.mediaRemove')}
        >
          <Trash2 size={15} aria-hidden="true" />
        </button>
      </div>
      <div className="media-meta" style={{ height: CARD_META_HEIGHT }}>
        <div className="media-meta-text">
          <span className="media-name">{item.name}</span>
          <span className="media-sub">
            {isImage ? t('common.loopImage') : t('common.loopVideo')}
            {item.origin === 'folder' && ` · ${t('mediaPage.folderLinked')}`}
          </span>
        </div>
        <button
          type="button"
          className="media-add"
          onClick={() => onAdd(item, thumb.url)}
          data-guide-anchor={item.name === 'practice-image.svg' ? 'media-add' : undefined}
          title={t('common.mediaAddToSlide')}
          aria-label={`${t('common.mediaAddToSlide')}: ${item.name}`}
        >
          <Plus size={16} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
});

// ─── Virtualized Grid ───────────────────────────────────────────────────────

const VirtualizedMediaGrid = memo(function VirtualizedMediaGrid({
  items,
  density,
  resetKey,
  renderItem,
}: {
  items: MediaItem[];
  density: MediaDensity;
  resetKey: string;
  renderItem: (item: MediaItem, metrics: GridMetrics) => ReactNode;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0, scrollTop: 0 });

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => {
      const style = getComputedStyle(el);
      const inner = el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      setViewport((prev) =>
        prev.width === inner && prev.height === el.clientHeight && prev.scrollTop === el.scrollTop
          ? prev
          : { width: inner, height: el.clientHeight, scrollTop: el.scrollTop }
      );
    };
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

  // A new search / filter / sort starts from the top instead of a stale offset.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [resetKey]);

  const metrics = useMemo(() => computeGridMetrics(viewport.width, density), [viewport.width, density]);
  const totalRows = Math.ceil(items.length / metrics.cols);
  const { startRow, endRow } = computeVisibleRange(
    viewport.scrollTop,
    viewport.height,
    metrics.rowHeight,
    totalRows,
    OVERSCAN_ROWS
  );
  const visibleItems = useMemo(
    () => items.slice(startRow * metrics.cols, Math.min(items.length, (endRow + 1) * metrics.cols)),
    [items, startRow, endRow, metrics.cols]
  );

  return (
    <div ref={scrollRef} className="media-viewport">
      <div style={{ position: 'relative', width: '100%', height: totalRows > 0 ? totalRows * metrics.rowHeight - GRID_GAP : 0 }}>
        <div
          role="list"
          style={{
            position: 'absolute',
            top: startRow * metrics.rowHeight,
            left: 0,
            right: 0,
            display: 'grid',
            gridTemplateColumns: `repeat(${metrics.cols}, minmax(0, 1fr))`,
            gridAutoRows: metrics.cardHeight,
            gap: GRID_GAP,
          }}
        >
          {visibleItems.map((item) => (
            <div key={item.id} role="listitem" data-motion-item="media" data-motion-id={item.id} style={{ minWidth: 0 }}>
              {renderItem(item, metrics)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
});

// ─── Menu Item ──────────────────────────────────────────────────────────────

const DropItem = memo(function DropItem({
  icon,
  title,
  desc,
  onClick,
  guideAnchor,
}: {
  guideAnchor?: string;
  icon: ReactNode;
  title: string;
  desc: string;
  onClick: () => void;
}) {
  return (
    <Menu.Item
      label={title}
      onClick={onClick}
      data-guide-anchor={guideAnchor}
      className="w-full flex items-center gap-2.5 p-2.5 rounded-lg hover:bg-white/[0.06] transition-colors text-left outline-none"
    >
      <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-blue-500/15 text-blue-300 shrink-0">{icon}</div>
      <div>
        <div className="text-xs font-semibold text-white/90">{title}</div>
        <div className="text-[11px] text-white/60 leading-snug">{desc}</div>
      </div>
    </Menu.Item>
  );
});

// ─── Main Component ─────────────────────────────────────────────────────────

interface MediaLoopTabProps {
  onAddMediaToPresentation: (type: MediaKind, path: string, thumbnailUrl?: string) => void;
  onAddAllMediaToPresentation: (items: Array<{ type: MediaKind; path: string; thumbnailUrl?: string }>) => void;
  onAddLoopToPresentation: (items: LoopItem[], defaultDuration: number) => void;
}

type ScanInfo = { status: 'ok'; count: number } | { status: 'failed' } | null;

export default function MediaLoopTab({
  onAddMediaToPresentation,
  onAddAllMediaToPresentation,
  onAddLoopToPresentation,
}: MediaLoopTabProps) {
  const { t, i18n } = useTranslation();
  const practice = usePractice();
  const [imageImported, setImageImported] = useState(false);
  const [activeSub, setActiveSub] = useState<'media' | 'loop'>('media');
  const motionRoot = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const motionEnabled = useUiMotionEnabled();

  const mediaItems = useStore((s) => s.mediaItems);
  const setMediaItems = useStore((s) => s.setMediaItems);
  useEffect(() => {
    if (!practice || useStore.getState().mediaItems.length) return;
    try {
      const saved = JSON.parse(localStorage.getItem('wpa.practice.sampleMedia') ?? '[]');
      if (Array.isArray(saved))
        setMediaItems(
          saved
            .filter(
              (item) =>
                item?.type === 'image' &&
                item.name === 'practice-image.svg' &&
                typeof item.path === 'string' &&
                typeof item.id === 'string'
            )
            .slice(0, 1)
        );
    } catch {
      /* Reimport the practice sample if storage is unavailable. */
    }
  }, [practice, setMediaItems]);
  useEffect(() => {
    if (!practice) return;
    try {
      localStorage.setItem(
        'wpa.practice.sampleMedia',
        JSON.stringify(mediaItems.filter((item) => item.name === 'practice-image.svg'))
      );
    } catch {
      /* Workspace outcomes remain authoritative. */
    }
  }, [practice, mediaItems]);
  const loopItems = useStore((s) => s.loopItems);
  const setLoopItems = useStore((s) => s.setLoopItems);

  // ── View state ──
  const [view, setView] = useState<MediaViewPrefs>(() => readStored(VIEW_PREFS_KEY, parseMediaViewPrefs, parseMediaViewPrefs(null)));
  const updateView = useCallback((patch: Partial<MediaViewPrefs>) => {
    setView((prev) => {
      const next = { ...prev, ...patch };
      writeStored(VIEW_PREFS_KEY, next);
      return next;
    });
  }, []);
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const counts = useMemo(() => countMediaByType(mediaItems), [mediaItems]);
  const visibleItems = useMemo(
    () => filterAndSortMedia(mediaItems, { query: deferredQuery, filter: view.filter, sort: view.sort }, locale),
    [mediaItems, deferredQuery, view.filter, view.sort, locale]
  );
  const filtersActive = view.filter !== 'all' || query.trim() !== '';
  const resetFilters = useCallback(() => {
    setQuery('');
    updateView({ filter: 'all' });
  }, [updateView]);

  const viewKey = `${activeSub}|${view.filter}|${view.sort}|${deferredQuery}`;
  const mediaIds = useMemo(() => mediaItems.map((item) => item.id), [mediaItems]);
  const loopIds = useMemo(() => loopItems.map((item) => item.id), [loopItems]);
  useListMotion(motionRoot, mediaIds, 'media-library', 'media', viewKey);
  useListMotion(motionRoot, loopIds, 'loop-library', 'loop', activeSub);

  // ── Selection (Set + ref so card callbacks stay stable) ──
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const anchorRef = useRef<string | null>(null);
  const visibleRef = useRef(visibleItems);
  visibleRef.current = visibleItems;

  // Drop selections whose items were removed (folder rescans, deletes).
  useEffect(() => {
    setSelected((prev) => {
      if (!prev.size) return prev;
      const ids = new Set(mediaIds);
      const next = new Set([...prev].filter((id) => ids.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [mediaIds]);

  const activateCard = useCallback((id: string, event: ReactMouseEvent) => {
    const current = selectedRef.current;
    if (event.shiftKey && anchorRef.current) {
      const ids = rangeIds(visibleRef.current, anchorRef.current, id);
      setSelected(new Set([...current, ...ids]));
      playSfx('check');
      return;
    }
    const next = new Set(current);
    if (next.has(id)) {
      next.delete(id);
      playSfx('uncheck');
    } else {
      next.add(id);
      playSfx('check');
    }
    anchorRef.current = id;
    setSelected(next);
  }, []);

  const clearSelection = useCallback(() => {
    if (!selectedRef.current.size) return;
    setSelected(new Set());
    anchorRef.current = null;
    playSfx('uncheck');
  }, []);

  const selectAllVisible = useCallback(() => {
    if (!visibleRef.current.length) return;
    setSelected(new Set([...selectedRef.current, ...visibleRef.current.map((item) => item.id)]));
    playSfx('check');
  }, []);

  /** Selected items in the current sort order (including any hidden by the filter). */
  const selectedItems = useCallback(
    () => sortMedia(mediaItems, view.sort, locale).filter((item) => selectedRef.current.has(item.id)),
    [mediaItems, view.sort, locale]
  );

  // ── Toast ──
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(timer);
  }, [toast]);

  // ── Folder ──
  const [menuOpen, setMenuOpen] = useState(false);
  const [folderSettings, setFolderSettings] = useState<MediaFolderSettings>(() => loadMediaFolderSettings());
  const [scanLoading, setScanLoading] = useState(false);
  const [folderMissing, setFolderMissing] = useState(false);
  const [scanInfo, setScanInfo] = useState<ScanInfo>(null);

  // ── Loop ──
  const [defaultDuration, setDefaultDuration] = useState(() =>
    readStored(LOOP_DURATION_KEY, (raw) => clampDurationSecs(Number(raw)), LOOP_DEFAULT_DURATION / 1000)
  );
  const [loopBusy, setLoopBusy] = useState(0);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<{ index: number; position: DropPosition } | null>(null);
  const totalMs = useMemo(() => loopItems.reduce((acc, i) => acc + i.duration, 0), [loopItems]);

  // ── File drop ──
  const [dropActive, setDropActive] = useState(false);
  const dragDepth = useRef(0);

  const addMediaPaths = useCallback(
    async (paths: string[], origin: 'manual' | 'folder' = 'manual') => {
      const incoming = paths
        .filter((p) => p && isMediaFile(p))
        .map((p) => ({ id: makeId(), type: detectMediaType(p)!, path: p, name: getFileName(p), preview: undefined, origin }) satisfies MediaItem);
      if (!incoming.length) return 0;
      const existing = new Set(useStore.getState().mediaItems.map((i) => normalizePath(i.path)));
      const fresh = incoming.filter((i) => !existing.has(normalizePath(i.path)));
      if (origin === 'manual' && fresh.length) playSfx('complete');
      setMediaItems((prev) => {
        const seen = new Set(prev.map((i) => normalizePath(i.path)));
        const unique = incoming.filter((i) => {
          const k = normalizePath(i.path);
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        });
        return unique.length ? [...prev, ...unique] : prev;
      });
      return fresh.length;
    },
    [setMediaItems]
  );

  const importFiles = useCallback(
    async (type: MediaKind) => {
      const api = window.electronAPI;
      if (!api) return;
      try {
        if (api.selectMediaFiles) {
          const r = await api.selectMediaFiles(type);
          if (r) await addMediaPaths(Array.isArray(r) ? r : [r]);
          return;
        }
        const r = await api.selectMediaFile(type);
        if (r) await addMediaPaths([r]);
      } catch {
        playSfx('error');
      }
    },
    [addMediaPaths]
  );

  const scanFolder = useCallback(
    async (settings: MediaFolderSettings, feedback = false) => {
      const api = window.electronAPI;
      if (!api?.readMediaFolder || !settings.path) return;
      setScanLoading(true);
      try {
        const result = await api.readMediaFolder(settings.path, {
          recursive: settings.recursive,
          includeImages: settings.includeImages,
          includeVideos: settings.includeVideos,
        });
        if (!result) {
          setScanInfo({ status: 'failed' });
          if (feedback) playSfx('error');
          return;
        }
        if (feedback) playSfx(result.missing ? 'error' : 'complete');
        setFolderMissing(result.missing);
        setScanInfo({ status: 'ok', count: result.missing ? 0 : result.paths.length });
        if (result.missing) {
          setMediaItems((prev) => prev.filter((i) => i.origin !== 'folder'));
        } else {
          const keep = new Set(result.paths.map(normalizePath));
          setMediaItems((prev) => {
            const next = prev.filter((i) => i.origin !== 'folder' || keep.has(normalizePath(i.path)));
            return next.length === prev.length ? prev : next;
          });
          if (result.paths.length) await addMediaPaths(result.paths, 'folder');
        }
      } catch {
        setScanInfo({ status: 'failed' });
        if (feedback) playSfx('error');
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
    const api = window.electronAPI;
    if (!api?.selectMediaFolder) return;
    const folder = await api.selectMediaFolder();
    if (!folder) return;
    setFolderMissing(false);
    setScanInfo(null);
    updateFolderSettings({ path: folder });
    playSfx('open');
  }, [updateFolderSettings]);

  const clearFolder = useCallback(() => {
    updateFolderSettings({ path: '', recursive: false, includeImages: true, includeVideos: true });
    setScanInfo(null);
    setFolderMissing(false);
    setMediaItems((prev) => prev.filter((i) => i.origin !== 'folder'));
  }, [updateFolderSettings, setMediaItems]);

  useEffect(() => {
    if (folderSettings.path) void scanFolder(folderSettings);
  }, [folderSettings, scanFolder]);

  // ── Library actions ──
  const removeMediaItem = useCallback(
    (id: string) => {
      setMediaItems((prev) => prev.filter((i) => i.id !== id));
      playSfx('delete');
    },
    [setMediaItems]
  );

  const addMediaToPres = useCallback(
    (item: MediaItem, thumb?: string) => onAddMediaToPresentation(item.type, item.path, thumb),
    [onAddMediaToPresentation]
  );

  const handleAddSelected = useCallback(() => {
    const items = selectedItems();
    if (!items.length) return;
    onAddAllMediaToPresentation(toPresentationItems(items));
    setSelected(new Set());
  }, [selectedItems, onAddAllMediaToPresentation]);

  const handleAddAllVisible = useCallback(async () => {
    const items = visibleRef.current;
    if (!items.length) return;
    const confirmed = await confirmDialog(t('mediaPage.confirmAddAll', { count: items.length }));
    if (!confirmed) return;
    onAddAllMediaToPresentation(toPresentationItems(items));
  }, [onAddAllMediaToPresentation, t]);

  const handleRemoveSelected = useCallback(async () => {
    const ids = selectedRef.current;
    if (!ids.size) return;
    if (ids.size > 1 && !(await confirmDialog(t('mediaPage.confirmRemove', { count: ids.size })))) return;
    setMediaItems((prev) => prev.filter((i) => !ids.has(i.id)));
    setSelected(new Set());
    playSfx('delete');
  }, [setMediaItems, t]);

  // ── Loop actions ──
  const addLoopPaths = useCallback(
    async (paths: string[]) => {
      const media = paths.filter(isMediaFile);
      if (!media.length) return 0;
      setLoopBusy((n) => n + media.length);
      try {
        const items = await createLoopItems(media, defaultDuration * 1000);
        setLoopItems((prev) => [...prev, ...items]);
        playSfx('complete');
        return items.length;
      } catch {
        playSfx('error');
        return 0;
      } finally {
        setLoopBusy((n) => Math.max(0, n - media.length));
      }
    },
    [defaultDuration, setLoopItems]
  );

  const addLoopFiles = useCallback(async () => {
    const api = window.electronAPI;
    if (!api) return;
    try {
      let paths: string[] = [];
      if (api.selectMediaFilesAll) {
        const r = await api.selectMediaFilesAll();
        if (r) paths = Array.isArray(r) ? r : [r];
      } else {
        const r = await api.selectMediaFile('image');
        if (r) paths = [r];
      }
      if (paths.length) await addLoopPaths(paths);
    } catch {
      playSfx('error');
    }
  }, [addLoopPaths]);

  const addItemToLoop = useCallback(
    async (item: MediaItem) => {
      const added = await addLoopPaths([item.path]);
      if (added) setToast(t('mediaPage.addedToLoop', { count: added }));
    },
    [addLoopPaths, t]
  );

  const handleAddSelectedToLoop = useCallback(async () => {
    const items = selectedItems();
    if (!items.length) return;
    setSelected(new Set());
    const added = await addLoopPaths(items.map((item) => item.path));
    if (added) setToast(t('mediaPage.addedToLoop', { count: added }));
  }, [selectedItems, addLoopPaths, t]);

  const removeLoopItem = useCallback(
    (id: string) => {
      setLoopItems((prev) => prev.filter((i) => i.id !== id));
      playSfx('delete');
    },
    [setLoopItems]
  );

  const clearLoop = useCallback(async () => {
    const count = useStore.getState().loopItems.length;
    if (!count) return;
    if (count > 1 && !(await confirmDialog(t('mediaPage.confirmClearLoop', { count })))) return;
    setLoopItems([]);
    playSfx('delete');
  }, [setLoopItems, t]);

  const updateLoopDuration = useCallback(
    (id: string, ms: number) => {
      const clamped = Math.max(MIN_DURATION_MS, Math.min(MAX_DURATION_MS, ms));
      setLoopItems((prev) => prev.map((i) => (i.id === id ? { ...i, duration: clamped } : i)));
    },
    [setLoopItems]
  );

  const updateLoopUseVideoDuration = useCallback(
    (id: string, enabled: boolean) => {
      playSfx(enabled ? 'toggle-on' : 'toggle-off');
      setLoopItems((prev) => prev.map((i) => (i.id === id ? { ...i, useVideoDuration: enabled } : i)));
    },
    [setLoopItems]
  );

  const changeDefaultDuration = useCallback((secs: number) => {
    setDefaultDuration(secs);
    writeStored(LOOP_DURATION_KEY, secs);
  }, []);

  const applyDefaultToAll = useCallback(() => {
    const ms = defaultDuration * 1000;
    setLoopItems((prev) => (prev.some((i) => i.duration !== ms) ? prev.map((i) => ({ ...i, duration: ms })) : prev));
    playSfx('complete');
  }, [defaultDuration, setLoopItems]);

  const moveLoopItem = useCallback(
    (from: number, to: number) => {
      const prev = useStore.getState().loopItems;
      const next = moveItem(prev, from, to);
      if (next === prev) return;
      setLoopItems(next as LoopItem[]);
      playSfx('reorder');
    },
    [setLoopItems]
  );

  const handleLoopDragOver = useCallback((index: number, position: DropPosition) => {
    setDropTarget((prev) => (prev?.index === index && prev.position === position ? prev : { index, position }));
  }, []);
  const handleLoopDragEnd = useCallback(() => {
    setDragIndex(null);
    setDropTarget(null);
  }, []);
  const handleLoopDrop = useCallback(
    (index: number, position: DropPosition) => {
      const from = dragIndex;
      setDragIndex(null);
      setDropTarget(null);
      if (from === null) return;
      let to = position === 'after' ? index + 1 : index;
      if (from < to) to -= 1;
      moveLoopItem(from, to);
    },
    [dragIndex, moveLoopItem]
  );

  const handleAddLoop = useCallback(() => {
    if (loopItems.length === 0) return;
    onAddLoopToPresentation(loopItems, defaultDuration * 1000);
    setLoopItems([]);
  }, [loopItems, defaultDuration, onAddLoopToPresentation, setLoopItems]);

  const switchSub = useCallback(
    (next: 'media' | 'loop') => {
      if (next === activeSub) return;
      setActiveSub(next);
      playSfx('swipe');
    },
    [activeSub]
  );

  // ── Page-level file drop (OS files → library or loop) ──
  const onPageDragEnter = (event: DragEvent<HTMLDivElement>) => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    dragDepth.current += 1;
    setDropActive(true);
  };
  const onPageDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  };
  const onPageDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (!isFileDrag(event)) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (!dragDepth.current) setDropActive(false);
  };
  const onPageDrop = async (event: DragEvent<HTMLDivElement>) => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
    dragDepth.current = 0;
    setDropActive(false);
    const api = window.electronAPI;
    const files = Array.from(event.dataTransfer.files);
    if (!api || !files.length) return;
    const resolve = api.getDroppedFilePath ?? api.getDroppedImagePath;
    const paths = (await Promise.all(files.map((file) => resolve(file).catch(() => null)))).filter(
      (p): p is string => !!p && isMediaFile(p)
    );
    if (!paths.length) {
      playSfx('error');
      return;
    }
    if (activeSub === 'loop') await addLoopPaths(paths);
    else if (!(await addMediaPaths(paths))) playSfx('error');
  };

  const onPageKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (activeSub !== 'media') return;
    if ((event.target as HTMLElement).closest('input, textarea, select, [contenteditable="true"]')) return;
    if (event.key === 'Escape' && selectedRef.current.size) {
      event.stopPropagation();
      clearSelection();
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a' && visibleRef.current.length) {
      event.preventDefault();
      event.stopPropagation();
      selectAllVisible();
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f' && mediaItems.length) {
      event.preventDefault();
      event.stopPropagation();
      searchRef.current?.focus();
    }
  };

  const renderCard = useCallback(
    (item: MediaItem, metrics: GridMetrics) => (
      <MediaCard
        item={item}
        selected={selected.has(item.id)}
        previewHeight={metrics.previewHeight}
        onActivate={activateCard}
        onAdd={addMediaToPres}
        onAddToLoop={addItemToLoop}
        onRemove={removeMediaItem}
      />
    ),
    [selected, activateCard, addMediaToPres, addItemToLoop, removeMediaItem]
  );

  const subTab = (id: 'media' | 'loop', icon: ReactNode, label: string, count: number) => (
    <button
      type="button"
      role="tab"
      id={`${id}-tab`}
      aria-controls={`${id}-panel`}
      aria-selected={activeSub === id}
      onClick={() => switchSub(id)}
    >
      {activeSub === id && (
        <m.span
          layoutId="media-active-tab"
          className="media-seg-pill"
          transition={{ duration: motionEnabled ? uiMotion.duration.fast : 0, ease: uiMotion.ease }}
        />
      )}
      {icon}
      {label}
      {count > 0 && <span className="media-count">{count.toLocaleString(locale)}</span>}
    </button>
  );

  const filterOptions: Array<{ value: MediaFilter; label: string }> = [
    { value: 'all', label: t('mediaPage.filterAll') },
    { value: 'image', label: t('mediaPage.filterImages') },
    { value: 'video', label: t('mediaPage.filterVideos') },
  ];

  const filtersOff = !!folderSettings.path && !folderSettings.includeImages && !folderSettings.includeVideos;
  const folderNotice = !folderSettings.path
    ? null
    : filtersOff
      ? t('common.mediaFiltersOff')
      : scanInfo?.status === 'failed'
        ? t('common.mediaScanFailed')
        : scanInfo?.status === 'ok' && scanInfo.count === 0 && !folderMissing
          ? t('common.mediaFolderNoMatches')
          : null;

  const importMenuItems = (
    <>
      <DropItem
        icon={<ImageIcon size={15} />}
        guideAnchor="media-import"
        title={t('common.mediaSelectImages')}
        desc={t('common.mediaSelectImagesDesc')}
        onClick={() => {
          setMenuOpen(false);
          void importFiles('image').then(() => setImageImported(true));
        }}
      />
      <DropItem
        icon={<Video size={15} />}
        title={t('common.mediaSelectVideos')}
        desc={t('common.mediaSelectVideosDesc')}
        onClick={() => {
          setMenuOpen(false);
          void importFiles('video');
        }}
      />
      <DropItem
        icon={<FolderOpen size={15} />}
        title={t('common.mediaSelectFolder')}
        desc={t('common.mediaSelectFolderDesc')}
        onClick={() => {
          setMenuOpen(false);
          void chooseFolder();
        }}
      />
    </>
  );

  return (
    <div
      ref={motionRoot}
      className="media-page"
      data-selecting={selected.size > 0}
      data-guide-state={JSON.stringify({
        mediaMenu: menuOpen,
        imageReady: mediaItems.some((item) => item.name === 'practice-image.svg'),
        imageImported,
      })}
      onKeyDown={onPageKeyDown}
      onDragEnter={onPageDragEnter}
      onDragOver={onPageDragOver}
      onDragLeave={onPageDragLeave}
      onDrop={onPageDrop}
    >
      <div className="media-top">
        <div className="media-head">
          <h2>
            <Film size={16} aria-hidden="true" />
            {t('mediaPage.title')}
          </h2>
          <div role="tablist" aria-label={t('common.mediaTabs')} className="media-seg">
            {subTab('media', <ImageIcon size={14} aria-hidden="true" />, t('mediaPage.library'), mediaItems.length)}
            {subTab('loop', <Repeat size={14} aria-hidden="true" />, t('mediaPage.loop'), loopItems.length)}
          </div>
          <div className="media-head-actions">
            {activeSub === 'media' ? (
              <>
              <Menu.Root
                modal={false}
                open={menuOpen}
                onOpenChange={(next, details) => {
                  // The guide owns focus until its asynchronous next-step lease arrives.
                  if (!next && details.reason === 'focus-out' && isGuideActive()) {
                    details.cancel();
                    return;
                  }
                  if (next !== menuOpen) {
                    setMenuOpen(next);
                    playSfx(next ? 'open' : 'close');
                  }
                }}
              >
                <Menu.Trigger data-guide-anchor="media-menu" className="media-primary">
                  <Plus size={15} aria-hidden="true" /> {t('common.mediaAdd')}
                  <ChevronDown size={13} className="opacity-70" aria-hidden="true" />
                </Menu.Trigger>
                <Menu.Portal>
                  <Menu.Positioner side="bottom" align="end" sideOffset={6} className="z-[80]">
                    <Menu.Popup
                      className="design-action-menu w-[290px]"
                      aria-label={t('common.mediaAdd')}
                      onKeyDown={(event) => event.stopPropagation()}
                    >
                      {importMenuItems}
                    </Menu.Popup>
                  </Menu.Positioner>
                </Menu.Portal>
              </Menu.Root>
              </>
            ) : (
              <>
                <ControlTooltip descriptionKey={'common.loopClearAll'}>
                  <button
                    type="button"
                    className="media-tool media-danger"
                    onClick={clearLoop}
                    disabled={loopItems.length === 0}
                    title={t('common.loopClearAll')}
                  >
                    <Trash2 size={15} aria-hidden="true" />
                    {t('common.loopClearAll')}
                  </button>
                </ControlTooltip>
                <button type="button" className="media-primary" onClick={addLoopFiles} disabled={loopBusy > 0}>
                  {loopBusy > 0 ? (
                    <RefreshCw size={15} className="animate-spin" aria-hidden="true" />
                  ) : (
                    <Plus size={15} aria-hidden="true" />
                  )}
                  {loopBusy > 0 ? t('mediaPage.preparing') : t('mediaPage.loopAddFiles')}
                </button>
              </>
            )}
          </div>
        </div>

        {activeSub === 'media' && (
          <>
            {mediaItems.length > 0 && (
              <div className="media-find">
                <div className="media-search">
                  <Search size={15} aria-hidden="true" />
                  <input
                    ref={searchRef}
                    type="search"
                    value={query}
                    placeholder={t('mediaPage.search')}
                    aria-label={t('mediaPage.search')}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === 'Escape' && query) setQuery('');
                    }}
                  />
                  {query && (
                    <button
                      type="button"
                      aria-label={t('mediaPage.clearSearch')}
                      onClick={() => {
                        setQuery('');
                        searchRef.current?.focus();
                      }}
                    >
                      <X size={14} aria-hidden="true" />
                    </button>
                  )}
                </div>
                <div role="radiogroup" aria-label={t('mediaPage.filterLabel')} className="media-seg media-seg-sm">
                  {filterOptions.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      role="radio"
                      aria-checked={view.filter === option.value}
                      onClick={() => updateView({ filter: option.value })}
                    >
                      {option.label}
                      <span className="media-count">{counts[option.value].toLocaleString(locale)}</span>
                    </button>
                  ))}
                </div>
                <select
                  className="media-select"
                  aria-label={t('mediaPage.sortLabel')}
                  value={view.sort}
                  onChange={(e) => updateView({ sort: e.target.value as MediaSort })}
                >
                  <option value="added">{t('mediaPage.sortAdded')}</option>
                  <option value="name">{t('mediaPage.sortName')}</option>
                  <option value="type">{t('mediaPage.sortType')}</option>
                </select>
                <div className="media-density" role="group" aria-label={t('mediaPage.densityLabel')}>
                  <button
                    type="button"
                    className="media-icon"
                    aria-pressed={view.density === 'compact'}
                    onClick={() => updateView({ density: 'compact' })}
                    aria-label={t('mediaPage.densityCompact')}
                    title={t('mediaPage.densityCompact')}
                  >
                    <Grid3x3 size={15} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="media-icon"
                    aria-pressed={view.density === 'comfortable'}
                    onClick={() => updateView({ density: 'comfortable' })}
                    aria-label={t('mediaPage.densityComfortable')}
                    title={t('mediaPage.densityComfortable')}
                  >
                    <Grid2x2 size={15} aria-hidden="true" />
                  </button>
                </div>
              </div>
            )}

            {folderSettings.path && (
              <div className="media-folder">
                <div className="media-folder-path">
                  <FolderOpen size={14} aria-hidden="true" />
                  <strong>{t('mediaPage.folderLinked')}</strong>
                  <code title={folderSettings.path}>{folderSettings.path}</code>
                  {folderMissing && <span className="media-badge-warn">{t('common.mediaFolderMissing')}</span>}
                </div>
                <div className="media-folder-opts">
                  <div role="radiogroup" aria-label={t('mediaPage.folderScope')} className="media-seg media-seg-sm">
                    <button
                      type="button"
                      role="radio"
                      aria-checked={!folderSettings.recursive}
                      onClick={() => updateFolderSettings({ recursive: false })}
                    >
                      {t('common.mediaFolderOnlyThis')}
                    </button>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={folderSettings.recursive}
                      onClick={() => updateFolderSettings({ recursive: true })}
                    >
                      {t('common.mediaFolderWithSubs')}
                    </button>
                  </div>
                  <button
                    type="button"
                    className="media-chip"
                    aria-pressed={folderSettings.includeImages}
                    onClick={() => updateFolderSettings({ includeImages: !folderSettings.includeImages })}
                  >
                    {folderSettings.includeImages ? <Check size={12} aria-hidden="true" /> : <ImageIcon size={12} aria-hidden="true" />}
                    {t('common.mediaFolderImages')}
                  </button>
                  <button
                    type="button"
                    className="media-chip"
                    aria-pressed={folderSettings.includeVideos}
                    onClick={() => updateFolderSettings({ includeVideos: !folderSettings.includeVideos })}
                  >
                    {folderSettings.includeVideos ? <Check size={12} aria-hidden="true" /> : <Video size={12} aria-hidden="true" />}
                    {t('common.mediaFolderVideos')}
                  </button>
                  <ControlTooltip descriptionKey={'common.mediaFolderRefresh'}>
                    <button
                      type="button"
                      className="media-icon"
                      onClick={() => void scanFolder(folderSettings, true)}
                      disabled={scanLoading}
                      title={scanLoading ? t('common.mediaFolderLoading') : t('common.mediaFolderRefresh')}
                      aria-label={scanLoading ? t('common.mediaFolderLoading') : t('common.mediaFolderRefresh')}
                    >
                      <RefreshCw size={14} className={cn(scanLoading && 'animate-spin')} aria-hidden="true" />
                    </button>
                  </ControlTooltip>
                  <button type="button" className="media-tool" onClick={chooseFolder} disabled={scanLoading}>
                    {t('common.mediaFolderChange')}
                  </button>
                  <ControlTooltip descriptionKey={'common.mediaFolderClear'}>
                    <button
                      type="button"
                      className="media-icon"
                      onClick={clearFolder}
                      title={t('common.mediaFolderClear')}
                      aria-label={t('common.mediaFolderClear')}
                    >
                      <X size={14} aria-hidden="true" />
                    </button>
                  </ControlTooltip>
                </div>
              </div>
            )}

            {folderNotice && (
              <div className="media-notice" role="status">
                <TriangleAlert size={14} aria-hidden="true" />
                {folderNotice}
              </div>
            )}

            {mediaItems.length > 0 &&
              (selected.size > 0 ? (
                <div className="media-selection ui-fade-enter" role="toolbar" aria-label={t('mediaPage.selectedCount', { count: selected.size })}>
                  <span className="media-selection-count" role="status" aria-live="polite">
                    {t('mediaPage.selectedCount', { count: selected.size })}
                  </span>
                  <button type="button" className="media-tool" onClick={selectAllVisible}>
                    <CheckCheck size={15} aria-hidden="true" />
                    {t('mediaPage.selectAll')}
                  </button>
                  <button type="button" className="media-tool media-danger" onClick={handleRemoveSelected}>
                    <Trash2 size={15} aria-hidden="true" />
                    {t('mediaPage.removeSelected')}
                  </button>
                  <button type="button" className="media-tool media-outline" onClick={handleAddSelectedToLoop} disabled={loopBusy > 0}>
                    <ListPlus size={15} aria-hidden="true" />
                    {t('mediaPage.addToLoop')}
                  </button>
                  <button type="button" className="media-primary" onClick={handleAddSelected}>
                    <Plus size={15} aria-hidden="true" />
                    {t('common.mediaAddSelected', { count: selected.size })}
                  </button>
                  <button
                    type="button"
                    className="media-icon"
                    onClick={clearSelection}
                    aria-label={t('common.mediaClearSelection')}
                    title={t('common.mediaClearSelection')}
                  >
                    <X size={15} aria-hidden="true" />
                  </button>
                </div>
              ) : (
                <div className="media-summary">
                  {toast ? (
                    <span className="media-toast ui-fade-enter">
                      <CircleCheck size={14} aria-hidden="true" />
                      {toast}
                    </span>
                  ) : (
                    <span>{t('mediaPage.hint')}</span>
                  )}
                  <span className="flex items-center gap-2">
                    <span role="status" aria-live="polite">
                      {t('mediaPage.resultCount', {
                        shown: visibleItems.length.toLocaleString(locale),
                        total: mediaItems.length.toLocaleString(locale),
                      })}
                    </span>
                    <button
                      type="button"
                      className="media-tool"
                      onClick={handleAddAllVisible}
                      disabled={visibleItems.length === 0}
                    >
                      <Plus size={14} aria-hidden="true" />
                      {t('common.mediaAddAll')}
                    </button>
                  </span>
                </div>
              ))}
          </>
        )}

        {activeSub === 'loop' && (
          <div className="loop-toolbar">
            <label htmlFor="loop-default-duration">{t('common.loopDefaultDuration')}</label>
            <DurationStepper
              id="loop-default-duration"
              valueSecs={defaultDuration}
              onChange={changeDefaultDuration}
              label={t('common.loopDefaultDuration')}
            />
            <button type="button" className="media-tool media-outline" onClick={applyDefaultToAll} disabled={loopItems.length === 0}>
              {t('mediaPage.applyToAll')}
            </button>
            <span className="flex-1" />
            {mediaItems.length > 0 && (
              <button type="button" className="media-tool" onClick={() => switchSub('media')}>
                <ImageIcon size={15} aria-hidden="true" />
                {t('mediaPage.loopFromLibrary')}
              </button>
            )}
          </div>
        )}
      </div>

      {activeSub === 'media' && (
        <div role="tabpanel" id="media-panel" aria-labelledby="media-tab" className="ui-fade-enter flex flex-col flex-1 min-h-0">
          {mediaItems.length === 0 ? (
            <div className="media-empty">
              <div className="media-empty-card">
                <div className="media-empty-icon">
                  <Upload size={24} aria-hidden="true" />
                </div>
                <h3>{t('mediaPage.emptyTitle')}</h3>
                <p>{t('mediaPage.emptyDesc')}</p>
                <div className="media-empty-actions">
                  <button type="button" className="media-tool media-outline" onClick={() => void importFiles('image')}>
                    <ImageIcon size={15} aria-hidden="true" />
                    {t('common.mediaSelectImages')}
                  </button>
                  <button type="button" className="media-tool media-outline" onClick={() => void importFiles('video')}>
                    <Video size={15} aria-hidden="true" />
                    {t('common.mediaSelectVideos')}
                  </button>
                  <button type="button" className="media-tool media-outline" onClick={() => void chooseFolder()}>
                    <FolderOpen size={15} aria-hidden="true" />
                    {t('common.mediaSelectFolder')}
                  </button>
                </div>
                <p className="media-empty-hint">{t('mediaPage.emptyDrop')}</p>
              </div>
            </div>
          ) : visibleItems.length === 0 ? (
            <div className="media-empty">
              <div className="media-empty-card">
                <div className="media-empty-icon">
                  <Search size={24} aria-hidden="true" />
                </div>
                <h3>{t('mediaPage.noResults')}</h3>
                <p>{t('mediaPage.noResultsDesc')}</p>
                {filtersActive && (
                  <div className="media-empty-actions">
                    <button type="button" className="media-tool media-outline" onClick={resetFilters}>
                      <X size={15} aria-hidden="true" />
                      {t('mediaPage.resetFilters')}
                    </button>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <VirtualizedMediaGrid items={visibleItems} density={view.density} resetKey={viewKey} renderItem={renderCard} />
          )}
        </div>
      )}

      {activeSub === 'loop' && (
        <div role="tabpanel" id="loop-panel" aria-labelledby="loop-tab" className="ui-fade-enter flex flex-col flex-1 min-h-0">
          {loopItems.length === 0 ? (
            <div className="media-empty">
              <div className="media-empty-card">
                <div className="media-empty-icon">
                  <Repeat size={24} aria-hidden="true" />
                </div>
                <h3>{t('mediaPage.loopEmptyTitle')}</h3>
                <p>{t('mediaPage.loopEmptyDesc')}</p>
                <div className="media-empty-actions">
                  <button type="button" className="media-primary" onClick={addLoopFiles} disabled={loopBusy > 0}>
                    <Plus size={15} aria-hidden="true" />
                    {loopBusy > 0 ? t('mediaPage.preparing') : t('mediaPage.loopAddFiles')}
                  </button>
                  {mediaItems.length > 0 && (
                    <button type="button" className="media-tool media-outline" onClick={() => switchSub('media')}>
                      <ImageIcon size={15} aria-hidden="true" />
                      {t('mediaPage.loopFromLibrary')}
                    </button>
                  )}
                </div>
                <p className="media-empty-hint">{t('mediaPage.emptyDrop')}</p>
              </div>
            </div>
          ) : (
            <>
              <div className="loop-list">
                {loopItems.map((item, index) => (
                  <LoopItemRow
                    key={item.id}
                    item={item}
                    index={index}
                    count={loopItems.length}
                    dropPosition={dropTarget?.index === index && dragIndex !== index ? dropTarget.position : null}
                    dragging={dragIndex === index}
                    onDragStart={setDragIndex}
                    onDragOverRow={handleLoopDragOver}
                    onDropRow={handleLoopDrop}
                    onDragEnd={handleLoopDragEnd}
                    onMove={moveLoopItem}
                    onRemove={removeLoopItem}
                    onDurationChange={updateLoopDuration}
                    onUseVideoDurationChange={updateLoopUseVideoDuration}
                  />
                ))}
                <button type="button" className="loop-add-more" onClick={addLoopFiles} disabled={loopBusy > 0}>
                  {loopBusy > 0 ? <RefreshCw size={13} className="animate-spin" aria-hidden="true" /> : <Plus size={13} aria-hidden="true" />}
                  {loopBusy > 0 ? t('mediaPage.preparing') : t('common.loopAddMedia')}
                </button>
              </div>
              <div className="loop-footer">
                <div className="loop-summary">
                  <div className="loop-summary-text">
                    <span>{t('common.loopItemCount', { count: loopItems.length })}</span>
                    <span aria-live="polite">
                      {t('common.loopTotal')} <strong>{formatLoopTime(totalMs)}</strong>
                    </span>
                  </div>
                  <div className="loop-timeline" role="img" aria-label={t('mediaPage.loopTimeline')}>
                    {loopItems.map((item) => (
                      <span
                        key={item.id}
                        data-kind={item.type}
                        data-full={(item.type === 'video' && item.useVideoDuration) || undefined}
                        style={{ flexGrow: Math.max(1, item.duration) }}
                        title={`${item.fileName ?? ''} · ${formatLoopTime(item.duration)}`}
                      />
                    ))}
                  </div>
                </div>
                <button type="button" className="media-primary" onClick={handleAddLoop}>
                  <Repeat size={15} aria-hidden="true" />
                  {t('mediaPage.loopAddToSlide')}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {dropActive && (
        <div className="media-drop ui-fade-enter" aria-hidden="true">
          <div>
            <Upload size={30} className="mx-auto text-blue-300" />
            <strong>{t('mediaPage.dropTitle')}</strong>
            <span>{activeSub === 'loop' ? t('mediaPage.dropLoop') : t('mediaPage.dropLibrary')}</span>
          </div>
        </div>
      )}
    </div>
  );
}
