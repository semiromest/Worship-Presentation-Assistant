/**
 * Electron's offscreen bitmaps carry premultiplied alpha (50% white arrives as 128,128,128,128,
 * measured on Electron 43), while NDI BGRA expects straight alpha. Without this conversion keyed
 * text gets dark fringes over a camera picture.
 *
 * A 64 KB lookup table (alpha × channel) keeps the conversion to table reads; fully transparent and
 * fully opaque pixels, which are almost all of a lyrics frame, are skipped.
 */
const LUT = (() => {
  const table = new Uint8Array(256 * 256);
  for (let a = 1; a < 256; a++) {
    for (let c = 0; c < 256; c++) table[a * 256 + c] = Math.min(255, Math.round((c * 255) / a));
  }
  return table;
})();

/** Converts premultiplied BGRA to straight alpha in place. */
export function unpremultiplyBgra(pixels: Uint8Array): void {
  const length = pixels.length - (pixels.length % 4);
  for (let i = 0; i < length; i += 4) {
    const a = pixels[i + 3];
    if (a === 255) continue;
    if (a === 0) { pixels[i] = 0; pixels[i + 1] = 0; pixels[i + 2] = 0; continue; }
    const row = a << 8;
    pixels[i] = LUT[row + pixels[i]];
    pixels[i + 1] = LUT[row + pixels[i + 1]];
    pixels[i + 2] = LUT[row + pixels[i + 2]];
  }
}
