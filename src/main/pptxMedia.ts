import path from 'node:path';
import type AdmZip from 'adm-zip';
import sharp from 'sharp';
import { mapLimit } from './pptxFontFiles';

/**
 * Embedded photos are often far larger than the slide raster needs. librsvg decodes
 * every <image> again for every slide that uses it, so that dominates import time.
 * Each picture's on-slide pixel size is derived from the slide XML and the media is
 * shrunk once, keeping HEADROOM× the needed resolution. Anything whose displayed size
 * cannot be determined with certainty is left untouched.
 */
const HEADROOM = 1.5;
/** Shrink only if it saves meaningfully (below this fraction of the original size). */
const MIN_GAIN = 0.8;
const SHRINK_CONCURRENCY = 4;
const RASTER_IMAGE_RE = /\.(?:jpe?g|png)$/i;
const ANALYZED_PART_RE = /^ppt\/(?:slides|slideLayouts|slideMasters)\/[^/]+\.xml$/;

/** Required scale per media path: a number (max needed fraction of the source) or null (keep as is). */
export type MediaNeeds = Map<string, { needW: number; needH: number } | null>;

function attr(tag: string, name: string): number | null {
  const m = new RegExp(`\\b${name}="(-?\\d+)"`).exec(tag);
  return m ? Number(m[1]) : null;
}

function relTargets(zip: AdmZip, part: string): Map<string, string> {
  const dir = path.posix.dirname(part);
  const rels = zip.getEntry(`${dir}/_rels/${path.posix.basename(part)}.rels`);
  const map = new Map<string, string>();
  if (!rels) return map;
  for (const m of rels.getData().toString('utf8').matchAll(/<(?:[\w-]+:)?Relationship\b[^>]*>/g)) {
    if (/\bTargetMode="External"/.test(m[0])) continue;
    const id = /\bId="([^"]+)"/.exec(m[0])?.[1];
    const target = /\bTarget="([^"]+)"/.exec(m[0])?.[1];
    if (id && target) map.set(id, target.startsWith('/') ? target.slice(1) : path.posix.normalize(`${dir}/${target}`));
  }
  return map;
}

/**
 * Computes, in output pixels, the largest width/height at which each raster image is
 * shown. Media used anywhere it cannot be measured (groups, backgrounds, tiles, insets,
 * inherited placeholder geometry, charts, themes...) maps to null.
 */
