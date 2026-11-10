// Control-panel UI typeface. Slide/projector text never uses this: slide render
// roots carry `.slide-surface`, which pins the inherited default to --font-slide.
// Atkinson Hyperlegible Next is the default: designed for low-vision legibility
// (distinct I/l/1, 0/O, ı/i) with Segoe-like width, so the narrow nav rail keeps its
// layout. Inter is wider and wraps "Geri Sayım" in the rail.
export const UI_FONTS = ['atkinson', 'figtree', 'inter', 'manrope', 'work-sans', 'system'] as const;
export type UiFont = typeof UI_FONTS[number];
export const DEFAULT_UI_FONT: UiFont = 'atkinson';
export const UI_FONT_STORAGE_KEY = 'wpa.uiFont';

const isUiFont = (value: unknown): value is UiFont => typeof value === 'string' && (UI_FONTS as readonly string[]).includes(value);

/** `?uiFont=` wins (quick comparisons), then the stored choice, then the default. */
export function resolveUiFont(search: string, stored: string | null | undefined): UiFont {
  const requested = new URLSearchParams(search).get('uiFont')?.trim().toLowerCase();
  if (isUiFont(requested)) return requested;
  return isUiFont(stored) ? stored : DEFAULT_UI_FONT;
}

export function applyUiFont(font: UiFont, root: HTMLElement = document.documentElement): void {
  if (font === DEFAULT_UI_FONT) root.removeAttribute('data-ui-font');
  else root.setAttribute('data-ui-font', font);
}

/** Applies the persisted UI font before first paint. Storage failures fall back to the default. */
export function initUiFont(): UiFont {
  let stored: string | null = null;
  try { stored = localStorage.getItem(UI_FONT_STORAGE_KEY); } catch { /* storage unavailable */ }
  const font = resolveUiFont(location.search, stored);
  applyUiFont(font);
  return font;
}

/** Persists a UI font choice (e.g. from DevTools: `__setUiFont('figtree')`). */
export function setUiFont(font: UiFont): void {
  if (!isUiFont(font)) throw new Error(`Unknown UI font: ${String(font)}`);
  try {
    if (font === DEFAULT_UI_FONT) localStorage.removeItem(UI_FONT_STORAGE_KEY);
    else localStorage.setItem(UI_FONT_STORAGE_KEY, font);
  } catch { /* storage unavailable: apply for this session only */ }
  applyUiFont(font);
}
