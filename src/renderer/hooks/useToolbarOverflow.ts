import { useLayoutEffect, useRef, useState } from 'react';

/** Overflow is UI-only; scrolling does not subscribe to or update the presentation. */
export function useToolbarOverflow() {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const next = { left: element.scrollLeft > 1, right: element.scrollLeft + element.clientWidth < element.scrollWidth - 1 };
      setEdges(old => old.left === next.left && old.right === next.right ? old : next);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
    const focus = (event: FocusEvent) => {
      if (!(event.target instanceof HTMLElement)) return;
      const view = element.getBoundingClientRect(), item = event.target.getBoundingClientRect();
      const left = view.left + 34, right = view.right - 34;
      if (item.left < left) element.scrollLeft += item.left - left;
      else if (item.right > right) element.scrollLeft += item.right - right;
      schedule();
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(element);
    for (const child of element.children) observer.observe(child);
    element.addEventListener('scroll', schedule, { passive: true });
    element.addEventListener('focusin', focus);
    measure();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      element.removeEventListener('scroll', schedule);
      element.removeEventListener('focusin', focus);
    };
  }, []);
  const scroll = (direction: -1 | 1) => {
    const element = ref.current;
    if (element) element.scrollLeft += direction * Math.max(160, element.clientWidth * 0.65);
  };
  return { ref, edges, scroll };
}
