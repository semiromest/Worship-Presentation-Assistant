import { useTranslation } from 'react-i18next';
import type { SlideItem } from '../types';
import { alignItems, distributeItems } from './alignmentUtils';

interface AlignmentToolsProps {
  selectedItems: SlideItem[];
  items: SlideItem[];
  onUpdateItems: (items: SlideItem[]) => void;
}

const alignButtons = [
  { id: 'left', icon: '⊣', labelKey: 'common.editorAlignLeft' },
  { id: 'center', icon: '⊥', labelKey: 'common.editorAlignCenterH' },
  { id: 'right', icon: '⊢', labelKey: 'common.editorAlignRight' },
  { id: 'top', icon: '⊤', labelKey: 'common.editorAlignTop' },
  { id: 'middle', icon: '⊦', labelKey: 'common.editorAlignMiddle' },
  { id: 'bottom', icon: '⊥', labelKey: 'common.editorAlignBottom' },
] as const;

export function AlignmentTools({
  selectedItems,
  items,
  onUpdateItems,
}: AlignmentToolsProps) {
  const { t } = useTranslation();
  if (selectedItems.length < 2) return null;

  const handleAlign = (type: (typeof alignButtons)[number]['id']) => {
    const updated = alignItems(
      items.map(i =>
        selectedItems.some(s => s.id === i.id) ? i : i,
      ),
      type,
    );
    // Only update selected items
    const result = items.map(item => {
      const aligned = updated.find(u => u.id === item.id);
      return aligned ? { ...item, x: aligned.x, y: aligned.y } : item;
    });
    onUpdateItems(result);
  };

  const handleDistribute = (type: 'horizontal' | 'vertical') => {
    const selected = items.filter(i => selectedItems.some(s => s.id === i.id));
    const distributed = distributeItems(selected, type);
    const result = items.map(item => {
      const d = distributed.find(di => di.id === item.id);
      return d ? { ...item, ...d } : item;
    });
    onUpdateItems(result);
  };

  return (
    <div className="space-y-2 rounded-2xl border border-white/10 bg-[#1a1a1a] p-3 shadow-sm">
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-white/40">
        <span>{t('common.editorAlignment')}</span>
      </div>

      <div className="grid grid-cols-6 gap-1">
        {alignButtons.map(({ id, icon, labelKey }) => (
          <button
            key={id}
            type="button"
            onClick={() => handleAlign(id)}
            title={t(labelKey)}
            aria-label={t(labelKey)}
            className="flex items-center justify-center rounded-lg border border-white/10 bg-black/20 px-1.5 py-2 text-xs text-white/70 transition hover:bg-black/35 hover:text-white"
          >
            {icon}
          </button>
        ))}
      </div>

      {selectedItems.length >= 3 && (
        <>
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-white/40 pt-1">
            <span>{t('common.editorDistribution')}</span>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => handleDistribute('horizontal')}
              className="flex-1 rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs text-white/70 transition hover:bg-black/35"
            >
              {t('common.editorDistributeH')}
            </button>
            <button
              type="button"
              onClick={() => handleDistribute('vertical')}
              className="flex-1 rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs text-white/70 transition hover:bg-black/35"
            >
              {t('common.editorDistributeV')}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
