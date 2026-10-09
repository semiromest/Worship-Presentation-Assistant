import type { ImageStyle } from './types';

export type CropRect = NonNullable<ImageStyle['crop']>;
/** Shared constant: frozen so no caller can corrupt it by mutating it. Always copy before modifying. */
export const FULL_CROP: CropRect = Object.freeze({ x: 0, y: 0, width: 100, height: 100 });

type Size = { width: number; height: number };
type Corner = 'tl' | 'tr' | 'bl' | 'br';

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
const finite = (n: number, fallback: number) => (Number.isFinite(n) ? n : fallback);
const isSize = (size: Size) =>
  Number.isFinite(size.width) && Number.isFinite(size.height) && size.width > 0 && size.height > 0;

/** Clamps a crop (percentages of the source) into a valid rectangle; bad or missing values fall back to "full". */
export function normalizeCrop(crop?: CropRect | null): CropRect {
  const input = crop ?? FULL_CROP;
  const width = clamp(finite(input.width, 100), 1, 100);
  const height = clamp(finite(input.height, 100), 1, 100);
  return {
    x: clamp(finite(input.x, 0), 0, 100 - width),
    y: clamp(finite(input.y, 0), 0, 100 - height),
    width,
    height,
  };
}

/**
 * Projects one axis of a frame-space range (percent of the frame) onto the source image (percent of the image).
 * `offset` and `size` describe where the image sits inside the frame, in frame pixels.
 */
function projectAxis(start: number, length: number, frameSize: number, offset: number, size: number): [number, number] {
  const from = clamp(((((start / 100) * frameSize) - offset) / size) * 100, 0, 100);
  const to = clamp((((((start + length) / 100) * frameSize) - offset) / size) * 100, 0, 100);
  return [from, to];
}

/** Convert the old frame-space inset to source pixels, accounting for letterboxing and flip. */
export function sourceCrop(styles: ImageStyle, source: Size, frame: Size): CropRect {
  if (!styles.crop) return { ...FULL_CROP };
  const crop = normalizeCrop(styles.crop);
  if (styles.cropMode === 'source') return crop;
  // Without usable geometry a frame-space crop cannot be converted.
  if (!isSize(source) || !isSize(frame)) return { ...FULL_CROP };

  const fit = styles.objectFit ?? 'contain';
  const scale =
    fit === 'cover'
      ? Math.max(frame.width / source.width, frame.height / source.height)
      : Math.min(frame.width / source.width, frame.height / source.height);
  const width = fit === 'fill' ? frame.width : source.width * scale;
  const height = fit === 'fill' ? frame.height : source.height * scale;
  const offsetX = (frame.width - width) / 2;
  const offsetY = (frame.height - height) / 2;

  const [x1, x2] = projectAxis(crop.x, crop.width, frame.width, offsetX, width);
  const [y1, y2] = projectAxis(crop.y, crop.height, frame.height, offsetY, height);
  // The crop lies entirely in the letterbox margin: nothing of the image is selected.
  if (x2 <= x1 || y2 <= y1) return { ...FULL_CROP };

  return normalizeCrop({
    x: styles.flipX ? 100 - x2 : x1,
    y: styles.flipY ? 100 - y2 : y1,
    width: x2 - x1,
    height: y2 - y1,
  });
}

/**
 * Shrinks `crop` around its centre to the largest rectangle with the given pixel aspect ratio
 * (width / height of the cropped region, in source pixels).
 */
export function fitCropRatio(crop: CropRect, pixelRatio: number, source: Size): CropRect {
  const next = normalizeCrop(crop);
  if (!Number.isFinite(pixelRatio) || pixelRatio <= 0 || !isSize(source)) return next;
  // Aspect ratio expressed in crop-space (percent of width over percent of height).
  const ratio = (pixelRatio * source.height) / source.width;
  const width = Math.min(next.width, next.height * ratio);
  const height = width / ratio;
  return normalizeCrop({
    x: next.x + (next.width - width) / 2,
    y: next.y + (next.height - height) / 2,
    width,
    height,
  });
}

export function moveCrop(start: CropRect, dx: number, dy: number): CropRect {
  // A NaN delta must not teleport the crop to the origin via normalizeCrop's fallbacks.
  return normalizeCrop({ ...start, x: start.x + finite(dx, 0), y: start.y + finite(dy, 0) });
}

/**
 * Resizes by dragging one corner; the opposite corner stays fixed.
 * `dx`/`dy` are the drag deltas in crop-space percent. `ratio` (optional) locks the crop-space
 * aspect ratio (width / height in percent units, see `fitCropRatio`); the dominant drag axis wins.
 */
export function resizeCrop(start: CropRect, corner: Corner, dx: number, dy: number, ratio?: number): CropRect {
  const from = normalizeCrop(start);
  const moveX = finite(dx, 0);
  const moveY = finite(dy, 0);
  const left = corner.endsWith('l');
  const top = corner.startsWith('t');

  // Anchor = the corner that does not move; the crop can only grow towards the image edge.
  const anchorX = left ? from.x + from.width : from.x;
  const anchorY = top ? from.y + from.height : from.y;
  const maxWidth = left ? anchorX : 100 - anchorX;
  const maxHeight = top ? anchorY : 100 - anchorY;

  let width = clamp(from.width + (left ? -moveX : moveX), 1, maxWidth);
  let height = clamp(from.height + (top ? -moveY : moveY), 1, maxHeight);

  if (ratio && Number.isFinite(ratio) && ratio > 0) {
    const requested = Math.abs(moveX / from.width) >= Math.abs(moveY / from.height) ? width : height * ratio;
    // Lower bound keeps both sides >= 1; upper bound keeps the crop inside the image.
    width = clamp(requested, Math.max(1, ratio), Math.min(maxWidth, maxHeight * ratio));
    height = width / ratio;
  }

  return normalizeCrop({
    x: left ? anchorX - width : anchorX,
    y: top ? anchorY - height : anchorY,
    width,
    height,
  });
}