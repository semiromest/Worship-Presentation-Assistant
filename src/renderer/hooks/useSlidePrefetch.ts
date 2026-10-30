import { useEffect, type RefObject } from 'react';
import type { Slide, SlideItem } from '../types';
import { canResizePreview, imagePreviewSources } from '../imagePreviewSource';
import { notePreviewScroll, stopPreviewScroll } from '../scrollPreviewPolicy';

function sources(slide: Slide): string[] {
  const result = new Set<string>();
  if (slide.type === 'image' && slide.mediaUrl) result.add(slide.mediaUrl);
  if (slide.styles?.backgroundImage) result.add(slide.styles.backgroundImage);
  const visit = (items?: SlideItem[]) => items?.forEach(item => {
    if (item.visible === false) return;
    if (item.type === 'image' && item.mediaUrl) result.add(item.mediaUrl);
    visit(item.groupItems);
  });
  visit(slide.items);
  const first = slide.loopItems?.[0];
  if (first?.type === 'image') result.add(first.mediaUrl);
  return [...result].filter(canResizePreview);
}

/** Prefetch file thumbnails, not invisible DOM nodes or decoded originals. */
export function useSlidePrefetch(root: RefObject<HTMLElement>, slides: Slide[], columns: number, broadcasting: boolean) {
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const indices = new Map(slides.map((slide, i) => [slide.id, i]));
    let top = element.scrollTop, time = performance.now(), direction = 0, epoch = 0, alive = true;
    let scheduled: ReturnType<typeof setTimeout> | undefined;
    const prepare = () => {
      scheduled = undefined;
      if (!alive || !direction || document.visibilityState !== 'visible') return;
      const ticket = ++epoch;
      const box = element.getBoundingClientRect();
      // Two hit tests avoid a rect scan across all mounted/overscan cards.
      const x = box.left + Math.min(100, box.width / 2);
      const y = direction > 0 ? Math.min(innerHeight, box.bottom) - 32 : Math.max(0, box.top) + 32;
      const card = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-slide-id]');
      const center = document.elementFromPoint(x, Math.max(0, box.top) + Math.min(box.height / 2, 300))?.closest<HTMLElement>('[data-slide-id]');
      const index = indices.get((card ?? center)?.dataset.slideId ?? '');
      if (index === undefined) return;
      let requested = 0;
      const count = columns * (broadcasting ? 1 : 2);
      for (let step = 1; step <= count; step++) {
        const slide = slides[index + direction * step];
        if (!slide) continue;
        for (const source of sources(slide)) {
          if (++requested > 32) return;
          void imagePreviewSources.request(source, 256, () => alive && epoch === ticket, 2);
        }
      }
    };
    const scroll = () => {
      const nextTop = element.scrollTop, nextTime = performance.now();
      if (nextTop === top) return;
      const nextDirection = Math.sign(nextTop - top);
      if (direction !== nextDirection) epoch++;
      direction = nextDirection;
      notePreviewScroll((nextTop - top) / Math.max(1, nextTime - time));
      top = nextTop; time = nextTime;
      if (!scheduled) scheduled = setTimeout(prepare, 40);
    };
    element.addEventListener('scroll', scroll, { passive: true });
    return () => { alive = false; epoch++; clearTimeout(scheduled); stopPreviewScroll(); element.removeEventListener('scroll', scroll); };
  }, [root, slides, columns, broadcasting]);
}
