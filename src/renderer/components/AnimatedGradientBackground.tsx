import { useEffect, useRef } from 'react';
import type { GeneratedBackground } from '../../shared/generatedBackground';
import './AnimatedGradientBackground.css';

const WIDTH = 192;
const HEIGHT = 108;
const FRAME_MS = 1000 / 24;
const MAX_STEP_MS = 100;
/** Palet segmenti başına arama tablosu girdisi. İki üssü olmalı (indeks çarpımı tam kalsın). */
const LUT_STEPS = 1024;
const FOG_TINT = [120, 130, 145] as const;

type Rgb = [number, number, number];
type Render = (t: number) => void;

// Pikseli tek bir 32 bit yazımla basmak için kanal dizilimi platformun endianlığına göre seçilir.
const LITTLE_ENDIAN = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;
const SHIFT_R = LITTLE_ENDIAN ? 0 : 24;
const SHIFT_G = LITTLE_ENDIAN ? 8 : 16;
const SHIFT_B = LITTLE_ENDIAN ? 16 : 8;
const ALPHA = LITTLE_ENDIAN ? 0xff000000 : 0xff;

/** Değerler 0..255 aralığında ve negatif değil; `+ .5 | 0` Math.round ile aynıdır. */
const pack = (r: number, g: number, b: number) =>
  ALPHA | (((r + .5) | 0) << SHIFT_R) | (((g + .5) | 0) << SHIFT_G) | (((b + .5) | 0) << SHIFT_B);

function table(length: number, fn: (i: number) => number): Float64Array {
  const out = new Float64Array(length);
  for (let i = 0; i < length; i++) out[i] = fn(i);
  return out;
}

// Kareden kareye değişmeyen tablolar bir kez, modül yüklenirken hesaplanır.
const X_NORM = table(WIDTH, x => x / (WIDTH - 1));
const Y_NORM = table(HEIGHT, y => y / (HEIGHT - 1));
const X_WAVE = table(WIDTH, x => x / WIDTH * 6.2);
const Y_WAVE = table(HEIGHT, y => y / HEIGHT * 5.4);
const Y_RAMP = table(HEIGHT, y => Y_NORM[y] * 3);
const SIN_5V = table(HEIGHT, y => Math.sin(Y_NORM[y] * 5));
const COS_5V = table(HEIGHT, y => Math.cos(Y_NORM[y] * 5));

function parsePalette(colorsKey: string): Rgb[] | null {
  const colors = colorsKey.split(',').slice(0, 4);
  if (colors.length !== 4) return null;
  return colors.map(color => [1, 3, 5].map(offset => parseInt(color.slice(offset, offset + 2), 16) || 0) as Rgb);
}

/** 4 renkli döngüsel gradyanı (smoothstep karışımı) önceden örnekler: piksel başına tek tablo okuması. */
function buildRamp(colors: Rgb[]): Uint32Array {
  const ramp = new Uint32Array(LUT_STEPS * 4);
  for (let k = 0; k < ramp.length; k++) {
    const position = (k + .5) / LUT_STEPS;
    const index = position | 0;
    const fraction = position - index;
    const mix = fraction * fraction * (3 - 2 * fraction);
    const a = colors[index];
    const b = colors[(index + 1) % 4];
    ramp[k] = pack(a[0] + (b[0] - a[0]) * mix, a[1] + (b[1] - a[1]) * mix, a[2] + (b[2] - a[2]) * mix);
  }
  return ramp;
}

/**
 * Dört bulanık leke. Ağırlıklı ortalama Σcᵢ/qᵢ / Σ1/qᵢ, paydaları eşitlenerek
 * (wᵢ = Π qⱼ, j≠i) yazılır: piksel başına 5 yerine 1 bölme.
 */
