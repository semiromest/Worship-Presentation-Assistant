/// <reference lib="webworker" />
// Browser counterpart of src/main/gradientRender.ts: the same shared renderer
// and contrast check, with JPEG encoding done by OffscreenCanvas.
import { renderGradient, type GeneratedBackground } from '../../src/shared/generatedBackground';
import { checkGradientContrast, type ContrastRegion } from '../../src/shared/gradientContrast';

type Request = { recipe: GeneratedBackground; regions: ContrastRegion[] };

const toHex = (buffer: ArrayBuffer) => [...new Uint8Array(buffer)].map(b => b.toString(16).padStart(2, '0')).join('');

self.onmessage = async ({ data }: MessageEvent<Request>) => {
  try {
    const { recipe, regions } = data;
    const rgba = renderGradient(recipe);
    const canvas = new OffscreenCanvas(recipe.width, recipe.height);
    const context = canvas.getContext('2d')!;
    const pixelsIn = new Uint8ClampedArray(rgba.byteLength);
    pixelsIn.set(rgba);
    context.putImageData(new ImageData(pixelsIn, recipe.width, recipe.height), 0, 0);
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 });

    // Contrast is measured on the encoded JPEG, as on the desktop.
    const bitmap = await createImageBitmap(blob);
    const decoded = new OffscreenCanvas(recipe.width, recipe.height).getContext('2d', { willReadFrequently: true })!;
    decoded.drawImage(bitmap, 0, 0);
    bitmap.close();
    const pixels = decoded.getImageData(0, 0, recipe.width, recipe.height).data;
    const contrast = checkGradientContrast(new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength), recipe.width, recipe.height, regions);
    const hash = toHex(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()));
    self.postMessage({ ok: true, blob, contrast, hash });
  } catch (error) {
    self.postMessage({ ok: false, error: String((error as Error)?.message ?? error) });
  }
};
