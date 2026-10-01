import { useEffect, useRef, useState, type ReactNode } from 'react';

// One observer for the whole grid; offscreen slides do not mount their media,
// canvas previews, timers or resize observers. Wrappers remain navigable.
const listeners = new Map<Element, (visible: boolean) => void>();
let observer: IntersectionObserver | undefined;

export default function DeferredSectionSlide({ render }: { render: () => ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    observer ??= new IntersectionObserver(
      (entries) => {
        for (const entry of entries) listeners.get(entry.target)?.(entry.isIntersecting);
      },
      { rootMargin: '600px' }
    );
    listeners.set(element, setVisible);
    observer.observe(element);
    return () => {
      observer?.unobserve(element);
      listeners.delete(element);
      if (!listeners.size) {
        observer?.disconnect();
        observer = undefined;
      }
    };
  }, []);
  return (
    <div ref={ref} className="aspect-video rounded-xl bg-black/30">
      {visible ? render() : null}
    </div>
  );
}