export function analyzeMediaNeeds(zip: AdmZip, outputWidth: number): MediaNeeds {
  const needs: MediaNeeds = new Map();
  const unknown = (media: string) => needs.set(media, null);
  const record = (media: string, w: number, h: number) => {
    const prev = needs.get(media);
    if (prev === null) return;
    needs.set(media, { needW: Math.max(prev?.needW ?? 0, w), needH: Math.max(prev?.needH ?? 0, h) });
  };

  const sldSz = /<(?:[\w-]+:)?sldSz\b[^>]*>/.exec(zip.readAsText('ppt/presentation.xml'))?.[0] ?? '';
  const slideCx = attr(sldSz, 'cx');
  const pxPerEmu = slideCx && slideCx > 0 ? outputWidth / slideCx : null;

  for (const entry of zip.getEntries()) {
    if (!entry.entryName.endsWith('.rels')) continue;
    const part = entry.entryName.replace(/_rels\/([^/]+)\.rels$/, '$1');
    const targets = [...relTargets(zip, part).values()].filter(t => t.startsWith('ppt/media/') && RASTER_IMAGE_RE.test(t));
    if (!targets.length) continue;
    if (!pxPerEmu || !ANALYZED_PART_RE.test(part) || !zip.getEntry(part)) { targets.forEach(unknown); continue; }

    const rels = relTargets(zip, part);
    const xml = zip.readAsText(part);
    const seen = new Set<string>();
    // One pass over shape boundaries and blips; a stack tells where each blip lives.
    const stack: { kind: string; start: number; blips: string[] }[] = [];
    const re = /<(\/?)(?:[\w-]+:)?(pic|sp|grpSp|bg)\b[^>]*?(\/?)>|<(?:[\w-]+:)?blip\b[^>]*?\br:embed="([^"]+)"/g;
    for (let m = re.exec(xml); m; m = re.exec(xml)) {
      const [, closing, kind, selfClosing, embed] = m;
      if (embed) {
        const media = rels.get(embed);
        if (!media || !RASTER_IMAGE_RE.test(media) || !media.startsWith('ppt/media/')) continue;
        seen.add(media);
        const top = stack[stack.length - 1];
        if (!top || stack.some(s => s.kind === 'grpSp' || s.kind === 'bg') || (top.kind !== 'pic' && top.kind !== 'sp')) unknown(media);
        else top.blips.push(media);
      } else if (!closing) {
        if (!selfClosing) stack.push({ kind, start: m.index, blips: [] });
      } else {
        const open = stack.pop();
        if (!open || open.kind !== kind) { targets.forEach(unknown); break; } // unexpected nesting: give up on this part
        if (!open.blips.length) continue;
        const block = xml.slice(open.start, re.lastIndex);
        const ext = /<(?:[\w-]+:)?xfrm\b[^>]*>\s*<(?:[\w-]+:)?off\b[^>]*>\s*<(?:[\w-]+:)?ext\b([^>]*)>/.exec(block)?.[1] ?? '';
        const cx = attr(ext, 'cx'), cy = attr(ext, 'cy');
        const src = /<(?:[\w-]+:)?srcRect\b([^>]*?)\/?>/.exec(block)?.[1] ?? '';
        const fill = /<(?:[\w-]+:)?fillRect\b([^>]*?)\/?>/.exec(block)?.[1] ?? '';
        const fracX = 1 - ((attr(src, 'l') ?? 0) + (attr(src, 'r') ?? 0)) / 100000;
        const fracY = 1 - ((attr(src, 't') ?? 0) + (attr(src, 'b') ?? 0)) / 100000;
        const measurable = cx && cy && cx > 0 && cy > 0 && fracX > 0.01 && fracY > 0.01
          && !/<(?:[\w-]+:)?tile\b/.test(block) && !/\b[ltrb]="/.test(fill);
        for (const media of open.blips) {
          if (measurable) record(media, (cx * pxPerEmu) / fracX, (cy * pxPerEmu) / fracY);
          else unknown(media);
        }
      }
    }
    // Referenced but not found as a measurable blip (e.g. used some other way): keep.
    for (const media of targets) if (!seen.has(media)) unknown(media);
  }
  return needs;
}

/**
 * Replaces oversized JPEG/PNG media in `zip` with downscaled copies. Returns how many
 * were replaced. Failures leave the original bytes in place.
 */
export async function shrinkSlideMedia(zip: AdmZip, outputWidth: number): Promise<number> {
  const needs = analyzeMediaNeeds(zip, outputWidth);
  const jobs = [...needs].filter((item): item is [string, { needW: number; needH: number }] => item[1] !== null);
  const replaced = await mapLimit(jobs, SHRINK_CONCURRENCY, async ([name, need]) => {
    const entry = zip.getEntry(name);
    if (!entry) return false;
    try {
      const data = entry.getData();
      const meta = await sharp(data).metadata();
      const { width, height, format } = meta;
      // EXIF-rotated, animated or unusual inputs are kept byte-for-byte.
      if (!width || !height || (meta.orientation ?? 1) !== 1 || (meta.pages ?? 1) > 1) return false;
      if ((format !== 'jpeg' && format !== 'png')) return false;
      const scale = Math.max(need.needW / width, need.needH / height) * HEADROOM;
      if (scale >= MIN_GAIN) return false;
      const w = Math.max(16, Math.round(width * scale)), h = Math.max(16, Math.round(height * scale));
      const resized = sharp(data).resize(w, h, { fit: 'fill' });
      const out = format === 'jpeg' ? await resized.jpeg({ quality: 92, chromaSubsampling: '4:4:4' }).toBuffer() : await resized.png({ compressionLevel: 1 }).toBuffer();
      zip.updateFile(entry, out);
      return true;
    } catch {
      return false;
    }
  });
  return replaced.filter(Boolean).length;
}
