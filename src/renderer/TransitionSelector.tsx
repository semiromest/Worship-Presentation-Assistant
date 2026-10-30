import { playSfx } from './sfx';
import { memo, useCallback } from 'react';
import { ChevronDown, Check, Clock3 } from 'lucide-react';
import { Select } from '@base-ui/react/select';
import type { TransitionType } from './types';
import { TRANSITION_OPTIONS, DURATION_OPTIONS } from './constants';
import { useTranslation } from 'react-i18next';

interface TransitionSelectorProps {
  transitionType: TransitionType;
  duration: number;
  onChange: (update: Partial<{ type: TransitionType; duration: number }>) => void;
}

function EffectDropdown({ value, label, items, onChange, duration = false }: {
  value: string; label: string; items: { value: string; label: string; icon?: string }[];
  onChange: (value: string) => void; duration?: boolean;
}) {
  return <Select.Root value={value} items={items} onValueChange={next => { if (next !== null) onChange(next); }}>
    <Select.Trigger aria-label={label} className="effect-select-trigger" data-duration={duration || undefined} onKeyDown={event => event.stopPropagation()}>
      {duration && <Clock3 className="effect-select-clock" aria-hidden="true" />}
      <Select.Value className="effect-select-value" />
      <Select.Icon><ChevronDown aria-hidden="true" /></Select.Icon>
    </Select.Trigger>
    <Select.Portal>
      <Select.Positioner side="bottom" align="start" sideOffset={6} alignItemWithTrigger={false} className="z-[80]">
        <Select.Popup className="effect-select-popup" aria-label={label} data-duration={duration || undefined} onKeyDown={event => event.stopPropagation()}>
          <Select.List className="effect-select-list">
            {items.map(item => <Select.Item key={item.value} value={item.value} label={item.label} data-value={item.value} className="effect-select-option">
              {item.icon && <span className="effect-select-symbol" aria-hidden="true">{item.icon}</span>}
              <Select.ItemText>{item.label}</Select.ItemText>
              <Select.ItemIndicator className="effect-select-check"><Check aria-hidden="true" /></Select.ItemIndicator>
            </Select.Item>)}
          </Select.List>
        </Select.Popup>
      </Select.Positioner>
    </Select.Portal>
  </Select.Root>;
}

export const TransitionSelector = memo(({
  transitionType,
  duration,
  onChange,
}: TransitionSelectorProps) => {
  const { t } = useTranslation();
  const handleTransitionChange = useCallback(
    (value: string) => {
      if (value === transitionType) return;
      onChange({ type: value as TransitionType });
      playSfx('press');
    },
    [onChange, transitionType]
  );

  const handleDurationChange = useCallback(
    (value: string) => {
      if (Number(value) === duration) return;
      onChange({ duration: Number(value) });
      playSfx('press');
    },
    [onChange, duration]
  );

  return (
    <div className="design-transition-controls" role="group" aria-label={t('transition.settings')}>
      <span>{t('transition.label')}</span>
      <div className="design-transition-selects">
        <EffectDropdown value={transitionType} label={t('transition.type')} items={TRANSITION_OPTIONS.map(item => ({ value: item.type, label: t(item.label), icon: item.icon }))} onChange={handleTransitionChange} />
        <EffectDropdown value={String(duration)} label={t('transition.duration')} items={DURATION_OPTIONS.map(ms => ({ value: String(ms), label: `${ms} ms` }))} onChange={handleDurationChange} duration />
      </div>
    </div>
  );
});

TransitionSelector.displayName = 'TransitionSelector';
