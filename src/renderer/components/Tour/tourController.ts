import { useStore } from '../../state/useStore';
import { useSttStore } from '../../state/useSttStore';
import { useTourStore, type TourEntry } from '../../state/useTourStore';
import { IS_PROJECTOR_MODE } from '../../constants';
import { tourBlockReason, type BlockReason } from './tourPolicy';
import { recordTourEnd, recordPage, readTourState, disablePageSuggestions } from './tourStorage';
import { TOUR_MAP, type TourPage } from './tourDefinition';
import { isGuideActive } from './guideBoundary';

type Tab = ReturnType<typeof useStore.getState>['activeTab'];
type Session = { id: number; abort: AbortController; previousTab: Tab; ownedTab: Tab; focus: HTMLElement | null };
let session: Session | undefined;
let nextId = 0;
let automaticSuppressed = false;
let standaloneDisabled = false;
export function disableStandaloneHelp() { standaloneDisabled = true; suppressAutomaticTour(); }
const anchors = new Map<string, HTMLElement>();
export function registerTourAnchor(id: string, element: HTMLElement | null) {
  if (element) anchors.set(id, element); else anchors.delete(id);
}
export function getTourAnchor(id: string) { return anchors.get(id) ?? null; }
export function isHelpActive() { return isGuideActive() || useTourStore.getState().phase !== 'idle'; }
export function isSpotlightActive() { return ['loading', 'running'].includes(useTourStore.getState().phase); }
export function suppressAutomaticTour() { automaticSuppressed = true; }
export function canAutoInvite() { return !automaticSuppressed && !IS_PROJECTOR_MODE && !isHelpActive() && !getTourBlockReason(); }
export function getTourBlockReason(page?: TourPage): BlockReason | null {
  const s = useStore.getState();
  const stt = useSttStore.getState();
  const ready = useTourStore.getState().ready;
  return tourBlockReason({
    ready: ['outputs', 'stt', 'share', 'screenShare'].every(key => ready[key]),
    output: s.isProjectorWindowOpen || Object.values(s.outputAssignments).some(output => output.isOpen),
    session: s.shareActive || s.screenShareActive || stt.micActive || stt.status !== 'idle',
    editor: page !== s.activeTab && (s.activeTab === 'editor' || s.editorDirty),
    modal: s.isCheatsheetOpen || s.isPrepCheckOpen || s.isUpdatesOpen || s.isRemoteOpen || s.isLiveShareOpen || s.drivePanelOpen ||
      !!document.querySelector('[role="dialog"]:not([data-tour-surface]), [role="alertdialog"]:not([data-tour-surface])'),
    interaction: !!s.draggedSlideId || !!s.activeColorPicker || s.panels.styles ||
      !!document.querySelector('[data-editor-popover] [aria-expanded="true"], [data-editor-interacting="true"], [data-editor-pointer-active="true"]'),
  });
}
function begin(entry: TourEntry) {
  if (entry !== 'automatic') suppressAutomaticTour();
  if (session) return;
  const tab = useStore.getState().activeTab;
  session = { id: ++nextId, abort: new AbortController(), previousTab: tab, ownedTab: tab, focus: document.activeElement as HTMLElement | null };
  useTourStore.setState({ sessionId: session.id, entry, error: null, waiting: false, kind: 'compact', page: null, suggestion: null });
}
export function requestMap(entry: TourEntry) {
  if (standaloneDisabled || IS_PROJECTOR_MODE || isHelpActive()) return;
  begin(entry);
  useTourStore.setState({ phase: 'map' });
}
export function requestWelcome() {
  if (!canAutoInvite()) return false;
  begin('automatic');
  useTourStore.setState({ phase: 'welcome' });
  return true;
}
export function showMap() { useTourStore.setState({ phase: 'map' }); }
export function requestTour(entry: TourEntry): { ok: true } | { ok: false; reason: BlockReason } {
  if (standaloneDisabled || IS_PROJECTOR_MODE || isSpotlightActive()) return { ok: false, reason: 'not-ready' };
  const reason = getTourBlockReason();
  if (reason) { useTourStore.setState({ error: `tour.blocked.${reason}` }); return { ok: false, reason }; }
  begin(entry);
  useTourStore.setState({ phase: 'loading', error: null, kind: 'compact', page: null, suggestion: null });
  return { ok: true };
}
export function markMotorReady(id: number) {
  if (!session || session.id !== id) return;
  const reason = getTourBlockReason(useTourStore.getState().page ?? undefined);
  if (reason) return finishTour('interrupted');
  useTourStore.setState({ phase: 'running' });
}
export function finishTour(reason: 'completed' | 'dismissed' | 'interrupted' | 'failed') {
  const ending = session;
  if (!ending) return;
  session = undefined;
  ending.abort.abort();
  const s = useStore.getState();
  if (s.activeTab === ending.ownedTab && s.activeTab !== ending.previousTab) s.setActiveTab(ending.previousTab);
  const tour = useTourStore.getState();
  if (tour.kind === 'page' && tour.page) {
    if (reason === 'completed') recordPage(tour.page, 'completed');
  } else if (reason === 'completed' || reason === 'dismissed') recordTourEnd(reason);
  useTourStore.setState(s => ({ phase: 'idle', waiting: false, error: reason === 'failed' ? 'tour.failed' : null, storageRevision: s.storageRevision + 1 }));
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (isHelpActive() || document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
    const old = ending.focus;
    if (old && old !== document.body && old !== document.documentElement && old.isConnected && old.getClientRects().length && !old.closest('[inert]')) old.focus();
    else document.querySelector<HTMLElement>('nav [aria-current="page"]')?.focus();
  }));
}
export async function prepareTourStep(id: number, targetId: string, tab?: Tab) {
  const current = session;
  if (!current || current.id !== id) throw new Error('Cancelled tour');
  if (tab) { current.ownedTab = tab; useStore.getState().setActiveTab(tab); }
  const started = performance.now();
  useTourStore.setState({ waiting: false });
  await new Promise<void>((resolve, reject) => {
    let frame = 0;
    const cleanup = () => { cancelAnimationFrame(frame); current.abort.signal.removeEventListener('abort', cancel); };
    const cancel = () => { cleanup(); reject(new Error('Cancelled tour')); };
    current.abort.signal.addEventListener('abort', cancel, { once: true });
    const check = () => {
      if (session !== current || current.abort.signal.aborted) return cancel();
      const elapsed = performance.now() - started;
      const target = anchors.get(targetId);
      if (target?.isConnected && target.getClientRects().length && target.getBoundingClientRect().width > 0 &&
        target.getBoundingClientRect().height > 0 && (!tab || useStore.getState().activeTab === tab)) {
        cleanup(); useTourStore.setState({ waiting: false }); resolve(); return;
      }
      if (elapsed >= 10000) { cleanup(); reject(new Error(`Missing tour anchor: ${targetId}`)); return; }
      if (elapsed >= 5000 && !useTourStore.getState().waiting) useTourStore.setState({ waiting: true });
      frame = requestAnimationFrame(check);
    };
    frame = requestAnimationFrame(check);
  });
}
/** Registered once by TourHost; no state rollback on external actions. */
export function watchTourSafety() {
  const inspect = () => {
    const suggestion = useTourStore.getState().suggestion;
    if (suggestion && (useStore.getState().activeTab !== suggestion || getTourBlockReason(suggestion))) useTourStore.setState({ suggestion: null });
    if (!isSpotlightActive()) return;
    if (getTourBlockReason(useTourStore.getState().page ?? undefined) || (session && useStore.getState().activeTab !== session.ownedTab)) finishTour('interrupted');
  };
  const offApp = useStore.subscribe(inspect);
  const offStt = useSttStore.subscribe(inspect);
  return () => { offApp(); offStt(); };
}

