import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { UsedFonts } from 'pptx-glimpse';
import type AdmZip from 'adm-zip';

const NAME_SCAN_CONCURRENCY = 16;
const MAX_FONT_DIR_DEPTH = 8;
const FONT_FILE_RE = /\.(?:ttf|otf|ttc|otc)$/i;
const CJK_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const TYPEFACE_RE = /\btypeface\s*=\s*(["'])(.*?)\1/;
const SCRIPT_RE = /\bscript\s*=\s*(["'])(.*?)\1/;
/** 1 aile, 4 tam ad, 6 PostScript, 16 tercih edilen aile. */
const NAME_IDS: ReadonlySet<number> = new Set([1, 4, 6, 16]);
const XML_ENTITIES: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

const normalize = (s: string) => s.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();

/** Tek geçişte çözer: `&amp;quot;` yalnızca `&quot;` olur (iki kez çözülmez). */
const decode = (s: string) => s.replace(/&(?:#(x[\da-f]+|\d+)|(amp|lt|gt|quot|apos));/gi, (whole, numeric: string | undefined, named: string | undefined) => {
  if (numeric) {
    const code = numeric[0].toLowerCase() === 'x' ? parseInt(numeric.slice(1), 16) : Number(numeric);
    return code <= 0x10ffff ? String.fromCodePoint(code) : whole;
  }
  return XML_ENTITIES[(named ?? '').toLowerCase()] ?? whole;
});

/** Sıra korunur; hata verirse yeni iş başlatılmaz. */
export async function mapLimit<T, R>(items: readonly T[], limit: number, task: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  let failed = false;
  const worker = async () => {
    while (!failed) {
      const index = next++;
      if (index >= items.length) return;
      try {
        results[index] = await task(items[index], index);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  };
  // Finish in-flight work before callers clear fonts or remove temporary files.
  const settled = await Promise.allSettled(Array.from({ length: Math.min(limit, items.length) }, worker));
  const rejected = settled.find((result): result is PromiseRejectedResult => result.status === 'rejected');
  if (rejected) throw rejected.reason;
  return results;
}

/** Theme EA fonts are often unused defaults; loading their entire CJK outlines costs hundreds of MB. */
export function requiredDeckFonts(zip: AdmZip, report: UsedFonts): string[] {
  const explicit = new Set<string>();
  let cjkText = false;
  for (const entry of zip.getEntries()) {
    if (!/^ppt\/(slides|slideLayouts|slideMasters|charts)\/[^/]+\.xml$/.test(entry.entryName)) continue;
    const xml = entry.getData().toString('utf8');
    for (const m of xml.matchAll(/<(?:[\w-]+:)?(?:latin|ea|cs|sym)\b[^>]*>/g)) {
      const name = TYPEFACE_RE.exec(m[0])?.[2];
      if (name && !name.startsWith('+')) explicit.add(decode(name));
    }
    if (cjkText) continue; // bir kez bulunduktan sonra metin taranmaz
    for (const m of xml.matchAll(/<(?:[\w-]+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:[\w-]+:)?t>/g)) {
      if (CJK_RE.test(decode(m[1]))) { cjkText = true; break; }
    }
  }
  const themeOnlyEa = new Set<string>([report.theme.majorFontEa, report.theme.minorFontEa].filter((name): name is string => name !== null));
  // Script-specific theme fonts are included by the patched collector. They are
  // needed for CJK text; explicit run references above always take precedence.
  for (const entry of zip.getEntries()) {
    if (!/^ppt\/theme\/[^/]+\.xml$/.test(entry.entryName)) continue;
    for (const m of entry.getData().toString('utf8').matchAll(/<(?:[\w-]+:)?font\b[^>]*>/g)) {
      const name = TYPEFACE_RE.exec(m[0])?.[2];
      if (SCRIPT_RE.exec(m[0])?.[2] === 'Jpan' && name) themeOnlyEa.add(decode(name));
    }
  }
  const fonts = new Set([...report.fonts.filter(name => cjkText || !themeOnlyEa.has(name) || explicit.has(name)), ...explicit]);
  return [...fonts];
}

export function platformFontFallbacks(names: string[]): string[] {
  if (process.platform !== 'win32' && process.platform !== 'darwin') return [];
  const mac = process.platform === 'darwin';
  const result = new Set<string>();
  for (const name of names) {
    if (name === 'Noto Sans JP' || name === 'Noto Sans CJK JP') {
      for (const fallback of mac ? ['Hiragino Sans', 'Hiragino Kaku Gothic ProN'] : ['Yu Gothic', 'Meiryo', 'MS Gothic']) result.add(fallback);
    }
    if (name === 'Noto Serif JP' || name === 'Noto Serif CJK JP') {
      for (const fallback of mac ? ['Hiragino Mincho ProN'] : ['Yu Mincho', 'MS Mincho']) result.add(fallback);
    }
  }
  return [...result];
}

/** Read only SFNT name tables, not glyph outlines for every installed font. */
export async function fontFamilyNames(file: string): Promise<string[]> {
  const handle = await fs.open(file, 'r');
  try {
    const size = (await handle.stat()).size;
    const read = async (offset: number, length: number) => {
      if (!Number.isSafeInteger(offset) || offset < 0 || length < 0 || offset + length > size) throw new Error('Invalid font table range');
      const bytes = Buffer.alloc(length);
      const result = await handle.read(bytes, 0, length, offset);
      if (result.bytesRead !== length) throw new Error('Truncated font table');
      return bytes;
    };
    const header = await read(0, 12);
    let offsets = [0];
    if (header.toString('ascii', 0, 4) === 'ttcf') {
      const count = header.readUInt32BE(8);
      if (count > 64) return [];
      const faces = await read(12, count * 4);
      offsets = Array.from({ length: count }, (_, i) => faces.readUInt32BE(i * 4));
    }
    const names = new Set<string>();
    for (const offset of offsets) {
      const face = await read(offset, 12);
      const count = face.readUInt16BE(4);
      if (count > 256) continue;
      const records = await read(offset + 12, count * 16);
      for (let i = 0; i < count; i++) {
        if (records.toString('ascii', i * 16, i * 16 + 4) !== 'name') continue;
        const start = records.readUInt32BE(i * 16 + 8);
        const length = records.readUInt32BE(i * 16 + 12);
        if (length < 6 || length > 2 * 1024 * 1024) continue;
        const table = await read(start, length);
        const entries = table.readUInt16BE(2), strings = table.readUInt16BE(4);
        if (6 + entries * 12 > table.length) continue;
        for (let n = 0; n < entries; n++) {
          const r = 6 + n * 12, platform = table.readUInt16BE(r), id = table.readUInt16BE(r + 6);
          if (!NAME_IDS.has(id)) continue;
          const len = table.readUInt16BE(r + 8), at = strings + table.readUInt16BE(r + 10);
          if (!len || len > 2048 || at + len > table.length) continue;
          const bytes = Buffer.from(table.subarray(at, at + len));
          if ((platform === 0 || platform === 3) && len % 2 === 0) names.add(bytes.swap16().toString('utf16le'));
          else if (platform === 1) names.add(bytes.toString('latin1'));
        }
      }
    }
    return [...names];
  } finally { await handle.close(); }
}

/** Yalnızca dizin listelemesi yapar (ucuz); font içeriği okunmaz. Sıra, eski gezinme sırasıyla aynıdır. */
async function listFontFiles(dir: string, out: string[], depth = 0): Promise<void> {
  if (depth > MAX_FONT_DIR_DEPTH) return;
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) await listFontFiles(file, out, depth + 1);
    else if ((entry.isFile() || entry.isSymbolicLink()) && FONT_FILE_RE.test(entry.name)) out.push(file);
  }
}

export async function selectSystemFontFiles(wanted: string[], roots?: string[]): Promise<string[]> {
  const requested = new Set(wanted.map(normalize));
  const home = os.homedir();
  const dirs = roots ?? (process.platform === 'win32'
    ? [path.join(process.env.WINDIR ?? 'C:/Windows', 'Fonts'), path.join(process.env.LOCALAPPDATA ?? path.join(home, 'AppData/Local'), 'Microsoft/Windows/Fonts')]
    : process.platform === 'darwin' ? ['/System/Library/Fonts', '/Library/Fonts', path.join(home, 'Library/Fonts')]
      : ['/usr/share/fonts', '/usr/local/share/fonts', path.join(home, '.fonts'), path.join(home, '.local/share/fonts')]);

  const candidates: string[] = [];
  for (const dir of new Set(dirs)) await listFontFiles(dir, candidates);

  // Ad tabloları sınırlı eşzamanlılıkla okunur; sonuç sırası aday sırasıyla aynıdır.
  const matches = await mapLimit(candidates, NAME_SCAN_CONCURRENCY, async file => {
    const names = await fontFamilyNames(file).catch(() => []);
    return names.some(name => requested.has(normalize(name)));
  });
  return candidates.filter((_, index) => matches[index]);
}
