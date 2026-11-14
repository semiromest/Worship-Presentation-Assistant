import { useLayoutEffect, useRef, useState } from 'react';

/** Tracks the 16:9 slide box inside a letterboxed parent, like LivePreview does. */
export function useSlideBox() {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (!w || !h) return;
      const width = w / h > 16 / 9 ? h * 16 / 9 : w;
      setBox(prev => prev.width === width ? prev : { width, height: width * 9 / 16 });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, box] as const;
}
