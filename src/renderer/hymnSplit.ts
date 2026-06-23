export type HymnSplitResult = { parts: string[] };

// ─── Sabitler ────────────────────────────────────────────────────────────────

const RE_CRLF         = /\r\n/g;
const RE_CR           = /\r/g;
const RE_TRAIL_SPACE  = /[^\S\n]+$/gm;
const RE_MULTI_BLANK  = /\n{3,}/g;
const RE_PUNCT_END    = /[.!?…;:,)]$/;

// İlahiler için (küçük font)
const HYMN_MAX_LINES = 3;
const HYMN_MAX_CHARS = 120;

// İncil ayetleri için (82 font)
const SCRIPTURE_MAX_LINES = 2;
const SCRIPTURE_MAX_CHARS = 80;

const DEFAULT_MAX_PARTS = 5;

// ─── Metin normalizasyonu ────────────────────────────────────────────────────

function normalizeText(text: string): string {
  return text
    .replace(RE_CRLF, '\n')
    .replace(RE_CR, '\n')
    .replace(RE_TRAIL_SPACE, '')
    .replace(RE_MULTI_BLANK, '\n\n')
    .trim();
}

function splitParagraphs(text: string): string[] {
  return text.split('\n\n').map(p => p.trim()).filter(p => p.length > 0);
}

// ─── Boyut kontrolü ──────────────────────────────────────────────────────────

interface SizeInfo {
  lines: number;
  chars: number;
  isOversize: boolean;
}

function analyzeSize(text: string, maxLines: number, maxChars: number): SizeInfo {
  const lines = text ? text.split('\n').length : 0;
  return {
    lines,
    chars: text.length,
    isOversize: lines > maxLines || text.length > maxChars
  };
}

function analyzeSizeHymn(text: string): SizeInfo {
  return analyzeSize(text, HYMN_MAX_LINES, HYMN_MAX_CHARS);
}

function analyzeSizeScripture(text: string): SizeInfo {
  return analyzeSize(text, SCRIPTURE_MAX_LINES, SCRIPTURE_MAX_CHARS);
}

// ─── Bölme algoritması ───────────────────────────────────────────────────────

function findOptimalSplitPoint(lines: string[], maxLines: number, maxChars: number): number {
  if (lines.length <= 1) return -1;

  let bestIndex = -1;
  let bestScore = Infinity;

  for (let i = 1; i < lines.length; i++) {
    const topPart = lines.slice(0, i).join('\n');
    const bottomPart = lines.slice(i).join('\n');
    
    const topSize = analyzeSize(topPart, maxLines, maxChars);
    const bottomSize = analyzeSize(bottomPart, maxLines, maxChars);

    if (!topSize.isOversize && !bottomSize.isOversize) {
      const endsWithPunctuation = RE_PUNCT_END.test(lines[i - 1].trim());
      const balance = Math.abs(topPart.length - bottomPart.length);
      const score = balance - (endsWithPunctuation ? 100 : 0);
      
      if (score < bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }
  }

  if (bestIndex === -1) {
    for (let i = 1; i < lines.length; i++) {
      const topPart = lines.slice(0, i).join('\n');
      const bottomPart = lines.slice(i).join('\n');
      
      const overflow = Math.max(
        Math.max(0, topPart.split('\n').length - maxLines),
        Math.max(0, bottomPart.split('\n').length - maxLines),
        Math.max(0, topPart.length - maxChars),
        Math.max(0, bottomPart.length - maxChars)
      );
      
      if (overflow < bestScore) {
        bestScore = overflow;
        bestIndex = i;
      }
    }
  }

  return bestIndex;
}

function splitBlockOptimally(text: string, maxParts: number, analyzer: (t: string) => SizeInfo, finder: (l: string[]) => number, maxChars: number): string[] {
  const normalized = normalizeText(text);
  if (!normalized) return [];

  const paragraphs = splitParagraphs(normalized);
  if (paragraphs.length === 0) return [];

  const parts: string[] = [];
  let currentPart = '';
  
  for (let i = 0; i < paragraphs.length; i++) {
    const candidate = currentPart ? `${currentPart}\n\n${paragraphs[i]}` : paragraphs[i];
    const candidateSize = analyzer(candidate);
    
    if (!candidateSize.isOversize || parts.length >= maxParts - 1) {
      currentPart = candidate;
    } else {
      if (currentPart) {
        parts.push(currentPart);
      }
      currentPart = paragraphs[i];
    }
  }
  
  if (currentPart) {
    parts.push(currentPart);
  }

  const finalParts: string[] = [];
  
  for (const part of parts) {
    if (analyzer(part).isOversize && finalParts.length < maxParts) {
      const lines = part.split('\n');
      const splitPoint = finder(lines);
      
      if (splitPoint > 0) {
        finalParts.push(lines.slice(0, splitPoint).join('\n'));
        finalParts.push(lines.slice(splitPoint).join('\n'));
      } else {
        if (part.length > maxChars) {
          let splitPos = maxChars;
          while (splitPos > 0 && part[splitPos] !== ' ' && part[splitPos] !== '\n') {
            splitPos--;
          }
          if (splitPos > 0) {
            finalParts.push(part.substring(0, splitPos).trim());
            finalParts.push(part.substring(splitPos).trim());
          } else {
            finalParts.push(part);
          }
        } else {
          finalParts.push(part);
        }
      }
    } else {
      finalParts.push(part);
    }
  }

  while (finalParts.length > maxParts) {
    let minIndex = 0;
    let minLength = finalParts[0].length + finalParts[1].length;
    
    for (let i = 1; i < finalParts.length - 1; i++) {
      const combinedLength = finalParts[i].length + finalParts[i + 1].length;
      if (combinedLength < minLength) {
        minLength = combinedLength;
        minIndex = i;
      }
    }
    
    const merged = `${finalParts[minIndex]}\n\n${finalParts[minIndex + 1]}`;
    finalParts.splice(minIndex, 2, merged);
  }

  return finalParts.filter(p => p.trim().length > 0);
}

// ─── Ana API ─────────────────────────────────────────────────────────────────

export function splitHymnLyrics(lyrics: string, maxParts: number = DEFAULT_MAX_PARTS): HymnSplitResult {
  if (!lyrics || typeof lyrics !== 'string') {
    return { parts: [] };
  }

  const finder = (lines: string[]) => findOptimalSplitPoint(lines, HYMN_MAX_LINES, HYMN_MAX_CHARS);
  const parts = splitBlockOptimally(lyrics, maxParts, analyzeSizeHymn, finder, HYMN_MAX_CHARS);
  
  return {
    parts: parts.map(normalizeText).filter(p => p.length > 0)
  };
}

export function splitScripture(text: string, maxParts: number = DEFAULT_MAX_PARTS): HymnSplitResult {
  if (!text || typeof text !== 'string') {
    return { parts: [] };
  }

  const finder = (lines: string[]) => findOptimalSplitPoint(lines, SCRIPTURE_MAX_LINES, SCRIPTURE_MAX_CHARS);
  const parts = splitBlockOptimally(text, maxParts, analyzeSizeScripture, finder, SCRIPTURE_MAX_CHARS);
  
  return {
    parts: parts.map(normalizeText).filter(p => p.length > 0)
  };
}

export const splitHymnIntoMaxFiveParts = (lyrics: string): HymnSplitResult => 
  splitHymnLyrics(lyrics, 5);
