import {
  exerciseOperation,
  guideSteps,
  guideResultSteps,
  isGuideResultStep,
  practiceHymns,
  type GuideResult,
  type GuideResultStep,
  type GuideUi,
  type PracticeGuide,
} from '../shared/practice';
import type { Presentation } from '../shared/presentation';
export const sampleVerse = 'In the beginning God created the heaven and the earth.';
export function isPracticeHymnSlide(slide: Presentation['slides'][number]) {
  return (
    slide.type === 'text' &&
    Object.values(practiceHymns).some(
      (sample) =>
        slide.group?.title === sample.title &&
        sample.lyrics.split('\n\n').includes(slide.content) &&
        (!slide.partsMode ||
          JSON.stringify(slide.parts) === JSON.stringify(sample.lyrics.split('\n\n')) ||
          (slide.parts?.length === 1 && slide.parts[0] === sample.lyrics.split('\n\n')[0]))
    )
  );
}
export function validateGuide(raw: unknown): PracticeGuide {
  const guide = raw as PracticeGuide;
  if (
    !guide ||
    ![1, 2, 3].includes(guide.version) ||
    typeof guide.id !== 'string' ||
    !guideSteps.includes(guide.step) ||
    typeof guide.paused !== 'boolean' ||
    !Array.isArray(guide.skipped) ||
    guide.skipped.some((step) => !guideSteps.includes(step))
  )
    throw new Error('Invalid guide');
  if (guide.ui) validateUi(guide.ui);
  if (guide.focusSlideId !== undefined && typeof guide.focusSlideId !== 'string')
    throw new Error('Invalid guide focus');
  const result = isGuideResultStep(guide.step) && validGuideResult(guide.result, guide.step) ? guide.result : undefined;
  return {
    ...guide,
    version: 3,
    result,
    step: (guide.version as number) === 1 && guide.step === 'done' ? 'nav-bible' : guide.step,
  };
}
export function validGuideResult(result: GuideResult | undefined, step: GuideResultStep): result is GuideResult {
  try {
    if (
      !result ||
      result.exercise !== guideResultSteps[step] ||
      result.operation !== exerciseOperation[result.exercise] ||
      [result.runId, result.deckId, result.sessionId, result.resourceId].some((id) => typeof id !== 'string' || !id) ||
      !Array.isArray(result.resourceIds) ||
      !result.resourceIds.length ||
      result.resourceIds.length > 1000 ||
      result.resourceIds.some((id) => typeof id !== 'string' || !id) ||
      new Set(result.resourceIds).size !== result.resourceIds.length ||
      !result.resourceIds.includes(result.resourceId) ||
      [result.beforeCount, result.afterCount].some((count) => !Number.isInteger(count) || count < 0 || count > 1000)
    )
      return false;
    validatePracticeDeck({ id: result.deckId, name: 'Result', slides: result.slides });
    for (const slide of result.slides) {
      if (
        slide.items !== undefined &&
        (!Array.isArray(slide.items) ||
          slide.items.some(
            (item) =>
              !item ||
              typeof item !== 'object' ||
              typeof item.id !== 'string' ||
              !['text', 'image', 'group', 'shape'].includes(item.type) ||
              (item.content !== undefined && typeof item.content !== 'string')
          ))
      )
        return false;
      if (
        slide.parts !== undefined &&
        (!Array.isArray(slide.parts) || slide.parts.some((part) => typeof part !== 'string'))
      )
        return false;
      if (
        slide.styles !== undefined &&
        (!slide.styles || typeof slide.styles !== 'object' || Array.isArray(slide.styles))
      )
        return false;
      const stops = slide.styles?.backgroundGradient?.stops;
      if (
        stops !== undefined &&
        (!Array.isArray(stops) ||
          stops.some((stop) => !stop || typeof stop.color !== 'string' || typeof stop.position !== 'number'))
      )
        return false;
      if (slide.videoOverlays !== undefined && !Array.isArray(slide.videoOverlays)) return false;
      if (slide.loopItems !== undefined && !Array.isArray(slide.loopItems)) return false;
    }
    if (result.remaining) {
      validatePracticeDeck({ id: result.deckId, name: 'Remaining', slides: result.remaining });
      if (result.remaining.length > 6) return false;
    }
    if (step === 'save-result')
      return (
        typeof result.savedName === 'string' &&
        !!result.savedName.trim() &&
        result.savedName.length <= 1000 &&
        typeof result.savedAt === 'number' &&
        Number.isFinite(result.savedAt) &&
        result.savedAt > 0 &&
        result.resourceId === result.deckId &&
        result.slides.length <= 1
      );
    if (
      !result.slides.length ||
      result.slides.length !== result.resourceIds.length ||
      result.slides.some((slide) => !result.resourceIds.includes(slide.id))
    )
      return false;
    if (step === 'delete-result')
      return (
        result.slides.length === 1 && result.afterCount === result.beforeCount - 1 && Array.isArray(result.remaining)
      );
    if (step === 'image-edit-result')
      return (
        result.beforeCount === result.afterCount &&
        result.slides.length === 1 &&
        result.slides[0].type === 'image' &&
        result.slides[0].styles?.objectFit === 'contain' &&
        result.slides[0].styles?.imageGrayscale === 1
      );
    if (step === 'editor-result')
      return (
        result.beforeCount === result.afterCount &&
        result.slides.length === 1 &&
        result.slides[0].type === 'image' &&
        result.slides[0].items?.length === 1 &&
        result.slides[0].items[0].rotation === 15
      );
    if (result.afterCount <= result.beforeCount) return false;
    if (step === 'add-result') return result.slides.every((slide) => slide.type === 'text');
    if (step === 'bible-result')
      return (
        result.slides.every((slide) => slide.type === 'text') &&
        result.slides.some((slide) => slide.content.includes(sampleVerse))
      );
    if (step === 'hymns-result') return result.slides.every(isPracticeHymnSlide);

    if (step === 'media-result') return result.slides.every((slide) => slide.type === 'image');
    return result.slides.every(
      (slide) =>
        slide.type === 'countdown' &&
        JSON.parse(slide.content).totalSeconds >= 120 &&
        JSON.parse(slide.content).totalSeconds < 180
    );
  } catch {
    return false;
  }
}
export function validateUi(ui: GuideUi) {
  if (!ui || typeof ui !== 'object' || Array.isArray(ui)) throw new Error('Invalid UI state');
  for (const [key, value] of Object.entries(ui)) {
    if (['editorSlideId', 'editorItemId'].includes(key)) {
      if (typeof value !== 'string' || value.length > 200) throw new Error('Invalid editor target');
    } else if (key === 'editorRotation') {
      if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 360)
        throw new Error('Invalid rotation');
    } else if (['book', 'chapter', 'minutes'].includes(key)) {
      if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > 200)
        throw new Error('Invalid UI number');
    } else if (
      ![
        'bibleReady',
        'chapterChosen',
        'verse',
        'sourceMenu',
        'mediaMenu',
        'imageReady',
        'imageImported',
        'editorSelected',
      ].includes(key) ||
      typeof value !== 'boolean'
    )
      throw new Error('Invalid UI flag');
  }
}
export function validatePracticeDeck(raw: unknown): Presentation & { id: string } {
  const deck = raw as Presentation;
  if (
    !deck ||
    typeof deck.id !== 'string' ||
    typeof deck.name !== 'string' ||
    !Array.isArray(deck.slides) ||
    deck.slides.length > 1000 ||
    JSON.stringify(deck).length > 10_000_000
  )
    throw new Error('Invalid practice presentation');
  const ids = new Set<string>();
  for (const slide of deck.slides) {
    if (
      !slide ||
      typeof slide.id !== 'string' ||
      ids.has(slide.id) ||
      typeof slide.content !== 'string' ||
      !['text', 'image', 'video', 'countdown', 'screen', 'loop', 'captions'].includes(slide.type)
    )
      throw new Error('Invalid practice slide');
    ids.add(slide.id);
  }
  return JSON.parse(JSON.stringify(deck));
}
