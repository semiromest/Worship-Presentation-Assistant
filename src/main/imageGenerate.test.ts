import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateImage, imageExt, myMemoryTranslate } from './imageGenerate';
import { buildPollinationsUrl, composePrompt } from '../shared/imageGenerate';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

function fakeFetch(status: number, body: Buffer, type = 'image/jpeg', seen?: string[]): typeof fetch {
  return (async (url: string) => {
    seen?.push(String(url));
    return new Response(new Uint8Array(body), { status, headers: { 'content-type': type } });
  }) as unknown as typeof fetch;
}

test('composePrompt appends style keywords and normalises whitespace', () => {
  assert.equal(composePrompt('  a  lake\n', 'none'), 'a lake');
  assert.match(composePrompt('a lake', 'photo'), /^a lake, photorealistic/);
});

test('buildPollinationsUrl encodes prompt, size and seed', () => {
  const url = new URL(buildPollinationsUrl('güneş / dağ', '9:16', 42));
  assert.equal(url.host, 'image.pollinations.ai');
  assert.equal(decodeURIComponent(url.pathname), '/prompt/güneş   dağ');
  assert.equal(url.searchParams.get('width'), '1080');
  assert.equal(url.searchParams.get('height'), '1920');
  assert.equal(url.searchParams.get('seed'), '42');
  assert.equal(url.searchParams.get('nologo'), 'true');
});

test('imageExt uses content type, then magic bytes', () => {
  assert.equal(imageExt('image/png', JPEG), '.png');
  assert.equal(imageExt(null, JPEG), '.jpg');
  assert.equal(imageExt('application/json', Buffer.from('{}')), null);
});

test('generateImage translates, fetches and stores the picture', async () => {
  const seen: string[] = [];
  const stored: [Buffer, string][] = [];
  const result = await generateImage(
    {
      fetch: fakeFetch(200, JPEG, 'image/jpeg', seen),
      translate: async () => ['sunrise over a lake'],
      storeBytes: async (data, ext) => { stored.push([data, ext]); return 'local-resource://media/abc.jpg'; },
    },
    { prompt: 'göl üzerinde gün doğumu', style: 'none', ratio: '16:9', seed: 7 },
  );
  assert.deepEqual(result, { ok: true, path: 'local-resource://media/abc.jpg', seed: 7, prompt: 'sunrise over a lake' });
  assert.match(decodeURIComponent(seen[0]), /sunrise over a lake/);
  assert.equal(stored[0][1], '.jpg');
});

test('ASCII-only Turkish prompts are translated too (the old bug: "bir kedi" went out untranslated)', async () => {
  const seen: string[] = [];
  await generateImage(
    { fetch: fakeFetch(200, JPEG, 'image/jpeg', seen), translate: async () => ['a cat sitting on the sofa'], storeBytes: async () => 'x' },
    { prompt: 'bir kedi kanepede oturuyor', style: 'none', ratio: '16:9', seed: 1 },
  );
  assert.match(decodeURIComponent(seen[0]), /a cat sitting on the sofa/);
});

test('falls back to the second translator, and refuses to generate when none answers', async () => {
  const seen: string[] = [];
  const fail = async () => { throw new Error('429'); };
  const viaFallback = await generateImage(
    { fetch: fakeFetch(200, JPEG, 'image/jpeg', seen), translate: fail, fallbackTranslate: async () => ['sunrise'], storeBytes: async () => 'x' },
    { prompt: 'gün doğumu', style: 'none', ratio: '16:9', seed: 1 },
  );
  assert.equal(viaFallback.ok, true);
  assert.match(decodeURIComponent(seen[0]), /sunrise/);
  const none = await generateImage(
    { fetch: fakeFetch(200, JPEG, 'image/jpeg', seen), translate: fail, fallbackTranslate: fail, storeBytes: async () => 'x' },
    { prompt: 'deniz kenarı', style: 'none', ratio: '16:9', seed: 1 },
  );
  assert.deepEqual(none, { ok: false, reason: 'translate-failed' });
  assert.equal(seen.length, 1, 'no image request without a translated prompt');
});

test('myMemoryTranslate reads translations and treats "distinct languages" as already English', async () => {
  const json = (body: unknown) => (async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;
  assert.deepEqual(await myMemoryTranslate(json({ responseStatus: 200, responseData: { translatedText: 'A cat.' } }))(['bir kedi'], 'auto', 'en'), ['A cat.']);
  assert.deepEqual(await myMemoryTranslate(json({ responseStatus: '403', responseDetails: 'PLEASE SELECT TWO DISTINCT LANGUAGES' }))(['a cat'], 'auto', 'en'), ['a cat']);
  await assert.rejects(myMemoryTranslate(json({ responseStatus: 429, responseDetails: 'quota' }))(['x'], 'auto', 'en'));
});

test('generateImage reports empty prompts, rate limits and non-images', async () => {
  const deps = { storeBytes: async () => 'x', translate: async (t: string[]) => t };
  assert.deepEqual(await generateImage({ ...deps, fetch: fakeFetch(200, JPEG) }, { prompt: '  ', style: 'none', ratio: '16:9', seed: 1 }), { ok: false, reason: 'empty-prompt' });
  const limited = await generateImage({ ...deps, fetch: fakeFetch(429, Buffer.from('{}'), 'application/json') }, { prompt: 'a', style: 'none', ratio: '16:9', seed: 1 });
  assert.equal(limited.ok === false && limited.reason, 'rate-limited');
  const notImage = await generateImage({ ...deps, fetch: fakeFetch(200, Buffer.from('{"error":1}'), 'application/json') }, { prompt: 'a', style: 'none', ratio: '16:9', seed: 1 });
  assert.equal(notImage.ok === false && notImage.reason, 'failed');
  const offline = await generateImage({ ...deps, fetch: (async () => { throw new Error('ENOTFOUND'); }) as unknown as typeof fetch }, { prompt: 'a', style: 'none', ratio: '16:9', seed: 1 });
  assert.equal(offline.ok === false && offline.reason, 'network');
});
