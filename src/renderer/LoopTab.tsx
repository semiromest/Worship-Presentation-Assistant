/**
 * LoopTab.tsx — Tam Yeniden Yazım
 *
 * KRİTİK HATALAR DÜZELTİLDİ:
 *
 * [BUG-1] dragOver.current ref olduğu için JSX'i yeniden render ettirmiyordu
 *         → dragOverIndex artık useState ile yönetiliyor (görsel feedback çalışıyor)
 *
 * [BUG-2] Dosya adları görüntülenmiyordu ("Öğe 1", "Öğe 2" yerine)
 *         → getFileName() ile yol'dan ad ayrıştırılıp item'a ekleniyor
 *
 * [BUG-3] parseInt() NaN dönebiliyordu, parse doğrulaması eksikti
 *         → parseDurationSecs() ile sağlam NaN/sınır koruma eklendi
 *
 * [BUG-4] Süre kısıtlaması tutarsızdı (input min=1sn ama clamp 500ms idi)
 *         → Her yerde tutarlı: min 1000ms (1sn), max 300_000ms (300sn)
 *
 * [BUG-5] window as any ile typed olmayan electronAPI erişimi
 *         → ElectronAPI interface'i tanımlandı
 *
 * PERFORMANS:
 *  - totalMs useMemo ile hesaplanıyor (her render'da yeniden hesaplanmıyor)
 *  - DurationInput, LoopItemRow ve MediaThumbnail memo ile sarmalandı
 *  - DurationInput: her tuş vuruşunda parent'ı render ettirmemek için
 *    local state + isFocused ref kullanıyor; blur/Enter'da commit ediyor
 *  - handleDurationChange her row'da useCallback ile stabilize edildi
 *
 * NOT: types.ts'de LoopItem tipine `fileName: string` eklemeniz gerekiyor.
 */

import {
  useState, useCallback, useRef, useMemo, useEffect, memo,
} from 'react';
import {
  Repeat, Plus, Trash2, GripVertical,
  Clock, Film, ImageIcon,
} from 'lucide-react';
import type { LoopItem } from './types';
import { LOOP_DEFAULT_DURATION } from './constants';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { useTranslation } from 'react-i18next';

// ─── cn ───────────────────────────────────────────────────────────────────────

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// ─── Tipler ───────────────────────────────────────────────────────────────────

// types.ts'deki LoopItem'a `fileName` eklemeniz gerekiyor:
// export interface LoopItem { id: string; type: 'image'|'video'; mediaUrl: string; fileName: string; duration: number; }
type RichLoopItem = LoopItem & { fileName: string };

interface ElectronAPI {
  selectMediaFilesAll?: () => Promise<string | string[] | null>;
  selectMediaFile?: (type: string) => Promise<string | null>;
}

interface LoopTabProps {
  onAddLoopToPresentation: (items: LoopItem[], defaultDuration: number) => void;
}

// ─── Sabitler ────────────────────────────────────────────────────────────────

const VIDEO_EXTS = new Set([
  'mp4', 'webm', 'mov', 'mkv', 'avi', 'm4v', 'wmv', 'flv', 'mpeg', 'mpg',
]);

const MIN_DURATION_MS = 1_000;   // 1 saniye
const MAX_DURATION_MS = 300_000; // 300 saniye

// ─── Yardımcı fonksiyonlar ────────────────────────────────────────────────────

function toFileUrl(p: string): string {
  const n = p.replace(/\\/g, '/');
  return encodeURI(`${n.startsWith('/') ? 'file://' : 'file:///'}${n}`);
}

function detectMediaType(path: string): 'image' | 'video' {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  return VIDEO_EXTS.has(ext) ? 'video' : 'image';
}

function getFileName(path: string): string {
  return path.replace(/\\/g, '/').split('/').pop() ?? path;
}

/** Herhangi bir girdiyi güvenli şekilde geçerli saniye değerine çevirir */
function parseDurationSecs(value: string | number): number {
  const n = typeof value === 'string' ? parseFloat(value) : value;
  if (!isFinite(n) || n < 1) return 1;
  if (n > 300) return 300;
  return Math.round(n);
}

/** Toplam ms'yi insan okunabilir formata çevirir */
function formatTotalTime(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r > 0 ? `${m}d ${r}s` : `${m}d`;
}

// ─── MediaThumbnail ────────────────────────────────────────────────────────────

