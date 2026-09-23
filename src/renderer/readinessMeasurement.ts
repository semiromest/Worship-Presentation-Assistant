import type { Slide, SlideItem } from './types';
import type { ReadinessIssue } from '../shared/readiness';
import { getSlideDisplayContent } from '../shared/slideContent';

/** Measure at the same 1920 × 1080 reference geometry and typography as LivePreview. */
export function measureSlideReadability(slide: Slide): ReadinessIssue[] {
  const issues: ReadinessIssue[] = [];
  const measure = (content: string, width: number, height: number, style: Partial<CSSStyleDeclaration>, detail?: string) => {
    const element = document.createElement('div');
    Object.assign(element.style, { position: 'fixed', left: '-100000px', top: '0', visibility: 'hidden',
      whiteSpace: 'pre-wrap', boxSizing: 'border-box', width: `${Math.max(1, width)}px`, ...style });
    element.textContent = content;
    document.body.appendChild(element);
    try {
      if (element.scrollHeight > height + 1 || element.scrollWidth > width + 1) issues.push({ severity: 'warning', message: 'textOverflow', detail });
    } finally { element.remove(); }
  };
  const inspect = (items?: SlideItem[], parentWidth = 1920, parentHeight = 1080) => items?.forEach(item => {
    if (item.visible === false) return;
    const width = parentWidth * item.width / 100, height = parentHeight * item.height / 100;
    if (item.type === 'text') {
      const style = item.textStyles;
      measure(item.content ?? '', width - 16, height - 16, {
        fontSize: `${style?.fontSize || 32}px`, fontFamily: style?.fontFamily || 'inherit',
        fontWeight: style?.fontWeight || 'normal', fontStyle: style?.fontStyle || 'normal',
        lineHeight: String(style?.lineHeight || 1.25), letterSpacing: `${style?.letterSpacing || 0}px`, textTransform: style?.textTransform || 'none',
      });
    }
    inspect(item.groupItems, width, height);
  });
  if (slide.items?.length) inspect(slide.items);
  else if (slide.type === 'text') {
    const parts = slide.partsMode && slide.parts?.length ? slide.parts : [getSlideDisplayContent(slide)];
    parts.forEach((part, index) => {
      const style = slide.styles;
      measure(part, 1920, 1080, { boxSizing: 'border-box', padding: '54px 96px', fontSize: `${style?.fontSize || 48}px`,
        fontFamily: style?.fontFamily || 'inherit', fontWeight: style?.fontWeight || 'bold',
        fontStyle: style?.fontStyle || 'normal', lineHeight: String(style?.lineHeight || 1.3), textTransform: style?.textTransform || 'none',
      }, parts.length > 1 ? String(index + 1) : undefined);
    });
  }
  return issues;
}
