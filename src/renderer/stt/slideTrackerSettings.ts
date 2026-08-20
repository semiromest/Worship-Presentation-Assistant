// ─── Slide tracker settings (localStorage) ───────────────────────────────────
// Non-sensitive preferences for the STT slide locator. The engine compares a
// rolling window of the live transcript with the deck's text slides and jumps
// to the slide the speaker is most likely on. Kept separate from sttSettings.ts
// so the language/translation defaults stay untouched.

import { SENSITIVITY_DEFAULT, SENSITIVITY_MAX, SENSITIVITY_MIN } from './slideMatcher';

const STORAGE_KEY = 'sttSlideTrackerSettings';

export interface SttSlideTrackerSettings {
  /** Master switch for auto slide tracking. */
  enabled: boolean;
  /** 0 (strict) – 100 (lenient). How eagerly the engine switches slides. */
  sensitivity: number;
}

function clampSensitivity(value: unknown): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : SENSITIVITY_DEFAULT;
  return Math.max(SENSITIVITY_MIN, Math.min(SENSITIVITY_MAX, n));
}

export function getSttSlideTrackerSettings(): SttSlideTrackerSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<SttSlideTrackerSettings>;
      return {
        enabled: typeof parsed.enabled === 'boolean' ? parsed.enabled : false,
        sensitivity: clampSensitivity(parsed.sensitivity),
      };
    }
  } catch {
    // Corrupt storage — fall through to defaults.
  }
  return { enabled: false, sensitivity: SENSITIVITY_DEFAULT };
}

/** Merges a patch into the stored settings and returns the full new value. */
export function updateSttSlideTrackerSettings(
  patch: Partial<SttSlideTrackerSettings>,
): SttSlideTrackerSettings {
  const next = {
    ...getSttSlideTrackerSettings(),
    ...patch,
    sensitivity: clampSensitivity(patch.sensitivity ?? getSttSlideTrackerSettings().sensitivity),
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable — the in-memory value still applies this session.
  }
  return next;
}
