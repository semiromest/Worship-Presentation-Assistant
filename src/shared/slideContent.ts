export interface PartsSlide {
  content: string;
  partsMode?: boolean;
  parts?: string[];
  activePart?: number;
}

export function getPartIndex(slide: PartsSlide, requested = slide.activePart): number {
  const parts = slide.parts;
  if (!parts?.length) return 0;

  const index = Number.isFinite(requested) ? Math.floor(requested!) : 0;
  return Math.min(Math.max(0, index), parts.length - 1);
}

export function getActivePartIndex(slide: PartsSlide): number {
  return getPartIndex(slide);
}

export function getSlideDisplayContent(slide: PartsSlide): string {
  if (!slide.partsMode || !slide.parts?.length) return slide.content;
  return slide.parts[getActivePartIndex(slide)] ?? slide.content;
}

/** The next operator cue follows the same part-first order as live navigation. */
export function getNextDisplaySlide<T extends PartsSlide>(slides: T[], index: number): T | undefined {
  const current = slides[index];
  if (current?.partsMode && current.parts?.length) {
    const activePart = getActivePartIndex(current);
    if (activePart + 1 < current.parts.length) return { ...current, activePart: activePart + 1 };
  }
  return slides[index + 1];
}

export function getNextPartIndex(slide: PartsSlide): number | null {
  if (!slide.partsMode || !slide.parts?.length) return null;
  return Math.min(getActivePartIndex(slide) + 1, slide.parts.length - 1);
}

export function getPreviousPartIndex(slide: PartsSlide): number | null {
  if (!slide.partsMode || !slide.parts?.length) return null;
  return Math.max(getActivePartIndex(slide) - 1, 0);
}
