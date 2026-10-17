import type { Presentation } from './types';
import type { SlideReadinessResult } from '../shared/readiness';
import type { PreparationStatus } from './state/usePreparationStore';
import { preparationInputKey } from './preparationCheck';

interface Report {
  status: PreparationStatus;
  results: SlideReadinessResult[];
}
type Check = (slides: Presentation['slides'], cancelled: () => boolean) => Promise<SlideReadinessResult[] | undefined>;

/** Debounce edits and invalidate in-flight work before scheduling its replacement. */
export function createPreparationMonitor(check: Check, publish: (report: Report) => void, delay = 350) {
  let key: string | undefined;
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  return {
    update(presentation: Presentation, force = false) {
      const nextKey = preparationInputKey(presentation);
      if (stopped || (!force && key === nextKey)) return;
      key = nextKey;
      const current = ++generation;
      clearTimeout(timer);
      publish({ status: 'stale', results: [] });
      timer = setTimeout(
        async () => {
          const cancelled = () => stopped || current !== generation;
          publish({ status: 'checking', results: [] });
          try {
            const results = await check(presentation.slides, cancelled);
            if (!cancelled()) publish(results ? { status: 'complete', results } : { status: 'failed', results: [] });
          } catch {
            if (!cancelled()) publish({ status: 'failed', results: [] });
          }
        },
        force ? 0 : delay
      );
    },
    stop() {
      stopped = true;
      ++generation;
      clearTimeout(timer);
    },
  };
}
