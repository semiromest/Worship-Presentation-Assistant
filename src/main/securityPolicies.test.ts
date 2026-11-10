import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isAllowedSender, senderRole, PROJECTOR_CHANNELS } from './ipcSenderPolicy';
import { isAppDocument, isExternalWebLink } from './windowSecurity';
import { isRemoteAuthorized, loadOrCreateRemoteToken, remoteAuthCookie, remoteTokenFromCookie, REMOTE_COOKIE } from './remoteAuth';

test('IPC sender gate: control window main frame only, projectors limited to read-only channels', () => {
  const controlFrame = {}, projectorFrame = {}, iframe = {};
  const control = { id: 1, mainFrame: controlFrame };
  const projector = { id: 2, mainFrame: projectorFrame };
  const stranger = { id: 3, mainFrame: {} };
  const source = { control: () => control, projectors: () => [projector] };

  assert.equal(senderRole(control, controlFrame, source), 'control');
  assert.equal(senderRole(control, iframe, source), 'unknown', 'iframes inside the control window are rejected');
  assert.equal(senderRole(control, null, source), 'unknown');
  assert.equal(senderRole(projector, projectorFrame, source), 'projector');
  assert.equal(senderRole(stranger, stranger.mainFrame, source), 'unknown');
  assert.equal(senderRole(control, controlFrame, { control: () => null, projectors: () => [] }), 'unknown');

  assert.equal(isAllowedSender('quit-app', 'control'), true);
  assert.equal(isAllowedSender('projector-ready', 'projector'), true);
  for (const channel of ['quit-app', 'import-bible-xml', 'public-tunnel:start', 'share:start', 'save-bible-data', 'toggle-projector']) {
    assert.equal(isAllowedSender(channel, 'projector'), false, channel);
    assert.equal(isAllowedSender(channel, 'unknown'), false, channel);
  }
  assert.ok(!PROJECTOR_CHANNELS.has('delete-bible-data'));
});

test('window navigation stays on the app document; only web links go to the OS browser', () => {
  const packaged = 'file:///C:/Program%20Files/WPA/resources/app.asar/dist/index.html';
  assert.equal(isAppDocument('file:///C:/Program%20Files/WPA/resources/app.asar/dist/index.html?mode=projector', packaged), true);
  assert.equal(isAppDocument('file:///c:/program files/wpa/resources/app.asar/dist/index.html#x', packaged), true);
  assert.equal(isAppDocument('file:///C:/Windows/System32/drivers/etc/hosts', packaged), false);
  assert.equal(isAppDocument('https://evil.example/', packaged), false);
  assert.equal(isAppDocument('http://127.0.0.1:5173/?mode=projector', 'http://127.0.0.1:5173/'), true);
  assert.equal(isAppDocument('http://127.0.0.1:5174/', 'http://127.0.0.1:5173/'), false);
  assert.equal(isAppDocument('not a url', packaged), false);

  assert.equal(isExternalWebLink('https://soniox.com/'), true);
  for (const url of ['file:///C:/x.exe', 'ms-settings:defaultapps', 'javascript:alert(1)', 'smb://host/share', '']) {
    assert.equal(isExternalWebLink(url), false, url);
  }
});

test('LAN remote requires the token via query or HttpOnly cookie and fails closed', () => {
  const token = 'a'.repeat(43);
  const req = (url: string, cookie?: string) => ({ url, headers: cookie ? { cookie } : {} });
  assert.equal(isRemoteAuthorized(req('/remote'), token), false);
  assert.equal(isRemoteAuthorized(req('/api/control'), token), false);
  assert.equal(isRemoteAuthorized(req(`/remote?token=${token}`), token), true);
  assert.equal(isRemoteAuthorized(req('/remote?token=wrong'), token), false);
  assert.equal(isRemoteAuthorized(req('/', `other=1; ${REMOTE_COOKIE}=${token}`), token), true);
  assert.equal(isRemoteAuthorized(req('/', `${REMOTE_COOKIE}=${token}x`), token), false);
  assert.equal(isRemoteAuthorized(req(`/remote?token=${token}`), null), false, 'no token configured means nobody is authorized');

  assert.equal(remoteTokenFromCookie(undefined), null);
  assert.equal(remoteTokenFromCookie(`${REMOTE_COOKIE}=`), null);
  const cookie = remoteAuthCookie(token);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
});

test('remote token persists across restarts and replaces a corrupted file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-token-test-'));
  try {
    const file = path.join(dir, 'nested', 'remote-control-token');
    const first = loadOrCreateRemoteToken(file);
    assert.match(first, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(loadOrCreateRemoteToken(file), first);
    fs.writeFileSync(file, 'short');
    const replaced = loadOrCreateRemoteToken(file);
    assert.notEqual(replaced, 'short');
    assert.match(replaced, /^[A-Za-z0-9_-]{43}$/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
