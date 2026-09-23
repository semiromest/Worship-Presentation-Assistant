import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { cacheGoogleFont, checkMediaResources } from './preparationResources';
test('checks missing, existing, managed and mediafile paths', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(),'presenter-readiness-'));
  try {
    const file = path.join(dir,'test image.png'); await fs.writeFile(file,'test');
    await fs.writeFile(path.join(dir,'managed.png'),'test');
    const url = pathToFileURL(file).href;
    const media = 'local-resource://media/managed.png';
    const stream = 'local-resource://mediafile/'+encodeURIComponent(file);
    const missing = path.join(dir,'missing.png');
    const result = await checkMediaResources([url,media,stream,missing,dir,'https://example.org/image.png'],dir);
    assert.equal(result[url],true); assert.equal(result[media],true); assert.equal(result[stream],true);
    assert.equal(result[missing],false); assert.equal(result[dir],false);
    assert.equal(result['https://example.org/image.png'],undefined);
  } finally { await fs.rm(dir,{recursive:true,force:true}); }
});
test('font cache embeds binaries and works on a subsequent offline load; failed downloads retry', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(),'presenter-fonts-'));
  const previous = globalThis.fetch; let calls = 0;
  try {
    globalThis.fetch = (async (url: string) => { calls++; return new Response(url.includes('googleapis') ? '@font-face{font-family:Test;src:url(https://fonts.gstatic.com/test.woff2)}' : 'fontbytes', { headers:{'content-type':'font/woff2'} }); }) as typeof fetch;
    const css = await cacheGoogleFont('Test',dir);
    assert.ok(css.includes('data:font/woff2;base64,')); assert.equal(calls,2);
    globalThis.fetch = async () => { throw new Error('Offline'); };
    assert.equal(await cacheGoogleFont('Test',dir),css);
    await assert.rejects(cacheGoogleFont('Missing',dir));
    globalThis.fetch = previous;
  } finally { globalThis.fetch = previous; await fs.rm(dir,{recursive:true,force:true}); }
});
