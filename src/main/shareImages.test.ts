import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { clearShareImages, registerShareImage, serveShareImage } from './shareImages';
import { phoneImageLanguages } from '../renderer/slideImages';

function fakeResponse() {
  const res = { status: 0, headers: {} as Record<string, unknown>, body: Buffer.alloc(0) as Buffer, destroyed: false, done: null as null | (() => void) };
  const finished = new Promise<void>((resolve) => { res.done = resolve; });
  const api = {
    get destroyed() { return res.destroyed; },
    writeHead(status: number, headers: Record<string, unknown>) { res.status = status; res.headers = headers; return api; },
    end(body?: Buffer) { if (body) res.body = body; res.done?.(); },
  };
  return { res, api: api as unknown as ServerResponse, finished };
}
const request = (url: string) => ({ url } as IncomingMessage);

test('phones load registered slide pictures only with the live broadcast token', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'share-img-'));
  const file = path.join(dir, 'slide.png');
  await fs.writeFile(file, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const token = 'live-token';
  const handleShareImageHttp = (req: IncomingMessage, res: ServerResponse) => serveShareImage(req, res, token);
  try {
    const route = registerShareImage(file);
    assert.match(route, /^\/share\/img\/[0-9a-f]{24}$/);

    const ok = fakeResponse();
    assert.equal(handleShareImageHttp(request(`${route}?token=${token}`), ok.api), true);
    await ok.finished;
    assert.equal(ok.res.status, 200);
    assert.equal(ok.res.headers['Content-Type'], 'image/png');
    assert.equal(ok.res.body.length, 4);

    for (const url of [`${route}?token=wrong`, `${route}`, `/share/img/ffffffffffffffffffffffff?token=${token}`]) {
      const denied = fakeResponse();
      assert.equal(handleShareImageHttp(request(url), denied.api), true);
      await denied.finished;
      assert.equal(denied.res.status, 404, url);
    }
    assert.equal(handleShareImageHttp(request('/share?token=x'), fakeResponse().api), false);
  } finally {
    clearShareImages();
  }
  // After the broadcast ends the old route is gone even with the old token.
  const after = fakeResponse();
  serveShareImage(request(`${registerShareImage(file).replace(/[0-9a-f]+$/, 'ffffffffffffffffffffffff')}?token=${token}`), after.api, null);
  await after.finished;
  assert.equal(after.res.status, 404);
});

test('phone image languages follow the STT targets that image translation supports', () => {
  assert.deepEqual(phoneImageLanguages(['en', 'de', 'xx', 'en'], 'tr'), ['en', 'de']);
  assert.deepEqual(phoneImageLanguages([], 'ko'), ['ko']);
  assert.deepEqual(phoneImageLanguages([], 'zz'), []);
});