export function requestPageIntro(page: TourPage, entry: TourEntry) {
  if (standaloneDisabled || IS_PROJECTOR_MODE || isSpotlightActive()) return;
  const reason = getTourBlockReason(page);
  if (reason) { useTourStore.setState({ error: 'tour.blocked.' + reason }); return; }
  begin(entry);
  if (!session) return;
  // A map choice is explicit navigation; stay on the chosen page after the intro.
  session.previousTab = page;
  session.ownedTab = page;
  useTourStore.setState({ kind: 'page', page, suggestion: null });
  useStore.getState().setActiveTab(page);
  useTourStore.setState({ phase: 'loading', error: null });
}
export function notifyPageVisit(page: string) {
  useTourStore.setState({ suggestion: null });
  if (!TOUR_MAP.some(item => item.id === page) || !useTourStore.getState().profileInitialized || !useTourStore.getState().profileKnown || isHelpActive()) return;
  const id = page as TourPage;
  const stored = readTourState();
  if (!stored.pageSuggestions.eligible || !stored.pageSuggestions.enabled || stored.pages[id]?.suggested || getTourBlockReason(id)) return;
  useTourStore.setState({ suggestion: id });
}
export function turnOffPageSuggestions() {
  disablePageSuggestions();
  useTourStore.setState(s => ({ suggestion: null, storageRevision: s.storageRevision + 1 }));
}
