import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assertNoLinks, assertProfileTree, parseLaunchMode, practicePath } from './launchPolicy';
test('launch modes cannot override profiles or combine capabilities', () => {
  assert.equal(parseLaunchMode([]), 'normal');
  assert.equal(parseLaunchMode(['--wpa-practice']), 'practice');
  assert.equal(parseLaunchMode(['--wpa-smoke']), 'smoke');
  for (const args of [['--wpa-profile=C:/data'], ['--wpa-isolation-spike'], ['--wpa-practice', '--wpa-smoke'],
    ['--wpa-practice', '--wpa-practice'], ['--user-data-dir=C:/data'], ['--wpa-other']]) assert.throws(() => parseLaunchMode(args));
  assert.notEqual(practicePath(path.resolve('profile')), path.resolve('profile'));
});
test('linked profile paths and linked ancestors are rejected', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wpa-launch-test-'));
  try {
    fs.mkdirSync(path.join(root, 'real'));
    fs.symlinkSync(path.join(root, 'real'), path.join(root, 'linked'), 'junction');
    assert.throws(() => assertNoLinks(path.join(root, 'linked', 'sessions')));
    assertNoLinks(path.join(root, 'real', 'sessions'));
    fs.writeFileSync(path.join(root, 'real', 'lockfile'), 'lock');
    assertProfileTree(path.join(root, 'real'));
    fs.symlinkSync(path.join(root, 'missing'), path.join(root, 'dangling'), 'junction');
    assert.throws(() => assertNoLinks(path.join(root, 'dangling')));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
