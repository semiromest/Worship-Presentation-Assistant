import { create } from 'zustand';
import {
  SENSITIVITY_DEFAULT,
  SENSITIVITY_MAX,
  SENSITIVITY_MIN,
} from '../stt/slideMatcher';
import {
  getSttSlideTrackerSettings,
  updateSttSlideTrackerSettings,
} from '../stt/slideTrackerSettings';

/** Last evaluation result, kept for the panel's live feedback. */
export interface SlideTrackerResult {
  /** Presentation index of the best-matching slide (null = no evaluation). */
  index: number | null;
  /** Match score in [0, 1]. */
  score: number;
  /** Whether the engine was confident enough to switch. */
  confident: boolean;
  at: number;
}

interface SlideTrackerState {
  enabled: boolean;
  /** 0 (strict) – 100 (lenient). */
  sensitivity: number;
  lastResult: SlideTrackerResult | null;

  setEnabled: (enabled: boolean) => void;
  setSensitivity: (sensitivity: number) => void;
  setLastResult: (result: SlideTrackerResult | null) => void;
}

const initial = getSttSlideTrackerSettings();

function clampSensitivity(value: number): number {
  if (!Number.isFinite(value)) return SENSITIVITY_DEFAULT;
  return Math.max(SENSITIVITY_MIN, Math.min(SENSITIVITY_MAX, Math.round(value)));
}

export const useSlideTrackerStore = create<SlideTrackerState>((set) => ({
  enabled: initial.enabled,
  sensitivity: initial.sensitivity,
  lastResult: null,

  setEnabled: (enabled) => {
    updateSttSlideTrackerSettings({ enabled });
    set({ enabled });
  },
  setSensitivity: (sensitivity) => {
    const clamped = clampSensitivity(sensitivity);
    updateSttSlideTrackerSettings({ sensitivity: clamped });
    set({ sensitivity: clamped });
  },
  setLastResult: (lastResult) => set({ lastResult }),
}));
