import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PreviewAssets } from './previewAssets';
import type { PreviewAssetRequest } from '../shared/remotePreview';

const dataUrl = (value: string) => 'data:image/webp;base64,' + Buffer.from(value).toString('base64');
test('encoded assets obey byte/entry limits after every write; eviction does not dirty metadata', async () => {
  const requests: PreviewAssetRequest[] = [];
  const cache = new PreviewAssets(request => requests.push(request), 6, 2);
  const deck = { token: 'deck', slots: [{ id: 'a', version: 1 }, { id: 'b', version: 2 }] };
  const urls = cache.configure(deck);
  cache.publish({ token: 'deck', id: 'a', version: 1, dataUrl: dataUrl('aaaa') });
  cache.publish({ token: 'deck', id: 'b', version: 2, dataUrl: dataUrl('bbbb') });
  assert.deepEqual(cache.snapshot(), { entries: 1, bytes: 4, slots: 2, waiting: 0 });
  assert.deepEqual(cache.configure(deck), urls);
  assert.equal(requests.length, 0);
  const waiting = cache.read(urls[0]);
  assert.deepEqual(requests, [{ token: 'deck', id: 'a', version: 1 }]);
  cache.publish({ ...requests[0], dataUrl: dataUrl('aaaa') });
  assert.equal((await waiting)?.bytes.toString(), 'aaaa');
  assert.equal(cache.snapshot().bytes, 4);
});

test('same source survives reorder, stale source/document responses cannot publish, and waiters cancel', async () => {
  const requests: PreviewAssetRequest[] = [];
  const cache = new PreviewAssets(request => requests.push(request));
  const a = { id: 'a', version: 1 }, b = { id: 'b', version: 2 };
  const urls = cache.configure({ token: 'one', slots: [a, b] });
  assert.deepEqual(cache.configure({ token: 'one', slots: [b, a] }), [urls[1], urls[0]]);
  const pending = cache.read(urls[0]);
  cache.configure({ token: 'one', slots: [{ ...a, version: 3 }] });
  assert.equal(await pending, undefined);
  assert.equal(cache.publish({ token: 'one', ...a, dataUrl: dataUrl('old') }), false);
  const latest = cache.configure({ token: 'two', slots: [a] });
  assert.equal(cache.publish({ token: 'one', ...a, dataUrl: dataUrl('old deck') }), false);
  const abort = new AbortController();
  const aborted = cache.read(latest[0], abort.signal); abort.abort();
  assert.equal(await aborted, undefined);
  assert.equal(cache.snapshot().waiting, 0);
  cache.clear();
  assert.equal(cache.snapshot().slots, 0);
});

test('invalid reconfiguration leaves active slots and cached assets unchanged', async () => {
  const cache = new PreviewAssets(() => {});
  const deck = { token: 'deck', slots: [{ id: 'a', version: 1 }] };
  const [address] = cache.configure(deck);
  assert.equal(cache.publish({ token: 'deck', id: 'a', version: 1, dataUrl: dataUrl('saved') }), true);
  const before = cache.snapshot();
  assert.throws(() => cache.configure({ token: 'other', slots: [{ id: 'duplicate', version: 1 }, { id: 'duplicate', version: 2 }] }), /Invalid preview deck/);
  assert.deepEqual(cache.snapshot(), before);
  assert.equal((await cache.read(address))?.bytes.toString(), 'saved');
});

test('inline data URLs require canonical base64 and invalid results do not replace cached data', () => {
  const cache = new PreviewAssets(() => {});
  cache.configure({ token: 'deck', slots: [{ id: 'a', version: 1 }] });
  assert.equal(cache.publish({ token: 'deck', id: 'a', version: 1, dataUrl: dataUrl('valid') }), true);
  for (const body of ['A', 'YQ=', 'YQ===', 'Y Q=']) {
    assert.equal(cache.publish({ token: 'deck', id: 'a', version: 1, dataUrl: `data:image/png;base64,${body}` }), false);
  }
  assert.equal(cache.snapshot().bytes, 5);
});

test('coalesces reads for one address and resolves all waiters with the published asset', async () => {
  const requests: PreviewAssetRequest[] = [];
  const cache = new PreviewAssets(request => requests.push(request));
  const [address] = cache.configure({ token: 'deck', slots: [{ id: 'a', version: 1 }] });
  const one = cache.read(address);
  const two = cache.read(address);
  assert.deepEqual(requests, [{ token: 'deck', id: 'a', version: 1 }]);
  cache.publish({ ...requests[0], dataUrl: dataUrl('image') });
  assert.equal((await one)?.bytes.toString(), 'image');
  assert.equal((await two)?.bytes.toString(), 'image');
  assert.equal(cache.snapshot().waiting, 0);
});

test('a failed request callback settles the waiter instead of leaving it pending', async () => {
  const cache = new PreviewAssets(() => { throw new Error('injected request failure'); });
  const [address] = cache.configure({ token: 'deck', slots: [{ id: 'a', version: 1 }] });
  assert.equal(await cache.read(address), undefined);
  assert.equal(cache.snapshot().waiting, 0);
});

test('1000 metadata slots do not allocate images or enqueue speculative work', () => {
  let requests = 0;
  const cache = new PreviewAssets(() => requests++);
  const urls = cache.configure({ token: 'large', slots: Array.from({ length: 1000 }, (_, i) => ({ id: String(i), version: i })) });
  assert.equal(urls.length, 1000);
  assert.equal(cache.snapshot().bytes, 0);
  assert.equal(requests, 0);
});
