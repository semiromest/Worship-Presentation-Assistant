import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolvePosterSource } from './mediaPosterSource';

test('poster sources resolve plain, file, streaming and embedded references', () => {
  const file = path.resolve('fixture', 'Hürriyet video.mp4');
  const dir = path.resolve('fixture', 'media');
  assert.equal(resolvePosterSource(file, dir), file);
  assert.equal(resolvePosterSource(pathToFileURL(file).href, dir), file);
  assert.equal(resolvePosterSource('local-resource://mediafile/' + encodeURIComponent(file), dir), file);
  assert.equal(resolvePosterSource('local-resource://media/abc123.mp4', dir), path.join(dir, 'abc123.mp4'));
  assert.equal(resolvePosterSource(pathToFileURL(file).href.replace('file://', 'local-resource://'), dir), file);
});

test('remote, relative and malformed references cannot reach filesystem extraction', () => {
  const dir = path.resolve('fixture');
  for (const source of ['https://example.com/a.mp4', 'data:video/mp4;base64,abc', 'video.mp4', 'local-resource://mediafile/%ZZ', 'local-resource://media/../secret.mp4']) {
    assert.equal(resolvePosterSource(source, dir), null, source);
  }
});
