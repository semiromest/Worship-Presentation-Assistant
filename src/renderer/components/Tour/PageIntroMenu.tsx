import { useTranslation } from 'react-i18next';
import { useTourStore } from '../../state/useTourStore';
import { TOUR_MAP } from './tourDefinition';
import { requestPageIntro, turnOffPageSuggestions } from './tourController';
import { readTourState } from './tourStorage';
import { tourButton } from './TourCard';

export default function PageIntroMenu() {
  const { t } = useTranslation();
  const initialized = useTourStore(s => s.profileInitialized);
  useTourStore(s => s.storageRevision);
  const stored = initialized ? readTourState() : null;
  return <div className="space-y-3">
    <h4 className="text-sm font-semibold">{t('tour.pageIntroductions')}</h4>
    <div className="grid grid-cols-2 gap-2">
      {TOUR_MAP.map(item => <button key={item.id} data-testid={`intro-settings-${item.id}`} className={tourButton}
        onClick={() => requestPageIntro(item.id, 'settings')}>
        {t(`nav.${item.id}`)}{stored?.pages[item.id]?.completed ? ' ✓' : ''}
      </button>)}
    </div>
    {stored?.pageSuggestions.eligible && <button data-testid="suggestions-disable" className={tourButton}
      disabled={!stored.pageSuggestions.enabled} onClick={turnOffPageSuggestions}>
      {t(stored.pageSuggestions.enabled ? 'tour.disableSuggestions' : 'tour.suggestionsDisabled')}
    </button>}
  </div>;
}
