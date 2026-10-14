import { useLayoutEffect, type ReactNode } from 'react';
import { finishTour } from './tourController';

export default function TourInteractionBoundary({ children }: { children: ReactNode }) {
  useLayoutEffect(() => {
    const shell = document.querySelector<HTMLElement>('[data-app-shell]');
    if (!shell) return;
    const previous = shell.inert;
    shell.inert = true;
    return () => { shell.inert = previous; };
  }, []);
  return <div data-tour-surface onKeyDown={e => e.stopPropagation()} onKeyUp={e => e.stopPropagation()}
    onPointerDown={e => e.stopPropagation()} onPointerUp={e => e.stopPropagation()}
    onMouseDown={e => e.stopPropagation()} onClick={e => {
      e.stopPropagation();
      if ((e.target as Element).closest('.react-joyride__overlay')) finishTour('dismissed');
    }} onDoubleClick={e => e.stopPropagation()}>
    {children}
  </div>;
}
