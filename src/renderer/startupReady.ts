import { rendererPerf } from './perf';
const phases = new Set<string>();
export function startupReady(phase: 'shell' | 'document' | 'desktop'): void {
  if (phases.has(phase)) return;
  phases.add(phase);
  performance.mark('presenter:' + phase);
  rendererPerf.push({ kind: 'startup', label: phase, ms: performance.now(), bytes: 0, t: Date.now() });
  if (['shell', 'document', 'desktop'].every(value => phases.has(value))) {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      document.documentElement.dataset.controlReady = 'true';
      performance.mark('presenter:control-ready');
    }));
  }
}
