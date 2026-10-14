import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { inspectTourProfile, isTourProfileSender } from './tourProfile';
test('profile inspection is read-only and recognises legacy and Chromium evidence', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wpa-tour-profile-'));
  try {
    assert.deepEqual(await inspectTourProfile(dir), { profileKind: 'new' });
    assert.deepEqual(await fs.readdir(dir), []);
    for (const name of ['presets.json', 'presets', 'Local Storage', 'IndexedDB']) {
      await fs.mkdir(path.join(dir, name));
      assert.deepEqual(await inspectTourProfile(dir), { profileKind: 'existing' });
      await fs.rmdir(path.join(dir, name));
    }
    assert.deepEqual(await inspectTourProfile('\0invalid'), { profileKind: 'unknown' });
  } finally { await fs.rmdir(dir); }
});
test('only the exact control webContents and its main frame can read classification', () => {
  const frame = {};
  const control = { mainFrame: frame };
  assert.equal(isTourProfileSender(control, frame, control), true);
  assert.equal(isTourProfileSender({}, frame, control), false);
  assert.equal(isTourProfileSender(control, {}, control), false);
  assert.equal(isTourProfileSender(control, frame, null), false);
});
