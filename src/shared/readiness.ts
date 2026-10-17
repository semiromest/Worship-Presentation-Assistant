import { getSlideDisplayContent } from './slideContent';
import type { SlideItem, Slide } from './presentation';

export interface ReadinessSlide {
  id: string;
  type: string;
  content: string;
  mediaUrl?: string;
  thumbnailUrl?: string;
  partsMode?: boolean;
  parts?: string[];
  activePart?: number;
  loopItems?: { mediaUrl?: string }[];
  items?: SlideItem[];
  videoOverlays?: SlideItem[];
  styles?: Partial<Slide['styles']>;
}

export type ReadinessSeverity = 'warning' | 'error';

export interface ReadinessIssue {
  severity: ReadinessSeverity;
  message: string;
  detail?: string;
}

export interface SlideReadinessResult {
  slideId: string;
  index: number;
  issues: ReadinessIssue[];
}

const LONG_TEXT_THRESHOLD = 200; // Lowered from 240 for safer margin

/** Rough estimate: below this chars-per-fontSize ratio, text likely overflows a 1920x1080 slide. */
function isLikelyOverflowing(content: string, fontSize: number): boolean {
  if (!content) return false;
  // Heuristic: If content length / font size ratio is too high, it's a warning.
  // 1920/1080 slide can comfortably fit about 200-300 chars at 48px.
  return content.length > LONG_TEXT_THRESHOLD && (content.length / fontSize) > 4;
}

export function analyzeSlideReadiness(slide: ReadinessSlide): ReadinessIssue[] {
  const issues: ReadinessIssue[] = [];
  const hasItems = Array.isArray(slide.items) && slide.items.length > 0;

  switch (slide.type) {
    case 'text':
    case 'captions': {
      const contents = slide.partsMode && slide.parts?.length ? slide.parts : [getSlideDisplayContent(slide)];
      if (!hasItems && contents.every(content => !content.trim())) {
        issues.push({ severity: 'error', message: 'emptyText' });
      }
      const fontSize = slide.styles?.fontSize ?? 48;
      if (contents.some(content => isLikelyOverflowing(content, fontSize))) {
        issues.push({ severity: 'warning', message: 'longTextSmallFont' });
      }
      if (slide.partsMode && slide.parts?.some(part => !part.trim())) issues.push({ severity: 'error', message: 'emptyPart' });
      break;
    }
    case 'image':
      if (!slide.mediaUrl && !hasItems) {
        issues.push({ severity: 'error', message: 'missingImage' });
      }
      break;
    case 'video':
      if (!slide.mediaUrl) {
        issues.push({ severity: 'error', message: 'missingVideo' });
      }
      break;
    case 'loop':
      if (!slide.loopItems || slide.loopItems.length === 0) {
        issues.push({ severity: 'error', message: 'emptyLoop' });
      }
      break;
    default:
      break;
  }

  if (collectMediaResources(slide).some(url => /^https?:/i.test(url))) issues.push({ severity: 'warning', message: 'onlineResource' });
  const inspect = (items?: SlideItem[]) => items?.forEach(item => {
    if (item.visible === false) return;
    if (item.type === 'image' && !item.mediaUrl) issues.push({ severity: 'error', message: 'missingImage' });
    inspect(item.groupItems);
  });
  inspect(slide.items);
  if (slide.loopItems?.some(item => !item.mediaUrl)) issues.push({ severity: 'error', message: 'missingVideo' });

  return issues;
}

export function collectMediaResources(slide: ReadinessSlide): string[] {
  const urls = new Set<string>();
  const add = (url?: string) => { if (url) urls.add(url); };
  if (slide.type !== 'screen') add(slide.mediaUrl);
  add(slide.styles?.backgroundImage); add(slide.styles?.backgroundVideo);
  slide.loopItems?.forEach(item => add(item.mediaUrl));
  const visit = (items?: SlideItem[]) => items?.forEach(item => { add(item.mediaUrl); visit(item.groupItems); });
  visit(slide.items);
  return [...urls];
}

export function analyzePresentationReadiness(
  slides: ReadinessSlide[],
): SlideReadinessResult[] {
  const results = slides
    .map((slide, index) => ({ slideId: slide.id, index, issues: analyzeSlideReadiness(slide) }));

  // Check for duplicate adjacent slides
  for (let i = 1; i < results.length; i++) {
    const current = slides[i];
    const prev = slides[i - 1];
    if (
      current.type === prev.type &&
      current.type !== 'countdown' && // Countdowns are often similar
      current.content === prev.content &&
      current.mediaUrl === prev.mediaUrl &&
      current.partsMode === prev.partsMode &&
      JSON.stringify(current.parts) === JSON.stringify(prev.parts) &&
      JSON.stringify(current.styles) === JSON.stringify(prev.styles) &&
      JSON.stringify(current.loopItems) === JSON.stringify(prev.loopItems) &&
      JSON.stringify(current.videoOverlays) === JSON.stringify(prev.videoOverlays) &&
      JSON.stringify(current.items) === JSON.stringify(prev.items)
    ) {
      results[i].issues.push({ severity: 'warning', message: 'duplicateSlide' });
    }
  }

  return results.filter((result) => result.issues.length > 0);
}
