import { memo, useCallback } from 'react';
import { Settings2, Clock, ChevronDown } from 'lucide-react';
import type { TransitionType } from './types';
import { TRANSITION_OPTIONS, DURATION_OPTIONS } from './constants';
import { cn } from './utils';
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
      onChange({ type: e.target.value as TransitionType });
    },
    [onChange]
  );

  const handleDurationChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      onChange({ duration: parseInt(e.target.value) });
    },
    [onChange]
  );

  return (
    <div className="px-4 py-3 border-b border-white/10 bg-[#161616] space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Settings2 className="w-3 h-3 text-white/40" />
          <span className="text-[10px] font-bold uppercase tracking-widest text-white/40">
            {t('transition.settings')}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="relative">
          <select
            value={transitionType}
            onChange={handleTransitionChange}
            aria-label={t('transition.type')}
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white/80 outline-none hover:bg-white/10 transition-colors appearance-none cursor-pointer"
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
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white/80 outline-none hover:bg-white/10 transition-colors appearance-none cursor-pointer font-mono"
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
