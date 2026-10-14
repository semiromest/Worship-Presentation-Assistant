/** Reproducible, development-only comparison. Paper is never shipped in the product. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';
import sharp from 'sharp';
import jpeg from 'jpeg-js';
import { createHash } from 'node:crypto';
import { GRADIENT_PALETTES, renderGradient, type GeneratedBackground } from '../src/shared/generatedBackground';
import { encodeGradient } from '../src/main/gradientRender';

async function main() {
  const dir = path.resolve('.tmp/gradient-evidence');
  await fs.mkdir(dir, { recursive: true });
  const packageRoot = path.resolve('.tmp/gradient-paper/package');
  const license = await fs.readFile(path.join(packageRoot, 'LICENSE'), 'utf8');
  if (!license.includes('Apache License') || !license.includes('Version 2.0'))
    throw new Error('Paper license not verified');
  await fs.copyFile(path.join(packageRoot, 'LICENSE'), path.join(dir, 'PAPER-LICENSE.txt'));
  await fs.copyFile(path.join(packageRoot, 'NOTICE'), path.join(dir, 'PAPER-NOTICE.txt'));
  const source = `import {ShaderMount,meshGradientFragmentShader,getShaderColorFromString} from ${JSON.stringify(path.join(packageRoot, 'dist/index.js').replaceAll('\\', '/'))};
    window.renderPaper = async (colors) => {
      document.body.innerHTML='<div id="paper" style="width:1920px;height:1080px"></div>';
      const mount=new ShaderMount(document.getElementById('paper'),meshGradientFragmentShader,{
        u_colors:colors.map(getShaderColorFromString),u_colorsCount:4,u_distortion:.65,u_swirl:.1,u_grainMixer:0,u_grainOverlay:.015,
        u_originX:.5,u_originY:.5,u_worldWidth:0,u_worldHeight:0,u_fit:2,u_scale:1,u_rotation:0,u_offsetX:0,u_offsetY:0
      },{preserveDrawingBuffer:true},0,42000,1,2073600);
      await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
      const canvas=mount.canvasElement;
      if(canvas.width!==1920||canvas.height!==1080)throw new Error('Wrong physical dimensions '+canvas.width+'x'+canvas.height);
      const out=document.createElement('canvas');out.width=1920;out.height=1080;const ctx=out.getContext('2d');ctx.drawImage(canvas,0,0);
      ctx.fillStyle='rgba(0,0,0,.25)';ctx.fillRect(0,0,1920,1080);const bytes=ctx.getImageData(0,0,1920,1080).data;
      const result=btoa(Array.from(bytes,b=>String.fromCharCode(b)).join(''));mount.dispose();return result;
    };`;
  const bundle = await build({
    stdin: { contents: source, resolveDir: process.cwd() },
    bundle: true,
    write: false,
    format: 'iife',
  });
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  const rows: Record<string, unknown>[] = [];
  try {
    for (const palette of ['ocean', 'lavender', 'sunset'] as const) {
      const recipe: GeneratedBackground = {
        engineVersion: 1,
        seed: 20261014,
        colors: [...GRADIENT_PALETTES[palette]],
        palette,
        style: 'flow',
        darkness: 25,
        width: 1920,
        height: 1080,
      };
      const cpu = encodeGradient(recipe);
      const paperResults: { scale: number; rgba: Buffer }[] = [];
      for (const scale of [1, 1.5, 2]) {
        const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: scale });
        const page = await context.newPage();
        await page.setContent('<html><body style="margin:0"></body></html>');
        await page.addScriptTag({ content: bundle.outputFiles[0].text });
        const base64 = await page.evaluate((colors) => (window as any).renderPaper(colors), recipe.colors);
        paperResults.push({ scale, rgba: Buffer.from(base64, 'base64') });
        await context.close();
      }
      for (const engine of ['software', 'paper'] as const) {
        const rgba = engine === 'software' ? renderGradient(recipe) : paperResults[0].rgba;
        const raw = { raw: { width: 1920, height: 1080, channels: 4 as const } };
        const images: { name: string; data: Buffer; ms: number }[] = [];
        let start = performance.now();
        const jpg = engine === 'software' ? cpu.bytes : jpeg.encode({ data: rgba, width: 1920, height: 1080 }, 90).data;
        images.push({ name: 'jpg', data: jpg, ms: engine === 'software' ? cpu.encodeMs : performance.now() - start });
        start = performance.now();
        images.push({ name: 'png', data: await sharp(rgba, raw).png().toBuffer(), ms: performance.now() - start });
        start = performance.now();
        images.push({
          name: 'webp',
          data: await sharp(rgba, raw).webp({ quality: 90 }).toBuffer(),
          ms: performance.now() - start,
        });
        for (const image of images) {
          await fs.writeFile(path.join(dir, `${palette}-${engine}.${image.name}`), image.data);
          rows.push({
            palette,
            engine,
            format: image.name,
            bytes: image.data.length,
            encodeMs: Math.round(image.ms),
            width: 1920,
            height: 1080,
            ...(engine === 'software'
              ? { rgbaHash: cpu.rgbaHash, jpegHash: cpu.jpegHash, renderMs: Math.round(cpu.renderMs) }
              : {
                  scales: paperResults.map((p) => ({
                    scale: p.scale,
                    rgbaHash: createHash('sha256').update(p.rgba).digest('hex'),
                  })),
                }),
          });
        }
      }
      for (const text of [false, true]) {
        const panels = [];
        for (const engine of ['software', 'paper']) {
          const label = engine === 'software' ? 'Software · deterministic' : 'Paper · WebGL2';
          const svg = `<svg width="960" height="540"><rect width="960" height="48" fill="#111827"/><text x="20" y="32" font-family="Arial" font-size="22" fill="white">${palette} — ${label}</text>${text ? '<text x="480" y="245" text-anchor="middle" font-family="Arial" font-weight="bold" font-size="42" fill="white"><tspan x="480">Rab çobanımdır;</tspan><tspan x="480" dy="60">eksiğim olmaz.</tspan><tspan x="480" dy="60">Mezmur 23:1</tspan></text>' : ''}</svg>`;
          panels.push(
            await sharp(path.join(dir, `${palette}-${engine}.jpg`))
              .resize(960, 540)
              .composite([{ input: Buffer.from(svg) }])
              .png()
              .toBuffer()
          );
        }
        await sharp({ create: { width: 1920, height: 540, channels: 3, background: '#000' } })
          .composite([
            { input: panels[0], left: 0, top: 0 },
            { input: panels[1], left: 960, top: 0 },
          ])
          .png()
          .toFile(path.join(dir, `${palette}-comparison${text ? '-text' : ''}.png`));
      }
    }
  } finally {
    await browser.close();
  }
  await fs.writeFile(
    path.join(dir, 'measurements.json'),
    JSON.stringify(
      {
        platform: process.platform,
        arch: process.arch,
        node: process.version,
        note: 'DPR emulation is not a physical Windows scaling or old GPU test. JPEG/PNG/WebP are encoded from the same raw image per engine.',
        rows,
      },
      null,
      2
    )
  );
  console.log(
    JSON.stringify(
      rows.map(({ palette, engine, format, bytes, encodeMs }) => ({ palette, engine, format, bytes, encodeMs })),
      null,
      2
    )
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
