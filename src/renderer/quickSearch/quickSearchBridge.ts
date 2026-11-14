import type { QuickSearchActions } from './quickSearchEngine';

/**
 * Connects the quick-search engine to the app without prop drilling: App
 * registers the slide-adding actions, the remote-control hook registers the
 * go-live routine. Both the Ctrl+K palette and the phone remote use them, so
 * adding and going live behave the same from either place.
 */

export type GoLiveOutcome = 'live' | 'locked' | 'failed';

let actions: QuickSearchActions | null = null;
let goLive: ((slideId: string) => Promise<GoLiveOutcome>) | null = null;

export function registerQuickSearchActions(next: QuickSearchActions): () => void {
  actions = next;
  return () => {
    if (actions === next) actions = null;
  };
}

export function getQuickSearchActions(): QuickSearchActions | null {
  return actions;
}

export function registerGoLive(next: (slideId: string) => Promise<GoLiveOutcome>): () => void {
  goLive = next;
  return () => {
    if (goLive === next) goLive = null;
  };
}

/** Puts a slide on the broadcast (respecting the broadcast lock, clearing blackout, opening the projector). */
export async function goLiveWithSlide(slideId: string | null): Promise<GoLiveOutcome> {
  if (!slideId || !goLive) return 'failed';
  return goLive(slideId);
}
