export interface ContrastRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  color: [number, number, number];
}
export interface ContrastResult {
  minimum: number | null;
  checked: number;
}
const linear = Array.from({ length: 256 }, (_, v) =>
  v / 255 <= 0.04045 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4
);
const luminance = (r: number, g: number, b: number) => 0.2126 * linear[r] + 0.7152 * linear[g] + 0.0722 * linear[b];
export function checkGradientContrast(
  data: Uint8Array,
  width: number,
  height: number,
  regions: ContrastRegion[]
): ContrastResult {
  let minimum = Infinity,
    checked = 0;
  const visited = new Set<string>();
  for (const region of regions) {
    const key = [region.x, region.y, region.width, region.height, ...region.color].join(',');
    if (visited.has(key)) continue;
    visited.add(key);
    const fg = luminance(...region.color);
    const x0 = Math.max(0, Math.floor(region.x)),
      y0 = Math.max(0, Math.floor(region.y));
    const x1 = Math.min(width, Math.ceil(region.x + region.width)),
      y1 = Math.min(height, Math.ceil(region.y + region.height));
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        const i = (y * width + x) * 4;
        const bg = luminance(data[i], data[i + 1], data[i + 2]);
        minimum = Math.min(minimum, (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05));
        checked++;
      }
  }
  return { minimum: checked ? minimum : null, checked };
}
