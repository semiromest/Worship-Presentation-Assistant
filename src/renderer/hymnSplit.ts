export type HymnSplitResult = {
  parts: string[];
};

// ───────────────────────  Ayarlanabilir konfigürasyon  ───────────────────────

export interface SplitConfig {
  maxLines: number;
  maxChars: number;
  defaultMaxParts: number;
  /** Slaytları cümle sınırında bitirmeyi tercih et (prose için uygundur, lirik için gereksiz) */
  preferSentenceBoundaryCuts: boolean;
  /** Tek bir birimin karakter-ceza eşiği (yalnızca scripture'da zorunlu kırma için) */
  allowWordBreak: boolean;
}

export const HYMN_CONFIG: SplitConfig = {
  maxLines: 6,
  maxChars: 240,
  defaultMaxParts: 5,
  preferSentenceBoundaryCuts: false,
  allowWordBreak: false,
};

export const SCRIPTURE_CONFIG: SplitConfig = {
  maxLines: 2,
  maxChars: 80,
  defaultMaxParts: 5,
  preferSentenceBoundaryCuts: true,
  allowWordBreak: true,
};

// ─────────────────────────────  Regex sabitleri  ──────────────────────────────

const RE_CRLF        = /\r\n/g;
const RE_CR          = /\r/g;
const RE_TRAIL_WS    = /[^\S\n]+$/gm;
const RE_LEAD_WS     = /^[^\S\n]+/gm;
const RE_MULTI_BLANK = /\n{3,}/g;
const RE_SPACE_RUN   = /[ \t]{2,}/g;
const RE_SENTENCE_END = /[.!?…;:»"\])\u061F\u0964]$/u;

// Wortslavyar/İngilizce stanza etiketleri + "1." / "12:" tek başına satır.
const STANZA_LABEL_PATTERN = String.raw`
  ^
  (?:
    (?:verse|verset|chorus|refrain|bridge|intro|outro|coda|tag|pre[-\s]?chorus
       |pre[-\s]?koro|ara[-\s]?koro|nakarat|koro|k\xf6pr\xfc|giri\u015f
       |biti\u015f|final|son(?:u\xe7)?|strophe|b\u00f6l\xfcm)
    \b[\s\d]*[:：.\-]?\s*$
    |
    \d{1,2}\s*[:：.\-]\s*$
  )
`.replace(/\s+/g, '');
const RE_LABEL = new RegExp(STANZA_LABEL_PATTERN, 'iu');

// ─────────────────────────  1) Normalizasyon  ──────────────────────────────────

function normalizeText(text: string): string {
  if (!text) return '';
  return text
    .replace(RE_CRLF, '\n')
    .replace(RE_CR,   '\n')
    .replace(RE_SPACE_RUN, ' ')
    .replace(RE_TRAIL_WS, '')
    .replace(RE_LEAD_WS, '')
    .replace(RE_MULTI_BLANK, '\n\n')
    .split('\n')
    .map(l => l.replace(/\s+/g, ' ').trim())
    .join('\n')
    .trim();
}

// ─────────────────────────  2) Birim modeli  ──────────────────────────────────

interface Unit {
  text: string;
  length: number;
  lineCount: number;
  endsSentence: boolean;
  isLabel: boolean;
  blockId: number;
}

interface Block { id: number; units: Unit[]; }

function splitSentences(text: string): string[] {
  const t = text.replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, ' ').trim();
  if (!t) return [];
  const out: string[] = [];
  let start = 0;
  const re = /([.!?…;:»"\])\u061F\u0964])(?:\s+|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t)) !== null) {
    const end = m.index + m[0].length;
    const seg = t.slice(start, end).trim();
    if (seg) out.push(seg);
    start = end;
  }
  if (start < t.length) {
    const tail = t.slice(start).trim();
    if (tail) out.push(tail);
  }
  return out;
}

function parseHymn(text: string): Block[] {
  const normalized = normalizeText(text);
  if (!normalized) return [];
  return normalized
    .split(/\n{2,}/)
    .map(p => p.trim())
    .filter(Boolean)
    .map((para, idx) => {
      const lines = para.split('\n').map(l => l.trim()).filter(Boolean);
      return {
        id: idx,
        units: lines.map((line, i) => ({
          text: line,
          length: line.length,
          lineCount: 1,
          endsSentence: RE_SENTENCE_END.test(line),
          isLabel: i === 0 && RE_LABEL.test(line),
          blockId: idx,
        })),
      };
    });
}

function parseScripture(text: string): Unit[] {
  const normalized = normalizeText(text);
  if (!normalized) return [];
  let sentences = splitSentences(normalized);
  if (sentences.length === 0) {
    sentences = normalized.split('\n').map(l => l.trim()).filter(Boolean);
  }
  return sentences.map(s => ({
    text: s,
    length: s.length,
    lineCount: 1,
    endsSentence: true,
    isLabel: false,
    blockId: 0,
  }));
}

// ────  3) Maliyet fonksiyonu (primary/secondary/tertiary hiyerarşi)  ─────────

const HARD_LINE_OVERFLOW_W   = 1000;   // slayt başına satır taşması — karesel
const HARD_CHAR_OVERFLOW_W   = 20;     // slayt başına karakter taşması — lineer
const SOFT_BASE_SLIDE_COST   = 1;      // daha az slayt preferable
const SOFT_UNDERUTILIZE_PEN  = 0.2;   // ≤0.5 dolu ise ufak ceza
const SOFT_LABEL_STRAND_PEN  = 4;      // etiket satırı tek başına slayt olamaz
const SOFT_CUT_MID_SENTENCE  = 0.01;   // cümle ortasında kesimin hafif cezası
const CROSS_BLOCK_MERGE_PEN  = 50;     // maxParts durumunda farklı stanza birleşiminden kaçın

function slideCostForRange(units: Unit[], start: number, end: number, cfg: SplitConfig): number {
  let chars = 0;
  let lines = 0;
  let labelCount = 0;
  let contentCount = 0;
  for (let i = start; i < end; i++) {
    const u = units[i];
    if (i > start) chars += 1;          // birim arası \n ayracı
    chars += u.length;
    lines += u.lineCount;
    if (u.isLabel) labelCount++; else contentCount++;
  }
  const lineOver = Math.max(0, lines - cfg.maxLines);
  const charOver = Math.max(0, chars - cfg.maxChars);
  let cost = 0;
  // PRIMARY: hard overflow (Daha fazla slaytın var olduğu durumda ~hiç risk olmamalı)
  cost += lineOver * lineOver * HARD_LINE_OVERFLOW_W + charOver * HARD_CHAR_OVERFLOW_W;
  // SECONDARY: daha az slayt tercih et
  cost += SOFT_BASE_SLIDE_COST;
  // TERTIARY: dengesiz kullanım + etiket tek başına
  const util = Math.min(chars / cfg.maxChars, lines / cfg.maxLines);
  if (util < 0.5) cost += (0.5 - util) * SOFT_UNDERUTILIZE_PEN;
  if (labelCount > 0 && contentCount === 0) cost += SOFT_LABEL_STRAND_PEN;
  return cost;
}

// ────  4) DP partition — her blok içinde optimum çok-yönlü kırma  ─────────────

function partitionByDP(units: Unit[], cfg: SplitConfig): Array<[number, number]> {
  const n = units.length;
  if (n === 0) return [];
  const dp   = new Array<number>(n + 1).fill(Infinity);
  const prev = new Array<number>(n + 1).fill(-1);
  dp[0] = 0;
  for (let i = 1; i <= n; i++) {
    for (let j = 0; j < i; j++) {
      const sc = slideCostForRange(units, j, i, cfg);
      // Yalnızca "i" sınırı gerçek bir kırma noktası ise cümle-ortası bias ekle
      let bias = 0;
      if (i < n && cfg.preferSentenceBoundaryCuts && !units[i - 1].endsSentence) {
        bias += SOFT_CUT_MID_SENTENCE;
      }
      const total = dp[j] + sc + bias;
      if (total < dp[i]) { dp[i] = total; prev[i] = j; }
    }
  }
  const out: Array<[number, number]> = [];
  let k = n;
  while (k > 0) {
    const p = prev[k];
    out.unshift([p, k]);
    k = p;
  }
  return out;
}

interface Slide {
  text: string;
  chars: number;
  lines: number;
  blockId: number;
  overflow: boolean;
}

function buildSlide(units: Unit[], start: number, end: number): Slide {
  const slice = units.slice(start, end);
  let chars = 0;
  let lines = 0;
  for (let i = 0; i < slice.length; i++) {
    if (i > 0) chars += 1;
    chars += slice[i].length;
    lines += slice[i].lineCount;
  }
  return {
    text: slice.map(u => u.text).join('\n'),
    chars, lines,
    blockId: slice.length ? slice[0].blockId : 0,
    overflow: false,
  };
}

// ────  5) Word-boundary fallback (yalnız scriptural zorunlu kırma için)  ────

function wordBreakRecursive(unit: Unit, maxChars: number): Unit[] {
  const text = unit.text;
  if (text.length <= maxChars) return [unit];

  // 1) Öncelik: maxChars'ın %55–%100 bandında en iyi noktalama işareti
  const lower = Math.floor(maxChars * 0.55);
  const re = /([.,;:!?\-–—،؛»"'])/g;
  let bestPunct = -1;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > maxChars) break;
    if (m.index >= lower) bestPunct = Math.max(bestPunct, m.index + 1);
  }
  let cut = bestPunct;
  if (cut < 0) {
    // 2) Noktalama yoksa nearest 0..maxChars boşluğu
    cut = maxChars;
    while (cut > 0 && text[cut] !== ' ' && text[cut] !== '\n') cut--;
    if (cut <= 0) cut = maxChars;   // kelime tek parça — mecburi sert kırma
  }
  const left  = text.slice(0, cut).replace(/[\s,;:\-–—،؛»"']+$/, '').trim();
  const right = text.slice(cut).replace(/^[\s,;:\-–—،؛»"']+/,    '').trim();
  const out: Unit[] = [];
  if (left)  out.push(mkUnit(left,  unit.blockId));
  if (right) out.push(mkUnit(right, unit.blockId));
  return out.length > 0 ? out : [unit];
}

function mkUnit(text: string, blockId: number): Unit {
  return {
    text,
    length: text.length,
    lineCount: 1,
    endsSentence: RE_SENTENCE_END.test(text),
    isLabel: false,
    blockId,
  };
}

function expandUnits(units: Unit[], maxChars: number, allowWordBreak: boolean): Unit[] {
  const out: Unit[] = [];
  for (const u of units) {
    if (u.length > maxChars && allowWordBreak) {
      out.push(...wordBreakRecursive(u, maxChars));
    } else {
      out.push(u);
    }
  }
  // Recursive stabilizasyon (çok uzun tek kelime nadiren olur)
  let stable = false;
  while (!stable) {
    stable = true;
    const next: Unit[] = [];
    for (const u of out) {
      if (u.length > maxChars && allowWordBreak) {
        next.push(...wordBreakRecursive(u, maxChars));
        stable = false;
      } else next.push(u);
    }
    out.length = 0; out.push(...next);
  }
  return out;
}

// ────  6) Slayt tıkanıklığı gevşetme: maxParts sınırları içinde akıllıca birleştir  ─

function enforceMaxParts(slides: Slide[], cfg: SplitConfig, maxParts: number): Slide[] {
  const work = slides.slice();
  while (work.length > maxParts) {
    let bestIdx = -1;
    let bestCost = Infinity;
    for (let i = 0; i < work.length - 1; i++) {
      const a = work[i], b = work[i + 1];
      const combinedLines = a.lines + b.lines;
      const combinedChars = a.chars + b.chars + 2;          // "\n\n"
      const lineOver = Math.max(0, combinedLines - cfg.maxLines);
      const charOver = Math.max(0, combinedChars - cfg.maxChars);
      const overflow = lineOver * lineOver * HARD_LINE_OVERFLOW_W + charOver * HARD_CHAR_OVERFLOW_W;
      const cross    = a.blockId === b.blockId ? 0 : CROSS_BLOCK_MERGE_PEN;
      const cost     = overflow + cross;
      if (cost < bestCost) { bestCost = cost; bestIdx = i; }
    }
    if (bestIdx < 0) break;
    const a = work[bestIdx], b = work[bestIdx + 1];
    const merged: Slide = {
      text: a.text + '\n\n' + b.text,
      chars: a.chars + b.chars + 2,
      lines: a.lines + b.lines,
      blockId: a.blockId,
      overflow: false,
    };
    work.splice(bestIdx, 2, merged);
  }
  for (const s of work) {
    s.overflow = s.lines > cfg.maxLines || s.chars > cfg.maxChars;
  }
  return work;
}

// ────  7) Top-level orkestrasyon  ──────────────────────────────────────────────

// İlahi bölme ilkesi: her kıta (boş satırla ayrılmış blok) = tek slayt.
// Satır sayısı veya karakter uzunluğuna bakılmaz; kıta asla parçalanmaz.
function splitHymnInternal(text: string): Slide[] {
  const blocks = parseHymn(text);
  const slides: Slide[] = [];
  for (const block of blocks) {
    if (!block.units.length) continue;
    slides.push(buildSlide(block.units, 0, block.units.length));
  }
  return slides;
}

function splitScriptureInternal(text: string, cfg: SplitConfig, maxParts: number): Slide[] {
  const rawUnits = parseScripture(text);
  if (!rawUnits.length) return [];
  const units = expandUnits(rawUnits, cfg.maxChars, cfg.allowWordBreak);
  const pseudo: Block = { id: 0, units };
  const ranges = partitionByDP(pseudo.units, cfg);
  const slides = ranges.map(([s, e]) => buildSlide(pseudo.units, s, e));
  return enforceMaxParts(slides, cfg, maxParts);
}

// ────  8) Public API  ─────────────────────────────────────────────────────────

export function splitHymnLyrics(lyrics: string): HymnSplitResult {
  if (!lyrics || typeof lyrics !== 'string') return { parts: [] };
  return {
    parts: splitHymnInternal(lyrics)
      .map(s => normalizeText(s.text))
      .filter(t => t.length > 0),
  };
}

export function splitScripture(text: string, maxParts?: number): HymnSplitResult {
  if (!text || typeof text !== 'string') return { parts: [] };
  const n = maxParts == null ? SCRIPTURE_CONFIG.defaultMaxParts : Math.max(1, Math.floor(maxParts));
  return {
    parts: splitScriptureInternal(text, SCRIPTURE_CONFIG, n)
      .map(s => normalizeText(s.text))
      .filter(t => t.length > 0),
  };
}

export const splitHymnIntoMaxFiveParts = (lyrics: string): HymnSplitResult =>
  splitHymnLyrics(lyrics);
