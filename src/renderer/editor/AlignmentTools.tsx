import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalDistributeCenter,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalDistributeCenter,
  ArrowDownToLine,
  ArrowUpToLine,
  BringToFront,
  SendToBack,
  MoveHorizontal,
  MoveVertical,
} from 'lucide-react';
import type { SlideItem } from '../types';
import { layoutSelection, type AlignTarget, type LayoutAction } from './alignmentUtils';
import { canReorderSelection, type ZOrderAction } from './bulkItemOps';
import { Section, Segmented, ToolButton, ToolDivider } from './EditorControls';

interface AlignmentToolsProps {
  selectedItems: SlideItem[];
  items: SlideItem[];
  onUpdateItems: (items: SlideItem[]) => void;
  /** Re-stacks the selection; omitted where layer order is not editable. */
  onReorder?: (action: ZOrderAction) => void;
}

const alignButtons = [
  { id: 'left', icon: AlignStartVertical, label: 'editorAlignLeft' },
  { id: 'center', icon: AlignCenterVertical, label: 'editorAlignCenterH' },
  { id: 'right', icon: AlignEndVertical, label: 'editorAlignRight' },
  { id: 'top', icon: AlignStartHorizontal, label: 'editorAlignTop' },
  { id: 'middle', icon: AlignCenterHorizontal, label: 'editorAlignMiddle' },
  { id: 'bottom', icon: AlignEndHorizontal, label: 'editorAlignBottom' },
] as const;

const zOrderButtons = [
  { id: 'front', icon: ArrowUpToLine, label: 'editorBringToFront' },
  { id: 'forward', icon: BringToFront, label: 'editorBringForward' },
  { id: 'backward', icon: SendToBack, label: 'editorSendBackward' },
  { id: 'back', icon: ArrowDownToLine, label: 'editorSendToBack' },
] as const;

export function AlignmentTools({ selectedItems, items, onUpdateItems, onReorder }: AlignmentToolsProps) {
  const { t } = useTranslation();
  const [targetOverride, setTargetOverride] = useState<AlignTarget | null>(null);
  const eligible = selectedItems.filter((item) => !item.locked && item.visible !== false);
  const target: AlignTarget = eligible.length < 2 ? 'slide' : (targetOverride ?? 'selection');
  const selectedIds = selectedItems.map((item) => item.id);
  if (!eligible.length) return null;
  const apply = (action: LayoutAction) =>
    onUpdateItems(
      layoutSelection(
        items,
        selectedIds,
        action,
        target
      )
    );
  return (
    <Section id="align" title={t('common.editorAlignment')}>
      {eligible.length >= 2 && (
        <Segmented
          label={t('common.editorAlignTarget')}
          value={target}
          onChange={setTargetOverride}
          options={[
            { value: 'slide', label: t('common.editorAlignToSlide'), text: t('common.editorAlignToSlide') },
            { value: 'selection', label: t('common.editorAlignToSelection'), text: t('common.editorAlignToSelection') },
            { value: 'slideBlock', label: t('common.editorAlignBlockToSlideHint'), text: t('common.editorAlignBlockToSlide') },
          ]}
        />
      )}
      <div className="flex flex-wrap items-center gap-0.5">
        {alignButtons.map((button, index) => (
          <span key={button.id} className="contents">
            {index === 3 && <ToolDivider />}
            <ToolButton
              label={t('common.' + button.label)}
              descriptionKey={'common.' + button.label}
              icon={button.icon}
              onClick={() => apply(button.id)}
            />
          </span>
        ))}
      </div>
      {eligible.length >= 2 && (
        <div className="flex flex-wrap items-center gap-0.5">
          <ToolButton label={t('common.editorSameWidth')} icon={MoveHorizontal} onClick={() => apply('sameWidth')} />
          <ToolButton label={t('common.editorSameHeight')} icon={MoveVertical} onClick={() => apply('sameHeight')} />
          {eligible.length >= 3 && (
            <>
              <ToolDivider />
              <ToolButton
                label={t('common.editorDistributeH')}
                icon={AlignHorizontalDistributeCenter}
                onClick={() => apply('distributeHorizontal')}
              />
              <ToolButton
                label={t('common.editorDistributeV')}
                icon={AlignVerticalDistributeCenter}
                onClick={() => apply('distributeVertical')}
              />
            </>
          )}
        </div>
      )}
      {onReorder && (
        <div className="flex flex-wrap items-center gap-0.5" role="group" aria-label={t('common.editorArrange')}>
          {zOrderButtons.map((button) => (
            <ToolButton
              key={button.id}
              label={t('common.' + button.label)}
              icon={button.icon}
              disabled={!canReorderSelection(items, selectedIds, button.id)}
              onClick={() => onReorder(button.id)}
            />
          ))}
        </div>
      )}
      <p className="text-[11px] leading-snug text-white/40">{t('common.editorLayoutActiveOnly')}</p>
    </Section>
  );
}
