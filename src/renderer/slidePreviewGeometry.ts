import { SLIDE_REFERENCE_HEIGHT, SLIDE_REFERENCE_WIDTH } from './editor/editorUtils';

export interface SlidePreviewGeometry {
  /** Uniform scale applied to the reference slide so it fits the preview. */
  scale: number;
  /** Offset (px) that centers the scaled slide horizontally inside the preview. */
  left: number;
  /** Offset (px) that centers the scaled slide vertically inside the preview. */
  top: number;
}

const isUsableSize = (size: number) => Number.isFinite(size) && size > 0;

/**
 * Fit the complete reference slide, including pixel-sized styles, in a preview.
 *
 * The slide is letterboxed (never cropped) and centered. An unusable preview size
 * (not yet measured, collapsed, NaN) yields `scale: 0`, so callers can skip rendering
 * instead of laying out a slide at a bogus size.
 */
export function slidePreviewGeometry(width: number, height: number): SlidePreviewGeometry {
  if (!isUsableSize(width) || !isUsableSize(height)) return { scale: 0, left: 0, top: 0 };
  const scale = Math.min(width / SLIDE_REFERENCE_WIDTH, height / SLIDE_REFERENCE_HEIGHT);
  return {
    scale,
    left: (width - SLIDE_REFERENCE_WIDTH * scale) / 2,
    top: (height - SLIDE_REFERENCE_HEIGHT * scale) / 2,
  };
}