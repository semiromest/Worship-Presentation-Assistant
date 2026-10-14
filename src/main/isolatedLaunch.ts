import { app, BrowserWindow } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { assertNoLinks, assertProfileTree, parseLaunchMode, practicePath } from './launchPolicy';

export const launchMode = (() => {
  try { return parseLaunchMode(process.argv.slice(1)); }
  catch (error) { console.error('[launch] refused', error); app.exit(1); throw error; }
})();
export const restricted = launchMode === 'practice';
export const systemTempRoot = os.tmpdir();
let normalProfile = app.getPath('userData');
try {
  if (launchMode === 'smoke') {
    // Only an opaque, app-generated identifier crosses into a smoke child.
    // No environment or command-line value is accepted as a filesystem path.
    const token = randomUUID();
    normalProfile = path.join(os.tmpdir(), 'wpa-smoke-' + token);
    assertNoLinks(normalProfile);
    fs.mkdirSync(normalProfile);
    fs.writeFileSync(path.join(normalProfile, 'smoke-session.json'), JSON.stringify({ token }), { flag: 'wx' });
    process.env.WPA_SMOKE_SESSION = token;
  } else if (restricted && process.env.WPA_SMOKE_SESSION) {
    const token = process.env.WPA_SMOKE_SESSION;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(token)) throw new Error('Invalid smoke session');
    const tempBase = systemTempRoot;
    normalProfile = path.join(tempBase, 'wpa-smoke-' + token);
    assertNoLinks(normalProfile);
    const marker = path.join(normalProfile, 'smoke-session.json');
    assertNoLinks(marker);
    if (JSON.parse(fs.readFileSync(marker, 'utf8')).token !== token) throw new Error('Invalid smoke marker');
  }
} catch (error) { console.error('[launch] refused', error); app.exit(1); }
export const practiceProfile = (launchMode === 'smoke' || restricted && process.env.WPA_SMOKE_SESSION) ? path.join(normalProfile, 'practice') : practicePath(normalProfile);
try {
  if (launchMode !== 'normal') {
    const profile = restricted ? practiceProfile : normalProfile;
    if (restricted && path.resolve(profile).toLowerCase() === path.resolve(normalProfile).toLowerCase()) throw new Error('Profile collision');
    assertNoLinks(profile);
    fs.mkdirSync(profile, { recursive: true });
    app.setPath('userData', profile);
    if (restricted) {
      if (!app.requestSingleInstanceLock()) app.exit(0);
      // Chromium's own root singleton links are managed by its acquired lock;
      // every application-owned subtree remains subject to link rejection.
      for (const entry of fs.readdirSync(profile)) {
        if (process.platform !== 'win32' && ['SingletonLock', 'SingletonCookie', 'SingletonSocket'].includes(entry)) continue;
        assertProfileTree(path.join(profile, entry));
      }
      app.on('second-instance', () => {
        const window = BrowserWindow.getAllWindows()[0];
        if (window?.isMinimized()) window.restore();
        window?.show(); window?.focus();
      });
    }
    for (const dir of ['sessions', 'runtime']) {
      assertNoLinks(path.join(profile, dir));
      fs.mkdirSync(path.join(profile, dir), { recursive: true });
    }
    app.setPath('sessionData', path.join(profile, 'sessions'));
    app.setPath('temp', path.join(profile, 'runtime'));
    process.env.TEMP = path.join(profile, 'runtime');
    process.env.TMP = path.join(profile, 'runtime');
    process.env.TMPDIR = path.join(profile, 'runtime');
  }
} catch (error) { console.error('[launch] refused', error); app.exit(1); }
