import { hasChords, mergeChordsAboveLyrics, stripChords } from '../shared/chords';
import { cleanLyrics, decodeEntities } from '../shared/hymnText';

export { cleanLyrics } from '../shared/hymnText';

// Strip ID codes like BG, TC (keep TY and RT)
const TITLE_PATTERNS = [/(?:BG|TC)\d+/gi, /\s{2,}/g];

export function cleanTitle(title: string): string {
  let t = title;
  t = t.replace(TITLE_PATTERNS[0], '').replace(TITLE_PATTERNS[1], ' ');
  return t.trim();
}

const LONE_SECTION_TAG_RE = /^\s*\[(?:V|C|B|CHORUS|BRIDGE|VERSE|PRE|OUTRO|INTRO)?\d*\]\s*$/i;

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

/**
 * Use the existing lyric breaks for chords too. The text cleanup can remove
 * lines or restore the stanza breaks of a legacy hymn, and a chord sheet may
 * contain instrumental stanzas that are absent from the projected lyrics.
 */
export function splitChordProParts(chordPro: string, lyricParts: string[]): string[] | null {
  const lines: { lyric: string; source: string }[] = [];
  let leading: string[] = [];
  let previous: (typeof lines)[number] | undefined;
  for (const source of chordPro.split(/\r?\n/)) {
    if (!source.trim()) {
      previous = undefined;
      continue;
    }
    const lyric = cleanLyrics(stripChords(source)).replace(/\s+/g, ' ').trim();
    if (lyric) {
      previous = { lyric, source: [...leading, source].join('\n') };
      lines.push(previous);
      leading = [];
    } else if (hasChords(source)) {
      if (previous) previous.source += '\n' + source;
      else leading.push(source);
    }
  }
  const finalLine = lines.at(-1);
  if (finalLine && leading.length) finalLine.source += '\n\n' + leading.join('\n');

  let index = 0;
  const parts = [];
  for (const part of lyricParts) {
    const matched: string[] = [];
    for (const line of part.split('\n')) {
      const lyric = line.replace(/\s+/g, ' ').trim();
      if (!lyric) {
        matched.push('');
        continue;
      }
      const entry = lines[index++];
      if (entry?.lyric !== lyric) return null;
      matched.push(entry.source);
    }
    parts.push(matched.join('\n'));
  }
  return index === lines.length ? parts : null;
}
