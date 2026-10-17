import { useLayoutEffect, useRef, type RefObject } from 'react';
import { animate } from 'motion/mini';
import { uiMotion } from '../uiMotion';
import { useUiMotionEnabled } from './useUiMotionEnabled';

type Frame = { left: number; top: number; width: number; height: number; label: string; group?: string };

/** Animate committed list mutations, never virtual mounts, filtering or scrolling.
 * Only lightweight shells survive deletion; media is unmounted immediately.
 */
export function useListMotion(
  root: RefObject<HTMLElement>,
  ids: readonly string[],
  scope: string,
  kind: string,
  view = '',
) {
  const enabled = useUiMotionEnabled();
  const previous = useRef<{ scope: string; view: string; ids: readonly string[]; frames: Map<string, Frame>; scroll: number }>();
  const stop = useRef<(() => void)[]>([]);
  const capture = useRef<() => void>(() => {});

  useLayoutEffect(() => {
    const container = root.current;
    if (!container) return;
    const selector = `[data-motion-item="${kind}"]`;
    const nodes = () => [...container.querySelectorAll<HTMLElement>(selector)];
    const visible = (elements: HTMLElement[]) => {
      const bounds = container.getBoundingClientRect();
      const top = Math.max(0, bounds.top), bottom = Math.min(innerHeight, bounds.bottom);
      if (!container.getClientRects().length) return [];
      return elements.filter(element => {
        const box = element.getBoundingClientRect();
        return box.width > 0 && box.height > 0 && box.bottom > top && box.top < bottom;
      });
    };
    const measure = () => new Map(visible(nodes()).map(element => {
      const { left, top, width, height } = element.getBoundingClientRect();
      return [element.dataset.motionId!, { left, top, width, height,
        group: element.parentElement?.closest<HTMLElement>('[data-motion-item="section"]')?.dataset.motionId,
        label: element.querySelector('[aria-label]')?.getAttribute('aria-label') ?? element.textContent?.trim().slice(0, 100) ?? '',
      }] as const;
    }));
    const clear = () => { stop.current.forEach(cancel => cancel()); stop.current = []; };
    const old = previous.current;
    const changed = old && old.ids !== ids && (old.ids.length !== ids.length || old.ids.some((id, index) => id !== ids[index]));
    const sameView = old?.scope === scope && old.view === view;
    if (!enabled || !sameView) clear();
    if (enabled && sameView && changed) {
      clear();
      const before = new Set(old.ids), after = new Set(ids);
      const frames = measure();
      let count = 0;
      const candidates = visible(nodes()).sort((a, b) => Number(before.has(a.dataset.motionId!)) - Number(before.has(b.dataset.motionId!)));
      for (const element of candidates) {
        const parent = element.parentElement?.closest<HTMLElement>('[data-motion-item]');
        if (parent?.classList.contains('ui-item-moving') || parent?.classList.contains('ui-item-added')) continue;
        const id = element.dataset.motionId!;
        const prior = old.frames.get(id), current = frames.get(id)!;
        if (count >= uiMotion.maxListItems) break;
        const added = !before.has(id);
        const dx = prior ? prior.left - current.left : 0;
        const dy = prior ? prior.top - current.top : 0;
        // A viewport scroll/resize must not masquerade as a reorder.
        const moved = prior && old.scroll === container.scrollTop && Math.abs(prior.width - current.width) < 1 && (Math.abs(dx) > 1 || Math.abs(dy) > 1);
        if (!added && !moved) continue;
        const original = { transform: element.style.transform, opacity: element.style.opacity };
        const finalTransform = original.transform || 'none';
        const playback = animate(element, added
          ? { opacity: [0, 1], transform: [`translateY(${uiMotion.distance}px)`, finalTransform] }
          : { transform: [`translate(${dx}px, ${dy}px)`, finalTransform] }, {
          duration: added ? uiMotion.duration.fast : uiMotion.duration.standard,
          delay: added ? count * uiMotion.stagger : 0,
          ease: uiMotion.ease,
        });
        element.classList.toggle('ui-item-added', added);
        element.classList.toggle('ui-item-moving', !added);
        const reset = () => { element.style.transform = original.transform; element.style.opacity = original.opacity; element.classList.remove('ui-item-added', 'ui-item-moving'); };
        let cancelled = false;
        const cancel = () => { cancelled = true; playback.cancel(); reset(); };
        stop.current.push(cancel);
        void Promise.resolve(playback).then(() => { if (!cancelled) reset(); stop.current = stop.current.filter(entry => entry !== cancel); });
        count++;
      }
      let removed = 0;
      if (old.scroll === container.scrollTop) for (const [id, frame] of old.frames) {
        if (after.has(id) || removed >= uiMotion.maxListItems) continue;
        if (kind === 'slide' && frame.group && !container.querySelector(`[data-motion-item="section"][data-motion-id="${CSS.escape(frame.group)}"]`)) continue;
        const shell = document.createElement('div');
        shell.className = 'ui-removal-shell';
        shell.setAttribute('aria-hidden', 'true');
        shell.inert = true;
        shell.textContent = frame.label;
        Object.assign(shell.style, { left: `${frame.left}px`, top: `${frame.top}px`, width: `${frame.width}px`, height: `${frame.height}px` });
        container.closest('[data-app-shell]')?.append(shell);
        const playback = animate(shell, { opacity: [0.65, 0], transform: ['scale(1)', 'scale(0.98)'] }, { duration: uiMotion.duration.fast, ease: uiMotion.ease });
        const cancel = () => { playback.cancel(); shell.remove(); };
        stop.current.push(cancel);
        void Promise.resolve(playback).then(() => { shell.remove(); stop.current = stop.current.filter(entry => entry !== cancel); });
        removed++;
      }
      // Store final layout, not an in-flight transform, for the next mutation.
      previous.current = { scope, view, ids, frames, scroll: container.scrollTop };
    } else if (!old || !sameView || !enabled || changed) {
      previous.current = { scope, view, ids, frames: enabled ? measure() : new Map(), scroll: container.scrollTop };
    }
    capture.current = () => {
      if (!enabled || !previous.current || stop.current.length) return;
      previous.current.frames = measure();
      previous.current.scroll = container.scrollTop;
    };
  });

  useLayoutEffect(() => {
    const container = root.current;
    if (!container || !enabled) return;
    let frame = 0;
    const beforeAction = () => capture.current();
    const onScroll = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(beforeAction); };
    container.addEventListener('pointerdown', beforeAction, true);
    const beforeKey = (event: KeyboardEvent) => { if ((event.target as HTMLElement)?.closest?.('input, textarea, select, [contenteditable=true]')) return; if (event.key === 'Delete' || event.key === 'Backspace' || ((event.ctrlKey || event.metaKey) && ['z', 'y', 'd'].includes(event.key.toLowerCase()))) beforeAction(); };
    container.addEventListener('keydown', beforeKey, true);
    container.addEventListener('drop', beforeAction, true);
    container.addEventListener('scroll', onScroll, { passive: true, capture: true });
    const parentScroll = container.parentElement?.closest('[data-guide-scroll]');
    parentScroll?.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      container.removeEventListener('pointerdown', beforeAction, true);
      container.removeEventListener('keydown', beforeKey, true);
      container.removeEventListener('drop', beforeAction, true);
      container.removeEventListener('scroll', onScroll, true);
      parentScroll?.removeEventListener('scroll', onScroll);
      stop.current.forEach(cancel => cancel()); stop.current = [];
    };
  }, [root, enabled]);
}
