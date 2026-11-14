/**
 * ChordPro-style chord handling for song lyrics.
 *
 * Songs keep chords inline as `[G]Amazing [C]grace`. A line that is nothing
 * but one bracket (`[Verse 1]`, `[C]`) is a section label, never a chord, to
 * stay compatible with the hymn splitter. Chord-only lines (intros, turnarounds)
 * are written with at least two tokens, e.g. `[G] [C] [D]` or `[G] |`.
 */

const SHARP_NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;
const FLAT_NOTES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'] as const;
const NATURAL_INDEX: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** Keys conventionally spelled with flats (major and minor). */
const FLAT_KEYS = new Set(['F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb', 'Cb', 'Dm', 'Gm', 'Cm', 'Fm', 'Bbm', 'Ebm', 'Abm']);

const CHORD_RE = /^([A-G](?:#|b)?)([^/\s]*)(?:\/([A-G](?:#|b)?))?$/;
const SUFFIX_RE = /^(?:maj|min|mi|m|M|dim|aug|sus|add|no|omit|alt|°|ø|o|\+|-|#|b|\d|\(|\)|,)*$/;
const INLINE_CHORD_RE = /\[([^\]\n]+)\]/g;
const LONE_BRACKET_RE = /^\s*\[[^\]\n]+\]\s*$/;
/** Tokens allowed on a chord line besides chords: bar lines, repeat marks, "N.C.". */
const FILLER_RE = /^(?:\||\/|-|–|x\d+|\d+x|\(x?\d+x?\)|N\.?C\.?|\.+)$/i;

export interface ChordSegment {
  chord: string | null;
  text: string;
}

export interface ParsedChord {
  root: string;
  suffix: string;
  bass: string | null;
}

export function parseChord(token: string): ParsedChord | null {
  const match = token.trim().match(CHORD_RE);
  if (!match) return null;
  const [, root, suffix, bass] = match;
  if (!SUFFIX_RE.test(suffix)) return null;
  return { root, suffix, bass: bass ?? null };
}

export function isChordToken(token: string): boolean {
  return parseChord(token) !== null;
}

function noteIndex(note: string): number {
  const base = NATURAL_INDEX[note[0]];
  if (base === undefined) return -1;
  const accidental = note.slice(1);
  const shift = accidental === '#' ? 1 : accidental === 'b' ? -1 : 0;
  return (base + shift + 12) % 12;
}

function spellNote(index: number, preferFlats: boolean): string {
  const i = ((index % 12) + 12) % 12;
  return preferFlats ? FLAT_NOTES[i] : SHARP_NOTES[i];
}

export function transposeChord(chord: string, semitones: number, preferFlats = false): string {
  const parsed = parseChord(chord);
  if (!parsed) return chord;
  const shift = ((semitones % 12) + 12) % 12;
  if (shift === 0) return chord;
  const root = spellNote(noteIndex(parsed.root) + shift, preferFlats);
  const bass = parsed.bass ? `/${spellNote(noteIndex(parsed.bass) + shift, preferFlats)}` : '';
  return `${root}${parsed.suffix}${bass}`;
}

function isMinorSuffix(suffix: string): boolean {
  return /^(?:m|min|mi|-)(?!aj)/.test(suffix);
}

/** Normalizes a key label ("G", "Em", "Bb major", "f# minor") to `Root` / `Rootm`. */
export function normalizeKey(key: string | null | undefined): string | null {
  if (!key) return null;
  const match = key.trim().match(/^([A-Ga-g])\s*(#|b|♯|♭)?\s*(m(?!aj)|min(?:or)?|minor|-|maj(?:or)?|major)?/i);
  if (!match) return null;
  const accidental = match[2] === '♯' ? '#' : match[2] === '♭' ? 'b' : (match[2] ?? '');
  const minor = match[3] ? /^(m|min|minor|-)$/i.test(match[3]) || /^min/i.test(match[3]) : false;
  return `${match[1].toUpperCase()}${accidental}${minor ? 'm' : ''}`;
}

export function keyPrefersFlats(key: string | null | undefined): boolean {
  const normalized = normalizeKey(key);
  return normalized ? FLAT_KEYS.has(normalized) : false;
}

/** Transposes a key label, choosing the conventional spelling for the new key. */
export function transposeKey(key: string, semitones: number): string {
  const normalized = normalizeKey(key);
  if (!normalized) return key;
  const minor = normalized.endsWith('m');
  const root = minor ? normalized.slice(0, -1) : normalized;
  const index = noteIndex(root) + semitones;
  const sharp = spellNote(index, false) + (minor ? 'm' : '');
  const flat = spellNote(index, true) + (minor ? 'm' : '');
  if (sharp === flat) return sharp;
  // F#/Gb is a tie; musicians usually write F#.
  return FLAT_KEYS.has(flat) && flat !== 'Gb' ? flat : sharp;
}

function isLoneBracketLine(line: string): boolean {
  return LONE_BRACKET_RE.test(line);
}

/** True when the text holds at least one inline chord (section labels don't count). */
export function hasChords(text: string | null | undefined): boolean {
  if (!text) return false;
  for (const line of text.split(/\r?\n/)) {
    if (isLoneBracketLine(line)) continue;
    for (const match of line.matchAll(INLINE_CHORD_RE)) {
      if (isChordToken(match[1])) return true;
    }
  }
  return false;
}

function isChordOnlyLine(line: string): boolean {
  if (isLoneBracketLine(line)) return false;
  const rest = line.replace(INLINE_CHORD_RE, (whole, inner: string) => (isChordToken(inner) ? ' ' : whole));
  if (rest === line) return false;
  return rest.split(/\s+/).every((token) => !token || FILLER_RE.test(token));
}

/** Removes inline chords; drops chord-only lines; keeps section labels. */
export function stripChords(text: string): string {
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (isLoneBracketLine(line)) {
      out.push(line);
      continue;
    }
    if (isChordOnlyLine(line)) continue;
    let changed = false;
    const stripped = line.replace(INLINE_CHORD_RE, (whole, inner: string) => {
      if (!isChordToken(inner)) return whole;
      changed = true;
      return '';
    });
    out.push(changed ? stripped.replace(/ {2,}/g, ' ').trim() : line);
  }
  return out.join('\n');
}

/** Splits a ChordPro line into chord/text segments for "chord over syllable" rendering. */
export function parseChordLine(line: string): ChordSegment[] {
  if (isLoneBracketLine(line)) return [{ chord: null, text: line }];
  const segments: ChordSegment[] = [];
  let cursor = 0;
  let pending: string | null = null;
  for (const match of line.matchAll(INLINE_CHORD_RE)) {
    if (!isChordToken(match[1])) continue;
    const index = match.index ?? 0;
    const text = line.slice(cursor, index);
    if (text || pending !== null) segments.push({ chord: pending, text });
    pending = match[1].trim();
    cursor = index + match[0].length;
  }
  const tail = line.slice(cursor);
  if (tail || pending !== null) segments.push({ chord: pending, text: tail });
  return segments.length ? segments : [{ chord: null, text: '' }];
}

/** Transposes every inline chord in a ChordPro text. */
export function transposeChordPro(
  text: string,
  semitones: number,
  options: { key?: string | null; preferFlats?: boolean } = {}
): string {
  if (!semitones || semitones % 12 === 0) return text;
  const preferFlats =
    options.preferFlats ??
    (options.key ? keyPrefersFlats(transposeKey(options.key, semitones)) : countFlats(text) > countSharps(text));
  return text
    .split(/\r?\n/)
    .map((line) =>
      isLoneBracketLine(line)
        ? line
        : line.replace(INLINE_CHORD_RE, (whole, inner: string) =>
            isChordToken(inner) ? `[${transposeChord(inner.trim(), semitones, preferFlats)}]` : whole
          )
    )
    .join('\n');
}

function chordRoots(text: string): string[] {
  const roots: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (isLoneBracketLine(line)) continue;
    for (const match of line.matchAll(INLINE_CHORD_RE)) {
      const parsed = parseChord(match[1]);
      if (parsed) roots.push(parsed.root + (isMinorSuffix(parsed.suffix) ? 'm' : ''));
    }
  }
  return roots;
}

function countFlats(text: string): number {
  return chordRoots(text).filter((root) => /^[A-G]b/.test(root)).length;
}

function countSharps(text: string): number {
  return chordRoots(text).filter((root) => /^[A-G]#/.test(root)).length;
}

/** Best-effort key guess: the last chord of a song usually resolves to the tonic, else the first. */
export function detectKey(text: string): string | null {
  const roots = chordRoots(text);
  if (!roots.length) return null;
  const first = roots[0];
  const last = roots[roots.length - 1];
  return first === last ? first : last;
}

// ── Chords-above-lyrics → inline ────────────────────────────────────────────

function chordLineTokens(line: string): Array<{ token: string; column: number }> | null {
  if (!line.trim() || line.includes('[')) return null;
  const tokens: Array<{ token: string; column: number }> = [];
  const re = /\S+/g;
  let match: RegExpExecArray | null;
  let chords = 0;
  while ((match = re.exec(line))) {
    const token = match[0];
    if (isChordToken(token)) chords += 1;
    else if (!FILLER_RE.test(token)) return null;
    tokens.push({ token, column: match.index });
  }
  return chords ? tokens : null;
}

/** "A" / "E" alone also read as English words; only trust them when the song clearly has chord lines. */
function isAmbiguousChordLine(tokens: Array<{ token: string }>): boolean {
  return tokens.every((t) => /^[AE]$/.test(t.token) || FILLER_RE.test(t.token));
}

function inlineChordOnlyLine(tokens: Array<{ token: string }>): string {
  const parts = tokens.map((t) => (isChordToken(t.token) ? `[${t.token}]` : t.token));
  if (parts.length === 1) parts.push('|');
  return parts.join(' ');
}

function mergeLine(tokens: Array<{ token: string; column: number }>, lyric: string): string {
  let result = lyric;
  for (let i = tokens.length - 1; i >= 0; i -= 1) {
    const { token } = tokens[i];
    let { column } = tokens[i];
    if (!isChordToken(token)) continue;
    // A chord typed one or two columns early (over the gap) belongs to the next word.
    if (lyric[column] === ' ') {
      const next = lyric.slice(column).search(/\S/);
      if (next > 0 && next <= 2) column += next;
    }
    if (column > result.length) result = result.padEnd(column, ' ');
    result = `${result.slice(0, column)}[${token}]${result.slice(column)}`;
  }
  return result.replace(/\s+$/, '');
}

/**
 * Converts "chords on the line above the words" into inline ChordPro.
 * Lines that already use brackets are left as they are.
 */
export function mergeChordsAboveLyrics(text: string): string {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const parsed = lines.map(chordLineTokens);
  const hasDefinite = parsed.some((tokens) => tokens && !isAmbiguousChordLine(tokens));
  const isChordLine = (index: number) => {
    const tokens = parsed[index];
    return !!tokens && (hasDefinite || !isAmbiguousChordLine(tokens));
  };
  const out: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (!isChordLine(i)) {
      out.push(lines[i]);
      continue;
    }
    const tokens = parsed[i] as Array<{ token: string; column: number }>;
    const next = lines[i + 1];
    if (next !== undefined && next.trim() && !isChordLine(i + 1) && !isLoneBracketLine(next)) {
      out.push(mergeLine(tokens, next));
      i += 1;
    } else {
      out.push(inlineChordOnlyLine(tokens));
    }
  }
  return out.join('\n');
}

/** Inline ChordPro → plain "chords above lyrics" text (for printing / copying to musicians). */
export function chordProToChordsAbove(text: string): string {
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!hasChords(line)) {
      out.push(line);
      continue;
    }
    let chordRow = '';
    let lyricRow = '';
    for (const segment of parseChordLine(line)) {
      if (segment.chord) {
        if (chordRow.length > lyricRow.length) lyricRow = lyricRow.padEnd(chordRow.length, ' ');
        chordRow = chordRow.padEnd(lyricRow.length, ' ') + segment.chord + ' ';
      }
      lyricRow += segment.text;
    }
    out.push(chordRow.replace(/\s+$/, ''));
    if (!isChordOnlyLine(line) && lyricRow.trim()) out.push(lyricRow.replace(/\s+$/, ''));
  }
  return out.join('\n');
}

