import React, { Profiler } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import './i18n';
import { initRendererPerf, rendererPerf } from './perf';
import { useStore } from './state/useStore';

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

const app = rendererPerf.enabled ? (
  <Profiler id="App" onRender={onRenderCallback}>
    <App />
  </Profiler>
) : (
  <App />
);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>{app}</React.StrictMode>
);
