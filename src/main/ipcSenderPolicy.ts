import { ipcMain, type WebContents, type WebFrameMain } from 'electron';

/**
 * Fail-closed IPC sender gate for the normal (non-practice) app.
 *
 * Every ipcMain.handle / ipcMain.on listener registered after this module is
 * evaluated only runs when the message comes from the main frame of the
 * control window. Projector windows share the same preload, so they are
 * limited to the read-only channels they actually need; anything else (a
 * projector, an iframe, a navigated page, a future window) is rejected.
 */

/** Channels a projector output renderer may use. Keep this list read-only. */
export const PROJECTOR_CHANNELS: ReadonlySet<string> = new Set([
  'projector-ready',
  'cache-google-font',
  'media:getThumbnail',
  'stt:get-status',
  'perf:snapshot',
  'perf:reset',
]);

export type SenderRole = 'control' | 'projector' | 'unknown';

type SenderLike = Pick<WebContents, 'id'> & { mainFrame: unknown };

export interface SenderSource {
  control(): SenderLike | null;
  projectors(): Iterable<SenderLike>;
}

export function senderRole(sender: SenderLike, frame: WebFrameMain | null | unknown, source: SenderSource): SenderRole {
  // Only the top-level document may talk to the main process — never an iframe.
  if (!frame || frame !== sender.mainFrame) return 'unknown';
  const control = source.control();
  if (control && control.id === sender.id) return 'control';
  for (const projector of source.projectors()) if (projector.id === sender.id) return 'projector';
  return 'unknown';
}

export function isAllowedSender(channel: string, role: SenderRole): boolean {
  if (role === 'control') return true;
  if (role === 'projector') return PROJECTOR_CHANNELS.has(channel);
  return false;
}

let installed = false;

export function installIpcSenderPolicy(source: SenderSource): void {
  if (installed) return;
  installed = true;
  const handle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (channel, listener) => handle(channel, (event, ...args: unknown[]) => {
    if (!isAllowedSender(channel, senderRole(event.sender, event.senderFrame, source))) {
      throw new Error('Unauthorized IPC sender: ' + channel);
    }
    return listener(event, ...args);
  });
  const on = ipcMain.on.bind(ipcMain);
  ipcMain.on = (channel, listener) => on(channel, (event, ...args: unknown[]) => {
    if (isAllowedSender(channel, senderRole(event.sender, event.senderFrame, source))) listener(event, ...args);
  });
}