/** Converts worship-leader `songxml` `<chord>G</chord>` markup to inline brackets. */
export function xmlChordsToInline(xml: string): string {
  return xml.replace(/<chord>\s*([^<]*?)\s*<\/chord>/gi, (_whole, chord: string) =>
    isChordToken(chord) ? `[${chord}]` : ''
  );
}

export interface ChordProDocumentInput {
  title: string;
  chordPro: string;
  author?: string;
  key?: string;
  bpm?: number;
  timeSignature?: string;
}

/** A standalone .cho document (directives + body), optionally transposed. */
export function buildChordProDocument(song: ChordProDocumentInput, semitones = 0): string {
  const key = song.key ? (semitones ? transposeKey(song.key, semitones) : song.key) : null;
  const header = [
    `{title: ${song.title}}`,
    song.author ? `{artist: ${song.author}}` : null,
    key ? `{key: ${key}}` : null,
    song.bpm ? `{tempo: ${song.bpm}}` : null,
    song.timeSignature ? `{time: ${song.timeSignature}}` : null,
  ].filter(Boolean);
  const body = transposeChordPro(song.chordPro, semitones, { key: song.key })
    .split('\n')
    .map((line) => {
      const label = line.match(/^\s*\[([^\]\n]+)\]\s*$/);
      return label ? `{comment: ${label[1]}}` : line;
    })
    .join('\n');
  return `${header.join('\n')}\n\n${body}\n`;
}
