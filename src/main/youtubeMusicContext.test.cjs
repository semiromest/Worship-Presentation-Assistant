const { test } = require('node:test');
const assert = require('node:assert/strict');
const { transformSync } = require('esbuild');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
test('simultaneous play and download claim separate single-use SABR preparations', async () => {
  const source = fs.readFileSync(path.join(__dirname, 'youtubeMusicService.ts'), 'utf8');
  const code = transformSync(source, { loader: 'ts', format: 'cjs', target: 'node22' }).code;
  const module = { exports: {} };
  class Sabr {
    on() {}
    async start() { return { audioStream: new ReadableStream({ start(c) { c.close(); } }), selectedFormats: { audioFormat: { mimeType: 'audio/webm' } } }; }
    abort() {}
  }
  const stubs = {
    electron: { app: { getPath: () => '.' } },
    'youtubei.js': { Platform: { shim: {} }, Constants: { CLIENT_NAME_IDS: { WEB: '1' }, CLIENTS: { WEB: { VERSION: 'test' } } } },
    'googlevideo/sabr-stream': { SabrStream: Sabr },
    'googlevideo/utils': { buildSabrFormat: v => v, EnabledTrackTypes: { AUDIO_ONLY: 'audio' } },
    'bgutils-js/utils': {},
    '../shared/youtubeMusic': {},
    './youtubeSearchPager': { YouTubeSearchPager: class {} },
    './musicStreamFetch': {},
    './offlineMusicCache': { OfflineMusicCache: class {} },
    './youtubeMusicLookup': {},
  };
  vm.runInNewContext(code, { module, exports: module.exports, require: name => name in stubs ? stubs[name] : require(name), ReadableStream, fetch, setTimeout, console });
  const service = new module.exports.YouTubeMusicService();
  let contexts = 0;
  service.getYouTube = async () => ({
    getBasicInfo: async () => { contexts++;return { playability_status: { status: 'OK' }, streaming_data: { adaptive_formats: [] } }; },
    session: { player: { decipher: async () => 'https://fixture.invalid' } },
  });
  service.mintToken = async () => 'fixture-token';service.ensureServer = async () => 1234;
  await Promise.all([service.createAudio('KI33ItOO_M4', () => false), service.createAudio('KI33ItOO_M4', () => false)]);
  assert.equal(contexts, 2);
});
