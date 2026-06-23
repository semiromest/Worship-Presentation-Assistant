import type { Preset } from './types';

/** Takvim veya başka yerlerden gelen sunum referansını normalize eder. */
export function normalizePresentationRef(ref: string): string {
  return ref.trim();
}

/**
 * Kayıtlı sunumu referansa göre bulur.
 * Öncelik: tam ad eşleşmesi (büyük/küçük harf duyarsız).
 * Geriye dönük: yalnızca rakamsa 1 tabanlı sıra numarası.
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
