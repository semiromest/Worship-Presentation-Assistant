/**
 * Pure geometry/pixel helpers for image text translation: picks the OCR paragraphs worth
 * translating, estimates text/background colours, builds the paint-out mask and fits the
 * translated text into the original box. No native modules: unit-tested with tsx.
 */

export interface Box { x0: number; y0: number; x1: number; y1: number }
export interface OcrWord { text: string; confidence: number; bbox: Box }
export interface OcrLine { text: string; confidence: number; bbox: Box; words: OcrWord[] }
export interface OcrParagraph { text: string; confidence: number; bbox: Box; lines: OcrLine[] }

export type TextAlign = 'left' | 'center' | 'right';
export type Rgb = [number, number, number];

export interface TextRegion {
  text: string;
  bbox: Box;
  lines: OcrLine[];
  /** Average OCR line box height in px (≈ the original font size). */
  lineHeight: number;
  /** Distance between consecutive line tops in px (lineHeight for single lines). */
  linePitch: number;
  align: TextAlign;
}

const MIN_CONFIDENCE = 65;
const LETTER = /\p{L}/gu;

function letterCount(text: string): number {
  return text.match(LETTER)?.length ?? 0;
}

/** Common OCR slips on slide fonts: a lone "|" is the pronoun "I". */
function cleanLine(text: string): string {
  return text.trim().replace(/(^|\s)[|!](?=\s|$)/g, '$1I');
}

