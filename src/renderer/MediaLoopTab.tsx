import {
  useState, useCallback, useRef, useMemo, useEffect, memo,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import {
  Image as ImageIcon, Video, Trash2, Plus, Film, FolderOpen,
  ChevronDown, Repeat, Clock, GripVertical,
} from 'lucide-react';
import type { LoopItem, MediaItem, MediaKind } from './types';
import { LOOP_DEFAULT_DURATION } from './constants';
import { cn } from './utils';
import { useStore } from './state/useStore';

// ─── Types ────────────────────────────────────────────────────────────────────

interface MediaLoopTabProps {
  onAddMediaToPresentation: (type: MediaKind, path: string, thumbnailUrl?: string) => void;
  onAddLoopToPresentation: (items: LoopItem[], defaultDuration: number) => void;
}

interface ElectronAPI {
  selectMediaFiles?: (type: string) => Promise<string | string[] | null>;
  selectMediaFilesAll?: () => Promise<string | string[] | null>;
  selectMediaFile?: (type: string) => Promise<string | null>;
  selectMediaFolder?: () => Promise<string | null>;
  readMediaFolder?: (folder: string) => Promise<string[] | null>;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const IMAGE_EXTS = new Set(['jpg','jpeg','png','gif','webp','bmp','tif','tiff','avif','svg']);
const VIDEO_EXTS = new Set(['mp4','webm','mov','mkv','avi','m4v','wmv','flv','mpeg','mpg']);
const THUMBNAIL_TIMEOUT_MS = 8_000;
const MIN_DURATION_MS = 1_000;
const MAX_DURATION_MS = 300_000;

// ─── Helpers ──────────────────────────────────────────────────────────────────

const normalizePath = (p: string) => p.replace(/\\/g, '/');

const toFileUrl = (p: string) => {
  const n = normalizePath(p);
  return encodeURI(`${n.startsWith('/') ? 'file://' : 'file:///'}${n}`);
};

const getFileName = (p: string) => normalizePath(p).split('/').pop() ?? 'Untitled';
const getExtension = (p: string) => getFileName(p).split('.').pop()?.toLowerCase() ?? '';

const detectMediaType = (p: string): MediaKind | null => {
  const ext = getExtension(p);
  if (IMAGE_EXTS.has(ext)) return 'image';
  if (VIDEO_EXTS.has(ext)) return 'video';
  return null;
};

const isMediaFile = (p: string) => detectMediaType(p) !== null;
const makeId = () => globalThis.crypto?.randomUUID?.() ?? `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;

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

// ─── Video Thumbnail ──────────────────────────────────────────────────────────

function createVideoThumbnail(filePath: string, timeout = THUMBNAIL_TIMEOUT_MS): Promise<string | null> {
  return new Promise(resolve => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;
    video.crossOrigin = 'anonymous';
    video.src = toFileUrl(filePath);

    let settled = false;
    const done = (result: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      video.removeAttribute('src');
      video.load();
      resolve(result);
    };

    const timer = setTimeout(() => done(null), timeout);
    video.onloadedmetadata = () => { video.currentTime = Math.min(0.1, (video.duration || 2) * 0.05); };
    video.onseeked = () => {
      try {
        const c = document.createElement('canvas');
        c.width = video.videoWidth || 320;
        c.height = video.videoHeight || 180;
        const ctx = c.getContext('2d');
        if (!ctx) return done(null);
        ctx.drawImage(video, 0, 0, c.width, c.height);
        done(c.toDataURL('image/jpeg', 0.8));
      } catch { done(null); }
    };
    video.onerror = () => done(null);
  });
}

// ─── DurationInput ────────────────────────────────────────────────────────────

const DurationInput = memo(function DurationInput({
  valueSecs, onChange, 'aria-label': ariaLabel,
}: { valueSecs: number; onChange: (secs: number) => void; 'aria-label'?: string }) {
  const [local, setLocal] = useState(String(valueSecs));
  const isFocused = useRef(false);

  useEffect(() => { if (!isFocused.current) setLocal(String(valueSecs)); }, [valueSecs]);

  const commit = useCallback(() => {
    const parsed = parseDurationSecs(local);
    setLocal(String(parsed));
    onChange(parsed);
  }, [local, onChange]);

  return (
    <div className="flex items-center gap-1 shrink-0">
      <input
        type="number" min={1} max={300} value={local}
        onChange={(e) => setLocal(e.target.value)}
        onFocus={() => { isFocused.current = true; }}
        onBlur={() => { isFocused.current = false; commit(); }}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        onClick={(e) => e.stopPropagation()}
        aria-label={ariaLabel}
        className="w-12 bg-zinc-900 border border-zinc-700 rounded px-1 py-0.5 text-[11px] text-white text-center font-mono focus:outline-none focus:border-amber-500/70 transition-colors"
      />
      <span className="text-[10px] text-zinc-500 select-none">s</span>
    </div>
  );
});

// ─── Loop Item Row ────────────────────────────────────────────────────────────

const LoopItemRow = memo(function LoopItemRow({
  item, index, isDragOver,
  onDragStart, onDragEnter, onDragEnd, onRemove, onDurationChange,
}: {
  item: LoopItem; index: number; isDragOver: boolean;
  onDragStart: (i: number) => void; onDragEnter: (i: number) => void; onDragEnd: () => void;
  onRemove: (id: string) => void; onDurationChange: (id: string, ms: number) => void;
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
        isDragOver && 'ring-1 ring-amber-500/50 bg-zinc-800 scale-[1.01]',
      )}
    >
      <div className="text-zinc-600 hover:text-zinc-400 cursor-grab active:cursor-grabbing shrink-0" title={t('common.loopDragToReorder')}>
        <GripVertical className="w-3.5 h-3.5" />
      </div>
      <span className="text-[10px] font-mono text-zinc-600 w-5 shrink-0">{String(index + 1).padStart(2, '0')}</span>

      {/* Thumbnail */}
      <div className="relative w-10 h-10 rounded-md overflow-hidden bg-zinc-900 shrink-0 ring-1 ring-white/5">
        {item.type === 'video' ? (
          <>
            <video src={item.mediaUrl} className="w-full h-full object-cover" muted preload="metadata" />
            <div className="absolute inset-0 flex items-center justify-center bg-black/50"><Film className="w-3.5 h-3.5 text-amber-400" /></div>
          </>
        ) : imgErr ? (
          <div className="w-full h-full flex items-center justify-center bg-zinc-800"><ImageIcon className="w-4 h-4 text-zinc-600" /></div>
        ) : (
          <img src={item.mediaUrl} className="w-full h-full object-cover" alt="" onError={() => setImgErr(true)} />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="text-xs text-zinc-200 truncate font-medium leading-tight" title={item.fileName}>{item.fileName}</div>
        <div className="flex items-center gap-1 text-[10px] text-zinc-500 mt-0.5">
          {item.type === 'video' ? <><Film className="w-2.5 h-2.5" />{t('common.loopVideo')}</> : <><ImageIcon className="w-2.5 h-2.5" />{t('common.loopImage')}</>}
        </div>
      </div>

      <DurationInput valueSecs={Math.round(item.duration / 1000)} onChange={handleDur} aria-label={t('common.loopDuration')} />

      <button onClick={() => onRemove(item.id)} className="text-zinc-600 hover:text-red-400 opacity-60 hover:opacity-100 focus-visible:opacity-100 transition-all shrink-0" title={t('common.loopRemove')} aria-label={t('common.loopRemove')}>
        <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
      </button>
    </div>
  );
});

// ─── Media Card ───────────────────────────────────────────────────────────────

const MediaCard = memo(function MediaCard({
  item, hovered, onHover, onAdd, onRemove,
}: {
  item: MediaItem; hovered: boolean;
  onHover: (id: string | null) => void; onAdd: (item: MediaItem) => void; onRemove: (id: string) => void;
}) {
  const { t } = useTranslation();
  const isImage = item.type === 'image';
  const ext = getExtension(item.path).toUpperCase();
  const previewSrc = item.preview ?? (isImage ? toFileUrl(item.path) : undefined);
  const accentBorder = isImage ? 'rgba(200,146,10,0.55)' : 'rgba(124,92,191,0.55)';
  const accentBg = isImage ? 'rgba(184,134,11,0.07)' : 'rgba(106,79,200,0.07)';
  const pillBg = isImage ? 'rgba(184,134,11,0.85)' : 'rgba(106,79,200,0.85)';

  return (
    <div
      onMouseEnter={() => onHover(item.id)} onMouseLeave={() => onHover(null)}
      className="rounded-lg border overflow-hidden transition-all duration-200"
      style={{
        borderColor: hovered ? accentBorder : 'rgba(255,255,255,0.08)',
        background: hovered ? accentBg : 'rgba(255,255,255,0.03)',
      }}
    >
      <div className="relative h-[180px] bg-black overflow-hidden">
        {previewSrc ? (
          <img src={previewSrc} alt={item.name} className="w-full h-full object-cover transition-opacity duration-200" style={{ opacity: hovered ? 1 : 0.72 }} />
        ) : (
          <div className="w-full h-full flex items-center justify-center" style={{ background: hovered ? '#160d2a' : '#0f0a1a' }}>
            <Video size={18} className="transition-colors" style={{ color: hovered ? 'rgba(156,120,230,0.7)' : 'rgba(255,255,255,0.18)' }} />
          </div>
        )}
        <span className="absolute top-1 left-1 text-[7px] font-bold font-mono tracking-wider text-white px-1.5 py-0.5 rounded" style={{ background: pillBg }}>
          {ext || (isImage ? 'IMG' : 'VID')}
        </span>
      </div>

      <div className="flex items-center gap-1 px-2 py-1.5 bg-black/30">
        <span className="text-[10px] text-white/45 font-semibold flex-1 min-w-0 truncate" title={item.name}>{item.name}</span>
        <button
          onClick={(e) => { e.stopPropagation(); onAdd(item); }}
          className="w-7 h-7 flex items-center justify-center rounded border border-white/[0.13] bg-white/[0.06] text-white/55 hover:bg-amber-500 hover:text-white hover:border-transparent transition-all hover:scale-110"
          title={t('common.mediaAddToSlide')}
          aria-label={t('common.mediaAddToSlide')}
        >
          <Plus size={11} aria-hidden="true" />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onRemove(item.id); }}
          className="w-7 h-7 flex items-center justify-center rounded border border-white/[0.13] bg-white/[0.06] text-white/55 hover:bg-red-600 hover:text-white hover:border-transparent transition-all hover:scale-110"
          title={t('common.mediaRemove')}
          aria-label={t('common.mediaRemove')}
        >
          <Trash2 size={11} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
});

// ─── Drop Item ────────────────────────────────────────────────────────────────

const DropItem = memo(function DropItem({ icon, title, desc, onClick }: {
  icon: ReactNode; title: string; desc: string; onClick: () => void;
}) {
  return (
    <button
      type="button" onClick={onClick}
      className="w-full flex items-center gap-2.5 p-2.5 rounded-lg hover:bg-white/[0.06] transition-colors text-left outline-none"
    >
      <div className="w-7 h-7 rounded-lg flex items-center justify-center bg-white/[0.06] text-white/85 shrink-0">{icon}</div>
      <div>
        <div className="text-xs font-semibold text-white/90">{title}</div>
        <div className="text-[10px] text-white/40 leading-snug">{desc}</div>
      </div>
    </button>
  );
});

// ─── Main Component ───────────────────────────────────────────────────────────

export default function MediaLoopTab({ onAddMediaToPresentation, onAddLoopToPresentation }: MediaLoopTabProps) {
  const { t } = useTranslation();
  const [activeSub, setActiveSub] = useState<'media' | 'loop'>('media');

  // ── Media state (persisted in global store) ──
  const mediaItems = useStore(s => s.mediaItems);
  const setMediaItems = useStore(s => s.setMediaItems);
  const loopItems = useStore(s => s.loopItems);
  const setLoopItems = useStore(s => s.setLoopItems);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // ── Loop state ──
  const [defaultDuration, setDefaultDuration] = useState(LOOP_DEFAULT_DURATION / 1000);
  const [isLoading, setIsLoading] = useState(false);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const dragItemIndex = useRef<number | null>(null);

  const totalMs = useMemo(() => loopItems.reduce((acc, i) => acc + i.duration, 0), [loopItems]);

  // Click-outside to close dropdown
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // ── Media actions ──
  const addMediaPaths = useCallback(async (paths: string[]) => {
    const incoming = paths.filter(p => p && isMediaFile(p)).map(p => {
      const type = detectMediaType(p)!;
      return { id: makeId(), type, path: p, name: getFileName(p), preview: type === 'image' ? toFileUrl(p) : undefined } satisfies MediaItem;
    });
    if (!incoming.length) return;

    setMediaItems(prev => {
      const seen = new Set(prev.map(i => normalizePath(i.path)));
      const unique = incoming.filter(i => { const k = normalizePath(i.path); if (seen.has(k)) return false; seen.add(k); return true; });
      return [...prev, ...unique];
    });

    for (const item of incoming) {
      if (item.type !== 'video') continue;
      const preview = await createVideoThumbnail(item.path);
      if (preview) setMediaItems(prev => prev.map(m => (m.id === item.id ? { ...m, preview } : m)));
    }
  }, []);

  const importFiles = useCallback(async (type: MediaKind) => {
    const api = window.electronAPI as ElectronAPI | undefined;
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
  }, [addMediaPaths]);

  const importFolder = useCallback(async () => {
    const api = window.electronAPI as ElectronAPI | undefined;
    if (!api?.selectMediaFolder || !api.readMediaFolder) return;
    const folder = await api.selectMediaFolder();
    if (!folder) return;
    const paths = await api.readMediaFolder(folder);
    if (paths?.length) await addMediaPaths(paths);
  }, [addMediaPaths]);

  const removeMediaItem = useCallback((id: string) => setMediaItems(prev => prev.filter(i => i.id !== id)), []);

  const addMediaToPres = useCallback((item: MediaItem) => {
    onAddMediaToPresentation(item.type, item.path, item.preview);
  }, [onAddMediaToPresentation]);

  // ── Loop actions ──
  const addLoopFiles = useCallback(async () => {
    const api = (window as any).electronAPI as ElectronAPI | undefined;
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
      setLoopItems(prev => [...prev, ...newItems]);
    } finally { setIsLoading(false); }
  }, [defaultDuration]);

  const removeLoopItem = useCallback((id: string) => setLoopItems(prev => prev.filter(i => i.id !== id)), []);
  const clearLoop = useCallback(() => setLoopItems([]), []);

  const updateLoopDuration = useCallback((id: string, ms: number) => {
    const clamped = Math.max(MIN_DURATION_MS, Math.min(MAX_DURATION_MS, ms));
    setLoopItems(prev => prev.map(i => i.id === id ? { ...i, duration: clamped } : i));
  }, []);

  const handleDragStart = useCallback((index: number) => { dragItemIndex.current = index; }, []);
  const handleDragEnter = useCallback((index: number) => setDragOverIndex(index), []);
  const handleDragEnd = useCallback(() => {
    const from = dragItemIndex.current;
    const to = dragOverIndex;
    if (from !== null && to !== null && from !== to) {
      setLoopItems(prev => { const next = [...prev]; const [moved] = next.splice(from, 1); next.splice(to, 0, moved); return next; });
    }
    dragItemIndex.current = null;
    setDragOverIndex(null);
  }, [dragOverIndex]);

  const handleAddLoop = useCallback(() => {
    if (loopItems.length === 0) return;
    onAddLoopToPresentation(loopItems, defaultDuration * 1000);
    setLoopItems([]);
  }, [loopItems, defaultDuration, onAddLoopToPresentation]);

  const handleDefaultDuration = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setDefaultDuration(parseDurationSecs(e.target.value));
  }, []);

  // ── Render ──
  return (
    <div className="flex flex-col h-full bg-[#181818] text-white overflow-hidden">

      {/* ── Sub-Tab Switcher ──────────────────────────────────────────────── */}
      <div className="shrink-0 px-3 pt-3 pb-2 border-b border-white/[0.07]">
        <div role="tablist" aria-label={t('common.mediaTabs')} className="flex items-center gap-1.5 p-1 rounded-xl bg-white/[0.03] border border-white/[0.06]">
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
                : 'text-zinc-500 hover:text-zinc-300 hover:bg-white/[0.04]',
            )}
          >
            <ImageIcon className="w-3.5 h-3.5" />
            {t('common.mediaLibrary')}
            {mediaItems.length > 0 && (
              <span className={cn(
                'text-[9px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center',
                activeSub === 'media' ? 'bg-white/20 text-white' : 'bg-amber-500/15 text-amber-400 border border-amber-500/30',
              )}>{mediaItems.length}</span>
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
                : 'text-zinc-500 hover:text-zinc-300 hover:bg-white/[0.04]',
            )}
          >
            <Repeat className="w-3.5 h-3.5" />
            {t('common.loopTitle')}
            {loopItems.length > 0 && (
              <span className={cn(
                'text-[9px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center',
                activeSub === 'loop' ? 'bg-white/20 text-white' : 'bg-amber-500/15 text-amber-400 border border-amber-500/30',
              )}>{loopItems.length}</span>
            )}
          </button>
        </div>
      </div>

      {/* ── Media Library Tab ─────────────────────────────────────────────── */}
      {activeSub === 'media' && (
        <div role="tabpanel" id="media-panel" aria-labelledby="media-tab">
          {/* Media toolbar */}
          <div className="shrink-0 px-3 py-2.5 flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <Film className="w-3 h-3 text-amber-500" />
              <span className="text-[10px] font-bold uppercase tracking-widest text-white/45">{t('common.mediaLibrary')}</span>
            </div>
            <div ref={menuRef} className="relative">
              <button
                onClick={() => setMenuOpen(v => !v)}
                className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-white/[0.12] bg-white/[0.04] hover:bg-white/[0.08] text-[11px] font-bold uppercase tracking-wider transition-all"
              >
                <Plus size={13} /> {t('common.mediaAdd')} <ChevronDown size={12} className="opacity-60" />
              </button>
              {menuOpen && (
                <div className="absolute right-0 top-[calc(100%+6px)] w-[280px] z-20 p-1.5 rounded-xl border border-white/10 bg-[#141414]/[0.98] shadow-2xl shadow-black/50 backdrop-blur-xl">
                  <DropItem icon={<ImageIcon size={14} />} title={t('common.mediaSelectImages')} desc={t('common.mediaSelectImagesDesc')} onClick={() => { setMenuOpen(false); importFiles('image'); }} />
                  <DropItem icon={<Video size={14} />} title={t('common.mediaSelectVideos')} desc={t('common.mediaSelectVideosDesc')} onClick={() => { setMenuOpen(false); importFiles('video'); }} />
                  <DropItem icon={<FolderOpen size={14} />} title={t('common.mediaSelectFolder')} desc={t('common.mediaSelectFolderDesc')} onClick={() => { setMenuOpen(false); importFolder(); }} />
                </div>
              )}
            </div>
          </div>

          {/* Media content */}
          <div className="flex-1 overflow-y-auto px-3 pb-4">
            {mediaItems.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-6">
                <div className="relative w-16 h-16 flex items-center justify-center mb-4">
                  <Film size={28} className="text-white/10" />
                  <div className="absolute inset-0 rounded-full border border-white/[0.05]" />
                </div>
                <p className="text-sm font-bold text-white/75">{t('common.mediaEmpty')}</p>
                <p className="text-[11px] text-white/35 mt-1.5 leading-relaxed">{t('common.mediaEmptyDesc')}</p>
              </div>
            ) : (
              <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))' }}>
                {mediaItems.map(item => (
                  <MediaCard key={item.id} item={item} hovered={hoveredId === item.id} onHover={setHoveredId} onAdd={addMediaToPres} onRemove={removeMediaItem} />
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Loop Slide Tab ────────────────────────────────────────────────── */}
      {activeSub === 'loop' && (
        <div role="tabpanel" id="loop-panel" aria-labelledby="loop-tab">
          {/* Loop toolbar */}
          <div className="shrink-0 px-3 pt-2.5 pb-2 space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Repeat className="w-3 h-3 text-amber-400" />
                <span className="text-[10px] font-bold uppercase tracking-widest text-white/45">{t('common.loopTitle')}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={addLoopFiles} disabled={isLoading} title={t('common.loopAddMedia')}
                  className="flex items-center justify-center w-7 h-7 rounded border bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border-emerald-500/20 disabled:opacity-40 transition-colors"
                >
                  {isLoading ? <span className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                </button>
                <button
                  onClick={clearLoop} disabled={loopItems.length === 0} title={t('common.loopClearAll')}
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
                <input type="number" min={1} max={300} value={defaultDuration} onChange={handleDefaultDuration}
                  className="w-14 bg-zinc-900 border border-zinc-700 rounded px-2 py-0.5 text-xs text-white text-center font-mono focus:outline-none focus:border-amber-500/70 transition-colors" />
                <span className="text-[10px] text-zinc-500 select-none">s</span>
              </div>
            </div>
          </div>

          {/* Loop item list */}
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {loopItems.length === 0 ? (
              <button onClick={addLoopFiles}
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
                    key={item.id} item={item} index={index} isDragOver={dragOverIndex === index}
                    onDragStart={handleDragStart} onDragEnter={handleDragEnter} onDragEnd={handleDragEnd}
                    onRemove={removeLoopItem} onDurationChange={updateLoopDuration}
                  />
                ))}
                <button onClick={addLoopFiles}
                  className="w-full py-2 mt-1 flex items-center justify-center gap-1.5 border border-dashed border-zinc-700 rounded-lg text-[11px] text-zinc-500 hover:text-zinc-300 hover:border-zinc-500 transition-colors"
                >
                  <Plus className="w-3 h-3" /> {t('common.loopAddMedia')}
                </button>
              </>
            )}
          </div>

          {/* Loop footer */}
          {loopItems.length > 0 && (
            <div className="shrink-0 px-3 py-3 border-t border-white/[0.07] space-y-2">
              <div className="flex items-center justify-between text-[10px] text-zinc-500">
                <span>{t('common.loopItemCount', { count: loopItems.length })}</span>
                <span className="flex items-center gap-1" aria-live="polite">
                  <Clock className="w-2.5 h-2.5" />
                  {t('common.loopTotal')} <strong className="text-zinc-400">{formatTotalTime(totalMs)}</strong>
                </span>
              </div>
              <button onClick={handleAddLoop}
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
