import { hasChords, stripChords, transposeChordPro, transposeKey } from './chords';
import { cleanLyrics } from './hymnText';
import { getPartIndex, type PartsSlide } from './slideContent';

export interface SlideChords {
  /** ChordPro text per slide part (one entry when the slide is not in parts mode). */
  parts: string[];
  /** Original key of the song, when known. */
  key?: string;
  /** Service-level transposition in semitones (the library song is unchanged). */
  transpose?: number;
}

type ChordSlide = PartsSlide & { chords?: SlideChords };

const comparable = (text: string) => text.replace(/\s+/g, ' ').trim().toLowerCase();

/** Raw (untransposed) ChordPro for the part currently shown, or null. */
function activeChordPart(slide: ChordSlide): string | null {
  const parts = slide.chords?.parts;
  if (!parts?.length) return null;
  const index = slide.partsMode && slide.parts?.length ? getPartIndex(slide) : 0;
  return parts[index] ?? null;
}

/**
 * Transposed ChordPro for what the slide shows right now. Returns null when the
 * slide has no chords or its text was edited after the chords were attached
 * (stale chords are worse than none).
 */
export function getSlideChordText(slide: ChordSlide | undefined): string | null {
  if (!slide?.chords) return null;
  const raw = activeChordPart(slide);
  if (!raw || !hasChords(raw)) return null;
  const shown = slide.partsMode && slide.parts?.length ? slide.parts[getPartIndex(slide)] ?? slide.content : slide.content;
  const lyrics = stripChords(raw);
  const shownText = comparable(shown);
  // The import keeps original punctuation in the chord sheet and cleans it in the projection.
  if (comparable(lyrics) !== shownText && comparable(cleanLyrics(lyrics)) !== shownText) return null;
  const semitones = slide.chords.transpose ?? 0;
  return semitones ? transposeChordPro(raw, semitones, { key: slide.chords.key }) : raw;
}

/** Original and sounding key for the stage header, e.g. { from: 'G', to: 'A', transpose: 2 }. */
export function getSlideChordKey(slide: ChordSlide | undefined): { from: string | null; to: string | null; transpose: number } {
  const transpose = slide?.chords?.transpose ?? 0;
  const from = slide?.chords?.key ?? null;
  return { from, to: from && transpose ? transposeKey(from, transpose) : from, transpose };
}

/** Normalizes a semitone offset to the -6..+6 range musicians expect. */
export function normalizeTranspose(semitones: number): number {
  const n = ((Math.round(semitones) % 12) + 12) % 12;
  return n > 6 ? n - 12 : n;
}