function joinLines(lines: OcrLine[]): string {
  return lines
    .map((line) => cleanLine(line.text))
    .filter(Boolean)
    .reduce((acc, line) => {
      if (!acc) return line;
      // A word hyphenated across a line break is one word again.
      if (/\p{L}-$/u.test(acc)) return acc.slice(0, -1) + line;
      return `${acc} ${line}`;
    }, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function unionBox(boxes: Box[]): Box {
  return {
    x0: Math.min(...boxes.map((b) => b.x0)),
    y0: Math.min(...boxes.map((b) => b.y0)),
    x1: Math.max(...boxes.map((b) => b.x1)),
    y1: Math.max(...boxes.map((b) => b.y1)),
  };
}

function spread(values: number[]): number {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(values.reduce((a, v) => a + (v - mean) ** 2, 0) / values.length);
}

export function detectAlign(lines: OcrLine[], imageWidth: number): TextAlign {
  if (lines.length >= 2) {
    const left = spread(lines.map((l) => l.bbox.x0));
    const center = spread(lines.map((l) => (l.bbox.x0 + l.bbox.x1) / 2));
    const right = spread(lines.map((l) => l.bbox.x1));
    const best = Math.min(left, center, right);
    // Ties (e.g. equal-length lines) read as centred: the usual slide layout.
    if (best === center || Math.abs(center - best) < 2) return 'center';
    return best === left ? 'left' : 'right';
  }
  const { x0, x1 } = lines[0].bbox;
  const mid = (x0 + x1) / 2;
  if (Math.abs(mid - imageWidth / 2) < imageWidth * 0.08) return 'center';
  if (x0 < imageWidth * 0.15) return 'left';
  if (x1 > imageWidth * 0.85) return 'right';
  return 'center';
}

const lineH = (line: OcrLine) => line.bbox.y1 - line.bbox.y0;
const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / Math.max(1, values.length);

/**
 * Splits an OCR line where the gap between two words is far wider than a space: Tesseract happily
 * reads a logo word and the text column beside it as one line, which drags the box over the logo.
 */
export function splitLineSegments(line: OcrLine): OcrLine[] {
  if (line.words.length < 2) return [line];
  const minGap = Math.max(1.2 * lineH(line), 12);
  const words = [...line.words].sort((a, b) => a.bbox.x0 - b.bbox.x0);
  const segments: OcrWord[][] = [[words[0]]];
  for (let i = 1; i < words.length; i++) {
    if (words[i].bbox.x0 - words[i - 1].bbox.x1 > minGap) segments.push([words[i]]);
    else segments[segments.length - 1].push(words[i]);
  }
  if (segments.length === 1) return [line];
  return segments.map((ws) => ({
    text: ws.map((w) => w.text).join(' '),
    confidence: mean(ws.map((w) => w.confidence)),
    bbox: { x0: Math.min(...ws.map((w) => w.bbox.x0)), y0: line.bbox.y0, x1: Math.max(...ws.map((w) => w.bbox.x1)), y1: line.bbox.y1 },
    words: ws,
  }));
}

/** Letters each source language really uses (lower case). Others in its text mean a misread. */
const ALPHABETS: Record<string, string> = {
  en: 'abcdefghijklmnopqrstuvwxyz',
  tr: 'abcçdefgğhıijklmnoöprsştuüvyzâîûqwx',
  de: 'abcdefghijklmnopqrstuvwxyzäöüß',
  es: 'abcdefghijklmnopqrstuvwxyzáéíóúñü',
  fr: 'abcdefghijklmnopqrstuvwxyzàâçéèêëîïôûùüÿœæ',
  pt: 'abcdefghijklmnopqrstuvwxyzáâãàçéêíóôõú',
  it: 'abcdefghijklmnopqrstuvwxyzàèéìíîòóùú',
};

/**
 * True when an OCR line reads like real text: confident words, mostly letters, and — for a known
 * Latin-script source language — letters from that language. Text in another script (e.g. Greek
 * read with a Turkish model) comes back as confident-looking junk; translating it makes it worse.
 */
export function isReadableLine(line: OcrLine, source?: string): boolean {
  if (line.bbox.x1 <= line.bbox.x0 || line.bbox.y1 <= line.bbox.y0) return false;
  const letters = line.text.match(LETTER) ?? [];
  if (letters.length < 2) return false;
  const words = line.words.length ? line.words : [{ text: line.text, confidence: line.confidence, bbox: line.bbox }];
  if (mean(words.map((w) => w.confidence)) < MIN_CONFIDENCE) return false;
  if (words.filter((w) => w.confidence < 45).length > words.length * 0.3) return false;
  const visible = line.text.replace(/\s/g, '');
  if (letters.length / Math.max(1, visible.length) < 0.6) return false;
  const alphabet = source ? ALPHABETS[source] : undefined;
  if (alphabet) {
    const foreign = letters.filter((ch) => !alphabet.includes(ch.toLocaleLowerCase(source))).length;
    if (foreign > letters.length * 0.12) return false;
  }
  return true;
}

/**
 * Groups lines into text blocks. A line joins the block above it only when the type size matches,
 * the gap is at most about a line and the two overlap horizontally — so a title and the text under
 * it, or two columns side by side, stay apart and keep their own size, colour and alignment.
 */
export function splitBlocks(lines: OcrLine[]): OcrLine[][] {
  const sorted = [...lines].sort((a, b) => a.bbox.y0 - b.bbox.y0);
  const groups: OcrLine[][] = [];
  for (const line of sorted) {
    let best: OcrLine[] | null = null;
    let bestGap = Infinity;
    for (const group of groups) {
      const prev = group[group.length - 1];
      const maxH = Math.max(lineH(line), lineH(prev));
      const ratio = maxH / Math.max(1, Math.min(lineH(line), lineH(prev)));
      const gap = line.bbox.y0 - prev.bbox.y1;
      const overlap = Math.min(line.bbox.x1, prev.bbox.x1) - Math.max(line.bbox.x0, prev.bbox.x0);
      if (ratio <= 1.3 && gap <= 0.9 * maxH && gap >= -0.5 * maxH && overlap > 0 && gap < bestGap) {
        best = group;
        bestGap = gap;
      }
    }
    if (best) best.push(line);
    else groups.push([line]);
  }
  return groups;
}

/** OCR paragraphs → regions worth translating (confident lines with real words). */
export function selectRegions(paragraphs: OcrParagraph[], imageWidth: number, source?: string): TextRegion[] {
  const regions: TextRegion[] = [];
  const blocks = paragraphs.flatMap((paragraph) =>
    splitBlocks(paragraph.lines.flatMap(splitLineSegments).filter((line) => isReadableLine(line, source)))
  );
  for (const lines of blocks) {
    if (!lines.length) continue;
    const text = joinLines(lines);
    if (letterCount(text) < 2) continue;
    const heights = lines.map((l) => l.bbox.y1 - l.bbox.y0);
    const lineHeight = heights.reduce((a, b) => a + b, 0) / heights.length;
    const tops = lines.map((l) => l.bbox.y0).sort((a, b) => a - b);
    const linePitch = tops.length > 1 ? (tops[tops.length - 1] - tops[0]) / (tops.length - 1) : lineHeight;
    regions.push({
      text,
      bbox: unionBox(lines.map((l) => l.bbox)),
      lines,
      lineHeight,
      linePitch,
      align: detectAlign(lines, imageWidth),
    });
  }
  return regions;
}

function clampBox(box: Box, width: number, height: number): Box {
  return {
    x0: Math.max(0, Math.floor(box.x0)),
    y0: Math.max(0, Math.floor(box.y0)),
    x1: Math.min(width, Math.ceil(box.x1)),
    y1: Math.min(height, Math.ceil(box.y1)),
  };
}

export function padBox(box: Box, pad: number, width: number, height: number): Box {
  return clampBox({ x0: box.x0 - pad, y0: box.y0 - pad, x1: box.x1 + pad, y1: box.y1 + pad }, width, height);
}

function dist2(data: Uint8Array | Uint8ClampedArray, i: number, c: Rgb): number {
  const dr = data[i] - c[0];
  const dg = data[i + 1] - c[1];
  const db = data[i + 2] - c[2];
  return dr * dr + dg * dg + db * db;
}

/**
 * Two-means colour split of the region's line boxes. The cluster that owns the box border is the
 * background, the other one the text.
 */
export function estimateColors(rgba: Uint8Array | Uint8ClampedArray, width: number, height: number, region: TextRegion): { text: Rgb; background: Rgb } {
  const boxes = region.lines.map((l) => clampBox(l.bbox, width, height));
  const samples: number[] = [];
  for (const b of boxes) {
    const step = Math.max(1, Math.floor(Math.sqrt(((b.x1 - b.x0) * (b.y1 - b.y0)) / 4000)));
    for (let y = b.y0; y < b.y1; y += step) for (let x = b.x0; x < b.x1; x += step) samples.push((y * width + x) * 4);
  }
  if (!samples.length) return { text: [255, 255, 255], background: [0, 0, 0] };

  // Seed with the darkest and lightest samples.
  const luma = (i: number) => rgba[i] * 0.299 + rgba[i + 1] * 0.587 + rgba[i + 2] * 0.114;
  let a = samples[0];
  let b = samples[0];
  for (const i of samples) {
    if (luma(i) < luma(a)) a = i;
    if (luma(i) > luma(b)) b = i;
  }
  let ca: Rgb = [rgba[a], rgba[a + 1], rgba[a + 2]];
  let cb: Rgb = [rgba[b], rgba[b + 1], rgba[b + 2]];
  for (let iter = 0; iter < 8; iter++) {
    const sa = [0, 0, 0, 0];
    const sb = [0, 0, 0, 0];
    for (const i of samples) {
      const s = dist2(rgba, i, ca) <= dist2(rgba, i, cb) ? sa : sb;
      s[0] += rgba[i]; s[1] += rgba[i + 1]; s[2] += rgba[i + 2]; s[3]++;
    }
    if (sa[3]) ca = [sa[0] / sa[3], sa[1] / sa[3], sa[2] / sa[3]];
    if (sb[3]) cb = [sb[0] / sb[3], sb[1] / sb[3], sb[2] / sb[3]];
  }

  // Border ring just outside each line box votes for the background.
  let votesA = 0;
  let votesB = 0;
  const pad = Math.max(2, Math.round(region.lineHeight * 0.15));
  for (const line of region.lines) {
    const r = padBox(line.bbox, pad, width, height);
    const vote = (x: number, y: number) => {
      const i = (y * width + x) * 4;
      if (dist2(rgba, i, ca) <= dist2(rgba, i, cb)) votesA++; else votesB++;
    };
    for (let x = r.x0; x < r.x1; x++) { vote(x, r.y0); vote(x, Math.max(r.y0, r.y1 - 1)); }
    for (let y = r.y0; y < r.y1; y++) { vote(r.x0, y); vote(Math.max(r.x0, r.x1 - 1), y); }
  }
  const round = (c: Rgb): Rgb => [Math.round(c[0]), Math.round(c[1]), Math.round(c[2])];
  const [background, textMean] = votesA >= votesB ? [ca, cb] : [cb, ca];
  // Anti-aliased stroke edges pull the cluster mean toward the background: use the stroke cores
  // (the third of text pixels farthest from the background) as the text colour.
  const textPixels = samples
    .filter((i) => dist2(rgba, i, textMean) <= dist2(rgba, i, background))
    .map((i) => ({ i, d: dist2(rgba, i, background) }))
    .sort((p, q) => q.d - p.d);
  const core = textPixels.slice(0, Math.max(1, Math.ceil(textPixels.length / 3)));
  const text: Rgb = core.length
    ? [mean(core.map((p) => rgba[p.i])), mean(core.map((p) => rgba[p.i + 1])), mean(core.map((p) => rgba[p.i + 2]))]
    : textMean;
  return { text: round(text), background: round(background) };
}

export interface RegionMask {
  /** Full-image mask, 255 = paint out. */
  mask: Uint8Array;
  /** Bounding box of the masked pixels (used as the inpaint ROI). */
  bounds: Box;
  /** Share of the line boxes covered by text strokes (before dilation). */
  inkRatio: number;
  /** Median horizontal stroke width ÷ estimated font size (0 when unknown). */
  strokeRatio: number;
}

/**
 * Font size implied by a line box: the box spans cap/ascender height when the text has tall
 * letters, x-height otherwise, plus descender depth when it has descending letters.
 */
export function emFromLine(text: string, boxHeight: number): number {
  const tall = /[\p{Lu}\p{N}bdfhklt]|[ıiİ]/u.test(text);
  const deep = /[gjpqyçş,;]/u.test(text);
  return boxHeight / ((tall ? 0.73 : 0.53) + (deep ? 0.21 : 0));
}

/** Font weight from stroke width (measured: light ≈ 0.07, regular ≈ 0.10–0.13, bold ≈ 0.15–0.18). */
export function weightFromStroke(strokeRatio: number): '' | '300 ' | 'bold ' {
  if (!strokeRatio) return '';
  if (strokeRatio > 0.138) return 'bold ';
  if (strokeRatio < 0.08) return '300 ';
  return '';
}

function dilate(mask: Uint8Array, width: number, bounds: Box, radius: number): void {
  if (radius <= 0) return;
  const w = bounds.x1 - bounds.x0;
  const h = bounds.y1 - bounds.y0;
  const tmp = new Uint8Array(w * h);
  // Separable box max: horizontal then vertical.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let on = 0;
      for (let k = Math.max(0, x - radius); k <= Math.min(w - 1, x + radius) && !on; k++) on = mask[(y + bounds.y0) * width + k + bounds.x0];
      tmp[y * w + x] = on ? 255 : 0;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let on = 0;
      for (let k = Math.max(0, y - radius); k <= Math.min(h - 1, y + radius) && !on; k++) on = tmp[k * w + x];
      mask[(y + bounds.y0) * width + x + bounds.x0] = on ? 255 : 0;
    }
  }
}

