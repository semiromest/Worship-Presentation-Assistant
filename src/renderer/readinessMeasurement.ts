import type { Slide, SlideItem } from './types';
import type { ReadinessIssue } from '../shared/readiness';
import { getSlideDisplayContent } from '../shared/slideContent';

/** Reference stage size; must match the geometry LivePreview renders at. */
const STAGE_WIDTH = 1920;
const STAGE_HEIGHT = 1080;
/** Padding LivePreview applies around a text item's content (8px per side). */
const ITEM_PADDING = 16;
/** Sub-pixel tolerance: scroll metrics are rounded to integers. */
const TOLERANCE = 1;
const PREVIEW_LENGTH = 40;

type MeasureTask = {
  content: string;
  width: number;
  height: number;
  style: Partial<CSSStyleDeclaration>;
  detail?: string;
};

const MEASURE_BASE_STYLE: Partial<CSSStyleDeclaration> = {
  position: 'absolute',
  left: '0',
  top: '0',
  whiteSpace: 'pre-wrap',
  boxSizing: 'border-box',
};

/** First line of a text, shortened, so a warning can say *which* text box overflows. */
function preview(content: string): string | undefined {
  const line = content.trim().split('\n')[0] ?? '';
  if (!line) return undefined;
  return line.length > PREVIEW_LENGTH ? `${line.slice(0, PREVIEW_LENGTH)}…` : line;
}

/**
 * Measures every task in two phases: first all elements are written into one hidden host,
 * then all of them are read. The browser therefore runs a single layout pass per call instead of
 * one forced synchronous layout per element (which is what append → read → remove costs).
 */
function findOverflowing(tasks: MeasureTask[]): MeasureTask[] {
  if (tasks.length === 0 || typeof document === 'undefined') return [];

  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  Object.assign(host.style, {
    position: 'fixed',
    left: '-100000px',
    top: '0',
    width: '0',
    height: '0',
    visibility: 'hidden',
    pointerEvents: 'none',
  });

  const elements = tasks.map((task) => {
    const element = document.createElement('div');
    Object.assign(element.style, MEASURE_BASE_STYLE, { width: `${Math.max(1, task.width)}px` }, task.style);
    element.textContent = task.content;
    host.appendChild(element);
    return element;
  });

  document.body.appendChild(host);
  try {
    return tasks.filter(
      (task, index) =>
        elements[index].scrollHeight > task.height + TOLERANCE || elements[index].scrollWidth > task.width + TOLERANCE
    );
  } finally {
    host.remove();
  }
}

/** Measure at the same 1920 × 1080 reference geometry and typography as LivePreview. */
export function measureSlideReadability(slide: Slide): ReadinessIssue[] {
  const tasks: MeasureTask[] = [];

  const queue = (
    content: string,
    width: number,
    height: number,
    style: Partial<CSSStyleDeclaration>,
    detail?: string
  ) => {
    // Empty text cannot overflow; skipping it saves a DOM node and a layout read.
    if (content) tasks.push({ content, width, height, style, detail });
  };

  const inspect = (items: SlideItem[] | undefined, parentWidth = STAGE_WIDTH, parentHeight = STAGE_HEIGHT) => {
    if (!items) return;
    for (const item of items) {
      if (item.visible === false) continue;
      const width = (parentWidth * item.width) / 100;
      const height = (parentHeight * item.height) / 100;
      // Without a valid geometry the measurement would fall back to the viewport width and
      // report false overflows, so such items (and their children) are skipped.
      if (!Number.isFinite(width) || !Number.isFinite(height)) continue;

      if (item.type === 'text') {
        const style = item.textStyles;
        const content = item.content ?? '';
        queue(
          content,
          width - ITEM_PADDING,
          height - ITEM_PADDING,
          {
            fontSize: `${style?.fontSize || 32}px`,
            fontFamily: style?.fontFamily || 'inherit',
            fontWeight: style?.fontWeight || 'normal',
            fontStyle: style?.fontStyle || 'normal',
            lineHeight: String(style?.lineHeight || 1.25),
            letterSpacing: `${style?.letterSpacing || 0}px`,
            textTransform: style?.textTransform || 'none',
          },
          preview(content)
        );
      }
      inspect(item.groupItems, width, height);
    }
  };

  if (slide.items?.length) {
    inspect(slide.items);
  } else if (slide.type === 'text') {
    const parts = slide.partsMode && slide.parts?.length ? slide.parts : [getSlideDisplayContent(slide)];
    const style = slide.styles;
    parts.forEach((part, index) => {
      queue(
        part,
        STAGE_WIDTH,
        STAGE_HEIGHT,
        {
          padding: '54px 96px',
          fontSize: `${style?.fontSize || 48}px`,
          fontFamily: style?.fontFamily || 'inherit',
          fontWeight: style?.fontWeight || 'bold',
          fontStyle: style?.fontStyle || 'normal',
          lineHeight: String(style?.lineHeight || 1.3),
          textTransform: style?.textTransform || 'none',
        },
        parts.length > 1 ? String(index + 1) : undefined
      );
    });
  }

  return findOverflowing(tasks).map(
    (task): ReadinessIssue => ({ severity: 'warning', message: 'textOverflow', detail: task.detail })
  );
}