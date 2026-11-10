import React from 'react';
import { createRoot } from 'react-dom/client';
import ProjectorApp from './ProjectorApp';
import UiMotionProvider from './components/UiMotionProvider';
import i18n from './i18n';
import { initRendererPerf } from './perf';
import { useStore } from './state/useStore';
import { useTourStore } from './state/useTourStore';

initRendererPerf(useStore);
if (import.meta.env.DEV && import.meta.env.VITE_TOUR_E2E === '1') {
  Object.assign(window, {
    __tourTest: {
      tour: useTourStore,
      language: (lang: string) => i18n.changeLanguage(lang),
    },
  });
}
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <UiMotionProvider><ProjectorApp /></UiMotionProvider>
  </React.StrictMode>
);