function createBlobRender(pixels: Uint32Array, colors: Rgb[], strength: number, warp: number, phase: number): Render {
  const [[cr0, cg0, cb0], [cr1, cg1, cb1], [cr2, cg2, cb2], [cr3, cg3, cb3]] = colors;
  const cx = new Float64Array(4);
  const cy = new Float64Array(4);
  const cs = new Float64Array(4);
  const xShift = new Float64Array(WIDTH);
  return t => {
    for (let i = 0; i < 4; i++) {
      const p = phase + i * 1.73;
      cx[i] = (i % 2 ? .78 : .22) + (Math.sin(t * .93 + p) * .34 + Math.cos(t * .47 + i) * .13) * strength;
      cy[i] = (i > 1 ? .78 : .22) + (Math.cos(t * .81 + p) * .34 + Math.sin(t * .53 + i) * .12) * strength;
      cs[i] = .025 + (.5 + .5 * Math.sin(t * .7 + p)) * .035;
    }
    const x0 = cx[0], x1 = cx[1], x2 = cx[2], x3 = cx[3];
    const y0 = cy[0], y1 = cy[1], y2 = cy[2], y3 = cy[3];
    const s0 = cs[0], s1 = cs[1], s2 = cs[2], s3 = cs[3];
    for (let x = 0; x < WIDTH; x++) xShift[x] = Math.sin(X_WAVE[x] + t * .8) * warp;
    let o = 0;
    for (let y = 0; y < HEIGHT; y++) {
      const ny = Y_NORM[y];
      const yShift = Math.cos(Y_WAVE[y] - t * .65) * warp;
      for (let x = 0; x < WIDTH; x++) {
        const px = X_NORM[x] + yShift;
        const py = ny + xShift[x];
        const ax = px - x0, ay = py - y0, da = s0 + ax * ax + ay * ay;
        const bx = px - x1, by = py - y1, db = s1 + bx * bx + by * by;
        const ex = px - x2, ey = py - y2, dc = s2 + ex * ex + ey * ey;
        const fx = px - x3, fy = py - y3, dd = s3 + fx * fx + fy * fy;
        const q0 = da * da, q1 = db * db, q2 = dc * dc, q3 = dd * dd;
        const q01 = q0 * q1, q23 = q2 * q3;
        const w0 = q1 * q23, w1 = q0 * q23, w2 = q3 * q01, w3 = q2 * q01;
        const inv = 1 / (w0 + w1 + w2 + w3);
        pixels[o++] = pack(
          (cr0 * w0 + cr1 * w1 + cr2 * w2 + cr3 * w3) * inv,
          (cg0 * w0 + cg1 * w1 + cg2 * w2 + cg3 * w3) * inv,
          (cb0 * w0 + cb1 * w1 + cb2 * w2 + cb3 * w3) * inv,
        );
      }
    }
  };
}

/** Konum = satır terimi + sütun terimi. Sinüsler sütun başına (192), piksel başına değil. */
function createWavesRender(pixels: Uint32Array, ramp: Uint32Array, strength: number): Render {
  const column = new Float64Array(WIDTH);
  return t => {
    for (let x = 0; x < WIDTH; x++) {
      const u = X_NORM[x];
      const raw = (Math.sin(u * 6.2 + t) * .13 * strength + Math.sin(u * 3.1 - t * .65) * .09 * strength + t * .055) * 3;
      column[x] = ((raw % 4) + 4) % 4;
    }
    let o = 0;
    for (let y = 0; y < HEIGHT; y++) {
      const row = Y_RAMP[y];
      for (let x = 0; x < WIDTH; x++) {
        let p = row + column[x];
        if (p >= 4) p -= 4;
        pixels[o++] = ramp[(p * LUT_STEPS) | 0];
      }
    }
  };
}

/**
 * sin(a + b) = sin a cos b + cos a sin b ile üç iç içe sinüs ayrıştırılır:
 * trigonometri yalnızca sütun/satır başına hesaplanır, piksel başına sadece çarpma-toplama kalır.
 */
