import type { VideoTextOverlay } from './types';

type OverlayTextStyles = NonNullable<VideoTextOverlay['textStyles']>;

/** Where a new text layer is placed: a caption band across the lower part of the frame (percent of the frame). */
const DEFAULT_GEOMETRY = { x: 10, y: 78, width: 80, height: 14 } as const;

const DEFAULT_TEXT_STYLES: Readonly<OverlayTextStyles> = Object.freeze({
  fontSize: 60,
  fontFamily: 'Arial, sans-serif',
  textColor: '#ffffff',
  backgroundColor: '#000000b3',
  fontWeight: 'bold',
  textAlign: 'center',
  verticalAlign: 'center',
  lineHeight: 1.25,
  textDecoration: '',
});

/** `value` if it is a finite number, otherwise `fallback`. Narrows without non-null assertions. */
const finiteOr = (value: number | undefined, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

/**
 * Whether a text layer is shown at `position` (seconds in the source video).
 * `startSeconds` is inclusive and defaults to 0; `endSeconds` is exclusive and defaults to "never".
 * Both are optional, and a missing or non-finite value simply means "unbounded" on that side.
 */
export function overlayVisible(item: VideoTextOverlay, position: number): boolean {
  if (item.visible === false) return false;
  const start = Math.max(0, finiteOr(item.startSeconds, 0));
  const end = finiteOr(item.endSeconds, Infinity);
  return position >= start && position < end;
}

export function newVideoOverlay(id: string, content: string, zIndex: number): VideoTextOverlay {
  return {
    id,
    type: 'text',
    content,
    styles: {},
    ...DEFAULT_GEOMETRY,
    zIndex,
    // A fresh copy per layer: editing one layer's styles must never leak into the shared defaults or other layers.
    textStyles: { ...DEFAULT_TEXT_STYLES },
  };
}