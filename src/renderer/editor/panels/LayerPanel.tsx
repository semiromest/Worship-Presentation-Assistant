import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { SlideItem } from '../../types';
import { cn } from '../../utils';
import {
  ChevronUp,
  ChevronDown,
  Copy,
  Trash2,
  Lock,
  Unlock,
  Eye,
  EyeOff,
  Layers,
} from 'lucide-react';

interface LayerPanelProps {
  items: SlideItem[];
  selectedIds: Set<string>;
  onSelect: (id: string) => void;
  onMove: (id: string, direction: 'up' | 'down') => void;
  onDelete: (id: string) => void;
  onToggleVisibility: (id: string) => void;
  onDuplicate: (id: string) => void;
  onToggleLock: (id: string) => void;
}

export const LayerPanel = memo(function LayerPanel({
  items,
  selectedIds,
  onSelect,
  onMove,
  onDelete,
  onToggleVisibility,
  onDuplicate,
  onToggleLock,
}: LayerPanelProps) {
  const { t } = useTranslation();
  const sorted = useMemo(
    () => [...items].sort((a, b) => (b.zIndex ?? 0) - (a.zIndex ?? 0)),
    [items],
  );

  const getItemIcon = (item: SlideItem): string => {
    switch (item.type) {
      case 'text': return '📝';
      case 'image': return '🖼️';
      case 'shape': return '⬛';
      case 'group': return '📦';
      default: return '📄';
    }
  };

  const getItemLabel = (item: SlideItem): string => {
    if (item.type === 'text') return item.content?.slice(0, 18) || t('common.editorText');
    if (item.type === 'image') return t('common.editorImage');
    if (item.type === 'group') return `Grup (${item.groupItems?.length || 0})`;
    return t('common.editorText');
  };

  return (
    <div className="space-y-3 rounded-2xl border border-white/10 bg-[#1a1a1a] p-4 shadow-sm">
      <div className="flex items-center gap-2 text-sm font-semibold text-white/80">
        <Layers className="h-4 w-4" />
        <span>{t('common.editorLayers', { count: items.length })}</span>
      </div>

      <div className="max-h-[360px] space-y-2 overflow-y-auto pr-1">
        {sorted.map((item, idx) => (
          <div
            key={item.id}
            onClick={() => onSelect(item.id)}
            className={cn(
              'flex cursor-pointer items-center gap-2 rounded-xl border px-2 py-2 transition',
              selectedIds.has(item.id)
                ? 'border-blue-500/50 bg-blue-600/20'
                : 'border-white/10 bg-black/20 hover:bg-black/30',
            )}
          >
            {/* Visibility */}
            <button
              type="button"
              onClick={e => {
                e.stopPropagation();
                onToggleVisibility(item.id);
              }}
              className="rounded-md p-1 text-white/60 hover:bg-white/5 hover:text-white"
              title={item.visible === false ? t('common.editorShow') : t('common.editorHide')}
              aria-label={item.visible === false ? t('common.editorShow') : t('common.editorHide')}
            >
              {item.visible === false ? (
                <EyeOff className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Eye className="h-4 w-4" aria-hidden="true" />
              )}
            </button>

            {/* Label */}
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs text-white/85">
                {getItemIcon(item)} {getItemLabel(item)}
              </div>
              <div className="text-[10px] text-white/35">
                {item.locked ? t('common.editorLocked') : t('common.editorUnlocked')} · z:
                {item.zIndex ?? 0}
              </div>
            </div>

            {/* Layer order */}
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={e => {
                  e.stopPropagation();
                  onMove(item.id, 'up');
                }}
                disabled={idx === 0}
                className="rounded-md p-1 text-white/45 hover:bg-white/5 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
                title={t('common.editorBringForward')}
                aria-label={t('common.editorBringForward')}
              >
                <ChevronUp className="h-4 w-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={e => {
                  e.stopPropagation();
                  onMove(item.id, 'down');
                }}
                disabled={idx === sorted.length - 1}
                className="rounded-md p-1 text-white/45 hover:bg-white/5 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
                title={t('common.editorSendBackward')}
                aria-label={t('common.editorSendBackward')}
              >
                <ChevronDown className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={e => {
                  e.stopPropagation();
                  onDuplicate(item.id);
                }}
                className="rounded-md p-1 text-white/45 hover:bg-white/5 hover:text-white"
                title={t('common.editorDuplicate')}
                aria-label={t('common.editorDuplicate')}
              >
                <Copy className="h-4 w-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={e => {
                  e.stopPropagation();
                  onToggleLock(item.id);
                }}
                className="rounded-md p-1 text-white/45 hover:bg-white/5 hover:text-white"
                title={item.locked ? t('common.editorUnlock') : t('common.editorLock')}
                aria-label={item.locked ? t('common.editorUnlock') : t('common.editorLock')}
              >
                {item.locked ? (
                  <Lock className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <Unlock className="h-4 w-4" aria-hidden="true" />
                )}
              </button>
              <button
                type="button"
                onClick={e => {
                  e.stopPropagation();
                  onDelete(item.id);
                }}
                className="rounded-md p-1 text-red-400 hover:bg-red-500/10 hover:text-red-300"
                title={t('common.editorDelete')}
                aria-label={t('common.editorDelete')}
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </div>
        ))}

        {items.length === 0 && (
          <div className="rounded-xl border border-dashed border-white/10 bg-black/15 px-3 py-6 text-center text-xs text-white/40">
            {t('common.editorNoLayers')}
          </div>
        )}
      </div>
    </div>
  );
});
