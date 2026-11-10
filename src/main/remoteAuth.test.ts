import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isRemoteAuthorized, loadOrCreateRemoteToken, readRemoteSettings, remoteAuthCookie, writeNewRemoteToken, writeRemoteSettings } from './remoteAuth';

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'wpa-remote-auth-'));
}

test('the token survives restarts until it is reset, and a reset locks out paired phones', () => {
  const dir = tempDir();
  try {
    const file = path.join(dir, 'remote-control-token');
    const first = loadOrCreateRemoteToken(file);
    assert.equal(loadOrCreateRemoteToken(file), first, 'same token after a restart');

    const pairedPhone = { url: '/remote', headers: { cookie: remoteAuthCookie(first).split(';')[0] } };
    assert.equal(isRemoteAuthorized(pairedPhone, first), true);

    const next = writeNewRemoteToken(file);
    assert.notEqual(next, first);
    assert.equal(loadOrCreateRemoteToken(file), next, 'the new token is what the next start uses');
    assert.equal(isRemoteAuthorized(pairedPhone, next), false, 'old cookie no longer works');
    assert.equal(isRemoteAuthorized({ url: `/remote?token=${first}`, headers: {} }, next), false, 'old bookmarked link no longer works');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('remote settings default to on-demand start with no saved port', () => {
  const dir = tempDir();
  try {
    assert.deepEqual(readRemoteSettings(path.join(dir, 'missing.json')), { autoStart: false, port: null });
    const broken = path.join(dir, 'broken.json');
    fs.writeFileSync(broken, '{not json');
    assert.deepEqual(readRemoteSettings(broken), { autoStart: false, port: null });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('remote settings merge updates and reject unusable ports', () => {
  const dir = tempDir();
  try {
    const file = path.join(dir, 'remote-control.json');
    assert.deepEqual(writeRemoteSettings(file, { port: 51234 }), { autoStart: false, port: 51234 });
    assert.deepEqual(writeRemoteSettings(file, { autoStart: true }), { autoStart: true, port: 51234 }, 'port kept');
    assert.deepEqual(readRemoteSettings(file), { autoStart: true, port: 51234 });
    assert.deepEqual(writeRemoteSettings(file, { port: 80 }), { autoStart: true, port: null }, 'privileged port dropped');
    fs.writeFileSync(file, JSON.stringify({ autoStart: 'yes', port: 70000 }));
    assert.deepEqual(readRemoteSettings(file), { autoStart: false, port: null });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
