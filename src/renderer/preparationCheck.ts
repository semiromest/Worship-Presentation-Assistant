import {
  analyzePresentationReadiness,
  collectMediaResources,
  type ReadinessIssue,
  type SlideReadinessResult,
} from '../shared/readiness';
import type { Presentation, Slide } from './types';

export interface PreparationDependencies {
  checkMedia: (urls: string[]) => Promise<Record<string, boolean> | undefined>;
  fonts: (slide: Slide) => string[];
  loadFont: (family: string) => Promise<boolean>;
  measure: (slide: Slide) => ReadinessIssue[];
  yieldToUI: () => Promise<void>;
}

/** Parts navigation changes compatibility content, but not the content being checked. */
export function preparationInputKey(presentation: Presentation): string {
  return JSON.stringify([
    presentation.id ?? presentation.name,
    presentation.slides.map((slide) => ({
      id: slide.id,
      type: slide.type,
      content: slide.partsMode && slide.parts?.length ? slide.parts : slide.content,
      partsMode: slide.partsMode,
      mediaUrl: slide.mediaUrl,
      styles: slide.styles,
      items: slide.items,
      loopItems: slide.loopItems,
      videoOverlays: slide.videoOverlays,
    })),
  ]);
}

export function mergePreparationIssues(issues: ReadinessIssue[]): ReadinessIssue[] {
  const measured = issues.some((issue) => issue.message === 'textOverflow');
  const unique = new Map<string, ReadinessIssue>();
  for (const issue of issues) {
    if (measured && issue.message === 'longTextSmallFont') continue;
    unique.set(JSON.stringify([issue.message, issue.detail, issue.severity]), issue);
  }
  return [...unique.values()].sort((a, b) => Number(b.severity === 'error') - Number(a.severity === 'error'));
}

/** Shared async report; cancellation never publishes a partial or obsolete result. */
export async function runPreparationCheck(
  slides: Slide[],
  deps: PreparationDependencies,
  isCancelled: () => boolean
): Promise<SlideReadinessResult[] | undefined> {
  // A stable part selection makes static analysis independent of the live part.
  const normalized = slides.map((slide) =>
    slide.partsMode && slide.parts?.length ? { ...slide, activePart: 0, content: slide.parts[0] } : slide
  );
  const base = new Map(analyzePresentationReadiness(normalized).map((result) => [result.slideId, result]));
  const mediaBySlide = slides.map((slide) => collectMediaResources(slide));
  const fontsBySlide = slides.map((slide) => [...new Set(deps.fonts(slide))]);
  const resources = [...new Set(mediaBySlide.flat())];
  let statuses: Record<string, boolean> = {};
  if (resources.length) {
    const checked = await deps.checkMedia(resources);
    if (!checked) throw new Error('Resource checks unavailable');
    statuses = checked;
    // The existing IPC deliberately skips network/data/blob URLs.
    if (resources.some((url) => !/^(https?:|data:|blob:)/i.test(url) && typeof statuses[url] !== 'boolean')) {
      throw new Error('Resource check incomplete');
    }
  }
  if (isCancelled()) return undefined;
  const fonts = new Map(
    await Promise.all(
      [...new Set(fontsBySlide.flat())].map(async (family) => {
        try {
          return [family, await deps.loadFont(family)] as const;
        } catch {
          return [family, false] as const;
        }
      })
    )
  );
  if (isCancelled()) return undefined;
  const results: SlideReadinessResult[] = [];
  let lastYield = performance.now();
  for (let index = 0; index < slides.length; index++) {
    if (isCancelled()) return undefined;
    const slide = slides[index];
    const issues = [...(base.get(slide.id)?.issues ?? [])];
    for (const url of mediaBySlide[index]) {
      if (statuses[url] === false) issues.push({ severity: 'error', message: 'inaccessibleMedia', detail: url });
    }
    for (const family of fontsBySlide[index]) {
      if (!fonts.get(family)) issues.push({ severity: 'warning', message: 'fontUnavailable', detail: family });
    }
    issues.push(...deps.measure(slide));
    const merged = mergePreparationIssues(issues);
    if (merged.length) results.push({ slideId: slide.id, index, issues: merged });
    if (performance.now() - lastYield > 12) {
      await deps.yieldToUI();
      lastYield = performance.now();
    }
  }
  return isCancelled() ? undefined : results;
}
