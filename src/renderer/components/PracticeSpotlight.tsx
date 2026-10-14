import { createContext, useContext, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { guideCardClass } from './GuideCard';
import { Joyride, EVENTS } from 'react-joyride';
import { leaseGuideBoundary } from './Tour/guideBoundary';
import { useUiMotionEnabled } from '../hooks/useUiMotionEnabled';
import { useTranslation } from 'react-i18next';
import './PracticeSpotlight.css';
const GuideContent = createContext<{ children: ReactNode; label: string }>({ children: null, label: '' });
let highlightLease = 0;

export default function PracticeSpotlight({ target, index, children, exit, fail, deleteAllowed, interactive = false, useInert = true, centered = false, interactionTargets }: {
  target: HTMLElement | null; index: number; children: ReactNode; exit: () => void; fail?: (index: number) => void; deleteAllowed?: () => boolean; interactive?: boolean; useInert?: boolean; centered?: boolean; interactionTargets?: HTMLElement[];
}) {
  const [portal] = useState(() => document.createElement('div'));
  const { t } = useTranslation();
  const surface = useRef<HTMLDivElement>(null);
  const motion = useUiMotionEnabled();
  const callbacks = useRef({ exit, fail, deleteAllowed }); callbacks.current = { exit, fail, deleteAllowed };
  useLayoutEffect(() => { portal.dataset.practicePortal = ''; document.body.appendChild(portal); return () => portal.remove(); }, [portal]);
  useLayoutEffect(() => {
    const marker = String(++highlightLease);
    const controls = [...new Set([target, ...(interactionTargets ?? [])])].filter((node): node is HTMLElement =>
      !!node && node.matches('button,input,select,[data-slide-id],[data-editor-item-id],[role="menuitem"]'));
    const previous = controls.map(node => ({ node, value: node.getAttribute('data-practice-highlight') }));
    controls.forEach(node => node.setAttribute('data-practice-highlight', marker));
    return () => previous.forEach(({ node, value }) => {
      if (node.getAttribute('data-practice-highlight') !== marker) return;
      if (value === null) node.removeAttribute('data-practice-highlight');
      else node.setAttribute('data-practice-highlight', value);
    });
  }, [target, interactionTargets, index]);
  useLayoutEffect(() => {
    const cleanup = leaseGuideBoundary({ surface: portal, targets: interactive ? interactionTargets ?? (target ? [target] : []) : [],
      exit: () => callbacks.current.exit(), deleteAllowed: () => callbacks.current.deleteAllowed?.() ?? false }, useInert);
    const focus = callbacks.current.deleteAllowed?.() || target?.matches('[role="menuitem"]') ? target : surface.current?.querySelector<HTMLElement>('button'); focus?.focus({ preventScroll: true });
    const observer = new MutationObserver(() => { if (target && !target.isConnected) { if (callbacks.current.fail) callbacks.current.fail(index); else callbacks.current.exit(); } });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => { observer.disconnect(); cleanup(); };
  }, [target, index, portal, useInert, interactive, interactionTargets]);
  // A single visible tooltip remains stable while Joyride moves its controlled spotlight.
  const Tooltip = useMemo(() => function GuideTooltip() { const content = useContext(GuideContent); return <div ref={surface} data-guide-card role="region" aria-label={content.label}
    className={`w-[min(320px,calc(100vw-32px))] ${guideCardClass}`}
    onClick={event => event.stopPropagation()} onKeyDown={event => { if (event.key !== 'Delete' || !callbacks.current.deleteAllowed?.()) event.stopPropagation(); }}>{content.children}</div>; }, []);
  const spotlightTarget = target?.matches('input[type="range"],input[type="number"]') ? target.parentElement ?? target : target;
  return createPortal(<GuideContent.Provider value={{ children, label: t('guide.title') }}>{target ? <Joyride run stepIndex={index} steps={Array.from({ length: index + 1 }, () => ({ target, spotlightTarget: spotlightTarget ?? target, content: '', placement: 'bottom' as const }))}
    portalElement={portal} tooltipComponent={Tooltip} styles={{ spotlight: { stroke: '#7DD3FC', strokeWidth: 4, vectorEffect: 'non-scaling-stroke', style: { pointerEvents: 'none', filter: 'drop-shadow(0 0 6px rgba(56,189,248,0.85))' } } }} onEvent={event => {
      if (event.type === EVENTS.ERROR || event.type === EVENTS.TARGET_NOT_FOUND) { if (callbacks.current.fail) callbacks.current.fail(index); else callbacks.current.exit(); }
    }} options={{ skipBeacon: true, blockTargetInteraction: !interactive,
      disableFocusTrap: true, dismissKeyAction: false, overlayClickAction: false, skipScroll: true,
      overlayColor: 'rgba(2,6,23,0.82)', spotlightPadding: 8, spotlightRadius: 12, zIndex: 250, scrollDuration: motion ? 150 : 0 }}
    floatingOptions={{ strategy: 'fixed', hideArrow: true, flipOptions: { fallbackPlacements: ['left','right','top'] }, shiftOptions: { boundary: [], rootBoundary: 'viewport', crossAxis: true, padding: 16 },
      middleware: [{ name: 'guideBounds', fn: ({ rects }) => rects.reference.width > innerWidth * 0.65 && rects.reference.height > innerHeight * 0.5
        ? { x: Math.max(16, innerWidth - rects.floating.width - 16), y: Math.max(16, innerHeight - rects.floating.height - 16) } : {} }] }} />
    : <div className={centered ? 'fixed inset-0 z-[250] flex items-center justify-center bg-slate-950/80 p-4' : ''}>
      <div ref={surface} data-guide-card role={centered ? 'dialog' : 'region'} aria-modal={centered || undefined} aria-label={t('guide.title')} className={`${centered ? 'w-[min(680px,calc(100vw-32px))] max-h-[calc(100vh-32px)] overflow-y-auto' : 'fixed bottom-4 right-4 z-[250] w-[min(320px,calc(100vw-32px))]'} ${guideCardClass}`}
        onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>{children}</div>
    </div>}</GuideContent.Provider>, portal);
}