function createFogRender(pixels: Uint32Array, ramp: Uint32Array, strength: number): Render {
  const k1 = .2 * strength;
  const k3 = .075 * strength;
  const sA = new Float64Array(WIDTH), cA = new Float64Array(WIDTH);
  const sD = new Float64Array(WIDTH), cD = new Float64Array(WIDTH);
  const sE = new Float64Array(WIDTH), cE = new Float64Array(WIDTH);
  const scale = 3 * LUT_STEPS;
  return t => {
    const tilt = Math.sin(t * .3);
    for (let x = 0; x < WIDTH; x++) {
      const u = X_NORM[x];
      const a = u * 3.8 + t * .34;
      const d = Math.sin(u * 3.2 - t * .21);
      const e = u * 8 + tilt;
      sA[x] = Math.sin(a) * k1; cA[x] = Math.cos(a) * k1;
      sD[x] = Math.sin(d) * k1; cD[x] = Math.cos(d) * k1;
      sE[x] = Math.sin(e) * k3; cE[x] = Math.cos(e) * k3;
    }
    let o = 0;
    for (let y = 0; y < HEIGHT; y++) {
      const v = Y_NORM[y];
      const b = Math.cos(v * 4.5 + t * .28);
      const sB = Math.sin(b), cB = Math.cos(b);
      const c = v * 5.1 - t * .25;
      const sC = Math.sin(c), cC = Math.cos(c);
      const sF = SIN_5V[y], cF = COS_5V[y];
      for (let x = 0; x < WIDTH; x++) {
        let cloud = .5 + sA[x] * cB + cA[x] * sB + sC * cD[x] + cC * sD[x] + sE[x] * cF + cE[x] * sF;
        cloud = cloud < 0 ? 0 : cloud > .999 ? .999 : cloud;
        pixels[o++] = ramp[(cloud * scale) | 0];
      }
    }
  };
}

/** Üç perde + taban. Ağırlıkların paydası eşitlenerek piksel başına tek bölme kullanılır. */
function createAuroraRender(pixels: Uint32Array, colors: Rgb[], strength: number, amount: number): Render {
  const [base, [r0, g0, b0], [r1, g1, b1], [r2, g2, b2]] = colors;
  const baseR = base[0] * .28, baseG = base[1] * .28, baseB = base[2] * .28;
  const falloff = 100 + amount;
  const light = new Float64Array(WIDTH);
  const heights = [new Float64Array(WIDTH), new Float64Array(WIDTH), new Float64Array(WIDTH)];
  const [h0, h1, h2] = heights;
  return t => {
    for (let x = 0; x < WIDTH; x++) {
      const u = X_NORM[x];
      const shimmer = Math.sin(u * 35 + t * .6);
      light[x] = 4 * (.65 + .35 * shimmer * shimmer);
      for (let band = 0; band < 3; band++) {
        heights[band][x] = .25 + band * .22
          + Math.sin(u * 4.8 + t * .8 + band * 1.9) * .18 * strength
          + Math.sin(u * 10 - t * .4 + band) * .05 * strength;
      }
    }
    let o = 0;
    for (let y = 0; y < HEIGHT; y++) {
      const v = Y_NORM[y];
      for (let x = 0; x < WIDTH; x++) {
        const d0 = v - h0[x], d1 = v - h1[x], d2 = v - h2[x];
        const f0 = 1 + d0 * d0 * falloff, f1 = 1 + d1 * d1 * falloff, f2 = 1 + d2 * d2 * falloff;
        const q0 = f0 * f0, q1 = f1 * f1, q2 = f2 * f2;
        const q01 = q0 * q1, q02 = q0 * q2, q12 = q1 * q2, all = q01 * q2;
        const l = light[x];
        const inv = 1 / (all + l * (q12 + q02 + q01));
        pixels[o++] = pack(
          (baseR * all + l * (r0 * q12 + r1 * q02 + r2 * q01)) * inv,
          (baseG * all + l * (g0 * q12 + g1 * q02 + g2 * q01)) * inv,
          (baseB * all + l * (b0 * q12 + b1 * q02 + b2 * q01)) * inv,
        );
      }
    }
  };
}

interface Scene {
  pixels: Uint32Array;
  palette: Rgb[];
  shade: number;
  strength: number;
  amount: number;
  warp: number;
  phase: number;
}

