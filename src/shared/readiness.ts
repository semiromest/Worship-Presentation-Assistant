import { getSlideDisplayContent } from './slideContent';
import type { SlideItem, Slide } from '../renderer/types';

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

const LONG_TEXT_THRESHOLD = 240;
const MIN_COMFORTABLE_FONT_SIZE = 28;

/** Rough estimate: below this chars-per-fontSize ratio, text likely overflows a 1920x1080 slide. */
function isLikelyOverflowing(content: string, fontSize: number): boolean {
  if (!content) return false;
  return content.length > LONG_TEXT_THRESHOLD && fontSize >= MIN_COMFORTABLE_FONT_SIZE;
}

export function analyzeSlideReadiness(slide: ReadinessSlide): ReadinessIssue[] {
  const issues: ReadinessIssue[] = [];
  const hasItems = Array.isArray(slide.items) && slide.items.length > 0;

  switch (slide.type) {
    case 'text':
    case 'captions': {
      const content = getSlideDisplayContent(slide).trim();
      if (!hasItems && !content) {
        issues.push({ severity: 'error', message: 'emptyText' });
      }
      const fontSize = slide.styles?.fontSize ?? 48;
      if (isLikelyOverflowing(content, fontSize)) {
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
    if (item.type === 'text' && (item.x < 5 || item.y < 5 || item.x + item.width > 95 || item.y + item.height > 95)) {
      issues.push({ severity: 'warning', message: 'safeMargin' });
    }
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
  return slides
    .map((slide, index) => ({ slideId: slide.id, index, issues: analyzeSlideReadiness(slide) }))
    .filter((result) => result.issues.length > 0);
}
