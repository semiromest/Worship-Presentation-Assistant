import { create } from 'zustand';
import type { TourPage } from '../components/Tour/tourDefinition';

export type TourPhase = 'idle' | 'welcome' | 'map' | 'loading' | 'running';
export type TourEntry = 'automatic' | 'settings' | 'cheatsheet';
export const useTourStore = create<{
  phase: TourPhase;
  sessionId: number;
  entry: TourEntry;
  error: string | null;
  waiting: boolean;
  ready: Record<string, boolean>;
  kind: 'compact' | 'page';
  page: TourPage | null;
  suggestion: TourPage | null;
  profileInitialized: boolean;
  profileKnown: boolean;
  storageRevision: number;
}>(() => ({ phase: 'idle', sessionId: 0, entry: 'settings', error: null, waiting: false, ready: {},
  kind: 'compact', page: null, suggestion: null, profileInitialized: false, profileKnown: false, storageRevision: 0 }));

/** Existing startup requests mark readiness only after successfully hydrating state. */
export function markTourReady(source: 'outputs' | 'stt' | 'share' | 'screenShare') {
  useTourStore.setState(s => ({ ready: { ...s.ready, [source]: true } }));
}
