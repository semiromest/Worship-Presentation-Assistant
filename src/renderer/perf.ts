/**
 * Renderer performance instrumentation (Phase 0).
 *
 * - Times every zustand setState call (includes reducer work like computePatch).
 * - Observes long tasks (>50ms main-thread blocks).
 * - Exposes window.__perf to read snapshots from DevTools:
 *     await window.__perf.all()      // renderer + preload + main merged
 *     window.__perf.snapshot()       // renderer only
 *     window.__perf.reset()          // reset all buffers
 *
 * Production builds pay zero overhead (perf buffers are disabled).
 */

import { PerfBuffer, defaultPerfEnabled, type PerfSnapshot, type MainPerfSnapshot } from '../shared/perf';

// NOTE: this module must NOT import useStore — useStore → utils → perf would
// form a circular import. The store is passed in from main.tsx instead.

interface PerfStoreLike {
  setState: (...args: any[]) => void;
}

export const rendererPerf = new PerfBuffer('renderer');
rendererPerf.enabled = defaultPerfEnabled();

export function initRendererPerf(store: PerfStoreLike): void {
  if (!rendererPerf.enabled) {
    (window as unknown as Record<string, unknown>).__perf = {
      enabled: false,
      snapshot: () => null,
      all: async () => null,
      reset: () => false,
    };
    return;
  }

  // Store update timing (dispatchUndo, setLiveIndex, ... — includes reducer).
  const origSetState = store.setState.bind(store);
  store.setState = (...args: any[]) => {
    const t0 = performance.now();
    try {
      return origSetState(...args);
    } finally {
      const partial = args[0];
      const label =
        partial && typeof partial === 'object' && !Array.isArray(partial)
          ? Object.keys(partial).slice(0, 4).join(',') || 'set'
          : 'set';
      rendererPerf.push({ kind: 'store-set', label, ms: performance.now() - t0, bytes: 0, t: Date.now() });
    }
  };

  // Long tasks (>50ms renderer main-thread blocks).
  if (typeof PerformanceObserver !== 'undefined') {
    try {
      const obs = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          rendererPerf.push({ kind: 'longtask', label: 'renderer', ms: entry.duration, bytes: 0, t: Date.now() });
        }
      });
      obs.observe({ entryTypes: ['longtask'] });
    } catch {
      /* not supported */
    }
  }

  // Startup marker: time from process start to first script evaluation.
  rendererPerf.push({ kind: 'startup', label: 'renderer-init', ms: performance.now(), bytes: 0, t: Date.now() });

  const all = async (): Promise<{ renderer: PerfSnapshot; preload: PerfSnapshot | null; main: MainPerfSnapshot | null }> => ({
    renderer: rendererPerf.snapshot(),
    preload: window.electronAPI?.getPreloadPerfSnapshot?.() ?? null,
    main: await window.electronAPI?.getMainPerfSnapshot?.() ?? null,
  });

  (window as unknown as Record<string, unknown>).__perf = {
    enabled: true,
    snapshot: () => rendererPerf.snapshot(),
    all,
    reset: async () => {
      rendererPerf.reset();
      window.electronAPI?.resetPerf?.();
      await window.electronAPI?.resetMainPerf?.();
      return true;
    },
  };
}