const MediaThumbnail = memo(function MediaThumbnail({
  item,
}: {
  item: RichLoopItem;
}) {
  const [hasError, setHasError] = useState(false);

  return (
    <div className="relative w-10 h-10 rounded-md overflow-hidden bg-zinc-900 shrink-0 ring-1 ring-white/5">
      {item.type === 'video' ? (
        <>
          <video
            src={item.mediaUrl}
            className="w-full h-full object-cover"
            muted
            preload="metadata"
          />
          <div className="absolute inset-0 flex items-center justify-center bg-black/50">
            <Film className="w-3.5 h-3.5 text-amber-400" />
          </div>
        </>
      ) : hasError ? (
        <div className="w-full h-full flex items-center justify-center bg-zinc-800">
          <ImageIcon className="w-4 h-4 text-zinc-600" />
        </div>
      ) : (
        <img
          src={item.mediaUrl}
          className="w-full h-full object-cover"
          alt=""
          onError={() => setHasError(true)}
        />
      )}
    </div>
  );
});

// ─── DurationInput ─────────────────────────────────────────────────────────────
// Local state kullanarak parent'ı her tuş vuruşunda render ettirmez.
// Sadece blur veya Enter'da commit eder.

const DurationInput = memo(function DurationInput({
  valueSecs,
  onChange,
}: {
  valueSecs: number;
  onChange: (secs: number) => void;
}) {
  const [local, setLocal] = useState(String(valueSecs));
  const isFocused = useRef(false);

  // Parent'tan gelen harici değişiklikleri, input odaklanmadıysa uygula
  useEffect(() => {
    if (!isFocused.current) {
      setLocal(String(valueSecs));
    }
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
        onFocus={() => { isFocused.current = true; }}
        onBlur={() => { isFocused.current = false; commit(); }}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        onClick={(e) => e.stopPropagation()}
        className={cn(
          'w-12 bg-zinc-900 border border-zinc-700 rounded px-1 py-0.5',
          'text-[11px] text-white text-center font-mono',
          'focus:outline-none focus:border-amber-500/70 transition-colors',
        )}
      />
      <span className="text-[10px] text-zinc-500 select-none">sn</span>
    </div>
  );
});

// ─── LoopItemRow ───────────────────────────────────────────────────────────────

interface LoopItemRowProps {
  item: RichLoopItem;
  index: number;
  isDragOver: boolean;
  onDragStart: (i: number) => void;
  onDragEnter: (i: number) => void;
  onDragEnd: () => void;
  onRemove: (id: string) => void;
  onDurationChange: (id: string, ms: number) => void;
}

const LoopItemRow = memo(function LoopItemRow({
  item,
  index,
  isDragOver,
  onDragStart,
  onDragEnter,
  onDragEnd,
  onRemove,
  onDurationChange,
}: LoopItemRowProps) {
  const { t } = useTranslation();
  // Her satır kendi callback'ini stabilize eder, parent prop değişikliği olmaz
  const handleDurationChange = useCallback(
    (secs: number) => onDurationChange(item.id, secs * 1000),
    [item.id, onDurationChange],
  );

  return (
    <div
      draggable
      onDragStart={() => onDragStart(index)}
      onDragEnter={() => onDragEnter(index)}
      onDragEnd={onDragEnd}
      onDragOver={(e) => e.preventDefault()}
      className={cn(
        'group flex items-center gap-2 px-2 py-1.5 rounded-lg',
        'bg-zinc-800/60 hover:bg-zinc-800',
        'transition-all duration-150 select-none',
        isDragOver && 'ring-1 ring-amber-500/50 bg-zinc-800 scale-[1.01]',
      )}
    >
      {/* Sürükleme tutamacı */}
      <div
        className="text-zinc-600 hover:text-zinc-400 cursor-grab active:cursor-grabbing shrink-0"
        title={t('common.loopDragToReorder')}
      >
        <GripVertical className="w-3.5 h-3.5" />
      </div>

      {/* Sıra numarası */}
      <span className="text-[10px] font-mono text-zinc-600 w-5 shrink-0">
        {String(index + 1).padStart(2, '0')}
      </span>

      {/* Küçük resim */}
      <MediaThumbnail item={item} />

      {/* Bilgi */}
      <div className="flex-1 min-w-0">
        <div
          className="text-xs text-zinc-200 truncate font-medium leading-tight"
          title={item.fileName}
        >
          {item.fileName}
        </div>
        <div className="flex items-center gap-1 text-[10px] text-zinc-500 mt-0.5">
          {item.type === 'video' ? (
            <><Film className="w-2.5 h-2.5" />{t('common.loopVideo')}</>
          ) : (
            <><ImageIcon className="w-2.5 h-2.5" />{t('common.loopImage')}</>
          )}
        </div>
      </div>

      {/* Süre girişi */}
      <DurationInput
        valueSecs={Math.round(item.duration / 1000)}
        onChange={handleDurationChange}
      />

      {/* Sil */}
      <button
        onClick={() => onRemove(item.id)}
        className={cn(
          'text-zinc-600 hover:text-red-400',
          'opacity-0 group-hover:opacity-100',
          'transition-all shrink-0',
        )}
        title={t('common.loopRemove')}
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );
});

// ─── LoopTab (Ana Bileşen) ────────────────────────────────────────────────────

export default function LoopTab({ onAddLoopToPresentation }: LoopTabProps) {
  const { t } = useTranslation();
  const [items, setItems] = useState<RichLoopItem[]>([]);
  const [defaultDuration, setDefaultDuration] = useState(LOOP_DEFAULT_DURATION / 1000);
  const [isLoading, setIsLoading] = useState(false);

  // DÜZELTME [BUG-1]: ref yerine state — yeniden render tetikler
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const dragItemIndex = useRef<number | null>(null);

  // Toplam süreyi yalnızca items değiştiğinde hesapla
  const totalMs = useMemo(
    () => items.reduce((acc, i) => acc + i.duration, 0),
    [items],
  );

  // ── Dosya seçimi ───────────────────────────────────────────────────────────

  const addFiles = useCallback(async () => {
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

      const newItems: RichLoopItem[] = paths.map((p) => ({
        id: crypto.randomUUID(),
        type: detectMediaType(p),
        mediaUrl: toFileUrl(p),
        fileName: getFileName(p), // DÜZELTME [BUG-2]
        duration: defaultDuration * 1000,
      }));

      setItems((prev) => [...prev, ...newItems]);
    } finally {
      setIsLoading(false);
    }
  }, [defaultDuration]);

  // ── Öğe işlemleri ──────────────────────────────────────────────────────────

  const removeItem = useCallback((id: string) => {
    setItems((prev) => prev.filter((i) => i.id !== id));
  }, []);

  const clearAll = useCallback(() => setItems([]), []);

  const updateItemDuration = useCallback((id: string, ms: number) => {
    // DÜZELTME [BUG-4]: Tutarlı sınırlama — her yerde aynı
    const clamped = Math.max(MIN_DURATION_MS, Math.min(MAX_DURATION_MS, ms));
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, duration: clamped } : i)));
  }, []);

  // ── Sürükle & Bırak ────────────────────────────────────────────────────────

  const handleDragStart = useCallback((index: number) => {
    dragItemIndex.current = index;
  }, []);

  const handleDragEnter = useCallback((index: number) => {
    setDragOverIndex(index); // DÜZELTME [BUG-1]: state = render tetiklenir
  }, []);

  const handleDragEnd = useCallback(() => {
    const from = dragItemIndex.current;
    const to = dragOverIndex;

    if (from !== null && to !== null && from !== to) {
      setItems((prev) => {
        const next = [...prev];
        const [moved] = next.splice(from, 1);
        next.splice(to, 0, moved);
        return next;
      });
    }

    dragItemIndex.current = null;
    setDragOverIndex(null);
  }, [dragOverIndex]);

  // ── Sunuma ekle ────────────────────────────────────────────────────────────

  const handleAdd = useCallback(() => {
    if (items.length === 0) return;
    onAddLoopToPresentation(items, defaultDuration * 1000);
    setItems([]);
  }, [items, defaultDuration, onAddLoopToPresentation]);

  const handleDefaultDuration = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setDefaultDuration(parseDurationSecs(e.target.value)); // DÜZELTME [BUG-3]
    },
    [],
  );

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full bg-[#1a1a1a] text-white overflow-hidden">

      {/* ── Üst Bar ────────────────────────────────────────────────────────── */}
      <div className="shrink-0 px-3 pt-3 pb-2.5 border-b border-white/[0.07] space-y-3">

        {/* Başlık + Aksiyonlar */}
        <div className="flex items-center justify-between">
          <h2 className="text-[10px] uppercase tracking-widest font-semibold text-zinc-500 flex items-center gap-1.5">
            <Repeat className="w-3 h-3" />
            {t('common.loopTitle')}
          </h2>

          <div className="flex items-center gap-1.5">
            <button
              onClick={addFiles}
              disabled={isLoading}
              title={t('common.loopAddMedia')}
              className={cn(
                'flex items-center justify-center w-7 h-7 rounded border transition-colors',
                'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border-emerald-500/20',
                'disabled:opacity-40 disabled:cursor-not-allowed',
              )}
            >
              {isLoading ? (
                <span className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" />
              ) : (
                <Plus className="w-3.5 h-3.5" />
              )}
            </button>

            <button
              onClick={clearAll}
              disabled={items.length === 0}
              title={t('common.loopClearAll')}
              className={cn(
                'flex items-center justify-center w-7 h-7 rounded border transition-colors',
                'bg-red-500/10 hover:bg-red-500/20 text-red-400 border-red-500/20',
                'disabled:opacity-40 disabled:cursor-not-allowed',
              )}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Varsayılan Süre */}
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
              className={cn(
                'w-14 bg-zinc-900 border border-zinc-700 rounded px-2 py-0.5',
                'text-xs text-white text-center font-mono',
                'focus:outline-none focus:border-amber-500/70 transition-colors',
              )}
            />
            <span className="text-[10px] text-zinc-500 select-none">sn</span>
          </div>
        </div>
      </div>

      {/* ── Öğe Listesi ────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {items.length === 0 ? (
          /* Boş durum — tıklanabilir alan */
          <button
            onClick={addFiles}
            className={cn(
              'w-full h-full min-h-36 flex flex-col items-center justify-center gap-2.5',
              'border border-dashed border-zinc-700 rounded-xl',
              'text-zinc-600 hover:text-zinc-400 hover:border-zinc-500',
              'transition-colors cursor-pointer',
            )}
          >
            <Repeat className="w-6 h-6 opacity-60" />
            <div className="text-center space-y-0.5">
              <div className="text-xs font-medium">{t('common.loopClickToAdd')}</div>
              <div className="text-[10px] text-zinc-600">{t('common.loopDragFiles')}</div>
            </div>
          </button>
        ) : (
          <>
            {items.map((item, index) => (
              <LoopItemRow
                key={item.id}
                item={item}
                index={index}
                isDragOver={dragOverIndex === index}
                onDragStart={handleDragStart}
                onDragEnter={handleDragEnter}
                onDragEnd={handleDragEnd}
                onRemove={removeItem}
                onDurationChange={updateItemDuration}
              />
            ))}

            {/* Daha fazla ekle */}
            <button
              onClick={addFiles}
              className={cn(
                'w-full py-2 mt-1 flex items-center justify-center gap-1.5',
                'border border-dashed border-zinc-700 rounded-lg',
                'text-[11px] text-zinc-500 hover:text-zinc-300 hover:border-zinc-500',
                'transition-colors',
              )}
            >
              <Plus className="w-3 h-3" />
              {t('common.loopAddMedia')}
            </button>
          </>
        )}
      </div>

      {/* ── Alt Bar ────────────────────────────────────────────────────────── */}
      {items.length > 0 && (
        <div className="shrink-0 px-3 py-3 border-t border-white/[0.07] space-y-2">
          {/* İstatistikler */}
          <div className="flex items-center justify-between text-[10px] text-zinc-500">
            <span>{t('common.loopItemCount', { count: items.length })}</span>
            <span className="flex items-center gap-1">
              <Clock className="w-2.5 h-2.5" />
              {t('common.loopTotal')} <strong className="text-zinc-400">{formatTotalTime(totalMs)}</strong>
            </span>
          </div>

          {/* Slayta Ekle */}
          <button
            onClick={handleAdd}
            className={cn(
              'w-full flex items-center justify-center gap-2 py-2.5',
              'bg-amber-500 hover:bg-amber-400 active:bg-amber-600',
              'text-black text-xs font-semibold rounded-lg',
              'transition-colors',
            )}
          >
            <Repeat className="w-3.5 h-3.5" />
            {t('common.loopAddToSlide')}
          </button>
        </div>
      )}
    </div>
  );
}