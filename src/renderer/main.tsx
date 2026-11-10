import './index.css';
import { i18nReady } from './i18n';
import { initUiFont, setUiFont } from './uiFont';

initUiFont();
// DevTools hook for comparing UI typefaces: __setUiFont('figtree' | 'inter' | 'manrope' | 'work-sans' | 'system' | 'atkinson').
(window as unknown as { __setUiFont?: typeof setUiFont }).__setUiFont = setUiFont;
// Select the role before importing control-only hooks, dialogs, practice UI or services.
// The active language loads first so module-level translations (store defaults) are localized.
const isProjector = new URLSearchParams(location.search).get('mode') === 'projector';
const entry = i18nReady.then(() => (isProjector ? import('./projectorEntry') : import('./controlEntry')));
void entry.catch(error => { console.error('Application startup failed', error); });
