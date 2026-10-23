import AdmZip from 'adm-zip';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { clearFontCache, collectUsedFonts, convertPptxToSvg, DEFAULT_FONT_MAPPING, getMappedFont, getWarningEntries, type SlideImage } from 'pptx-glimpse';
import { mapLimit, platformFontFallbacks, requiredDeckFonts, selectSystemFontFiles } from './pptxFontFiles';

/** Çıktı genişliği. Değiştirmek, içe aktarılmış tüm slaytların piksellerini değiştirir. */
const OUTPUT_WIDTH = 1024;
/** Eşzamanlı rasterlama. SVG içindeki büyük bitmap'ler açılınca bellek artar; yükselirse 1 yapın. */
const RASTER_CONCURRENCY = 2;
const BASE_FALLBACK_FONTS = ['Arial', 'Calibri', 'Liberation Sans', 'DejaVu Sans'];

const SFNT_TTF = 0x00010000;
const SFNT_TRUE = 0x74727565; // 'true' (Apple TrueType)
const SFNT_OTF = 0x4f54544f; // 'OTTO'

/** EOT is a wrapper, not a TTF file. Compressed/obfuscated payloads need a decoder. */
export function embeddedFontPayload(bytes: Buffer): Buffer | null {
  if (bytes.length < 82 || bytes.readUInt16LE(34) !== 0x504c) return null;
  const size = bytes.readUInt32LE(4);
  const flags = bytes.readUInt32LE(12);
  if ((flags & (4 | 0x10000000)) !== 0 || size < 12 || size > bytes.length - 82) return null;
  const data = bytes.subarray(bytes.length - size);
  const signature = data.readUInt32BE(0);
  return signature === SFNT_TTF || signature === SFNT_OTF || signature === SFNT_TRUE ? data : null;
}

export function sourceSlideCount(zip: AdmZip): number {
  const xml = zip.readAsText('ppt/presentation.xml');
  const count = [...xml.matchAll(/<(?:[\w-]+:)?sldId(?=[\s/>])/g)].length;
  if (!count) throw new Error('PPTX contains no slides');
  return count;
}

export function validateSlideImages(slides: SlideImage[], expected: number): void {
  if (slides.length !== expected) throw new Error(`PPTX conversion incomplete: expected ${expected} slides, received ${slides.length}`);
  slides.sort((a, b) => a.slideNumber - b.slideNumber);
  for (let i = 0; i < expected; i++) {
    const s = slides[i];
    if (s.slideNumber !== i + 1 || !s.png.length || !Number.isFinite(s.width) || !Number.isFinite(s.height) || s.width <= 0 || s.height <= 0) {
      throw new Error(`PPTX conversion produced an invalid slide (${i + 1})`);
    }
  }
}

/** Ham RGBA'da boş sayfa: bütün pikseller beyaz ya da bütün pikseller saydam. (Önceki `stats()` kuralıyla aynı.) */
function isBlankRaster(raw: Buffer): boolean {
  let allWhite = true;
  let anyVisible = false;
  for (let i = 0; i < raw.length; i += 4) {
    if (raw[i + 3] !== 0) anyVisible = true;
    if (raw[i] !== 255 || raw[i + 1] !== 255 || raw[i + 2] !== 255) allWhite = false;
    if (anyVisible && !allWhite) return false;
  }
  return allWhite || !anyVisible;
}

/** Sistem fontları kopyalanmaz, mümkünse sabit bağlanır (aynı disk); olmazsa (başka birim, izin) kopyalanır. */
async function installFile(source: string, destination: string): Promise<void> {
  try {
    await fs.link(source, destination);
  } catch {
    await fs.copyFile(source, destination);
  }
}

export async function renderPptx(buffer: Buffer, tempDir: string): Promise<{ slides: SlideImage[]; warnings: string[] }> {
  const zip = new AdmZip(buffer);
  const expected = sourceSlideCount(zip);
  const warnings: string[] = [];
  const used = requiredDeckFonts(zip, collectUsedFonts(buffer));
  const mapped = used.map(name => getMappedFont(name, DEFAULT_FONT_MAPPING)).filter((name): name is string => !!name);
  const wanted = [...used, ...mapped, ...platformFontFallbacks(mapped), ...BASE_FALLBACK_FONTS];

  const installs: (() => Promise<void>)[] = [];
  const embedded = zip.getEntries().filter(e => /^ppt\/fonts\/[^/]+\.fntdata$/i.test(e.entryName));
  for (const [index, entry] of embedded.entries()) {
    const data = embeddedFontPayload(entry.getData());
    if (!data) {
      warnings.push(`Embedded font could not be decoded (${path.posix.basename(entry.entryName)}); text may use a substitute font.`);
      continue;
    }
    // No names from the input become filesystem paths; never install fonts system-wide.
    const ext = data.readUInt32BE(0) === SFNT_OTF ? 'otf' : 'ttf';
    installs.push(() => fs.writeFile(path.join(tempDir, `font-${index}.${ext}`), data));
  }
  const systemFonts = await selectSystemFontFiles(wanted);
  for (const [index, file] of systemFonts.entries()) {
    installs.push(() => installFile(file, path.join(tempDir, `system-${index}-${path.basename(file)}`)));
  }
  await mapLimit(installs, 16, install => install());

  clearFontCache();
  try {
    const vectors = await convertPptxToSvg(buffer, { logLevel: 'off', fontDirs: [tempDir], skipSystemFonts: true });
    if (vectors.length !== expected) throw new Error(`PPTX conversion incomplete: expected ${expected} slides, received ${vectors.length}`);
    for (const w of getWarningEntries()) warnings.push(`${w.context ? w.context + ': ' : ''}${w.message}`);

    // The project already ships Sharp. Rasterize the glyph-path SVG with it:
    // resvg-wasm loses/noisily samples large bitmap-fill patterns in these decks.
    // SVG bir kez rasterlanır; boşluk denetimi ham pikseller üzerinde yapılır, PNG yeniden çözülmez.
    const rendered = await mapLimit(vectors, RASTER_CONCURRENCY, async vector => {
      try {
        const { data: raw, info } = await sharp(Buffer.from(vector.svg))
          .resize({ width: OUTPUT_WIDTH })
          .ensureAlpha()
          .raw()
          .toBuffer({ resolveWithObject: true });
        vector.svg = ''; // büyük SVG dizgisi hemen bırakılır
        const png = await sharp(raw, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
        const slide: SlideImage = { slideNumber: vector.slideNumber, png, width: info.width, height: info.height };
        return { slide, blank: isBlankRaster(raw) };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Slide ${vector.slideNumber} could not be rasterized: ${message}`);
      }
    });

    const slides = rendered.map(r => r.slide);
    for (const { slide, blank } of rendered) {
      // A white slide can be intentional. Warn only; never reject/delete it.
      if (blank) warnings.push(`Slide ${slide.slideNumber}: output is blank; check that no content was lost.`);
    }
    validateSlideImages(slides, expected);
    return { slides, warnings: [...new Set(warnings)] };
  } finally {
    clearFontCache();
  }
}
