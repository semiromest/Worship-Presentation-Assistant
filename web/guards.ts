// Control-page behaviour specific to the web: explain desktop-only actions
// instead of silently doing nothing, and warn before leaving with unsaved work
// or an open output.
import i18n from '../src/renderer/i18n';
import { documentSession } from '../src/renderer/documentSession';
import { useStore } from '../src/renderer/state/useStore';
import { notify } from './bridge/dialogs';

/** Controls whose work needs the Electron main process. */
const DESKTOP_ONLY_SELECTORS = [
  '[data-testid="background-music-toggle"]',
  '[data-testid="slide-music-attachment"]',
].join(',');
const DESKTOP_ONLY_LABELS = ['common.remoteControl', 'common.liveShareButton', 'common.sttPanelTitle'];

export function installWebGuards(): void {
  window.addEventListener('click', event => {
    const node = event.target instanceof Element ? event.target : null;
    if (!node) return;
    const control = node.closest('button,[role="menuitem"],[role="button"]');
    const label = control?.getAttribute('aria-label') ?? control?.textContent?.trim();
    const blocked = node.closest(DESKTOP_ONLY_SELECTORS) || (label && DESKTOP_ONLY_LABELS.some(key => i18n.t(key) === label));
    if (!blocked) return;
    event.preventDefault();
    event.stopPropagation();
    void notify('unsupported');
  }, true);

  window.addEventListener('beforeunload', event => {
    const state = useStore.getState();
    const outputsOpen = state.isProjectorWindowOpen || Object.values(state.outputAssignments).some(output => output.isOpen);
    if (!documentSession.isDirty() && !outputsOpen) return;
    event.preventDefault();
    event.returnValue = '';
  });
}
