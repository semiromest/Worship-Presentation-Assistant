import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Joyride, EVENTS, STATUS, type TooltipRenderProps } from 'react-joyride';
import TourCard, { tourButton } from './TourCard';
import TourInteractionBoundary from './TourInteractionBoundary';
import { finishTour, getTourAnchor, markMotorReady, prepareTourStep } from './tourController';
import { TOUR_STEPS, PAGE_INTROS } from './tourDefinition';
import { useTourStore } from '../../state/useTourStore';
import { useUiMotionEnabled } from '../../hooks/useUiMotionEnabled';

function Tooltip(props: TooltipRenderProps) {
  return <TourCard id={props.step.id ?? 'navigation'} index={props.index} size={props.size} last={props.isLastStep}
    container={props.tooltipProps} onBack={props.backProps.onClick} onNext={props.primaryProps.onClick} />;
}
function Loader() {
  const { t } = useTranslation();
  const waiting = useTourStore(s => s.waiting);
  return <div data-tour-surface role="dialog" aria-modal="true" aria-label={t('tour.loading')}
    className="fixed inset-0 z-[201] bg-black/60 grid place-items-center">
    <div className="rounded-2xl bg-surface-overlay text-white p-6 max-w-sm">
      <p role="status">{t(waiting ? 'tour.stillLoading' : 'tour.loading')}</p>
      <button autoFocus className={`${tourButton} mt-4`} onClick={() => finishTour('dismissed')}>{t('tour.close')}</button>
    </div>
  </div>;
}
export default function JoyrideAdapter({ sessionId }: { sessionId: number }) {
  const phase = useTourStore(s => s.phase);
  const motion = useUiMotionEnabled();
  const page = useTourStore(s => s.page);
  const kind = useTourStore(s => s.kind);
  const [portal] = useState(() => document.createElement('div'));
  useEffect(() => { portal.dataset.tourSurface = ''; document.body.appendChild(portal); return () => portal.remove(); }, [portal]);
  useEffect(() => { markMotorReady(sessionId); }, [sessionId]);
  const steps = useMemo(() => (kind === 'page' && page ? PAGE_INTROS[page] : TOUR_STEPS).map(step => ({
    id: step.id, target: () => getTourAnchor(step.targetId), content: '',
    placement: step.id === 'navigation' ? 'right' as const : step.id === 'help' ? 'top' as const : 'bottom' as const,
    before: () => prepareTourStep(sessionId, step.targetId, 'tab' in step ? step.tab : undefined),
  })), [sessionId, kind, page]);
  return createPortal(<TourInteractionBoundary>
    <Joyride run={phase === 'running'} continuous steps={steps} portalElement={portal}
      tooltipComponent={Tooltip} loaderComponent={Loader}
      floatingOptions={{ strategy: 'fixed', hideArrow: true,
        flipOptions: { crossAxis: true },
        shiftOptions: { boundary: [], rootBoundary: 'viewport', crossAxis: true, padding: 16 },
        middleware: [{ name: 'tourViewport', fn: ({ rects }) => {
          // Large workspace targets leave no outside space: center the card over the
          // workspace while retaining the spotlight. The target has already been verified.
          if (rects.reference.width > innerWidth * 0.8 && rects.reference.height > innerHeight * 0.6) {
            return { x: (innerWidth - rects.floating.width) / 2, y: (innerHeight - rects.floating.height) / 2 };
          }
          return {};
        } }],
      }}
      options={{ skipBeacon: true, blockTargetInteraction: true, dismissKeyAction: false, closeButtonAction: 'skip',
        overlayClickAction: false, beforeTimeout: 10500, targetWaitTimeout: 0, skipScroll: true,
        scrollDuration: motion ? 200 : 0, zIndex: 200, spotlightPadding: 6, spotlightRadius: 12 }}
      onEvent={data => {
        if (data.type === EVENTS.ERROR || data.type === EVENTS.TARGET_NOT_FOUND) finishTour('failed');
        else if (data.type === EVENTS.TOUR_END) finishTour(data.status === STATUS.FINISHED ? 'completed' : 'dismissed');
      }} />
  </TourInteractionBoundary>, portal);
}
