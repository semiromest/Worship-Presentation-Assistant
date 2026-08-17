/**
 * Persistent media library (Phase 6).
 *
 * Media bytes live in userData/media/ as content-addressed files
 * (<sha256[:16]><ext>) and are referenced from presentation state as
 * `local-resource://media/<name>` — served by the main process's
 * local-resource protocol. This removes inline base64 from React state, undo
 * history, IPC payloads and autosave files, and (unlike the old temp-dir
 * extraction) the references stay valid after the app quits.
 *
 * Pure Node module (no electron import) so it can be unit-tested with tsx.
 * The electron-backed singleton lives in getMediaLibrary().
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import AdmZip from 'adm-zip';
import { walkStrings, localResourceUrlToPath, MEDIA_REF_PREFIX, mediaRefToName } from '../shared/mediaTree';

const DATA_URL_RE = /^data:image\/(png|jpe?g|webp|gif|bmp);base64,([A-Za-z0-9+/=]+)$/;

function hashName(data: Buffer, ext: string): string {
  const cleanExt = ext.startsWith('.') ? ext.toLowerCase() : `.${ext.toLowerCase()}`;
  return `${crypto.createHash('sha256').update(data).digest('hex').slice(0, 16)}${cleanExt}`;
}

/**
 * Writes bytes to dir/<hash><ext> atomically (temp + rename); returns the
 * local-resource ref, or null on failure. Content-addressing dedupes: the
 * same bytes always map to the same file, written only once.
 */
export async function storeBytesTo(dir: string, data: Buffer, ext: string): Promise<string | null> {
  if (!data || data.length === 0) return null;
  const name = hashName(data, ext);
  const file = path.join(dir, name);
  try {
    await fs.mkdir(dir, { recursive: true });
    await fs.access(file);
    return `${MEDIA_REF_PREFIX}${name}`; // already stored
  } catch { /* not present — write below */ }

  const tempFile = `${file}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
  try {
    await fs.writeFile(tempFile, data);
    await fs.rename(tempFile, file);
    return `${MEDIA_REF_PREFIX}${name}`;
  } catch {
    try { await fs.rm(tempFile, { force: true }); } catch { /* best-effort */ }
    return null;
  }
}

/**
 * Externalizes an inline base64 image data URI; returns a media ref or null
 * (non-image data URIs, malformed input, or write failure → null, so callers
 * keep the original value untouched — graceful degradation, never data loss).
 */
export async function externalizeDataUrlTo(dir: string, dataUrl: string): Promise<string | null> {
  const m = DATA_URL_RE.exec(dataUrl);
  if (!m) return null;
  const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
  const bytes = Buffer.from(m[2], 'base64');
  if (bytes.length === 0) return null;
  return storeBytesTo(dir, bytes, ext);
}

export interface MediaLibrary {
  dir: string;
  storeBytes: (data: Buffer, ext: string) => Promise<string | null>;
  externalizeDataUrl: (dataUrl: string) => Promise<string | null>;
  /** Resolves a media ref (library or legacy local-resource/file) to an absolute path. */
  urlToPath: (url: string) => string;
}

export function createMediaLibrary(dir: string): MediaLibrary {
  const storeBytes = (data: Buffer, ext: string) => storeBytesTo(dir, data, ext);
  const externalizeDataUrl = (dataUrl: string) => externalizeDataUrlTo(dir, dataUrl);
  const urlToPath = (url: string): string => {
    const name = mediaRefToName(url);
    if (name) return path.join(dir, name);
    if (url.startsWith('local-resource://')) return localResourceUrlToPath(url);
    return url; // file:// or plain path handled by callers as before
  };
  return { dir, storeBytes, externalizeDataUrl, urlToPath };
}

/**
 * Rewrites a parsed .gpres tree in place: `media/*` refs are written from the
 * ZIP into the library (content-addressed), and inline base64 images are
 * externalized too. Returns the number of rewritten references.
 */
export async function rewriteGpresMedia(
  zip: AdmZip,
  data: unknown,
  lib: MediaLibrary,
): Promise<number> {
  const mediaPaths = new Set<string>();
  const dataUrls = new Set<string>();
  walkStrings(data, (val) => {
    if (typeof val !== 'string') return;
    if (val.startsWith('media/')) mediaPaths.add(val);
    else if (val.startsWith('data:image/')) dataUrls.add(val);
  });

  const urlMap = new Map<string, string>();
  await Promise.all([...mediaPaths].map(async (mediaPath) => {
    const entry = zip.getEntry(mediaPath);
    if (!entry) return;
    const buf = zip.readFile(entry);
    if (!buf) return;
    const ext = path.extname(mediaPath) || '.bin';
    const ref = await lib.storeBytes(buf, ext);
    if (ref) urlMap.set(mediaPath, ref);
  }));
  await Promise.all([...dataUrls].map(async (dataUrl) => {
    const ref = await lib.externalizeDataUrl(dataUrl);
    if (ref) urlMap.set(dataUrl, ref);
  }));

  walkStrings(data, (val, parent, key) => {
    const mapped = urlMap.get(val as string);
    if (mapped) parent[key] = mapped;
  });

  return urlMap.size;
}

// Electron-backed singleton (main process only).
let mediaLibraryInstance: MediaLibrary | null = null;

export function getMediaLibrary(): MediaLibrary {
  if (!mediaLibraryInstance) {
    // Lazy require keeps this module importable in pure-node tests; electron
    // is external in the main build, so require() is the standard runtime form.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { app } = require('electron') as typeof import('electron');
    mediaLibraryInstance = createMediaLibrary(path.join(app.getPath('userData'), 'media'));
  }
  return mediaLibraryInstance;
}
