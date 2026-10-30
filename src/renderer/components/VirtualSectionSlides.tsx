import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Slide } from '../types';
import { SECTION_GAP, sectionVirtualRows } from './sectionVirtualRows';
import { slideGridGeometry } from './slideGridGeometry';

// One scroll listener/frame and one resize observer per scrolling workspace,
// independent of its number of slides or sections.
type Hub = { listeners: Set<() => void>; dispose: () => void };
const hubs = new WeakMap<HTMLElement, Hub>();
function subscribe(scroll: HTMLElement, update: () => void) {
  let hub = hubs.get(scroll);
  if (!hub) {
    const listeners = new Set<() => void>();
    let frame = 0;
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(() => { frame = 0; listeners.forEach(listener => listener()); });
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(scroll);
    // Collapse/expand/reorder above a section changes its offset as well.
    if (scroll.firstElementChild) observer.observe(scroll.firstElementChild);
    scroll.addEventListener('scroll', schedule, { passive: true });
    hub = { listeners, dispose: () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      scroll.removeEventListener('scroll', schedule);
      hubs.delete(scroll);
    } };
    hubs.set(scroll, hub);
  }
  hub.listeners.add(update);
  return () => { hub.listeners.delete(update); if (!hub.listeners.size) hub.dispose(); };
}

export default function VirtualSectionSlides({ slides, requestedColumns, pinnedIds, children }: {
  slides: Slide[];
  requestedColumns: number;
  pinnedIds: Array<string | null>;
  children: (slide: Slide) => ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ width: 800, top: 0, bottom: 600 });
  useLayoutEffect(() => {
    const element = root.current;
    const scroll = element?.closest<HTMLElement>('[data-guide-scroll]');
    if (!element || !scroll) return;
    const update = () => {
      const box = element.getBoundingClientRect();
      const view = scroll.getBoundingClientRect();
      const next = { width: element.clientWidth, top: view.top - box.top, bottom: view.top + scroll.clientHeight - box.top };
      if (!next.width || !scroll.clientHeight) return;
      setViewport(previous => {
        if (previous.width !== next.width) return next;
        const { columns, cardWidth } = slideGridGeometry(next.width, requestedColumns);
        const before = sectionVirtualRows(slides.length, columns, previous.width, previous.top, previous.bottom, cardWidth);
        const after = sectionVirtualRows(slides.length, columns, next.width, next.top, next.bottom, cardWidth);
        return before.start === after.start && before.end === after.end ? previous : next;
      });
    };
    update();
    return subscribe(scroll, update);
  }, [requestedColumns, slides]);
  const { columns, cardWidth } = slideGridGeometry(viewport.width, requestedColumns);
  const geometry = sectionVirtualRows(slides.length, columns, viewport.width, viewport.top, viewport.bottom, cardWidth);
  const index = useMemo(() => new Map(slides.map((slide, i) => [slide.id, i])), [slides]);
  const rows = new Set(Array.from({ length: geometry.end - geometry.start }, (_, i) => geometry.start + i));
  for (const id of pinnedIds) {
    const position = id ? index.get(id) : undefined;
    if (position !== undefined) rows.add(Math.floor(position / columns));
  }
  return <div ref={root} data-section-virtual-grid style={{ position: 'relative', height: geometry.height }}>
    {[...rows].sort((a, b) => a - b).map(row => <div key={row} data-section-virtual-row style={{
      position: 'absolute', top: row * geometry.stride, left: 0, right: 0,
      display: 'grid', gap: SECTION_GAP, gridTemplateColumns: `repeat(${columns}, ${cardWidth}px)`,
    }}>{slides.slice(row * columns, (row + 1) * columns).map(children)}</div>)}
  </div>;
}
