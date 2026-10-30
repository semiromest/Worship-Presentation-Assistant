import type { SlideInsertion } from '../shared/slideInsertion';
import type { Presentation, Slide } from './types';
import { makeSlideId, toFileUrl } from './utils';
import { DEFAULT_STYLES } from './constants';

/** An absent target appends to the deck; a deleted explicit target cancels the drop. */
export function insertDroppedImages(
  deck: Presentation,
  targetId: string | SlideInsertion | undefined,
  paths: readonly string[],
): Presentation {
  // Boş girdide findIndex'i (O(n)) hiç çalıştırma.
  if (paths.length === 0) return deck;

  const { slides } = deck;
  if (typeof targetId === 'object') {
    const section = deck.sections?.find(section => section.id === targetId.sectionId);
    if (!section) return deck;
    let index = targetId.beforeId === null ? -1 : slides.findIndex(slide => slide.id === targetId.beforeId && slide.sectionId === targetId.sectionId);
    if (targetId.beforeId !== null && index < 0) return deck;
    if (targetId.beforeId === null) {
      const following = new Set(deck.sections!.slice(deck.sections!.indexOf(section) + 1).map(section => section.id));
      index = slides.findIndex(slide => following.has(slide.sectionId!));
      if (index < 0) index = slides.length;
    }
    const added: Slide[] = paths.map(path => ({ id: makeSlideId(), type: 'image', content: '', mediaUrl: toFileUrl(path),
      styles: { ...DEFAULT_STYLES, objectFit: 'contain', backgroundExplicit: true }, sectionId: section.id,
      section: { id: section.id, title: section.title } }));
    return { ...deck, slides: [...slides.slice(0, index), ...added, ...slides.slice(index)] };
  }
  const index = targetId === undefined
    ? slides.length - 1
    : slides.findIndex(slide => slide.id === targetId);

  if (targetId !== undefined && index < 0) return deck;

  // Deste boşsa target undefined olur; bu durum bilinçli olarak destekleniyor.
  const target: Slide | undefined = slides[index];
  const sectionId = target?.sectionId;
  const section = target?.section;

  const added: Slide[] = paths.map(path => ({
    id: makeSlideId(),
    type: 'image',
    content: '',
    mediaUrl: toFileUrl(path),
    // Her slayt kendi style nesnesini alır; paylaşılan referans riski yok.
    styles: { ...DEFAULT_STYLES, objectFit: 'contain', backgroundExplicit: true },
    sectionId,
    ...(section && { section: { ...section } }),
  }));

  const insertAt = targetId === undefined ? slides.length : index;
  return {
    ...deck,
    slides: [...slides.slice(0, insertAt), ...added, ...slides.slice(insertAt)],
  };
}