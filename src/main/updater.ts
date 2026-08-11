/**
 * Auto-update via GitHub Releases (electron-updater).
 * autoUpdater events are forwarded to the renderer over 'updater-event'.
 */

import { autoUpdater } from 'electron-updater';
import { app, BrowserWindow, ipcMain } from 'electron';

export type UpdaterEventType =
  | 'checking-for-update'
  | 'update-available'
  | 'update-not-available'
  | 'download-progress'
  | 'update-downloaded'
  | 'update-cancelled'
  | 'error';

export interface UpdaterEvent {
  type: UpdaterEventType;
  payload?: any;
}

let mainWindow: BrowserWindow | null = null;

function sendEvent(type: UpdaterEventType, payload?: any): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('updater-event', { type, payload } satisfies UpdaterEvent);
  }
}

export function initUpdater(win: BrowserWindow): void {
  mainWindow = win;

  if (process.env.FORCE_DEV_UPDATE) {
    autoUpdater.forceDevUpdateConfig = true; // reads dev-app-update.yml in dev
  }

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.disableWebInstaller = true;

  autoUpdater.on('checking-for-update', () => sendEvent('checking-for-update'));
  autoUpdater.on('update-available', (info) => sendEvent('update-available', { version: info.version }));
  autoUpdater.on('update-not-available', () => sendEvent('update-not-available'));
  autoUpdater.on('download-progress', (p) =>
    sendEvent('download-progress', {
      percent: Math.round(p.percent * 10) / 10,
      transferred: p.transferred,
      total: p.total,
      bytesPerSecond: p.bytesPerSecond,
    }));
  autoUpdater.on('update-downloaded', (info) => sendEvent('update-downloaded', { version: info.version }));
  autoUpdater.on('update-cancelled', () => sendEvent('update-cancelled'));
  autoUpdater.on('error', (err) => sendEvent('error', { message: err?.message ?? String(err) }));

  ipcMain.handle('updater:get-info', () => ({
    version: app.getVersion(),
    updaterActive: app.isPackaged || !!process.env.FORCE_DEV_UPDATE,
  }));

  ipcMain.handle('updater:check', async () => {
    try {
      await autoUpdater.checkForUpdates();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error)?.message ?? String(err) };
    }
  });

  ipcMain.handle('updater:download', async () => {
    try {
      await autoUpdater.downloadUpdate();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error)?.message ?? String(err) };
    }
  });

  ipcMain.handle('updater:install', () => {
    autoUpdater.quitAndInstall(true, true);
    return true;
  });

  // silent startup check — no user notification; UI badge lives in the renderer
  win.webContents.once('did-finish-load', () => {
    if (app.isPackaged || process.env.FORCE_DEV_UPDATE) {
      autoUpdater.checkForUpdates().catch(() => { /* non-fatal */ });
    }
  });
}