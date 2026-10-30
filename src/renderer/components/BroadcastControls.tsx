import ControlTooltip from './ControlTooltip';
import { Eye, EyeOff, Play } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useStore } from '../state/useStore';
import { playSfx } from '../sfx';

/** Shared by the status strip and the narrow-screen inspector header. */
export default function BroadcastControls() {
  const { t } = useTranslation();
  const blackout = useStore(s => s.isBlackout);
  const locked = useStore(s => s.presentation.slides.some(slide => slide.locked));
  return <div className="broadcast-controls" data-testid="broadcast-controls">
    <ControlTooltip><button
      type="button"
      onClick={() => {
        const state = useStore.getState();
        const next = !state.isBlackout;
        playSfx(next ? 'lock' : 'unlock');
        state.setIsBlackout(next);
      }}
      title={t(blackout ? 'common.openBroadcast' : 'common.blackScreen')}
      aria-label={t(blackout ? 'common.openBroadcast' : 'common.blackScreen')}
      aria-pressed={blackout}
      className="broadcast-blackout"
    >
      {blackout ? <Eye aria-hidden="true" /> : <EyeOff aria-hidden="true" />}
      <span>{t(blackout ? 'common.openBroadcast' : 'common.blackScreen')}</span>
    </button></ControlTooltip>
    <ControlTooltip><button
      type="button"
      onClick={() => {
        const state = useStore.getState();
        const index = state.presentation.slides.findIndex(slide => slide.id === state.selectedSlideId);
        if (index >= 0 && !state.presentation.slides.some(slide => slide.locked)) {
          state.setLiveIndex(index);
          playSfx('start');
        }
      }}
      disabled={locked}
      title={t(locked ? 'common.slideLockActiveHint' : 'common.sendSelectedToLive')}
      aria-label={t('common.sendSelectedToLive')}
    >
      <Play aria-hidden="true" />
      <span>{t('common.goToSelected')}</span>
    </button></ControlTooltip>
  </div>;
}