/**
 * Marks the text strokes of a region (pixels nearer the text colour than the background inside the
 * padded word boxes), grown a little so anti-aliased edges and shadows go too. Falls back to whole
 * boxes when the colour split finds almost nothing (e.g. outlined or gradient text).
 */
export function buildTextMask(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  region: TextRegion,
  colors: { text: Rgb; background: Rgb }
): RegionMask {
  const mask = new Uint8Array(width * height);
  const pad = Math.max(2, Math.round(region.lineHeight * 0.15));
  const boxes = region.lines.flatMap((line) => (line.words.length ? line.words.map((w) => w.bbox) : [line.bbox])).map((b) => padBox(b, pad, width, height));
  let ink = 0;
  let area = 0;
  for (const b of boxes) {
    for (let y = b.y0; y < b.y1; y++) {
      for (let x = b.x0; x < b.x1; x++) {
        const p = y * width + x;
        area++;
        if (dist2(rgba, p * 4, colors.text) < dist2(rgba, p * 4, colors.background)) { mask[p] = 255; ink++; }
      }
    }
  }
  const inkRatio = area ? ink / area : 0;
  let strokeRatio = 0;
  if (inkRatio < 0.03) {
    for (const b of boxes) for (let y = b.y0; y < b.y1; y++) mask.fill(255, y * width + b.x0, y * width + b.x1);
  } else {
    // Horizontal ink runs inside each (unpadded) line box, scaled by that line's font size.
    const runs: number[] = [];
    for (const line of region.lines) {
      const b = clampBox(line.bbox, width, height);
      const em = emFromLine(line.text, b.y1 - b.y0);
      if (em <= 0) continue;
      for (let y = b.y0; y < b.y1; y++) {
        let run = 0;
        for (let x = b.x0; x <= b.x1; x++) {
          if (x < b.x1 && mask[y * width + x]) run++;
          else if (run) { runs.push(run / em); run = 0; }
        }
      }
    }
    if (runs.length) strokeRatio = runs.sort((a, b) => a - b)[Math.floor(runs.length / 2)];
  }
  const radius = Math.max(2, Math.round(region.lineHeight * 0.1));
  const bounds = padBox(unionBox(boxes), radius, width, height);
  dilate(mask, width, bounds, radius);
  return { mask, bounds, inkRatio, strokeRatio };
}

