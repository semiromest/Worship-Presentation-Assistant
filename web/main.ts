// Entry point of the web app: install the browser bridge, make sure the media
// service worker controls this page, then start the unchanged desktop renderer
// (control UI, or the projector view when opened with `?mode=projector`).
import './bridge';
import { IS_OUTPUT } from './bridge/projector';
import { installWebGuards } from './guards';

async function ensureMediaWorker(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  try {
    await navigator.serviceWorker.register('./sw.js');
    await navigator.serviceWorker.ready;
    if (navigator.serviceWorker.controller) return;
    // clients.claim() in the worker hands this page over; wait briefly for it.
    await new Promise<void>(resolve => {
      const timer = setTimeout(resolve, 3000);
      navigator.serviceWorker.addEventListener('controllerchange', () => { clearTimeout(timer); resolve(); }, { once: true });
    });
  } catch (error) {
    console.warn('[web] media service worker unavailable; stored media will not load', error);
  }
}

await ensureMediaWorker();
if (!IS_OUTPUT) installWebGuards();
await import('../src/renderer/main');
