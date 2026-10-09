import type { Slide } from '../types';

/** One capability boundary for all entry points into the item editor. */
export function isItemEditableSlide(slide: Slide): boolean {
  return !slide.partsMode && (slide.type === 'text' || slide.type === 'image');
}

export function isVideoEditableSlide(slide: Slide): boolean { return slide.type === 'video' && !slide.partsMode; }
export function isEditorEditableSlide(slide: Slide): boolean { return isItemEditableSlide(slide) || isVideoEditableSlide(slide); }

export function filteredEditorSlides(slides: Slide[], editableOnly: boolean): Slide[] {
  return editableOnly ? slides.filter(isEditorEditableSlide) : slides;
}

/** Retain the active slide when possible; otherwise prefer the next, then previous. */
export function editorFilterTarget(slides: Slide[], activeId: string, editableOnly: boolean): Slide | undefined {
  const index = slides.findIndex(slide => slide.id === activeId);
  const visible = (slide: Slide) => !editableOnly || isEditorEditableSlide(slide);
  if (index >= 0 && visible(slides[index])) return slides[index];
  return slides.slice(index + 1).find(visible) ?? slides.slice(0, Math.max(0, index)).reverse().find(visible);
}
