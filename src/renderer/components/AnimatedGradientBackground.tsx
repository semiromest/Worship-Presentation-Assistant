import { useEffect, useRef } from 'react';
import type { GeneratedBackground } from '../../shared/generatedBackground';
import './AnimatedGradientBackground.css';

const WIDTH = 192;
const HEIGHT = 108;

/** A continuously deforming color field. The stored JPEG remains the export fallback. */
export function AnimatedGradientBackground({ recipe, active = true }: { recipe?: GeneratedBackground; active?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const elapsedRef = useRef(0);
  const enabled = recipe?.motion?.enabled === true;
  const speed = Math.max(1, Math.min(100, recipe?.motion?.speed ?? 40));
  const amount = Math.max(1, Math.min(100, recipe?.motion?.amount ?? 50));
  const colorsKey = recipe?.colors.join(',') ?? '';
  const seed = recipe?.seed ?? 0;
  const darkness = recipe?.darkness ?? 25;
  const kind = recipe?.style ?? 'flow';
  const animation = recipe?.motion?.type ?? 'flow';

  useEffect(() => { elapsedRef.current = 0; }, [seed, colorsKey, kind, animation]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!enabled || !canvas) return;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    const frame = ctx.createImageData(WIDTH, HEIGHT);
    const palette = colorsKey.split(',').slice(0, 4).map(color =>
      [1, 3, 5].map(offset => parseInt(color.slice(offset, offset + 2), 16) || 0));
    if (palette.length !== 4) return;
    const strength = .35 + amount / 100 * .85;
    const rate = .12 + speed / 100 * .68;
    const shade = 1 - Math.max(0, Math.min(85, darkness)) / 100;
    const phase = (seed % 6283) / 1000;
    const xWaves = new Float32Array(WIDTH);
    const yWaves = new Float32Array(HEIGHT);
    const curtains = Array.from({ length: 3 }, () => new Float32Array(WIDTH));
    const curtainLight = new Float32Array(WIDTH);
    const centers = palette.map((color, i) => ({ color, x: 0, y: 0, radius: 0, phase: phase + i * 1.73 }));
    let raf = 0;
    let previous = 0;
    let lastDraw = -Infinity;
    const draw = (timestamp: number) => {
      // Stop scheduling when paused/hidden; CSS scaling smoothly enlarges the small field.
      if (active && !document.hidden) {
        if (previous) elapsedRef.current += Math.min(timestamp - previous, 100);
        previous = timestamp;
      }
      const t = elapsedRef.current / 1000 * rate + phase;
      for (let i = 0; i < centers.length; i++) {
        const center = centers[i];
        const p = center.phase;
        center.x = (i % 2 ? .78 : .22) + (Math.sin(t * .93 + p) * .34 + Math.cos(t * .47 + i) * .13) * strength;
        center.y = (i > 1 ? .78 : .22) + (Math.cos(t * .81 + p) * .34 + Math.sin(t * .53 + i) * .12) * strength;
        center.radius = .025 + (.5 + .5 * Math.sin(t * .7 + p)) * .035;
      }
      const warp = (kind === 'flow' ? .15 : .065) * strength;
      for (let x = 0; x < WIDTH; x++) xWaves[x] = Math.sin(x / WIDTH * 6.2 + t * .8);
      for (let y = 0; y < HEIGHT; y++) yWaves[y] = Math.cos(y / HEIGHT * 5.4 - t * .65);
      if (animation === 'aurora') for (let x = 0; x < WIDTH; x++) {
        const u = x / (WIDTH - 1);
        curtainLight[x] = .65 + .35 * Math.sin(u * 35 + t * .6) ** 2;
        for (let band = 0; band < 3; band++) {
          curtains[band][x] = .25 + band * .22 + Math.sin(u * 4.8 + t * .8 + band * 1.9) * .18 * strength
            + Math.sin(u * 10 - t * .4 + band) * .05 * strength;
        }
      }
      for (let y = 0; y < HEIGHT; y++) {
        for (let x = 0; x < WIDTH; x++) {
          const px = x / (WIDTH - 1) + yWaves[y] * warp;
          const py = y / (HEIGHT - 1) + xWaves[x] * warp;
          let red = 0, green = 0, blue = 0, total = 0;
          if (animation === 'waves' || animation === 'fog') {
            const u = x / (WIDTH - 1), v = y / (HEIGHT - 1);
            let position: number;
            if (animation === 'waves') {
              position = (v + Math.sin(u * 6.2 + t) * .13 * strength
                + Math.sin(u * 3.1 - t * .65) * .09 * strength + t * .055) * 3;
            } else {
              const cloud = .5 + Math.sin(u * 3.8 + Math.cos(v * 4.5 + t * .28) + t * .34) * .2 * strength
                + Math.sin(v * 5.1 + Math.sin(u * 3.2 - t * .21) - t * .25) * .2 * strength
                + Math.sin(u * 8 + v * 5 + Math.sin(t * .3)) * .075 * strength;
              position = Math.max(0, Math.min(.999, cloud)) * 3;
            }
            position = ((position % 4) + 4) % 4;
            const index = Math.floor(position), fraction = position - index;
            const mix = fraction * fraction * (3 - 2 * fraction);
            const a = palette[index], b = palette[(index + 1) % 4];
            red = a[0] + (b[0] - a[0]) * mix;
            green = a[1] + (b[1] - a[1]) * mix;
            blue = a[2] + (b[2] - a[2]) * mix;
            if (animation === 'fog') {
              red = red * .82 + 120 * .18;
              green = green * .82 + 130 * .18;
              blue = blue * .82 + 145 * .18;
            }
            total = 1;
          } else if (animation === 'aurora') {
            red = palette[0][0] * .28; green = palette[0][1] * .28; blue = palette[0][2] * .28;
            total = 1;
            for (let band = 0; band < 3; band++) {
              const distance = y / (HEIGHT - 1) - curtains[band][x];
              const falloff = 1 + distance * distance * (100 + amount);
              const weight = 4 * curtainLight[x] / (falloff * falloff);
              const color = palette[band + 1];
              red += color[0] * weight; green += color[1] * weight; blue += color[2] * weight;
              total += weight;
            }
          } else for (const center of centers) {
            const dx = px - center.x, dy = py - center.y;
            const distance = center.radius + dx * dx + dy * dy;
            const weight = 1 / (distance * distance);
            total += weight;
            red += center.color[0] * weight;
            green += center.color[1] * weight;
            blue += center.color[2] * weight;
          }
          const offset = (y * WIDTH + x) * 4;
          frame.data[offset] = Math.round(red / total * shade);
          frame.data[offset + 1] = Math.round(green / total * shade);
          frame.data[offset + 2] = Math.round(blue / total * shade);
          frame.data[offset + 3] = 255;
        }
      }
      ctx.putImageData(frame, 0, 0);
      lastDraw = timestamp;
    };
    const tick = (timestamp: number) => {
      if (timestamp - lastDraw >= 1000 / 24) draw(timestamp);
      raf = requestAnimationFrame(tick);
    };
    const resume = () => {
      cancelAnimationFrame(raf);
      previous = 0;
      if (active && !document.hidden) raf = requestAnimationFrame(tick);
    };
    // Paint immediately, including when a live preview is paused.
    draw(performance.now());
    resume();
    document.addEventListener('visibilitychange', resume);
    return () => { cancelAnimationFrame(raf); document.removeEventListener('visibilitychange', resume); };
  }, [enabled, active, speed, amount, colorsKey, seed, darkness, kind, animation]);

  if (!enabled) return null;
  return <canvas ref={canvasRef} width={WIDTH} height={HEIGHT} className="animated-gradient-background" aria-hidden="true" />;
}
