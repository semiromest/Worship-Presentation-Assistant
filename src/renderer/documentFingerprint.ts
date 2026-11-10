import type { Presentation, Slide } from './types';

/** Exact content fragments, memoized only for immutable source objects. No hash collisions. */
export interface DocumentSignature { readonly header: string; readonly slides: readonly string[] }
const documents = new WeakMap<Presentation, DocumentSignature>();
const slides = new WeakMap<Slide, string>();
export function documentSignature(presentation: Presentation): DocumentSignature {
  const cached = documents.get(presentation);
  if (cached) return cached;
  const source = presentation.slides;
  const header = { ...presentation, slides: undefined, liveIndex: undefined, liveSlideId: undefined, zoom: undefined };
  const signature = { header: JSON.stringify(header), slides: source.map(slide => {
    const cachedSlide = slides.get(slide);
    if (cachedSlide !== undefined) return cachedSlide;
    const content = { ...slide, activePart: undefined };
    const value = JSON.stringify(slide.partsMode && slide.parts?.length
      ? { ...content, content: slide.parts.join('\n') } : content);
    slides.set(slide, value);
    return value;
  }) };
  documents.set(presentation, signature);
  return signature;
}
export function sameDocument(a: DocumentSignature | undefined, b: DocumentSignature): boolean {
  return a === b || !!a && a.header === b.header && a.slides.length === b.slides.length
    && a.slides.every((slide, index) => slide === b.slides[index]);
}
