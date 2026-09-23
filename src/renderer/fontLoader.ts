import type { Slide, SlideItem } from './types';
const loadedFonts = new Map<string, Promise<boolean>>();
const SYSTEM = /^(inherit|sans-serif|serif|monospace|system-ui|arial|verdana|tahoma|times new roman|georgia|courier new|segoe ui|trebuchet ms)$/i;
export function slideFonts(slide: Slide): string[] {
  const families = new Set<string>();
  const add = (family?: string) => { if (family) families.add(family); };
  const visit = (items?: SlideItem[]) => items?.forEach(item => { add(item.textStyles?.fontFamily); visit(item.groupItems); });
  add(slide.styles?.fontFamily); visit(slide.items);
  return [...families];
}
export function loadGoogleFont(family: string): Promise<boolean> {
  const name = family.split(',')[0].replace(/['"]/g, '').trim();
  if (SYSTEM.test(name)) return Promise.resolve(true);
  const existing = loadedFonts.get(name);
  if (existing) return existing;
  const loading = (async () => {
    try {
      const css = await window.electronAPI?.cacheGoogleFont?.(name);
      if (!css) return false;
      const style = document.createElement('style');
      style.textContent = css;
      document.head.appendChild(style);
      await document.fonts.load('400 16px "' + name + '"');
      await document.fonts.load('700 16px "' + name + '"');
      return true;
    } catch { return false; }
  })();
  loadedFonts.set(name, loading);
  void loading.then(ok => { if (!ok) loadedFonts.delete(name); });
  return loading;
}
