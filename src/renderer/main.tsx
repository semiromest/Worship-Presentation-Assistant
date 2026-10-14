import { PracticeFrame } from './components/PracticePanel';
import React, { Profiler } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { useTourStore } from './state/useTourStore';
import i18n from './i18n';
import { installTourEventBoundary } from './components/Tour/tourEvents';
installTourEventBoundary();
import './index.css';
import './i18n';
import { initRendererPerf, rendererPerf } from './perf';
import { useStore } from './state/useStore';
import UiMotionProvider from './components/UiMotionProvider';

// Phase 0: renderer instrumentation (store timing, long tasks, window.__perf).
initRendererPerf(useStore);

function onRenderCallback(
  id: string,
  _phase: 'mount' | 'update' | 'nested-update',
  actualDuration: number,
  _baseDuration: number,
  _startTime: number,
  commitTime: number,
): void {
  // Only record commits that cost real time — keeps the buffer clean.
  if (actualDuration > 1) {
    rendererPerf.push({ kind: 'react-commit', label: id, ms: actualDuration, bytes: 0, t: commitTime });
  }
}

// Development-only seam for real Electron tests. Never included in release builds.
if (import.meta.env.DEV && import.meta.env.VITE_TOUR_E2E === '1') {
  Object.assign(window, { __tourTest: {
    tour: useTourStore,
    language: (lang: string) => i18n.changeLanguage(lang),
    snapshot: () => {
      const s = useStore.getState();
      return JSON.stringify({ presentation: s.presentation, undo: s.undoState, selected: s.selectedSlideId,
        selectedIds: [...s.selectedSlideIds], live: s.liveIndex, blackout: s.isBlackout,
        muted: s.isMediaMuted, outputs: s.outputAssignments, zoom: s.slideZoom, tab: s.activeTab });
    },
    output: () => ({ fullPresentation: useStore.getState().presentation, liveIndex: 0 }),
  } });
}
const app = rendererPerf.enabled ? (
  <Profiler id="App" onRender={onRenderCallback}>
    <UiMotionProvider><App /></UiMotionProvider>
  </Profiler>
) : (
  <UiMotionProvider><App /></UiMotionProvider>
);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><PracticeFrame>{app}</PracticeFrame></React.StrictMode>
);
