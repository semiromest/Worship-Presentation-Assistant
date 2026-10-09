import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SlideItem } from '../types';
import { layoutSelection, type LayoutAction } from './alignmentUtils';

interface AlignmentToolsProps {
  selectedItems: SlideItem[];
  items: SlideItem[];
  onUpdateItems: (items: SlideItem[]) => void;
}
const alignButtons = [
  { id: 'left', icon: '⊣', label: 'editorAlignLeft' },
  { id: 'center', icon: '↔', label: 'editorAlignCenterH' },
  { id: 'right', icon: '⊢', label: 'editorAlignRight' },
  { id: 'top', icon: '⊤', label: 'editorAlignTop' },
  { id: 'middle', icon: '↕', label: 'editorAlignMiddle' },
  { id: 'bottom', icon: '⊥', label: 'editorAlignBottom' },
] as const;
export function AlignmentTools({ selectedItems, items, onUpdateItems }: AlignmentToolsProps) {
  const { t } = useTranslation();
  const [targetOverride, setTargetOverride] = useState<'slide' | 'selection' | null>(null);
  const eligible = selectedItems.filter((item) => !item.locked && item.visible !== false);
  const target = eligible.length < 2 ? 'slide' : (targetOverride ?? 'selection');
  if (!eligible.length) return null;
  const apply = (action: LayoutAction) =>
    onUpdateItems(
      layoutSelection(
        items,
        selectedItems.map((item) => item.id),
        action,
        target
      )
    );
  const buttonClass =
    'rounded-lg border border-white/10 bg-black/20 px-2 py-2 text-xs text-white/70 hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-blue-500';
  return (
    <div className="space-y-3 rounded-2xl border border-white/10 bg-[#1a1a1a] p-3">
      <h3 className="text-xs text-white/60">{t('common.editorAlignment')}</h3>
      <p className="text-[10px] text-white/45">{t('common.editorLayoutActiveOnly')}</p>
      <label className="flex items-center justify-between gap-2 text-xs text-white/60">
        {t('common.editorAlignTarget')}
        <select
          className="rounded-lg border border-white/10 bg-[#222] p-2"
          value={target}
          onChange={(event) => setTargetOverride(event.target.value as 'slide' | 'selection')}
        >
          <option value="slide">{t('common.editorAlignToSlide')}</option>
          <option value="selection" disabled={eligible.length < 2}>
            {t('common.editorAlignToSelection')}
          </option>
        </select>
      </label>
      <div className="grid grid-cols-6 gap-1">
        {alignButtons.map((button) => (
          <button
            key={button.id}
            type="button"
            className={buttonClass}
            aria-label={t('common.' + button.label)}
            title={t('common.' + button.label)}
            onClick={() => apply(button.id)}
          >
            {button.icon}
          </button>
        ))}
      </div>
      {eligible.length >= 2 && (
        <div className="grid grid-cols-2 gap-2">
          <button className={buttonClass} onClick={() => apply('sameWidth')}>
            {t('common.editorSameWidth')}
          </button>
          <button className={buttonClass} onClick={() => apply('sameHeight')}>
            {t('common.editorSameHeight')}
          </button>
        </div>
      )}
      {eligible.length >= 3 && (
        <div className="grid grid-cols-2 gap-2">
          <button className={buttonClass} onClick={() => apply('distributeHorizontal')}>
            {t('common.editorDistributeH')}
          </button>
          <button className={buttonClass} onClick={() => apply('distributeVertical')}>
            {t('common.editorDistributeV')}
          </button>
        </div>
      )}
    </div>
  );
}
