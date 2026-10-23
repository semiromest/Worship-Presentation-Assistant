import { useTranslation } from 'react-i18next';
import { useStore } from '../state/useStore';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export function SlideSelectionStatus({ drawer = false }: { drawer?: boolean }) {
  const { t } = useTranslation();
  const liveIndex = useStore(s => s.liveIndex);
  const slideCount = useStore(s => s.presentation.slides.length);
  const selectedIndex = useStore(s => s.presentation.slides.findIndex(slide => slide.id === s.selectedSlideId));
  const setLiveIndex = useStore(s => s.setLiveIndex);
  const locked = useStore(s => s.presentation.slides.some(slide => slide.locked));
  const open = useStore(s => s.isProjectorWindowOpen);
  return <div className={`output-slide-status${drawer ? ' output-slide-status-drawer' : ''}`} data-testid={drawer ? 'drawer-slide-status' : 'output-slide-status'} role={drawer ? 'status' : undefined}>
    <span className="design-live-number">{t('common.liveSlide')}: {slideCount ? Math.min(liveIndex + 1, slideCount) : 0}/{slideCount}</span>
    <span className="output-selected-number">{t('common.selectedSlide')}: {selectedIndex + 1}</span>
    {(locked || open) && <span className={`output-slide-state${locked ? ' design-lock-state' : ''}`}>{t(locked ? 'slidesWorkspace.locked' : 'slidesWorkspace.direct')}</span>}
    <div className="design-navigation">
      <button type="button" onClick={() => setLiveIndex(index => Math.max(0, index - 1))}
        disabled={liveIndex <= 0 || locked || slideCount === 0}
        title={t(locked ? 'common.slideLockActiveHint' : 'common.prevSlide')} aria-label={t('common.prevSlide')}
        className="rounded-md text-white/60 hover:bg-white/10 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400">
        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
      </button>
      <button type="button" onClick={() => setLiveIndex(index => Math.min(slideCount - 1, index + 1))}
        disabled={liveIndex >= slideCount - 1 || locked || slideCount === 0}
        title={t(locked ? 'common.slideLockActiveHint' : 'common.nextSlide')} aria-label={t('common.nextSlide')}
        className="rounded-md text-white/60 hover:bg-white/10 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400">
        <ChevronRight className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  </div>;
}

export default function OutputStatus() {
  const { t } = useTranslation();
  const open = useStore(s => s.isProjectorWindowOpen);
  const assignments = useStore(s => s.outputAssignments);
  const blackout = useStore(s => s.isBlackout);
  const sessionError = useStore(s => s.sessionSaveStatus === 'error');
  const enabled = useStore(s => s.liveSaveEnabled);
  const isSlides = useStore(s => s.activeTab === 'slides');
  const panelOpen = useStore(s => s.isRightPanelOpen);
  const stage = Object.values(assignments).some(a => a.isOpen && a.mode === 'stage');
  const live = open || Object.values(assignments).some(a => a.isOpen && a.mode !== 'stage');
  const black = blackout || Object.values(assignments).some(a => a.isOpen && a.isBlackout);
  return <div className={`output-status-bar bg-surface-raised border-b border-white/10 text-[10px] text-white/55${panelOpen ? ' output-status-panel-open' : ''}`} role="status">
    <div className="output-status-items">
    {([['presentation', live], ['stage', stage], ['blackout', black]] as const).map(([key, active]) =>
      <span key={key} className="inline-flex items-center gap-1.5"><span aria-hidden="true" className={`w-1.5 h-1.5 rounded-full ${active ? key === 'blackout' ? 'bg-amber-400' : 'bg-emerald-400' : 'bg-white/25'}`} />
        {t(`outputStatus.${key}`)}: {t(active ? 'outputStatus.on' : 'outputStatus.off')}
      </span>)}
    {!enabled && <span>{t('outputStatus.saveOff')}</span>}
    {enabled && sessionError && <span className="text-red-300">{t('outputStatus.sessionError')}</span>}
    </div>
    {isSlides && <SlideSelectionStatus />}
  </div>;
}
