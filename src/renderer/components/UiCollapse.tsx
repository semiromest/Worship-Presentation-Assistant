import { useLayoutEffect, useRef, type ReactNode } from 'react';
import * as m from 'motion/react-m';
import { useUiMotionEnabled } from '../hooks/useUiMotionEnabled';
import { uiMotion } from '../uiMotion';

/** Release children immediately on close; a height-only shim animates the gap. */
export default function UiCollapse({ open, children, className }: { open: boolean; children: ReactNode; className?: string }) {
  const enabled = useUiMotionEnabled();
  const content = useRef<HTMLDivElement>(null);
  const height = useRef(0);
  const root = useRef<HTMLDivElement>(null);
  const lastOpen = useRef(open);
  const inViewport = useRef(true);
  // Only inspect layout on an explicit toggle; offscreen sections snap instantly.
  if (lastOpen.current !== open) {
    const box = root.current?.getBoundingClientRect();
    inViewport.current = !!box && box.bottom >= 0 && box.top <= innerHeight;
    lastOpen.current = open;
  }
  const animated = enabled && inViewport.current;
  useLayoutEffect(() => {
    const element = content.current;
    if (!open || !element) return;
    const measure = () => { height.current = element.getBoundingClientRect().height; };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [open]);
  return <m.div ref={root} initial={false} animate={{ height: open ? 'auto' : 0, opacity: open ? 1 : 0 }}
    transition={{ duration: animated ? uiMotion.duration.standard : 0, ease: uiMotion.ease }}
    aria-hidden={!open} className={open ? 'overflow-visible' : 'overflow-hidden'}>
    {open ? <div ref={content} className={className}>{children}</div> : <div aria-hidden="true" style={{ height: animated ? height.current : 0 }} />}
  </m.div>;
}