export type MeasureText = (text: string, fontSize: number) => number;

export function wrapText(measure: MeasureText, text: string, fontSize: number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (!current || measure(candidate, fontSize) <= maxWidth) current = candidate;
    else { lines.push(current); current = word; }
  }
  if (current) lines.push(current);
  return lines;
}

export interface FittedText { fontSize: number; lineHeight: number; lines: string[] }

/**
 * Largest font size (≤ the original) at which the wrapped translation fits the original box.
 * The box may grow 15% vertically: translations usually run longer than the source.
 */
export function fitText(measure: MeasureText, text: string, region: TextRegion): FittedText {
  const boxWidth = Math.max(1, region.bbox.x1 - region.bbox.x0);
  const boxHeight = Math.max(1, region.bbox.y1 - region.bbox.y0) * 1.15;
  const maxSize = Math.max(8, region.lineHeight * 1.05);
  const spacing = region.lines.length > 1 ? Math.min(1.8, Math.max(1.05, region.linePitch / maxSize)) : 1.2;
  const fits = (size: number) => {
    const lines = wrapText(measure, text, size, boxWidth);
    const tallEnough = lines.length * size * spacing - size * (spacing - 1) <= boxHeight;
    return tallEnough && lines.every((line) => measure(line, size) <= boxWidth * 1.02) ? lines : null;
  };
  let lo = 6;
  let hi = maxSize;
  let best = fits(lo) ? lo : 6;
  if (fits(hi)) best = hi;
  else {
    for (let i = 0; i < 18; i++) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) { best = mid; lo = mid; } else hi = mid;
    }
  }
  const fontSize = Math.floor(best * 10) / 10;
  return { fontSize, lineHeight: fontSize * spacing, lines: wrapText(measure, text, fontSize, boxWidth) };
}
