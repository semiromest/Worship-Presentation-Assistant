import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lookupMusicQuery, parseMusicQuery } from './youtubeMusicLookup';
const id = 'KI33ItOO_M4';
test('YouTube watch, short, Music, Shorts, live and embed links resolve exact IDs', () => {
  for (const link of [
    `https://www.youtube.com/watch?v=${id}`, `https://youtube.com/watch?v=${id}&list=PL123&t=40`,
    `https://youtu.be/${id}?si=share`, `https://music.youtube.com/watch?v=${id}`,
    `https://m.youtube.com/watch?v=${id}`, `youtube.com/watch?v=${id}`, `youtu.be/${id}`,
    `https://www.youtube.com/shorts/${id}`, `https://youtube.com/live/${id}`, `https://youtube.com/embed/${id}`,
    `  https://www.youtube.com/watch?v=${id}  `,
  ]) assert.deepEqual(parseMusicQuery(link), { kind: 'video', id }, link);
});
test('invalid links, arbitrary hosts, playlists and invalid IDs never trigger provider calls', async () => {
  for (const link of [
    'https://example.com/song', `https://youtube.com.evil.test/watch?v=${id}`,
    `https://youtube.com@evil.test/watch?v=${id}`, `https://evil@youtube.com/watch?v=${id}`,
    `ftp://youtube.com/watch?v=${id}`, `https://youtube.com:1234/watch?v=${id}`,
    'https://youtube.com/playlist?list=PL123', 'https://youtu.be/invalid',
    `https://youtu.be/${id}/extra`, `https://youtube.com/watch?v=${id}`+'x'.repeat(2048),
  ]) {
    let calls = 0;
    const result = await lookupMusicQuery(link, undefined, async () => { calls++;return { ok: true, results: [] }; }, async () => { calls++;throw Error('unexpected'); });
    assert.deepEqual(result, { ok: false, error: 'invalid-link' }, link);assert.equal(calls, 0);
  }
});
test('links bypass text search and return one exact video, without pagination or playback', async () => {
  let lookups = 0;
  const lookup = async (actual: string) => { assert.equal(actual, id);lookups++;return { id, title: 'Exact song', duration: 125 }; };
  const search = async () => { throw Error('URL must not become a text query'); };
  assert.deepEqual(await lookupMusicQuery(`https://youtu.be/${id}`, undefined, search, lookup), { ok: true, results: [{ id, title: 'Exact song', duration: 125 }] });
  assert.deepEqual(await lookupMusicQuery(`https://youtu.be/${id}`, 'old-cursor', search, lookup), { ok: false, error: 'search-expired' });
  assert.equal(lookups, 1);
  assert.deepEqual(await lookupMusicQuery(`https://youtu.be/${id}`, undefined, search, async () => { throw Error('private'); }), { ok: false, error: 'video-unavailable' });
});
test('ordinary text and continuation cursors retain the existing pager path', async () => {
  assert.deepEqual(parseMusicQuery('Amazing Grace piano'), { kind: 'text', query: 'Amazing Grace piano' });
  const result = await lookupMusicQuery(' Amazing Grace ', 'cursor', async (text, cursor) => {
    assert.equal(text, 'Amazing Grace');assert.equal(cursor, 'cursor');return { ok: true, results: [], nextCursor: 'next' };
  }, async () => { throw Error('text must not be a direct lookup'); });
  assert.deepEqual(result, { ok: true, results: [], nextCursor: 'next' });
});
