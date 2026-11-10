// Local media for the web app. Files the user picks are copied into IndexedDB
// under their SHA-256, and the renderer receives a stable same-origin URL
// (`<app>/wpa-media/<sha256>.<ext>#<name>`). The service worker serves those
// URLs (with Range support for video), so they survive reloads, work in the
// projector window, and map 1:1 onto `.gpres` `media/<sha256>.<ext>` entries.
import { mediaGet, mediaHas, mediaPut } from './db';
import { ensurePersistentStorage, mediaStored } from './storage';

export const MEDIA_SEGMENT = 'wpa-media/';
const SAFE_EXT = /^[a-z0-9]{1,10}$/;
const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/bmp': 'bmp', 'image/svg+xml': 'svg',
  'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov', 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/ogg': 'ogg',
};
export const MIME_BY_EXT: Record<string, string> = Object.fromEntries(Object.entries(EXT_BY_MIME).map(([mime, ext]) => [ext, mime]));
Object.assign(MIME_BY_EXT, { jpeg: 'image/jpeg', m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac', mkv: 'video/x-matroska', m4v: 'video/mp4' });

export const appBase = () => new URL('./', location.href.split(/[?#]/)[0]).href;

export function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export function extensionOf(name: string, type = ''): string {
  const fromName = name.split('.').pop()?.toLowerCase() ?? '';
  if (name.includes('.') && SAFE_EXT.test(fromName)) return fromName;
  return EXT_BY_MIME[type] ?? 'bin';
}

export function mediaUrl(key: string, name?: string): string {
  return `${appBase()}${MEDIA_SEGMENT}${key}${name ? `#${encodeURIComponent(name)}` : ''}`;
}

/** `<sha256>.<ext>` when the URL points at this app's media store, otherwise null. */
export function mediaKeyOf(url: string): string | null {
  if (typeof url !== 'string') return null;
  const clean = url.split('#')[0];
  const index = clean.indexOf(MEDIA_SEGMENT);
  if (index < 0) return null;
  const key = clean.slice(index + MEDIA_SEGMENT.length);
  return /^[a-f0-9]{64}\.[a-z0-9]{1,10}$/.test(key) ? key : null;
}

export async function storeBlob(blob: Blob, name: string, knownSha?: string): Promise<string> {
  const ext = extensionOf(name, blob.type);
  const sha = knownSha ?? toHex(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()));
  const key = `${sha}.${ext}`;
  if (!(await mediaHas(key))) {
    const type = blob.type || MIME_BY_EXT[ext] || 'application/octet-stream';
    await mediaPut({ key, blob: blob.type ? blob : new Blob([blob], { type }), name, type, size: blob.size, addedAt: Date.now() });
    void ensurePersistentStorage();
    mediaStored();
  }
  return mediaUrl(key, name);
}

export const importFile = (file: File) => storeBlob(file, file.name);

export async function readMedia(url: string): Promise<Blob | null> {
  const key = mediaKeyOf(url);
  if (key) return (await mediaGet(key))?.blob ?? null;
  if (/^(blob:|data:)/.test(url)) {
    try { return await (await fetch(url)).blob(); } catch { return null; }
  }
  return null;
}

export async function mediaAvailable(url: string): Promise<boolean> {
  const key = mediaKeyOf(url);
  if (key) return mediaHas(key);
  return /^(data:|blob:|https?:)/.test(url);
}

const ACCEPT: Record<string, string> = {
  image: 'image/*', video: 'video/*', audio: 'audio/*', all: 'image/*,video/*', any: '',
};

/** Opens the browser's file chooser; resolves to [] when the user cancels. */
export function pickFiles(kind: keyof typeof ACCEPT | string, multiple = false, accept?: string): Promise<File[]> {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept ?? ACCEPT[kind] ?? '';
    input.multiple = multiple;
    input.hidden = true;
    document.body.append(input);
    let settled = false;
    const finish = (files: File[]) => { if (settled) return; settled = true; input.remove(); resolve(files); };
    input.addEventListener('cancel', () => finish([]), { once: true });
    input.addEventListener('change', () => finish([...(input.files ?? [])]), { once: true });
    input.click();
  });
}

const matches = (file: File, kind: string) => kind === 'all'
  ? /^(image|video)\//.test(file.type)
  : kind === 'any' || file.type.startsWith(`${kind}/`) || (!file.type && kind !== 'image');

export async function chooseMedia(kind: 'image' | 'video' | 'audio' | 'all', multiple = false): Promise<string[] | null> {
  const files = (await pickFiles(kind, multiple)).filter(file => matches(file, kind));
  if (!files.length) return null;
  return Promise.all(files.map(importFile));
}
