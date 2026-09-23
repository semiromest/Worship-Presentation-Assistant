import assert from 'node:assert/strict';
import test from 'node:test';
import { GetBibleApi, GetBibleApiError } from './getBibleApi';
import type { GetBibleTranslation } from './getBibleModel';

const translation: GetBibleTranslation = {
  translation: 'Fixture Bible',
  abbreviation: 'fixture',
  description: 'Fixture',
  lang: 'en',
  language: 'English',
  direction: 'LTR',
  distribution_license: 'Public Domain',
  url: 'https://example.test/fixture.json',
  sha: 'fixture-sha',
};

const payload = JSON.stringify({
  translation: 'Fixture Bible',
  abbreviation: 'fixture',
  books: [
    {
      nr: 1,
      name: 'Genesis',
      chapters: [{ chapter: 1, verses: [{ chapter: 1, verse: 1, text: 'In the beginning' }] }],
    },
  ],
});

test('downloads once per SHA, reports progress and reuses the memory cache', async () => {
  const originalFetch = globalThis.fetch;
  let fetches = 0;
  globalThis.fetch = async () => {
    fetches += 1;
    return new Response(payload, { headers: { 'Content-Length': String(new TextEncoder().encode(payload).length) } });
  };
  try {
    const api = new GetBibleApi();
    const progress: Array<{ done: number; total: number }> = [];
    const first = await api.downloadBible(translation, (value) => progress.push(value));
    const second = await api.downloadBible(translation);

    assert.equal(fetches, 1);
    assert.equal(first, second);
    assert.equal(first.books[0].chapters[0].verses[0].text, 'In the beginning');
    assert.equal(progress.at(-1)?.done, progress.at(-1)?.total);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('exposes retry information for rate limits and temporary outages', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response('', { status: 429, headers: { 'Retry-After': '30' } });
    await assert.rejects(
      () => new GetBibleApi().downloadBible(translation),
      (error: unknown) => error instanceof GetBibleApiError && error.status === 429 && error.retryAfter === '30'
    );

    globalThis.fetch = async () => new Response('', { status: 503 });
    await assert.rejects(
      () => new GetBibleApi().downloadBible({ ...translation, sha: 'other' }),
      (error: unknown) => error instanceof GetBibleApiError && error.status === 503
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('rejects malformed downloaded JSON without caching it', async () => {
  const originalFetch = globalThis.fetch;
  let fetches = 0;
  globalThis.fetch = async () => {
    fetches += 1;
    return new Response('{broken');
  };
  try {
    const api = new GetBibleApi();
    await assert.rejects(() => api.downloadBible(translation));
    await assert.rejects(() => api.downloadBible(translation));
    assert.equal(fetches, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