/** Mod seçimi piksel döngüsünün dışında, bir kez yapılır. Kararma (shade) paletin içine gömülür. */
function createRender(animation: string, { pixels, palette, shade, strength, amount, warp, phase }: Scene): Render {
  const shaded = palette.map(color => color.map(v => v * shade) as Rgb);
  switch (animation) {
    case 'waves':
      return createWavesRender(pixels, buildRamp(shaded), strength);
    case 'fog': {
      const fogged = palette.map(color => color.map((v, i) => (v * .82 + FOG_TINT[i] * .18) * shade) as Rgb);
      return createFogRender(pixels, buildRamp(fogged), strength);
    }
    case 'aurora':
      return createAuroraRender(pixels, shaded, strength, amount);
    default:
      return createBlobRender(pixels, shaded, strength, warp, phase);
  }
}

/** A continuously deforming color field. The stored JPEG remains the export fallback. */
export function AnimatedGradientBackground({ recipe, active = true }: { recipe?: GeneratedBackground; active?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const elapsedRef = useRef(0);
  const activeRef = useRef(active);
  const resumeRef = useRef<(() => void) | null>(null);
  const enabled = recipe?.motion?.enabled === true && recipe.style !== 'linear';
  const speed = Math.max(1, Math.min(100, recipe?.motion?.speed ?? 40));
  const amount = Math.max(1, Math.min(100, recipe?.motion?.amount ?? 50));
  const colorsKey = recipe?.colors.join(',') ?? '';
  const seed = recipe?.seed ?? 0;
  const darkness = recipe?.darkness ?? 25;
  const kind = recipe?.style ?? 'flow';
  const animation = recipe?.motion?.type ?? 'flow';

  useEffect(() => { elapsedRef.current = 0; }, [seed, colorsKey, kind, animation]);

  // Renderer yalnızca görsel parametreler değişince kurulur; `active` değişimi buraya dokunmaz.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!enabled || !canvas) return;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;
    const palette = parsePalette(colorsKey);
    if (!palette) return;

    const strength = .35 + amount / 100 * .85;
    const rate = .12 + speed / 100 * .68;
    const phase = (seed % 6283) / 1000;
    const frame = ctx.createImageData(WIDTH, HEIGHT);
    const render = createRender(animation, {
      pixels: new Uint32Array(frame.data.buffer),
      palette,
      shade: 1 - Math.max(0, Math.min(85, darkness)) / 100,
      strength,
      amount,
      warp: (kind === 'flow' ? .15 : .065) * strength,
      phase,
    });

    let raf = 0;
    let previous = 0;
    let lastDraw = -Infinity;
    const paint = () => {
      render(elapsedRef.current / 1000 * rate + phase);
      ctx.putImageData(frame, 0, 0);
    };
    const tick = (timestamp: number) => {
      raf = requestAnimationFrame(tick);
      if (timestamp - lastDraw < FRAME_MS) return;
      if (previous) elapsedRef.current += Math.min(timestamp - previous, MAX_STEP_MS);
      previous = timestamp;
      lastDraw = timestamp;
      paint();
    };
    // Duraklatılmış/gizli sekmede döngü hiç planlanmaz; canvas boyutu JSX niteliklerinden gelir.
    const resume = () => {
      cancelAnimationFrame(raf);
      previous = 0;
      if (activeRef.current && !document.hidden) raf = requestAnimationFrame(tick);
    };

    // Paused önizlemede bile hemen bir kare çiz.
    paint();
    lastDraw = performance.now();
    resumeRef.current = resume;
    resume();
    document.addEventListener('visibilitychange', resume);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', resume);
      resumeRef.current = null;
    };
  }, [enabled, speed, amount, colorsKey, seed, darkness, kind, animation]);

  // Duraklat/devam et: renderer'ı yeniden kurmadan yalnızca döngüyü açıp kapatır.
  useEffect(() => {
    activeRef.current = active;
    resumeRef.current?.();
  }, [active]);

  if (!enabled) return null;
  return <canvas ref={canvasRef} width={WIDTH} height={HEIGHT} className="animated-gradient-background" aria-hidden="true" />;
}