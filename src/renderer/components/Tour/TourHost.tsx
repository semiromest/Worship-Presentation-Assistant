import { Component, lazy, Suspense, useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import Dialog from '../Dialog';
import { useTourStore } from '../../state/useTourStore';
import { canAutoInvite, finishTour, getTourBlockReason, requestTour, requestWelcome, requestPageIntro, showMap, watchTourSafety, turnOffPageSuggestions } from './tourController';
import { TOUR_MAP } from './tourDefinition';
import { readTourState, writeTourState, recordPage } from './tourStorage';
import { tourButton } from './TourCard';
import TourInteractionBoundary from './TourInteractionBoundary';
import { usePractice } from '../../hooks/usePractice';

const Motor = lazy(() => import('./JoyrideAdapter'));
class MotorErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { finishTour('failed'); }
  render() { return this.state.failed ? null : this.props.children; }
}
function Loading() {
  const { t } = useTranslation();
  return createPortal(<TourInteractionBoundary><div data-tour-surface role="dialog" aria-modal="true" aria-label={t('tour.loading')}
    className="fixed inset-0 z-[200] bg-black/60 grid place-items-center"><div className="rounded-2xl bg-surface-overlay p-6 text-white">
      <p role="status">{t('tour.loading')}</p><button autoFocus className={`${tourButton} mt-4`} onClick={() => finishTour('dismissed')}>{t('tour.close')}</button>
    </div></div></TourInteractionBoundary>, document.body);
}
export default function TourHost() {
  const practice = usePractice();
  return practice ? null : <TourHostContent />;
}
function TourHostContent() {
  const { t } = useTranslation();
  const phase = useTourStore(s => s.phase);
  const sessionId = useTourStore(s => s.sessionId);
  const error = useTourStore(s => s.error);
  const entry = useTourStore(s => s.entry);
  const suggestion = useTourStore(s => s.suggestion);
  const autoHandled = useRef(false);
  useEffect(watchTourSafety, []);
  useEffect(() => {
    let alive = true;
    const automatic = async () => {
      const profile = await window.electronAPI?.getTourProfileInfo?.().catch(() => ({ profileKind: 'unknown' as const }));
      if (!alive || autoHandled.current) return;
      const stored = readTourState(profile?.profileKind ?? 'unknown');
      writeTourState(stored);
      useTourStore.setState({ profileInitialized: true, profileKnown: profile?.profileKind === 'new' || profile?.profileKind === 'existing' });
      if (stored.welcomeSeen || profile?.profileKind !== 'new') { autoHandled.current = true; writeTourState(stored); return; }
      const attempt = () => {
        if (!alive || autoHandled.current || !canAutoInvite()) return;
        if (requestWelcome()) autoHandled.current = true;
      };
      attempt();
      offReady = useTourStore.subscribe(attempt);
    };
    let offReady: (() => void) | undefined;
    void automatic();
    return () => { alive = false; offReady?.(); };
  }, []);
  useLayoutEffect(() => {
    if (phase === 'welcome') writeTourState({ ...readTourState(), welcomeSeen: true });
  }, [phase]);
  useLayoutEffect(() => { if (suggestion) recordPage(suggestion, 'suggested'); }, [suggestion]);
  const reason = getTourBlockReason();
  return <>
    {(phase === 'welcome' || phase === 'map') && <Dialog open onboardingSurface onClose={() => finishTour('dismissed')}
      labelledBy="tour-title" className="bg-surface-overlay border border-white/10 rounded-2xl p-6 shadow-2xl w-[min(720px,calc(100vw-32px))] max-h-[85vh] overflow-y-auto">
      <div onKeyDown={e => e.stopPropagation()} onKeyUp={e => e.stopPropagation()} onPointerDown={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center gap-3 mb-3"><h2 id="tour-title" className="text-xl font-bold">{t(phase === 'map' ? 'tour.mapTitle' : 'tour.welcomeTitle')}</h2>
          <button className={tourButton} aria-label={t('tour.close')} onClick={() => finishTour('dismissed')}>×</button></div>
        <p className="text-sm text-white/70 mb-4">{t('tour.intro')}</p>
        {phase === 'map' && <div className="grid grid-cols-1 sm:grid-cols-2 gap-3" data-testid="tour-map">
          {TOUR_MAP.map(item => <button key={item.id} data-testid={`intro-map-${item.id}`} onClick={() => requestPageIntro(item.id, entry)}
            className="rounded-xl border border-white/10 bg-surface-raised p-3 text-left hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-blue-400">
            <div className="flex justify-between gap-2"><h3 className="text-sm font-semibold">{t(`nav.${item.id}`)}</h3><kbd className="text-xs text-white/50">{item.shortcut}</kbd></div>
            <p className="text-xs text-white/65 mt-1 leading-relaxed">{t(item.description)}</p>
          </button>)}
        </div>}
        {(reason || error) && <p role="status" className="text-sm text-amber-200 mt-4">{t(error ?? `tour.blocked.${reason}`)}</p>}
        <div className="flex flex-wrap justify-end gap-2 mt-5">
          {phase === 'welcome' && <><button className={tourButton} onClick={() => finishTour('dismissed')}>{t('tour.later')}</button><button className={tourButton} onClick={showMap}>{t('tour.mapTitle')}</button></>}
          <button className={`${tourButton} bg-blue-600 disabled:opacity-50`} disabled={!!reason} data-testid="tour-start" onClick={() => requestTour(entry)}>{t('tour.start')}</button>
        </div>
      </div>
    </Dialog>}
    {(phase === 'loading' || phase === 'running') && <MotorErrorBoundary key={sessionId}><Suspense fallback={<Loading />}><Motor sessionId={sessionId} /></Suspense></MotorErrorBoundary>}
    {phase === 'idle' && suggestion && createPortal(<aside data-testid="page-suggestion" aria-label={t('tour.suggestTitle')}
      className="fixed bottom-4 right-4 z-[45] rounded-xl border border-white/15 bg-surface-overlay text-white shadow-xl p-4 w-80 max-w-[calc(100vw-32px)]"
      onKeyDown={e => e.stopPropagation()} onKeyUp={e => e.stopPropagation()} onClick={e => e.stopPropagation()}>
      <p className="font-semibold text-sm">{t('tour.suggestTitle')} — {t(`nav.${suggestion}`)}</p>
      <div className="flex flex-wrap gap-2 mt-3">
        <button className={tourButton} onClick={() => requestPageIntro(suggestion, 'automatic')}>{t('tour.learnPage')}</button>
        <button className={tourButton} onClick={() => useTourStore.setState({ suggestion: null })}>{t('tour.close')}</button>
        <button className={tourButton} data-testid="suggestions-disable" onClick={turnOffPageSuggestions}>{t('tour.disableSuggestions')}</button>
      </div>
    </aside>, document.body)}
    {phase === 'idle' && error && <div role="alert" className="fixed bottom-4 right-4 z-[200] bg-surface-overlay text-white p-4 rounded-xl shadow-xl max-w-sm">
      {t(error)} <button className={tourButton} aria-label={t('tour.close')} onClick={() => useTourStore.setState({ error: null })}>×</button>
    </div>}
  </>;
}
