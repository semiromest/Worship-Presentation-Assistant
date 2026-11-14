export interface Hymn {
  /** Per-addition display preference; not part of imported hymn identity. */
  showAuthorOnSlides?: boolean;
  id: string;
  title: string;
  lyrics: string;
  /** Author / lyricist / composer, when known. */
  author?: string;
  /** Musical key (ton), when known. */
  key?: string;
  /** Source book reference (e.g. "TY527, RT38"), when known. */
  source?: string;
  /**
   * Lyrics with inline ChordPro chords (`[G]Amazing [C]grace`). When present it is
   * the source of truth and `lyrics` is its chord-free form.
   */
  chordPro?: string;
  /** Tempo in beats per minute, when known. */
  bpm?: number;
  /** Time signature such as "4/4" or "6/8", when known. */
  timeSignature?: string;
}

/**
 * Merges imported hymns into the existing list, replacing stale cached entries.
 */
function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ı/g, 'i');
}

const comparableLyrics = (text: string) => text.replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * A re-import without chords (e.g. from a plain XML archive) must not wipe chords
 * or tempo the user already added to the same song text.
 */
function keepChordData(previous: Hymn, fresh: Hymn): Hymn {
  if (fresh.chordPro || !previous.chordPro) {
    return {
      ...fresh,
      bpm: fresh.bpm ?? previous.bpm,
      timeSignature: fresh.timeSignature ?? previous.timeSignature,
    };
  }
  if (comparableLyrics(previous.lyrics) !== comparableLyrics(fresh.lyrics)) return fresh;
  return {
    ...fresh,
    chordPro: previous.chordPro,
    key: fresh.key ?? previous.key,
    bpm: fresh.bpm ?? previous.bpm,
    timeSignature: fresh.timeSignature ?? previous.timeSignature,
  };
}

export function mergeImportedHymns(existing: Hymn[], imported: Hymn[]): Hymn[] {
  if (imported.length === 0) return existing;

  const indexByTitle = new Map<string, number>();
  existing.forEach((h, i) => indexByTitle.set(normalizeTitle(h.title), i));

  const result = [...existing];
  for (const fresh of imported) {
    const idx = indexByTitle.get(normalizeTitle(fresh.title));
    if (idx !== undefined) {
      result[idx] = keepChordData(result[idx], fresh);
    } else {
      indexByTitle.set(normalizeTitle(fresh.title), result.length);
      result.push(fresh);
    }
  }
  return result;
}
