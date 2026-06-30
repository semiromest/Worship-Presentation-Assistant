import type { Preset } from './types';

/** Normalize a presentation reference string. */
export function normalizePresentationRef(ref: string): string {
  return ref.trim();
}

/**
 * Find a saved preset by reference.
 * Priority: exact name match (case-insensitive), then 1-based numeric index.
 */
export function findPresetByRef(ref: string, presets: Preset[]): Preset | undefined {
  const trimmed = normalizePresentationRef(ref);
  if (!trimmed) return undefined;

  const exact = presets.find(p => p.name.toLowerCase() === trimmed.toLowerCase());
  if (exact) return exact;

  const num = parseInt(trimmed, 10);
  if (String(num) === trimmed && num >= 1 && num <= presets.length) {
    return presets[num - 1];
  }

  return undefined;
}
