import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildQuickSearch, runQuickEntry, type QuickSearchActions } from './quickSearchEngine';
import { isSetLink, parseSongXml, parseSongXmlChordPro, songDetailToHymn } from '../worshipLeaderApi';

const bible = {
  books: [
    {
      name: 'Yuhanna',
      number: '43',
      chapters: [{ number: '3', verses: [1, 2, 3, 4].map((n) => ({ number: String(n), text: `Ayet ${n}` })) }],
    },
  ],
};

const ctx = {
  bible: bible as never,
  source: null,
  hymns: [
    { id: 'h1', title: 'Amazing Grace', lyrics: 'Amazing grace', chordPro: '[G]Amazing [C]grace', key: 'G' },
    { id: 'h2', title: 'Holy Holy', lyrics: 'Holy holy' },
  ],
  media: [{ id: 'm1', type: 'image' as const, path: 'C:/x/grace.jpg', name: 'grace.jpg' }],
};

function fakeActions() {
  const calls: string[] = [];
  let selected = 0;
  const actions: QuickSearchActions = {
    addScripture: (content) => { calls.push(`scripture:${Array.isArray(content) ? content.length : 1}`); selected += 1; },
    addHymn: (hymn, partsMode) => { calls.push(`hymn:${hymn.title}:${partsMode}:${hymn.chordPro ? 'chords' : 'plain'}`); selected += 1; },
    addMedia: (type, path) => { calls.push(`media:${type}:${path}`); selected += 1; },
    selectedSlideId: () => `slide-${selected}`,
    addToLibrary: (hymns) => { calls.push(`library:${hymns.length}`); },
    hymnPreferences: () => ({ partsMode: true, showAuthor: false }),
  };
  return { actions, calls };
}

test('one query finds verses, songs (with chord flag) and media', () => {
  const verse = buildQuickSearch('yuhanna 3:2-3', ctx);
  assert.equal(verse[0].kind, 'scripture');
  assert.deepEqual(verse[0].kind === 'scripture' && verse[0].hit.verseNumbers, ['2', '3']);

  const grace = buildQuickSearch('grace', ctx);
  assert.deepEqual(grace.map((e) => e.kind), ['hymn', 'media']);
  assert.equal(grace[0].result.hasChords, true);
  assert.equal(grace[0].result.subtitle, 'G');
  // Result rows are plain data that can cross to the phone.
  assert.doesNotThrow(() => JSON.stringify(grace.map((e) => e.result)));
});

test('a pasted set link becomes a single set row; set_id links are flagged', () => {
  const link = 'https://worshipleaderapp.com/#page-set-list?new_set=Pazar&song_ids=12,7,9';
  assert.ok(isSetLink(link));
  assert.ok(!isSetLink('amazing grace'));
  const entries = buildQuickSearch(link, ctx);
  assert.equal(entries.length, 1);
  assert.deepEqual(entries[0].result, { id: 'set:link', kind: 'setLink', title: 'Pazar', songCount: 3, error: undefined });
  const local = buildQuickSearch('https://worshipleaderapp.com/#page-set?set_id=4', ctx);
  assert.equal(local[0].result.error, 'set-id-only');
});

test('running a result adds through the actions and reports the first new slide', async () => {
  const { actions, calls } = fakeActions();
  const [hymn] = buildQuickSearch('amazing', ctx);
  const outcome = await runQuickEntry(hymn, actions, { source: null });
  assert.deepEqual(calls, ['hymn:Amazing Grace:true:chords']);
  assert.equal(outcome.ok, true);
  assert.equal(outcome.firstSlideId, 'slide-1');

  const [verse] = buildQuickSearch('yuhanna 3::', ctx);
  const verseOutcome = await runQuickEntry(verse, actions, { source: null });
  assert.equal(verseOutcome.ok, true);
  assert.equal(calls[1], 'scripture:2');
});

test('set links import every song in order, keep chords and add them to the library', async () => {
  const songs: Record<number, unknown> = {
    12: { id: 12, title: 'First', songxml: '<verse><chord>G</chord>Line <chord>C</chord>one</verse>', songkey: 'G' },
    9: { id: 9, title: 'Second', songxml: '<verse>Plain line</verse>' },
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string) => {
    const id = Number(new URL(url).searchParams.get('id'));
    const data = songs[id];
    return { ok: !!data, status: data ? 200 : 404, json: async () => ({ success: true, data }) };
  }) as never;
  try {
    const { actions, calls } = fakeActions();
    const [entry] = buildQuickSearch('#page-set-list?song_ids=12,7,9', ctx);
    const progress: string[] = [];
    const outcome = await runQuickEntry(entry, actions, { source: null }, (f, t) => progress.push(`${f}/${t}`));
    assert.deepEqual(calls, ['hymn:First:true:chords', 'hymn:Second:true:plain', 'library:2']);
    assert.deepEqual(progress, ['1/3', '2/3', '3/3']);
    assert.equal(outcome.added, 2);
    assert.equal(outcome.failed, 1);
    assert.equal(outcome.firstSlideId, 'slide-1');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('worship-leader songxml keeps chords as ChordPro while plain lyrics stay chord-free', () => {
  const xml = '<verse><chord>G</chord>Amazing <chord>C</chord>grace<br/><chord>D</chord></verse>';
  assert.equal(parseSongXmlChordPro(xml), '[G]Amazing [C]grace\n[D] |');
  assert.equal(parseSongXml(xml), 'Amazing grace');
  const hymn = songDetailToHymn({ id: 5, title: 'T', songxml: xml, songkey: null });
  assert.equal(hymn.chordPro, '[G]Amazing [C]grace\n[D] |');
  assert.equal(hymn.key, 'D');
  assert.equal(songDetailToHymn({ id: 6, title: 'P', songxml: '<verse>x</verse>' }).chordPro, undefined);
});
