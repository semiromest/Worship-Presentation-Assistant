import { app, type WebContents } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function restrictPracticeSession(control: WebContents, distribution: string): void {
  const session = control.session;
  session.setPermissionCheckHandler(() => false);
  session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.setDisplayMediaRequestHandler((_request, callback) => callback({}));
  const dev = !app.isPackaged && process.env.VITE_DEV_SERVER_URL ? new URL(process.env.VITE_DEV_SERVER_URL) : null;
  const roots = [distribution, app.getPath('userData'), app.getAppPath()].map(root => path.resolve(root));
  function permitted(raw: string): boolean {
    try {
      const url = new URL(raw);
      if (['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol))
        return !!dev && url.hostname === dev.hostname && url.port === dev.port &&
          ['http:', 'ws:'].includes(url.protocol) && dev.protocol === 'http:';
      if (url.protocol === 'file:') {
        const file = fileURLToPath(url);
        return roots.some(root => { const relative = path.relative(root, file);
          return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative)); });
      }
      return ['data:', 'blob:', 'local-resource:'].includes(url.protocol);
    } catch { return false; }
  }
  session.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => callback({ cancel: !permitted(details.url) }));
  control.setWindowOpenHandler(() => ({ action: 'deny' }));
  control.on('will-navigate', event => event.preventDefault());
  control.on('will-attach-webview', event => event.preventDefault());
}
