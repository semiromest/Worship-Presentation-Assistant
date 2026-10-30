const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildSync } = require('esbuild');
const vm = require('node:vm');
const path = require('node:path');
test('native dialog gate counts overlapping dialogs and releases after rejection', async () => {
  let finish;
  const dialog = {
    showOpenDialog: () => new Promise(resolve => { finish = resolve; }),
    showSaveDialog: async () => { throw new Error('dialog failed'); },
    showMessageBox: async () => ({ response: 0 }),
    showOpenDialogSync: () => [], showSaveDialogSync: () => undefined, showMessageBoxSync: () => 0,
  };
  const code = buildSync({ entryPoints: [path.join(__dirname, 'nativeDialogGate.ts')], bundle: true, platform: 'node', format: 'cjs', external: ['electron'], write: false }).outputFiles[0].text;
  const context = { module: { exports: {} }, exports: {}, require: () => ({ dialog }), Promise };
  vm.runInNewContext(code, context);
  const { installNativeDialogGate, nativeDialogBusy } = context.module.exports;
  installNativeDialogGate();
  const pending = dialog.showOpenDialog(); assert.equal(nativeDialogBusy(), true);
  await assert.rejects(dialog.showSaveDialog(), /failed/); assert.equal(nativeDialogBusy(), true);
  finish({ canceled: false }); await pending; assert.equal(nativeDialogBusy(), false);
});
