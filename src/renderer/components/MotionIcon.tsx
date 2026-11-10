import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useUiMotionEnabled } from '../hooks/useUiMotionEnabled';
import audio from '../assets/gentleface/audio-lines.svg?raw';
import mic from '../assets/gentleface/mic.svg?raw';
import broadcast from '../assets/gentleface/broadcast.svg?raw';
import scissors from '../assets/gentleface/scissors.svg?raw';
import check from '../assets/gentleface/check-circle.svg?raw';
import loader from '../assets/gentleface/loader.svg?raw';
import sync from '../assets/gentleface/sync.svg?raw';
import images from '../assets/gentleface/images.svg?raw';
import projector from '../assets/gentleface/projector.svg?raw';
import timer from '../assets/gentleface/timer-countdown.svg?raw';
import license from '../assets/gentleface/LICENSE.txt?raw';

// Original Gentleface line-round SVGs, MIT; see assets/gentleface/LICENSE.txt.
const icons = {
  'audio-lines': [audio, .2, 2.45], mic: [mic, .3, 2.2], broadcast: [broadcast, .3, 2.4],
  scissors: [scissors, .25, 1.4], 'check-circle': [check, .2, 1.75], loader: [loader, .3, 2.2],
  sync: [sync, .25, 2], images: [images, .3, 2.2], projector: [projector, .25, 3],
  'timer-countdown': [timer, .25, 2.85],
} as const;

export default function MotionIcon({ name, active = false, loop = false, eventKey, size = 16, className = '' }: {
  name: keyof typeof icons;
  active?: boolean;
  loop?: boolean;
  eventKey?: string | number | null;
  size?: number;
  className?: string;
}) {
  const host = useRef<HTMLSpanElement>(null);
  const prefix = useId().replace(/[^a-zA-Z0-9]/g, '');
  const enabled = useUiMotionEnabled();
  const [visible, setVisible] = useState(false);
  const [pageVisible, setPageVisible] = useState(() => !document.hidden);
  const [source, start, end] = icons[name];
  const html = useMemo(() => ({ __html: `<!-- ${license} -->` + source
    .replace(/\bid="([^"]+)"/g, `id="${prefix}-$1"`)
    .replace(/url\(#([^)]+)\)/g, `url(#${prefix}-$1)`)
    .replace(/width="16" height="16"/, 'width="100%" height="100%"') }), [source, prefix]);
  const event = useMemo(() => ({}), [name, active, eventKey]);
  const played = useRef<object | null>(null);

  useLayoutEffect(() => {
    const svg = host.current?.querySelector('svg');
    svg?.pauseAnimations(); svg?.setCurrentTime(0);
  }, [html]);

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting));
    observer.observe(element);
    const visibility = () => setPageVisible(!document.hidden);
    document.addEventListener('visibilitychange', visibility);
    return () => { observer.disconnect(); document.removeEventListener('visibilitychange', visibility); };
  }, []);

  useEffect(() => {
    const svg = host.current?.querySelector('svg');
    if (!svg) return;
    const stop = () => { svg.pauseAnimations(); svg.setCurrentTime(0); };
    stop();
    if (!enabled || !active || !visible || !pageVisible || (!loop && played.current === event)) return;
    played.current = event;
    svg.setCurrentTime(loop ? 0 : start);
    svg.unpauseAnimations();
    const timeout = loop ? undefined : window.setTimeout(stop, (end - start) * 1000);
    return () => { window.clearTimeout(timeout); stop(); };
  }, [enabled, active, visible, pageVisible, loop, event, start, end, html]);

  // Only checked-in SVG markup is used here. No runtime downloads or user HTML.
  return <span ref={host} aria-hidden="true" data-motion-icon={name}
    className={`inline-flex shrink-0 align-middle ${className}`} style={{ width: size, height: size }}
    dangerouslySetInnerHTML={html} />;
}
