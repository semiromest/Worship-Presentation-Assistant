import { finishTour, isHelpActive, isSpotlightActive, suppressAutomaticTour } from './tourController';
import { dismissGuide, guideAllows, guideKey, isGuideActive } from './guideBoundary';

let installed = false;
/** Install before React mounts: application shortcuts must not use window capture. */
export function installTourEventBoundary() {
  if (installed) return;
  installed = true;
  const inside = (event: Event) => event.composedPath().some(node => node instanceof HTMLElement && node.hasAttribute('data-tour-surface'));
  window.addEventListener('keydown', event => {
    if (event.key === 'Escape' && dismissGuide()) { event.preventDefault(); event.stopImmediatePropagation(); return; }
    if (guideKey(event)) return;
    if (!isHelpActive()) { suppressAutomaticTour(); return; }
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopImmediatePropagation(); finishTour('dismissed'); return;
    }
    if (!inside(event)) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, true);
  window.addEventListener('keyup', event => {
    if (isGuideActive()) { if (!guideAllows(event)) { event.preventDefault(); event.stopImmediatePropagation(); } return; }
    if (isHelpActive() && !inside(event)) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, true);
  window.addEventListener('pointerdown', event => {
    if (isGuideActive()) { if (!guideAllows(event)) { event.preventDefault(); event.stopImmediatePropagation(); } return; }
    if (!isHelpActive()) suppressAutomaticTour();
    else if (isSpotlightActive() && !inside(event)) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, true);
}
