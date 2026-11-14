import { hasChords, mergeChordsAboveLyrics, stripChords } from '../shared/chords';
import { splitHymnLyrics } from './hymnSplit';

// Strip ID codes like BG, TC (keep TY and RT)
const TITLE_PATTERNS = [/(?:BG|TC)\d+/gi, /\s{2,}/g];

export function cleanTitle(title: string): string {
  let t = title;
  t = t.replace(TITLE_PATTERNS[0], '').replace(TITLE_PATTERNS[1], ' ');
  return t.trim();
}

const CHORD_TOKEN_RE =
  /^(?:\d+|\.?[A-G](#|b)?(?:M(?:aj)?(?:7|9)?|maj(?:7|9)?|min(?:7|9)?|mn?|m(?:7|9)?|sus(?:2|4)?|dim7?|aug|add\d+|\d+)?[+o°]?(?:\/[A-G](#|b)?)?(?:\([A-GMmb#0-9/+]+\))?)$/;

/** Are all tokens in this line chords? If so, the whole line is removed. */
function isPureChordLine(line: string): boolean {
  const tokens = line.trim().split(/\s+/);
  return tokens.length > 0 && tokens.every((t) => CHORD_TOKEN_RE.test(t));
}

/** Remove inline chord tokens from a mixed (lyrics + chords) line. */
function removeInlineChords(line: string): string {
  return line
    .split(/\s+/)
    .filter((token) => !CHORD_TOKEN_RE.test(token))
    .join(' ')
    .trim();
}

const SECTION_TAG_RE = /\[(V|C|B|CHORUS|BRIDGE|VERSE|PRE|OUTRO|INTRO)?\d*\]/gi;
const LONE_SECTION_TAG_RE = /^\s*\[(?:V|C|B|CHORUS|BRIDGE|VERSE|PRE|OUTRO|INTRO)?\d*\]\s*$/i;
const MULTI_SPACE_RE = /\s{2,}/g;
const SENTENCE_SPLIT_RE = /(!|\?|\.|,)/;
const HTML_ENTITIES: Record<string, string> = {
  '&quot;': '"',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
};

function decodeEntities(text: string): string {
  let out = text.replace(/\r\n?/g, '\n');
  for (const [entity, char] of Object.entries(HTML_ENTITIES)) out = out.split(entity).join(char);
  return out;
}

/** Plain-lyrics cleanup used for every imported / typed hymn (chords are removed). */
export function cleanLyrics(lyrics: string): string {
  if (!lyrics) return '';

  let text = decodeEntities(lyrics);

  // Strip section tags: [V1] [CHORUS] etc.
  text = text.replace(SECTION_TAG_RE, '\n\n');

  const lines = text.split('\n');
  const out: string[] = [];

  for (const raw of lines) {
    let line = raw.trim();

    // Empty line — avoid consecutive blank lines
    if (!line) {
      if (out.length > 0 && out[out.length - 1] !== '') out.push('');
      continue;
    }

    // 1) Skip lines that are entirely chords (e.g. "G F", "Am7 Dsus4", ".D .G")
    if (isPureChordLine(line)) continue;

    // 2) Remove chord tokens from mixed lines (e.g. "Seni Am seviyorum G7")
    line = removeInlineChords(line);

    // 3) Clean dots, dashes, underscores + fix spacing
    line = line.replace(/[.\-_]+/g, ' ').replace(MULTI_SPACE_RE, ' ').trim();
    if (!line) continue;

    // 4) Merge over-split repeated fragments separated by commas/punctuation
    const parts = line.split(SENTENCE_SPLIT_RE);
    if (parts.length > 3) {
      const seen = new Set<string>();
      const rebuilt: string[] = [];
      for (let i = 0; i < parts.length; i += 2) {
        const s = (parts[i] + (parts[i + 1] ?? '')).trim();
        if (!seen.has(s)) {
          seen.add(s);
          rebuilt.push(s);
        }
      }
      line = rebuilt.join(' ');
    }

    out.push(line);
  }

  while (out[0] === '') out.shift();
  while (out[out.length - 1] === '') out.pop();
  return out.join('\n');
}

/** Light tidy for ChordPro text: trims lines, turns section tags into stanza gaps, collapses blank runs. */
function tidyChordPro(text: string): string {
  const out: string[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\s+$/, '').replace(/^\s+/, '');
    if (!line || LONE_SECTION_TAG_RE.test(line)) {
      if (out.length > 0 && out[out.length - 1] !== '') out.push('');
      continue;
    }
    out.push(line.replace(/ {2,}/g, ' '));
  }
  while (out[0] === '') out.shift();
  while (out[out.length - 1] === '') out.pop();
  return out.join('\n');
}

export interface PreparedHymnText {
  lyrics: string;
  chordPro?: string;
}

/**
 * Turns pasted / imported song text into chord-free lyrics plus, when the text
 * carries chords (inline `[G]` or chords-above-lyrics), a ChordPro copy.
 */
export function prepareHymnText(raw: string): PreparedHymnText {
  if (!raw) return { lyrics: '' };
  const merged = mergeChordsAboveLyrics(decodeEntities(raw));
  if (!hasChords(merged)) return { lyrics: cleanLyrics(raw) };
  const chordPro = tidyChordPro(merged);
  return { lyrics: cleanLyrics(stripChords(chordPro)), chordPro };
}

/** Normalizes a hymn that may already carry `chordPro` (e.g. from the online catalog). */
export function prepareHymn<T extends { lyrics: string; chordPro?: string }>(hymn: T): T {
  if (hymn.chordPro && hasChords(hymn.chordPro)) {
    const chordPro = tidyChordPro(decodeEntities(hymn.chordPro));
    return { ...hymn, chordPro, lyrics: cleanLyrics(stripChords(chordPro)) };
  }
  const rest: T = { ...hymn };
  delete rest.chordPro;
  return { ...rest, ...prepareHymnText(hymn.lyrics) };
}

const INLINE_CHORD_RE = /\[([^\]\n]+)\]/g;
const LONE_BRACKET_RE = /^\s*\[[^\]\n]+\]\s*$/;

/**
 * Splits a ChordPro song into slide parts that line up one-to-one with
 * `splitHymnLyrics(lyrics)`. Chords are masked while splitting because the
 * splitter treats a lone `[C]` as a chorus label. Returns null when the two
 * splits disagree, so callers fall back to chord-free slides.
 */
export function splitChordProParts(chordPro: string, lyricParts: string[]): string[] | null {
  const masked = chordPro
    .split('\n')
    .map((line) => (LONE_BRACKET_RE.test(line) ? line : line.replace(INLINE_CHORD_RE, '⟦$1⟧')))
    .join('\n');
  const parts = splitHymnLyrics(masked)
    .parts.map((part) => part.replace(/⟦([^⟧\n]+)⟧/g, '[$1]'))
    .filter((part) => stripChords(part).trim());
  return parts.length === lyricParts.length ? parts : null;
}
