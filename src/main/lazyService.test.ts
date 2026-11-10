import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LazyService } from './lazyService';
test('first use and warmup share initialization; rejection can be retried', async () => {
  let calls = 0;
  const loader = new LazyService(async () => { if (++calls === 1) throw Error('temporary'); return { ready: true }; }, () => {});
  const first = loader.get(); assert.equal(first, loader.get()); await assert.rejects(first, /temporary/);
  assert.equal(loader.peek(), undefined);
  const result = await loader.get(); assert.equal(result, loader.peek()); assert.equal(calls, 2);
});
test('dispose during initialization rejects late result and disposes it once', async () => {
  let release!: (value: object) => void, disposed = 0;
  const loader = new LazyService(() => new Promise<object>(resolve => { release = resolve; }), () => disposed++);
  const pending = loader.get(); await Promise.resolve(); loader.dispose(); release({});
  await assert.rejects(pending, /cancelled/); assert.equal(disposed, 1); assert.equal(loader.peek(), undefined);
});
test('cleanup without first use does not initialize or erase stored state', () => {
  let loaded = 0;
  const loader = new LazyService(async () => ++loaded, () => {}); loader.dispose(); assert.equal(loaded, 0);
});
