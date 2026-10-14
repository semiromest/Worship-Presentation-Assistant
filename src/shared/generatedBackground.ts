/** Portable v1 recipe. Changing the raster algorithm requires a new version. */
export interface GeneratedBackground {
  engineVersion: 1;
  seed: number;
  colors: string[];
  palette: string;
  style: 'soft' | 'flow';
  darkness: number;
  width: 1920;
  height: 1080;
  motion?: { enabled: boolean; speed: number; amount: number; type?: 'flow' | 'aurora' | 'waves' | 'fog' };
}

export const GRADIENT_PALETTES = {
  night: ['#0c122f', '#35347d', '#695c99', '#183356'],
  ocean: ['#071b38', '#135d86', '#348b9c', '#62609b'],
  emerald: ['#092d2a', '#17685b', '#64a18a', '#304454'],
  lavender: ['#282046', '#73558a', '#af819b', '#536895'],
  sunset: ['#321b49', '#a94d79', '#e18a72', '#6864a0'],
  amber: ['#352a25', '#9a6740', '#c9a575', '#645370'],
  rose: ['#3d223c', '#914b75', '#c187a2', '#676a91'],
  smoke: ['#17212e', '#4e6676', '#9babb2', '#605f7b'],
} as const;

export function validateGradient(value: unknown): GeneratedBackground {
  const r = value as GeneratedBackground;
  if (r?.motion?.type !== undefined && !['flow', 'aurora', 'waves', 'fog'].includes(r.motion.type)) {
    throw new Error('Invalid gradient animation');
  }
  if (r?.motion && (typeof r.motion.enabled !== 'boolean' || !Number.isInteger(r.motion.speed) ||
    r.motion.speed < 1 || r.motion.speed > 100 || !Number.isInteger(r.motion.amount) || r.motion.amount < 1 || r.motion.amount > 100)) {
    throw new Error('Invalid gradient motion');
  }
  if (
    !r ||
    r.engineVersion !== 1 ||
    r.width !== 1920 ||
    r.height !== 1080 ||
    !Number.isInteger(r.seed) ||
    r.seed < 0 ||
    r.seed > 0xffffffff ||
    !Number.isInteger(r.darkness) ||
    r.darkness < 0 ||
    r.darkness > 85 ||
    !['soft', 'flow'].includes(r.style) ||
    typeof r.palette !== 'string' ||
    r.palette.length > 32 ||
    !Array.isArray(r.colors) ||
    r.colors.length !== 4 ||
    !r.colors.every((c) => /^#[0-9a-f]{6}$/i.test(c))
  ) {
    throw new Error('Invalid gradient recipe');
  }
  return {
    engineVersion: 1,
    seed: r.seed,
    width: 1920,
    height: 1080,
    colors: [...r.colors],
    palette: r.palette,
    style: r.style,
    darkness: r.darkness,
    ...(r.motion ? { motion: { ...r.motion } } : {}),
  };
}

/** Int32-only hash, including coordinate noise. No Math.random/trigonometry/blur. */
function hash(x: number): number {
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b);
  return (x ^ (x >>> 16)) >>> 0;
}
const lerp = (a: number, b: number, t: number) => a + Math.floor(((b - a) * t) / 65536);
function smooth(t: number): number {
  const squared = Math.floor((t * t) / 65536);
  return Math.floor((squared * (196608 - 2 * t)) / 65536);
}
function field(x: number, y: number, seed: number): number {
  const gx = Math.floor(x / 65536),
    gy = Math.floor(y / 65536);
  const tx = smooth(x - gx * 65536),
    ty = smooth(y - gy * 65536);
  const at = (dx: number, dy: number) =>
    hash(seed ^ Math.imul(gx + dx, 73856093) ^ Math.imul(gy + dy, 19349663)) & 65535;
  return lerp(lerp(at(0, 0), at(1, 0), tx), lerp(at(0, 1), at(1, 1), tx), ty);
}

/** Pixel arithmetic stays within exact IEEE integer range; RGBA is platform independent. */
export function renderGradient(input: GeneratedBackground): Uint8Array {
  const r = validateGradient(input);
  const colors = r.colors.map((c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)));
  const data = new Uint8Array(r.width * r.height * 4);
  // Compute a smooth field on a fixed 241 × 136 lattice, then interpolate explicitly.
  const gw = 241,
    gh = 136;
  const grid = new Uint8Array(gw * gh * 3);
  const spots = colors.map((color, i) => ({
    color,
    x: [4000, 52000, 12000, 58000][i] + (hash(r.seed + i * 53) % 18000) - 9000,
    y: [8000, 13000, 55000, 50000][i] + (hash(r.seed + i * 97) % 20000) - 10000,
  }));
  for (let gy = 0; gy < gh; gy++)
    for (let gx = 0; gx < gw; gx++) {
      let x = Math.floor((gx * 65536) / (gw - 1)),
        y = Math.floor((gy * 65536) / (gh - 1));
      const strength = r.style === 'flow' ? 29000 : 8000;
      x += Math.floor(((field(x * 2, y * 2, r.seed) - 32768) * strength) / 65536);
      y += Math.floor(((field(x * 2 + 17000, y * 2, r.seed ^ 0x1234) - 32768) * strength) / 65536);
      let total = 0;
      const sums = [0, 0, 0];
      for (const s of spots) {
        const dx = Math.floor((x - s.x) / 32),
          dy = Math.floor((y - s.y) / 32);
        const w = Math.max(1, Math.floor(0x100000000 / (100000 + dx * dx + dy * dy)));
        const weight = w * w;
        total += weight;
        for (let c = 0; c < 3; c++) sums[c] += s.color[c] * weight;
      }
      for (let c = 0; c < 3; c++) grid[(gy * gw + gx) * 3 + c] = Math.floor(sums[c] / total);
    }
  const xs = Array.from({ length: r.width }, (_, x) => Math.floor((x * (gw - 1) * 65536) / (r.width - 1)));
  for (let y = 0; y < r.height; y++) {
    const fy = Math.floor((y * (gh - 1) * 65536) / (r.height - 1));
    const gy = Math.min(gh - 2, Math.floor(fy / 65536)),
      ty = fy - gy * 65536;
    for (let x = 0; x < r.width; x++) {
      const fx = xs[x],
        gx = Math.min(gw - 2, Math.floor(fx / 65536)),
        tx = fx - gx * 65536;
      const i = (y * r.width + x) * 4;
      const noise = (hash(r.seed ^ Math.imul(x, 73856093) ^ Math.imul(y, 19349663)) % 3) - 1;
      for (let c = 0; c < 3; c++) {
        const at = (gy * gw + gx) * 3 + c;
        const v = lerp(lerp(grid[at], grid[at + 3], tx), lerp(grid[at + gw * 3], grid[at + gw * 3 + 3], tx), ty);
        data[i + c] = Math.max(0, Math.min(255, Math.floor((v * (100 - r.darkness)) / 100) + noise));
      }
      data[i + 3] = 255;
    }
  }
  return data;
}
