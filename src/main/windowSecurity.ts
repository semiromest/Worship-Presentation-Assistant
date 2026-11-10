import { shell, type WebContents } from 'electron';

/**
 * True when `target` is the app's own document (same file for packaged builds,
 * same origin for the Vite dev server). Query/hash may differ.
 */
export function isAppDocument(target: string, appUrl: string): boolean {
  try {
    const a = new URL(target);
    const b = new URL(appUrl);
    if (a.protocol !== b.protocol) return false;
    if (a.protocol === 'file:') return decodeURIComponent(a.pathname).toLowerCase() === decodeURIComponent(b.pathname).toLowerCase();
    return a.origin === b.origin;
  } catch {
    return false;
  }
}

/** Only plain web links are handed to the OS browser; never file:, ms-settings:, custom schemes… */
export function isExternalWebLink(target: string): boolean {
  try {
    const url = new URL(target);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

/**
 * Lock an app window to its own document: no in-window navigation to other
 * pages, no child windows (they would inherit the preload bridge), no
 * <webview>. Web links open in the user's browser instead.
 */
export function hardenAppWindow(contents: WebContents, appUrl: () => string): void {
  contents.setWindowOpenHandler(({ url }) => {
    if (isExternalWebLink(url)) void shell.openExternal(url).catch(() => {});
    return { action: 'deny' };
  });
  const guard = (event: Electron.Event, url: string) => {
    if (isAppDocument(url, appUrl())) return;
    event.preventDefault();
    if (isExternalWebLink(url)) void shell.openExternal(url).catch(() => {});
  };
  contents.on('will-navigate', guard);
  contents.on('will-attach-webview', event => event.preventDefault());
}
