import { ipcMain, type BrowserWindow } from 'electron';
import { randomUUID } from 'node:crypto';
import type { AppDialogOptions, AppDialogRequest } from '../shared/appDialog';

const sessions = new WeakMap<BrowserWindow, {
  ready: boolean;
  pending: Map<string, { request: AppDialogRequest; resolve: (value: string | null) => void }>;
}>();

/** Only the owning control window may display and answer its requests. */
export function attachAppDialogs(window: BrowserWindow) {
  const state = { ready: false, pending: new Map<string, { request: AppDialogRequest; resolve: (value: string | null) => void }>() };
  sessions.set(window, state);
  const authorized = (event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) =>
    event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame;
  const ready = (event: Electron.IpcMainEvent) => {
    if (!authorized(event)) return;
    state.ready = true;
    for (const { request } of state.pending.values()) window.webContents.send('app-dialog:request', request);
  };
  const respond = (event: Electron.IpcMainEvent, id: unknown, value: unknown) => {
    if (!authorized(event) || typeof id !== 'string') return;
    const item = state.pending.get(id);
    if (!item || (value !== null && !item.request.choices.some(choice => choice.value === value))) return;
    state.pending.delete(id);
    item.resolve(value as string | null);
  };
  const cancel = () => {
    state.ready = false;
    for (const item of state.pending.values()) item.resolve(null);
    state.pending.clear();
  };
  ipcMain.on('app-dialog:ready', ready);
  ipcMain.on('app-dialog:respond', respond);
  window.webContents.on('render-process-gone', cancel);
  window.on('unresponsive', () => {
    for (const item of state.pending.values()) item.resolve(null);
    state.pending.clear();
  });
  window.webContents.on('did-fail-load', cancel);
  window.webContents.on('did-start-navigation', (_event, _url, inPlace, mainFrame) => { if (mainFrame && !inPlace) cancel(); });
  window.once('closed', () => {
    cancel();
    ipcMain.removeListener('app-dialog:ready', ready);
    ipcMain.removeListener('app-dialog:respond', respond);
  });
}

export function showAppDialog(window: BrowserWindow | null, options: AppDialogOptions): Promise<string | null> {
  if (!window || window.isDestroyed()) return Promise.resolve(null);
  const state = sessions.get(window);
  if (!state) return Promise.resolve(null);
  return new Promise(resolve => {
    const request = { ...options, id: randomUUID() };
    state.pending.set(request.id, { request, resolve });
    if (state.ready) window.webContents.send('app-dialog:request', request);
  });
}

export function appDialogsReady(window: BrowserWindow): boolean {
  return sessions.get(window)?.ready === true && !window.webContents.isDestroyed();
}
