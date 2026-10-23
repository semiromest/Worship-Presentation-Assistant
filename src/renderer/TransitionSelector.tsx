import { playSfx } from './sfx';
import { memo, useCallback } from 'react';
import { ChevronDown } from 'lucide-react';
import type { TransitionType } from './types';
import { TRANSITION_OPTIONS, DURATION_OPTIONS } from './constants';
import { useTranslation } from 'react-i18next';

interface TransitionSelectorProps {
  transitionType: TransitionType;
  duration: number;
  onChange: (update: Partial<{ type: TransitionType; duration: number }>) => void;
}

export const TransitionSelector = memo(({
  transitionType,
  duration,
  onChange,
}: TransitionSelectorProps) => {
  const { t } = useTranslation();
  const handleTransitionChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      if (e.target.value === transitionType) return;
      onChange({ type: e.target.value as TransitionType });
      playSfx('press');
    },
    [onChange, transitionType]
  );

  const handleDurationChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      if (parseInt(e.target.value) === duration) return;
      onChange({ duration: parseInt(e.target.value) });
      playSfx('press');
    },
    [onChange, duration]
  );

  return (
    <div className="design-transition-controls" role="group" aria-label={t('transition.settings')}>
      <span>{t('transition.label')}</span>
      <div className="design-transition-selects">
        <div className="relative">
          <select
            value={transitionType}
            onChange={handleTransitionChange}
            aria-label={t('transition.type')}
            className="w-full bg-white/5 border border-white/10 rounded-lg pl-2 pr-6 text-xs text-white/80 outline-none focus-visible:ring-2 focus-visible:ring-blue-500 hover:bg-white/10 transition-colors appearance-none cursor-pointer"
          >
            {TRANSITION_OPTIONS.map(({ type, label }) => (
              <option key={type} value={type} className="bg-[#181818]">
                {t(label)}
              </option>
            ))}
          </select>
          <div className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-white/40">
            <ChevronDown className="w-3 h-3" />
          </div>
        </div>

        <div className="relative">
          <select
            value={duration}
            onChange={handleDurationChange}
            aria-label={t('transition.duration')}
            className="w-full bg-white/5 border border-white/10 rounded-lg pl-2 pr-6 text-xs text-white/80 outline-none focus-visible:ring-2 focus-visible:ring-blue-500 hover:bg-white/10 transition-colors appearance-none cursor-pointer font-mono"
          >
            {DURATION_OPTIONS.map(ms => (
              <option key={ms} value={ms} className="bg-[#181818]">
                {ms}ms
              </option>
            ))}
          </select>
          <div className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-white/40">
            <ChevronDown className="w-3 h-3" />
          </div>
        </div>
      </div>
    </div>
  );
});

TransitionSelector.displayName = 'TransitionSelector';
