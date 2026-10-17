import { create } from 'zustand';
import type { SlideReadinessResult } from '../../shared/readiness';

export type PreparationStatus = 'stale' | 'checking' | 'complete' | 'failed';

interface PreparationState {
  status: PreparationStatus;
  results: SlideReadinessResult[];
  focusedSlideId: string | null;
  retry: number;
  disconnectedOutputIds: string[];
  requestCheck: () => void;
}

/** Session-only report, never serialized into a presentation or sent to outputs. */
export const usePreparationStore = create<PreparationState>((set) => ({
  status: 'stale',
  results: [],
  focusedSlideId: null,
  retry: 0,
  disconnectedOutputIds: [],
  requestCheck: () => set((state) => ({ retry: state.retry + 1 })),
}));
