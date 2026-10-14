import jpeg from 'jpeg-js';
import { createHash } from 'node:crypto';
import { renderGradient, type GeneratedBackground } from '../shared/generatedBackground';
import { checkGradientContrast, type ContrastRegion } from '../shared/gradientContrast';
export function encodeGradient(recipe: GeneratedBackground, regions: ContrastRegion[] = []) {
  const start = performance.now();
  const rgba = renderGradient(recipe);
  const renderedAt = performance.now();
  const bytes = jpeg.encode({ data: rgba, width: recipe.width, height: recipe.height }, 90).data;
  const encodedAt = performance.now();
  const decoded = jpeg.decode(bytes, { useTArray: true });
  return {
    bytes,
    contrast: checkGradientContrast(decoded.data, recipe.width, recipe.height, regions),
    rgbaHash: createHash('sha256').update(rgba).digest('hex'),
    jpegHash: createHash('sha256').update(bytes).digest('hex'),
    renderMs: renderedAt - start,
    encodeMs: encodedAt - renderedAt,
  };
}
