import { ipcMain, type WebContents } from 'electron';
import { restricted } from './isolatedLaunch';
import { isTourProfileSender } from './tourProfile';

// Fail closed: new application IPC cannot acquire practice capabilities implicitly.
const allowed = new Set(['tour:profile', 'practice:info', 'practice:progress', 'practice:guide', 'practice:close', 'practice:ready', 'practice:workspace:read', 'practice:workspace:start', 'practice:workspace:observe', 'practice:workspace:pause', 'practice:workspace:resume', 'import-bible-xml', 'select-media-file', 'select-media-files-all', 'media:getThumbnail',
  'show-confirm-dialog', 'show-alert-dialog', 'load-presets', 'save-preset', 'rename-preset', 'delete-preset', 'get-displays', 'get-projector-outputs',
  'get-projector-status', 'get-remote-url', 'updater:get-info', 'quit-app', 'cleanup-temp-dir']);
let control: WebContents | null = null;
export function setPracticeControl(value: WebContents): void { control = value; }
if (restricted) {
  const handle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (channel, listener) => handle(channel, (event, ...args: unknown[]) => {
    if (!isTourProfileSender(event.sender, event.senderFrame, control)) throw new Error('Unauthorized practice sender');
    if (!allowed.has(channel)) throw new Error('Unavailable in practice mode: ' + channel);
    return listener(event, ...args);
  });
  const on = ipcMain.on.bind(ipcMain);
  ipcMain.on = (channel, listener) => on(channel, (event, ...args: unknown[]) => {
    if (allowed.has(channel) && isTourProfileSender(event.sender, event.senderFrame, control)) listener(event, ...args);
  });
}
