/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS Node/Playwright entrypoint. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { captures, check } = require('./check-tour-capture.cjs');
test('AST recognises literal, object, alias and dynamic capture options', () => {
  for (const source of [
    "window.addEventListener('keydown', fn, true)",
    "window.addEventListener('keyup', fn, {capture:true})",
    "window['addEventListener']('keydown', fn, {['capture']:true})",
    "const w=window; const options={capture:true}; w.addEventListener('keydown', fn, options)",
  ]) assert.equal(captures(source).length, 1);
  assert.equal(captures("window.addEventListener('keydown', fn, options)")[0].dynamic, true);
  assert.equal(captures("window.addEventListener(eventName, fn, true)")[0].dynamic, true);
  assert.equal(captures("window.addEventListener('keydown', fn, {capture:false})").length, 0);
  assert.equal(captures("element.addEventListener('keydown', fn, true)").length, 0);
});
test('renderer introduces no unreviewed window keyboard capture listeners', () => {
  assert.deepEqual(check(), []);
});
