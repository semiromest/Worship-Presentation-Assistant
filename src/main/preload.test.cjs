/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS VM harness tests the sandboxed preload bundle. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildSync } = require('esbuild');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const code = buildSync({
  entryPoints: [path.join(__dirname, 'preload.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  write: false,
  external: ['electron'],
}).outputFiles[0].text;
function fixture(enabled) {
  let api;
  const calls = [],
    ipc = new EventEmitter();
  ipc.invoke = async (channel, ...args) => {
    calls.push({ channel, args });
    return channel === 'perf:snapshot' ? { enabled: false } : true;
  };
  ipc.send = (channel, ...args) => {
    calls.push({ channel, args });
  };
  vm.runInNewContext(code, {
    require: () => ({
      contextBridge: {
        exposeInMainWorld: (_name, value) => {
          api = value;
        },
      },
      ipcRenderer: ipc,
      webUtils: { getPathForFile: file => file.diskPath ?? '' },
    }),
    process: { env: { WPA_PERF: enabled ? '1' : '0' } },
    performance,
    Buffer,
    console,
    exports: {},
  });
  return { api, ipc, calls };
}

test('dropped image bridge accepts disk image paths and rejects other files or synthetic files', async () => {
  for (const enabled of [false, true]) {
    const { api } = fixture(enabled);
    assert.equal(await api.getDroppedImagePath({ diskPath: 'C:\\Photos\\a.PNG' }), 'C:\\Photos\\a.PNG');
    assert.equal(await api.getDroppedImagePath({ diskPath: 'C:\\clip.mp4' }), null);
    assert.equal(await api.getDroppedImagePath({}), null);
  }
});

test('performance bridge distinguishes main and preload buffers and resets each source', async () => {
  for (const enabled of [false, true]) {
    const { api, calls } = fixture(enabled);
    await api.getDisplays();
    assert.equal((await api.getMainPerfSnapshot()).enabled, false);
    assert.equal(api.getPreloadPerfSnapshot().sampleCount > 0, enabled);
    assert.equal(api.getPerfSnapshot().sampleCount, api.getPreloadPerfSnapshot().sampleCount);
    await api.resetMainPerf();
    api.resetPerf();
    assert.equal(api.getPreloadPerfSnapshot().sampleCount, 0);
    assert.deepEqual(
      calls.map((call) => call.channel),
      ['get-displays', 'perf:snapshot', 'perf:reset']
    );
  }
});

test('subscriptions relay payloads without exposing Electron events and unsubscribe exactly once', () => {
  const { api, ipc } = fixture(true);
  const received = [];
  const unsubscribe = api.onProjectorUpdate((value) => received.push(value));
  assert.equal(api.getPreloadPerfSnapshot().listeners.total, 1);
  ipc.emit('projector-update', { sender: 'private' }, { liveIndex: 2 });
  assert.deepEqual(received, [{ liveIndex: 2 }]);
  unsubscribe();
  unsubscribe();
  assert.equal(ipc.listenerCount('projector-update'), 0);
  assert.equal(api.getPreloadPerfSnapshot().listeners.total, 0);
  ipc.emit('projector-update', {}, { liveIndex: 3 });
  assert.equal(received.length, 1);
});

test('invoke arguments and one-way audio/frame channels retain their transport semantics', async () => {
  const { api, calls } = fixture(true);
  await api.updateSlidePreviewsDelta([{ i: 0, url: 'preview' }]);
  assert.equal(api.sttSendAudio(new Uint8Array([1])), undefined);
  assert.equal(api.sharePublish({ text: 'caption' }), undefined);
  assert.equal(api.screenShareFrame('frame'), undefined);
  assert.deepEqual(
    calls.map((call) => call.channel),
    ['update-slide-previews-delta', 'stt:audio', 'share:publish', 'screen-share:frame']
  );
  assert.deepEqual(calls[0].args, [[{ i: 0, url: 'preview' }]]);
});

test('every preload request has a compatible main-process channel registration', () => {
  const ts = require('typescript');
  const files = fs.readdirSync(__dirname).filter(name => name.endsWith('.ts') && !name.endsWith('.test.ts'));
  const handlers = new Set(), requests = [];
  function inspect(file, requestSide) {
    const source = ts.createSourceFile(file, fs.readFileSync(path.join(__dirname, file), 'utf8'), ts.ScriptTarget.Latest, true);
    function visit(node) {
      // Desktop IPC uses a local registration wrapper. Verify the wrapper really
      // delegates to ipcMain.handle before accepting its literal call sites.
      if (file === 'desktopService.ts' && ts.isCallExpression(node) &&
          ts.isIdentifier(node.expression) && node.expression.text === 'handle' &&
          node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
        assert.match(source.text, /ipcMain\.handle\(channel,\s*listener\)/);
        handlers.add('handle:' + node.arguments[0].text);
      }
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const receiver = node.expression.expression.getText(source), method = node.expression.name.text, arg = node.arguments[0];
        if (arg && ts.isStringLiteral(arg)) {
          if (receiver === 'ipcMain' && ['handle', 'on'].includes(method)) handlers.add(method + ':' + arg.text);
          if (requestSide && receiver === 'ipcRenderer' && ['invoke', 'send'].includes(method)) requests.push({ method, channel: arg.text });
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  for (const file of files) inspect(file, file === 'preload.ts');
  // This family is registered from an explicit literal loop in main.ts.
  const main = fs.readFileSync(path.join(__dirname, 'main.ts'), 'utf8');
  const family = main.match(/for \(const action of \[([^\]]+)\] as const\) \{\s*ipcMain.handle\('practice:workspace:' \+ action/);
  assert.ok(family, 'Practice action family must remain statically enumerable');
  for (const action of family[1].matchAll(/'([^']+)'/g)) handlers.add('handle:practice:workspace:' + action[1]);
  assert.ok(requests.length >= 98);
  for (const request of requests) assert.ok(handlers.has((request.method === 'invoke' ? 'handle:' : 'on:') + request.channel), 'Unregistered channel: ' + request.channel);
});

test('gradient library exposes typed list, save and delete invocations', async () => {
  const { api, calls } = fixture(false);
  const input = { name: 'Ocean', token: 'draft-token', recipe: { seed: 12 } };
  await api.listGradientLibrary(); await api.saveGradientLibrary(input); await api.deleteGradientLibrary('entry-id');
  assert.deepEqual(calls.map(c => c.channel), ['gradient-library:list', 'gradient-library:save', 'gradient-library:remove']);
  assert.deepEqual(calls[1].args, [input]); assert.deepEqual(calls[2].args, ['entry-id']);
});
