import { useLayoutEffect, useRef } from 'react';
import * as m from 'motion/react-m';
import { useIsPresent, type HTMLMotionProps } from 'motion/react';
import { useUiMotionEnabled } from '../hooks/useUiMotionEnabled';
import { uiMotion } from '../uiMotion';

/** Visual presence for custom menus. Base UI popups already own their exits. */
export default function UiMenu(props: HTMLMotionProps<'div'>) {
  const enabled = useUiMotionEnabled();
  const present = useIsPresent();
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { if (ref.current) ref.current.inert = !present; }, [present]);
  return <m.div {...props} ref={ref} aria-hidden={!present || props['aria-hidden']}
    initial={enabled ? { opacity: 0, y: -uiMotion.menuDistance } : false}
    animate={{ opacity: 1, y: 0 }}
    exit={enabled ? { opacity: 0, y: -uiMotion.menuDistance } : { opacity: 0 }}
    transition={{ duration: enabled ? uiMotion.duration.fast : 0, ease: uiMotion.ease }} />;
}
