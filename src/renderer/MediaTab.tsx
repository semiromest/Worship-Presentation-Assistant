import {
  useEffect,
  useRef,
  useState,
  useCallback,
  memo,
  type ReactNode,
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
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────
type MediaKind = 'image' | 'video';

interface MediaItem {
  id: string;
  type: MediaKind;
  path: string;
  name: string;
  preview?: string;
}

interface MediaTabProps {
  onAddMediaToPresentation: (
    type: MediaKind,
    path: string,
    thumbnailUrl?: string,
  ) => void;
}

// ─── Constants ────────────────────────────────────────────
const IMAGE_EXTS = new Set([
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp',
  'tif', 'tiff', 'avif', 'svg',
]);

const VIDEO_EXTS = new Set([
  'mp4', 'webm', 'mov', 'mkv', 'avi',
  'm4v', 'wmv', 'flv', 'mpeg', 'mpg',
]);

const THUMBNAIL_TIMEOUT_MS = 8_000;

// ─── Helpers ──────────────────────────────────────────────
const normalizePath = (p: string) => p.replace(/\\/g, '/');

const toFileUrl = (p: string) => {
  const n = normalizePath(p);
  const prefix = n.startsWith('/') ? 'file://' : 'file:///';
  return encodeURI(`${prefix}${n}`);
};

const getFileName = (p: string) =>
  normalizePath(p).split('/').pop() ?? 'Untitled';

const getExtension = (p: string) =>
  getFileName(p).split('.').pop()?.toLowerCase() ?? '';

const detectMediaType = (p: string): MediaKind | null => {
  const ext = getExtension(p);
  if (IMAGE_EXTS.has(ext)) return 'image';
  if (VIDEO_EXTS.has(ext)) return 'video';
  return null;
};

const isMediaFile = (p: string) => detectMediaType(p) !== null;

const makeId = () =>
  globalThis.crypto?.randomUUID?.() ??
  `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;

// ─── Video thumbnail ──────────────────────────────────────
function createVideoThumbnail(
  filePath: string,
  timeout = THUMBNAIL_TIMEOUT_MS,
): Promise<string | null> {
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

    video.onloadedmetadata = () => {
      video.currentTime = Math.min(0.1, (video.duration || 2) * 0.05);
    };

    video.onseeked = () => {
      try {
        const c = document.createElement('canvas');
        c.width = video.videoWidth || 320;
        c.height = video.videoHeight || 180;
        const ctx = c.getContext('2d');
        if (!ctx) return done(null);
        ctx.drawImage(video, 0, 0, c.width, c.height);
        done(c.toDataURL('image/jpeg', 0.8));
      } catch {
        done(null);
      }
    };

    video.onerror = () => done(null);
  });
}

// ─── Main Component ───────────────────────────────────────
export default function MediaTab({ onAddMediaToPresentation }: MediaTabProps) {
  const { t } = useTranslation();
  const [items, setItems] = useState<MediaItem[]>([]);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Click-outside to close dropdown
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node))
        setMenuOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Add file paths to library (dedup by normalized path)
  const addPaths = useCallback(async (paths: string[]) => {
    const incoming = paths
      .filter(p => p && isMediaFile(p))
      .map(p => {
        const type = detectMediaType(p)!;
        return {
          id: makeId(),
          type,
          path: p,
          name: getFileName(p),
          preview: type === 'image' ? toFileUrl(p) : undefined,
        } satisfies MediaItem;
      });

    if (!incoming.length) return;

    setItems(prev => {
      const seen = new Set(prev.map(i => normalizePath(i.path)));
      const unique = incoming.filter(i => {
        const key = normalizePath(i.path);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      return [...prev, ...unique];
    });

    // Async video thumbnails
    for (const item of incoming) {
      if (item.type !== 'video') continue;
      const preview = await createVideoThumbnail(item.path);
      if (preview)
        setItems(prev =>
          prev.map(m => (m.id === item.id ? { ...m, preview } : m)),
        );
    }
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
    [addPaths],
  );

  const importFolder = useCallback(async () => {
    const api = window.electronAPI;
    if (!api?.selectMediaFolder || !api.readMediaFolder) return;
    const folder = await api.selectMediaFolder();
    if (!folder) return;
    const paths = await api.readMediaFolder(folder);
    if (paths?.length) await addPaths(paths);
  }, [addPaths]);

  const removeItem = useCallback((id: string) => {
    setItems(prev => prev.filter(i => i.id !== id));
  }, []);

  const addItemToPresentation = useCallback(
    (item: MediaItem) => {
      onAddMediaToPresentation(item.type, item.path, item.preview);
    },
    [onAddMediaToPresentation],
  );

  return (
    <div style={s.root}>
      {/* Header */}
      <div style={s.header}>
        <div style={s.headerLabel}>
          <Film size={12} style={{ color: '#9c7c38', flexShrink: 0 }} />
          <span style={s.headerText}>{t('common.mediaLibrary')}</span>
          {items.length > 0 && (
            <span style={s.countBadge}>{items.length}</span>
          )}
        </div>

        {/* Dropdown */}
        <div ref={menuRef} style={s.dropdownWrap}>
          <button
            type="button"
            onClick={() => setMenuOpen(v => !v)}
            style={s.dropdownBtn}
          >
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
                onClick={() => { setMenuOpen(false); importFiles('image'); }}
              />
              <DropItem
                icon={<Video size={14} />}
                title={t('common.mediaSelectVideos')}
                desc={t('common.mediaSelectVideosDesc')}
                onClick={() => { setMenuOpen(false); importFiles('video'); }}
              />
              <DropItem
                icon={<FolderOpen size={14} />}
                title={t('common.mediaSelectFolder')}
                desc={t('common.mediaSelectFolderDesc')}
                onClick={() => { setMenuOpen(false); importFolder(); }}
              />
            </div>
          )}
        </div>
      </div>

      <div style={s.divider} />

      {/* Content */}
      <div style={s.content}>
        {items.length === 0 ? (
          <EmptyState />
        ) : (
          <div style={s.grid}>
            {items.map(item => (
              <MediaCard
                key={item.id}
                item={item}
                hovered={hoveredId === item.id}
                onHover={setHoveredId}
                onAdd={addItemToPresentation}
                onRemove={removeItem}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

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
  const [hov, setHov] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        ...s.dropItem,
        background: hov ? 'rgba(255,255,255,0.06)' : 'transparent',
      }}
    >
      <div style={s.dropItemIcon}>{icon}</div>
      <div>
        <div style={s.dropItemTitle}>{title}</div>
        <div style={s.dropItemDesc}>{desc}</div>
      </div>
    </button>
  );
});

// ─── Media Card ───────────────────────────────────────────
const MediaCard = memo(function MediaCard({
  item,
  hovered,
  onHover,
  onAdd,
  onRemove,
}: {
  item: MediaItem;
  hovered: boolean;
  onHover: (id: string | null) => void;
  onAdd: (item: MediaItem) => void;
  onRemove: (id: string) => void;
}) {
  const { t } = useTranslation();
  const isImage = item.type === 'image';
  const ext = getExtension(item.path).toUpperCase();
  const previewSrc =
    item.preview ?? (isImage ? toFileUrl(item.path) : undefined);

  const accentColor = isImage
    ? 'rgba(200,146,10,0.55)'
    : 'rgba(124,92,191,0.55)';
  const accentBg = isImage
    ? 'rgba(184,134,11,0.07)'
    : 'rgba(106,79,200,0.07)';

  return (
    <div
      onMouseEnter={() => onHover(item.id)}
      onMouseLeave={() => onHover(null)}
      style={{
        ...s.card,
        borderColor: hovered ? accentColor : 'rgba(255,255,255,0.08)',
        background: hovered ? accentBg : 'rgba(255,255,255,0.03)',
      }}
    >
      {/* Thumbnail area */}
      <div style={s.thumb}>
        {previewSrc ? (
          <img
            src={previewSrc}
            alt={item.name}
            style={{ ...s.thumbImg, opacity: hovered ? 1 : 0.72 }}
          />
        ) : (
          <div
            style={{
              ...s.videoFallback,
              background: hovered ? '#160d2a' : '#0f0a1a',
            }}
          >
            <Video
              size={16}
              style={{ color: hovered ? 'rgba(156,120,230,0.7)' : 'rgba(255,255,255,0.18)' }}
            />
          </div>
        )}
        <span
          style={{
            ...s.typePill,
            background: isImage
              ? 'rgba(184,134,11,0.85)'
              : 'rgba(106,79,200,0.85)',
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
          <FootBtn
            title={t('common.mediaAddToSlide')}
            hoverBg="rgba(200,146,10,0.85)"
            onClick={() => onAdd(item)}
          >
            <Plus size={11} />
          </FootBtn>
          <FootBtn
            title={t('common.mediaRemove')}
            hoverBg="rgba(180,40,40,0.85)"
            onClick={() => onRemove(item.id)}
          >
            <Trash2 size={11} />
          </FootBtn>
        </div>
      </div>
    </div>
  );
});

// ─── Footer Button ────────────────────────────────────────
const FootBtn = memo(function FootBtn({
  children,
  title,
  hoverBg,
  onClick,
}: {
  children: ReactNode;
  title: string;
  hoverBg: string;
  onClick: () => void;
}) {
  const [hov, setHov] = useState(false);
  return (
    <button
      type="button"
      title={title}
      onClick={e => { e.stopPropagation(); onClick(); }}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        ...s.footBtn,
        borderColor: hov ? 'transparent' : 'rgba(255,255,255,0.13)',
        background: hov ? hoverBg : 'rgba(255,255,255,0.06)',
        color: hov ? '#fff' : 'rgba(255,255,255,0.55)',
        transform: hov ? 'scale(1.1)' : 'scale(1)',
      }}
    >
      {children}
    </button>
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

// ─── Styles ───────────────────────────────────────────────
const s: Record<string, React.CSSProperties> = {
  root: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    background: '#181818',
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
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
    transition: 'background 0.15s ease',
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
    gridTemplateColumns: 'repeat(auto-fill, minmax(375px, 1fr))',
    gap: 7,
  },

  // Media card
  card: {
    borderRadius: 6,
    border: '1px solid',
    overflow: 'hidden',
    cursor: 'default',
    transition: 'border-color 0.18s ease, background 0.18s ease',
  },
  thumb: {
    position: 'relative',
    height: 215,
    background: '#0d0d0d',
    overflow: 'hidden',
  },
  thumbImg: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    transition: 'opacity 0.2s ease',
    display: 'block',
  },
  videoFallback: {
    width: '100%',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'background 0.18s',
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
    transition: 'all 0.13s ease',
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
