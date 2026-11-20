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
const MULTI_SPACE_RE = /\s{2,}/g;
const SENTENCE_SPLIT_RE = /(!|\?|\.|,)/;
const HTML_ENTITIES: Record<string, string> = {
  '&quot;': '"',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
};

export function decodeEntities(text: string): string {
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
