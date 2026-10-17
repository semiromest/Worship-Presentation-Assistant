import { useLayoutEffect, useRef, type RefObject } from 'react';
import { animate } from 'motion/mini';
import { uiMotion } from '../uiMotion';
import { useUiMotionEnabled } from './useUiMotionEnabled';

/** Fade a changed view without keying/remounting its fields or media. */
export function useContentMotion(root: RefObject<HTMLElement>, identity: string) {
  const enabled = useUiMotionEnabled();
  const last = useRef(identity);
  useLayoutEffect(() => {
    const changed = last.current !== identity;
    last.current = identity;
    const element = root.current;
    if (!enabled || !changed || !element || !element.getClientRects().length) return;
    const originalOpacity = element.style.opacity;
    const playback = animate(element, { opacity: [0.35, 1] }, { duration: uiMotion.duration.fast, ease: uiMotion.ease });
    const reset = () => { element.style.opacity = originalOpacity; };
    let cancelled = false;
    void Promise.resolve(playback).then(() => { if (!cancelled) reset(); });
    return () => { cancelled = true; playback.cancel(); reset(); };
  }, [identity, enabled, root]);
}
