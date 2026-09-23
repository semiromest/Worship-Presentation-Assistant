import type { Slide } from './types';
import { languageName } from '../shared/stt';
export interface CaptionDisplayState {
  currentOriginal: string; partialOriginal: string; currentTranslation: string; partialTranslation: string;
  currentTranslations: Record<string, string>; partialTranslations: Record<string, string>;
  lastOriginal: string; lastTranslation: string; lastTranslations: Record<string, string>;
  targetLanguage: string; targetLanguages: string[]; translationEnabled: boolean;
}
export function captionText(s: CaptionDisplayState) {
  const translations = Object.fromEntries(s.targetLanguages.map(code => [code,
    ((s.currentTranslations[code] ?? (code === s.targetLanguage ? s.currentTranslation : '')) +
      (s.partialTranslations[code] ?? (code === s.targetLanguage ? s.partialTranslation : ''))).trim(),
  ]));
  return { original: (s.currentOriginal + s.partialOriginal).trim(), translations };
}
export interface CaptionRow { text: string; y: number; size: number; opacity: number; bold: boolean; rtl: boolean }
export interface CaptionLayout { rows: CaptionRow[]; color: string; background: string; family: string; band?: { y: number; height: number } }
const rtlText = (text: string) => /^[\s\p{P}\p{N}]*[\u0590-\u08ff]/u.test(text);
/** Fixed reference coordinates keep SVG and JPEG output identical at every size. */
export function layoutCaptions(slide: Slide, state: CaptionDisplayState, measure: (text: string, size: number, bold: boolean, family: string) => number): CaptionLayout {
  const cfg = slide.captions;
  const family = slide.styles?.fontFamily || 'sans-serif';
  const configured = Number(slide.styles?.fontSize);
  const size = Number.isFinite(configured) && configured > 0 ? Math.min(96, Math.max(24, configured)) : 48;
  const text = captionText(state);
  const translated = state.translationEnabled && cfg?.showTranslation !== false;
  const blocks: { text: string; size: number; bold: boolean; opacity: number }[] = [];
  if (!translated || cfg?.showOriginal !== false) {
    const original = text.original || state.lastOriginal;
    if (original) blocks.push({ text: original, size: translated ? size * .65 : size, bold: !translated, opacity: translated ? .75 : 1 });
  }
  if (translated) for (const code of state.targetLanguages) {
    const value = text.translations[code] || state.lastTranslations[code] || (code === state.targetLanguage ? state.lastTranslation : '');
    if (value) blocks.push({ text: state.targetLanguages.length > 1 ? languageName(code) + ' · ' + value : value, size, bold: true, opacity: 1 });
  }
  const banded = cfg?.layout === 'top' || cfg?.layout === 'lowerThird';
  const available = banded ? 420 : 880;
  const budget = Math.max(1, blocks.length);
  const gap = Math.min(22, available / budget * .12);
  const rows: CaptionRow[] = [];
  let y = 0;
  for (const block of blocks) {
    // Only measure the visible tail; the full text stays in the timeline.
    const chars = Array.from(block.text.slice(-4000));
    const lines: string[] = [];
    let line = '';
    const fittedSize = Math.min(block.size, (available / budget - gap) / 1.35);
    for (const char of chars) {
      if (char === '\n' || measure(line + char, fittedSize, block.bold, family) > 1640) {
        lines.push(line); line = char === '\n' ? '' : char;
      } else line += char;
    }
    if (line) lines.push(line);
    const height = fittedSize * 1.35;
    const count = Math.max(1, Math.floor((available / budget - gap) / height));
    const tail = lines.slice(-count);
    if (lines.length > count && tail.length) tail[0] = '… ' + tail[0];
    for (const value of tail) { y += height; rows.push({ text: value, y, size: fittedSize, bold: block.bold, opacity: block.opacity, rtl: rtlText(value) }); }
    y += gap;
  }
  const offset = cfg?.layout === 'top' ? 70 : cfg?.layout === 'lowerThird' ? 1010 - y : (1080 - y) / 2;
  for (const row of rows) row.y += offset;
  return { rows, family, color: slide.styles?.textColor || '#ffffff', background: slide.styles?.backgroundColor || '#000000',
    ...(banded && rows.length ? { band: { y: offset - 12, height: y + 28 } } : {}) };
}
let measuringContext: CanvasRenderingContext2D | null = null;
export function measureCaptionText(text: string, size: number, bold: boolean, family: string): number {
  measuringContext ??= document.createElement('canvas').getContext('2d');
  if (!measuringContext) return text.length * size * .6;
  measuringContext.font = (bold ? '700' : '400') + ' ' + size + 'px ' + family;
  return measuringContext.measureText(text).width;
}
export function drawCaptionsFrame(slide: Slide, state: CaptionDisplayState): string {
  const canvas = document.createElement('canvas'); canvas.width = 1280; canvas.height = 720;
  const ctx = canvas.getContext('2d'); if (!ctx) return '';
  const layout = layoutCaptions(slide, state, measureCaptionText);
  ctx.scale(2 / 3, 2 / 3); ctx.fillStyle = layout.background; ctx.fillRect(0, 0, 1920, 1080);
  if (layout.band) { ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(76, layout.band.y, 1768, layout.band.height); }
  ctx.fillStyle = layout.color; ctx.textAlign = 'center';
  for (const row of layout.rows) {
    ctx.font = (row.bold ? '700' : '400') + ' ' + row.size + 'px ' + layout.family;
    ctx.globalAlpha = row.opacity; ctx.direction = row.rtl ? 'rtl' : 'ltr'; ctx.fillText(row.text, 960, row.y);
  }
  return canvas.toDataURL('image/jpeg', .85);
}
