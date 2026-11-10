import React from 'react';
import { createRoot } from 'react-dom/client';
import ProjectorApp from './ProjectorApp';
import './i18n';
import { initRendererPerf } from './perf';
import { useStore } from './state/useStore';

initRendererPerf(useStore);
createRoot(document.getElementById('root')!).render(<React.StrictMode><ProjectorApp /></React.StrictMode>);
