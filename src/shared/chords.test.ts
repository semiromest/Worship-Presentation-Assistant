import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildChordProDocument,
  chordProToChordsAbove,
  detectKey,
  hasChords,
  isChordToken,
  mergeChordsAboveLyrics,
  normalizeKey,
  parseChordLine,
  stripChords,
  transposeChord,
  transposeChordPro,
  transposeKey,
  xmlChordsToInline,
} from './chords';

test('recognizes chord tokens with extensions and slash basses', () => {
  for (const chord of ['C', 'Am', 'F#m7', 'Bb', 'Cmaj7', 'Dsus4', 'Gadd9', 'C/E', 'Bdim', 'Eaug', 'A7(b9)', 'F#m7b5']) {
    assert.ok(isChordToken(chord), chord);
  }
  for (const word of ['Grace', 'And', 'Dim', 'Bad', 'H', '3', 'Cm7x']) {
    assert.ok(!isChordToken(word), word);
  }
});

test('transposes roots and basses, keeping extensions', () => {
  assert.equal(transposeChord('G', 3), 'A#');
  assert.equal(transposeChord('G', 3, true), 'Bb');
  assert.equal(transposeChord('C/E', 2), 'D/F#');
  assert.equal(transposeChord('F#m7', -2), 'Em7');
  assert.equal(transposeChord('Dsus4', 12), 'Dsus4');
  assert.equal(transposeChord('Bb', 1), 'B');
});

test('keys are normalized and transposed with conventional spelling', () => {
  assert.equal(normalizeKey('bb major'), 'Bb');
  assert.equal(normalizeKey('F# minor'), 'F#m');
  assert.equal(normalizeKey('Em'), 'Em');
  assert.equal(transposeKey('G', 3), 'Bb');
  assert.equal(transposeKey('D', 2), 'E');
  assert.equal(transposeKey('Am', 1), 'Bbm');
  assert.equal(transposeKey('E', 2), 'F#');
});

test('merges chords written above the lyrics into inline brackets', () => {
  const sheet = ['G       C        G', 'Amazing grace how sweet', '', 'D   G', 'That saved'].join('\n');
  assert.equal(
    mergeChordsAboveLyrics(sheet),
    ['[G]Amazing [C]grace how [G]sweet', '', '[D]That [G]saved'].join('\n')
  );
});

test('chord-only lines stay chord-only and single chords get a bar so they never look like a label', () => {
  const sheet = ['G  C  D', '', 'G', '', 'Words here'].join('\n');
  assert.equal(mergeChordsAboveLyrics(sheet), ['[G] [C] [D]', '', '[G] |', '', 'Words here'].join('\n'));
  assert.equal(stripChords(mergeChordsAboveLyrics(sheet)), ['', '', 'Words here'].join('\n'));
});

test('lone "A" lines are words unless the song clearly has chord lines', () => {
  assert.equal(mergeChordsAboveLyrics('A\nmighty fortress'), 'A\nmighty fortress');
  assert.equal(mergeChordsAboveLyrics('A\nmighty\n\nG  D\nis our God'), '[A]mighty\n\n[G]is [D]our God');
});

test('section labels are never treated as chords', () => {
  const song = '[C]\n[G]Holy [D]holy\n[Verse 1]';
  assert.ok(hasChords(song));
  assert.ok(!hasChords('[C]\nHoly holy'));
  assert.equal(stripChords(song), '[C]\nHoly holy\n[Verse 1]');
  assert.equal(transposeChordPro(song, 2, { key: 'G' }), '[C]\n[A]Holy [E]holy\n[Verse 1]');
});

test('parses a line into chord-over-text segments', () => {
  assert.deepEqual(parseChordLine('[G]Amazing [C]grace'), [
    { chord: 'G', text: 'Amazing ' },
    { chord: 'C', text: 'grace' },
  ]);
  assert.deepEqual(parseChordLine('How [D7]sweet'), [
    { chord: null, text: 'How ' },
    { chord: 'D7', text: 'sweet' },
  ]);
});

test('transposeChordPro picks flats for flat keys', () => {
  assert.equal(transposeChordPro('[G]a [D/F#]b', 3, { key: 'G' }), '[Bb]a [F/A]b');
  assert.equal(transposeChordPro('[G]a', 0), '[G]a');
});

test('detects key, converts back to chords-above, builds .cho and reads worship-leader xml chords', () => {
  assert.equal(detectKey('[G]a [C]b [D]c [G]d'), 'G');
  assert.equal(chordProToChordsAbove('[G]Amazing [C]grace'), 'G       C\nAmazing grace');
  assert.equal(xmlChordsToInline('<chord>G</chord>Amazing <chord> C </chord>grace'), '[G]Amazing [C]grace');
  const doc = buildChordProDocument({ title: 'Song', chordPro: '[Verse]\n[G]Hi', key: 'G' }, 2);
  assert.equal(doc, '{title: Song}\n{key: A}\n\n{comment: Verse}\n[A]Hi\n');
});
