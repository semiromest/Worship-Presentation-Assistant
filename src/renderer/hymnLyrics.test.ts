import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepareHymn, prepareHymnText, splitChordProParts } from './hymnLyrics';
import { splitHymnLyrics } from './hymnSplit';
import { mergeImportedHymns } from './hymnImport';

test('chords above the words are kept as ChordPro; lyrics stay clean', () => {
  const prepared = prepareHymnText(['[V1]', 'G       C', 'Amazing grace', '', '[C]', 'D   G', 'How sweet'].join('\n'));
  assert.equal(prepared.chordPro, '[G]Amazing [C]grace\n\n[D]How [G]sweet');
  assert.equal(prepared.lyrics, 'Amazing grace\n\nHow sweet');
});

test('plain lyrics carry no chordPro and are cleaned as before', () => {
  assert.deepEqual(prepareHymnText('Line one...\n\n\nLine two'), { lyrics: 'Line one\n\nLine two' });
  assert.equal(prepareHymn({ id: '1', title: 't', lyrics: 'x', chordPro: 'no chords here' }).chordPro, undefined);
});

test('chord parts line up with lyric parts even with a lone [C] chord line', () => {
  const chordPro = '[G]Amazing [C]grace\n[C] |\n\n[D]How [G]sweet';
  const lyrics = 'Amazing grace\n\nHow sweet';
  const lyricParts = splitHymnLyrics(lyrics).parts;
  assert.deepEqual(splitChordProParts(chordPro, lyricParts), ['[G]Amazing [C]grace\n[C] |', '[D]How [G]sweet']);
  assert.equal(splitChordProParts(chordPro, ['only one part']), null);
});

test('a chord-free re-import keeps chords the user already added to the same text', () => {
  const merged = mergeImportedHymns(
    [{ id: '1', title: 'Song', lyrics: 'Amazing grace', chordPro: '[G]Amazing grace', key: 'G', bpm: 72 }],
    [{ id: '2', title: 'Song', lyrics: 'Amazing  grace' }],
  );
  assert.equal(merged[0].chordPro, '[G]Amazing grace');
  assert.equal(merged[0].bpm, 72);
  const changed = mergeImportedHymns(
    [{ id: '1', title: 'Song', lyrics: 'Amazing grace', chordPro: '[G]Amazing grace' }],
    [{ id: '2', title: 'Song', lyrics: 'Different words' }],
  );
  assert.equal(changed[0].chordPro, undefined);
});
