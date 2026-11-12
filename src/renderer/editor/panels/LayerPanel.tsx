import ControlTooltip from '../../components/ControlTooltip';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { SlideItem } from '../../types';
import { cn } from '../../utils';
import {
  Boxes,
  ChevronDown,
  ChevronUp,
  Copy,
  Eye,
  EyeOff,
  Image as ImageIcon,
  Lock,
  Square,
  Trash2,
  Type,
  Unlock,
} from 'lucide-react';
import { ToolButton } from '../EditorControls';

interface LayerPanelProps {
  items: SlideItem[];
  selectedIds: Set<string>;
  onSelect: (id: string) => void;
  onMove: (id: string, direction: 'up' | 'down') => void;
  onDelete: (id: string) => void;
  onToggleVisibility: (id: string) => void;
  onDuplicate: (id: string) => void;
  onToggleLock: (id: string) => void;
  /** Enables dragging a row onto a slide thumbnail to move the element. */
  onDragItemStart?: (event: React.DragEvent<HTMLDivElement>, itemId: string) => void;
}

const typeIcon = { text: Type, image: ImageIcon, group: Boxes, shape: Square } as const;

export const LayerPanel = memo(function LayerPanel({
  items,
  selectedIds,
  onSelect,
  onMove,
  onDelete,
  onToggleVisibility,
  onDuplicate,
  onToggleLock,
  onDragItemStart,
}: LayerPanelProps) {
  const { t } = useTranslation();
  const sorted = useMemo(() => [...items].sort((a, b) => (b.zIndex ?? 0) - (a.zIndex ?? 0)), [items]);

  const getItemLabel = (item: SlideItem): string => {
    if (item.type === 'text') return item.content?.split('\n')[0]?.slice(0, 40) || t('common.editorText');
    if (item.type === 'image') return t('common.editorImage');
    if (item.type === 'group') return `${t('common.editorGroup')} (${item.groupItems?.length || 0})`;
    return t('common.editorText');
  };

  return (
    <div className="px-2 py-2">
      <div className="flex items-center justify-between px-1 pb-1.5">
        <h3 className="text-[11px] font-semibold text-white/70">{t('common.editorLayers', { count: items.length })}</h3>
      </div>

      <div className="space-y-px">
        {sorted.map((item, idx) => {
          const Icon = typeIcon[item.type as keyof typeof typeIcon] ?? Type;
          const selected = selectedIds.has(item.id);
          const hidden = item.visible === false;
          return (
            <ControlTooltip key={item.id}>
              <div
                onClick={() => onSelect(item.id)}
                draggable={!!onDragItemStart}
                onDragStart={(event) => onDragItemStart?.(event, item.id)}
                title={onDragItemStart ? t('common.editorLayerDragHint') : undefined}
                className={cn(
                  'group flex h-8 items-center gap-1.5 rounded-md pl-2 pr-0.5 transition',
                  onDragItemStart && 'cursor-grab active:cursor-grabbing',
                  selected ? 'bg-blue-500/20 text-white' : 'text-white/75 hover:bg-white/[0.05]'
                )}
              >
                <Icon className={cn('h-3.5 w-3.5 shrink-0', selected ? 'text-blue-200' : 'text-white/45')} aria-hidden="true" />
                <span className={cn('min-w-0 flex-1 truncate text-xs', hidden && 'text-white/40 line-through')}>
                  {getItemLabel(item)}
                </span>

                <div
                  className={cn(
                    'flex items-center transition-opacity',
                    selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100'
                  )}
                  onClick={(event) => event.stopPropagation()}
                >
                  <ToolButton
                    label={t('common.editorBringForward')}
                    descriptionKey="common.editorBringForward"
                    icon={ChevronUp}
                    disabled={idx === 0}
                    className="h-6 min-w-6 px-1"
                    onClick={() => onMove(item.id, 'up')}
                  />
                  <ToolButton
                    label={t('common.editorSendBackward')}
                    descriptionKey="common.editorSendBackward"
                    icon={ChevronDown}
                    disabled={idx === sorted.length - 1}
                    className="h-6 min-w-6 px-1"
                    onClick={() => onMove(item.id, 'down')}
                  />
                  <ToolButton
                    label={t('common.editorDuplicate')}
                    descriptionKey="common.editorDuplicate"
                    icon={Copy}
                    className="h-6 min-w-6 px-1"
                    onClick={() => onDuplicate(item.id)}
                  />
                  <ToolButton
                    label={t('common.editorDelete')}
                    descriptionKey="common.editorDelete"
                    icon={Trash2}
                    tone="danger"
                    className="h-6 min-w-6 px-1"
                    onClick={() => onDelete(item.id)}
                  />
                </div>

                {/* State toggles stay visible when they are "on" so hidden/locked layers are obvious. */}
                <div className="flex items-center" onClick={(event) => event.stopPropagation()}>
                  <ToolButton
                    label={item.locked ? t('common.editorUnlock') : t('common.editorLock')}
                    descriptionKey={item.locked ? 'common.editorUnlock' : 'common.editorLock'}
                    icon={item.locked ? Lock : Unlock}
                    className={cn(
                      'h-6 min-w-6 px-1',
                      !item.locked && !selected && 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100'
                    )}
                    onClick={() => onToggleLock(item.id)}
                  />
                  <ToolButton
                    label={hidden ? t('common.editorShow') : t('common.editorHide')}
                    descriptionKey={hidden ? 'common.editorShow' : 'common.editorHide'}
                    icon={hidden ? EyeOff : Eye}
                    className={cn(
                      'h-6 min-w-6 px-1',
                      !hidden && !selected && 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100'
                    )}
                    onClick={() => onToggleVisibility(item.id)}
                  />
                </div>
              </div>
            </ControlTooltip>
          );
        })}

        {items.length === 0 && (
          <div className="rounded-md border border-dashed border-white/10 px-3 py-6 text-center text-xs text-white/50">
            {t('common.editorNoLayers')}
          </div>
        )}
      </div>
    </div>
  );
});
