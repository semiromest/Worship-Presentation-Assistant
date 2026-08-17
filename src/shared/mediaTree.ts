/**
 * Pure .gpres (ZIP) helpers shared by the main process and the perf bench.
 *
 * Extracted from main.ts so the cost of save/load serialization can be
 * measured in isolation (node, no electron) — Phase 0 instrumentation.
 */

import path from 'node:path';
import fs from 'node:fs/promises';
import { pathToFileURL, fileURLToPath as nodeFileURLToPath } from 'node:url';
import AdmZip from 'adm-zip';

// Windows drive letters, spaces, and Unicode in paths need Node's URL API
// for path <-> local-resource conversions; manual string concatenation
// (`local-resource://${p}`) misparses "C:" as a URL host and drops the
// drive letter.
export function pathToLocalResourceUrl(filePath: string): string {
  return pathToFileURL(filePath).href.replace(/^file:\/\//, 'local-resource://');
}

export function localResourceUrlToPath(resourceUrl: string): string {
  const fileUrl = resourceUrl.replace(/^local-resource:\/\//, 'file://');
  return nodeFileURLToPath(fileUrl);
}

export const MEDIA_REF_PREFIX = 'local-resource://media/';

/** True for `local-resource://media/<name>` refs (Phase 6 content-addressed form). */
export function mediaRefToName(url: string): string | null {
  if (!url.startsWith(MEDIA_REF_PREFIX)) return null;
  const name = url.slice(MEDIA_REF_PREFIX.length);
  // No slashes, no path traversal, letters/digits/dot/underscore/hyphen only.
  if (name === '..' || name.includes('..') || !/^[a-zA-Z0-9._-]+$/.test(name)) return null;
  return name;
}

export function fileUrlToPath(fileUrl: string, mediaDir?: string): string {
  // Presentations re-opened from disk carry local-resource:// URLs pointing
  // into the temp dir; convert those back to a real path so re-saving can
  // re-embed the media. Phase 6 media-library refs resolve into the
  // persistent media dir.
  if (!fileUrl) return fileUrl;
  const dir = mediaDir;
  const mediaName = dir ? mediaRefToName(fileUrl) : null;
  if (mediaName && dir) return path.join(dir, mediaName);
  if (fileUrl.startsWith('local-resource://')) return localResourceUrlToPath(fileUrl);
  if (fileUrl.startsWith('file://')) return nodeFileURLToPath(fileUrl);
  if (fileUrl.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(fileUrl)) return fileUrl;
  return nodeFileURLToPath(fileUrl);
}

/**
 * Recursive walker over a JSON-like tree hitting every string leaf.
 * Replaces three near-identical tree walks; callback may mutate in place.
 */
export function walkStrings(node: any, onString: (value: string, parent: any, key: string) => void): void {
  if (!node || typeof node !== 'object') return;
  for (const key of Object.keys(node)) {
    const val = node[key];
    if (typeof val === 'string') {
      onString(val, node, key);
    } else if (Array.isArray(val)) {
      for (const item of val) walkStrings(item, onString);
    } else if (typeof val === 'object') {
      walkStrings(val, onString);
    }
  }
}

export function normalizeLocalSourcePath(value: string, mediaDir?: string): string {
  if (!value) return '';
  const dir = mediaDir;
  const mediaName = dir ? mediaRefToName(value) : null;
  if (mediaName && dir) return path.join(dir, mediaName);
  if (value.startsWith('local-resource://')) return localResourceUrlToPath(value);
  if (value.startsWith('file://')) return nodeFileURLToPath(value);
  return value;
}

export const isEmbeddableUrl = (v: string) => {
  if (!v) return false;
  if (v.startsWith('file:///') || v.startsWith('local-resource://')) return true;
  if (v.startsWith('http://') || v.startsWith('https://') || v.startsWith('data:')) return false;
  return v.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(v);
};

/** Bidirectional registry so repeated files reuse one name in O(1). */
export interface MediaNameRegistry {
  usedNames: Map<string, string>; // sanitized name -> source path (collision check)
  byPath:    Map<string, string>; // source path -> media/xxx (reverse lookup)
}
export function createMediaNameRegistry(): MediaNameRegistry {
  return { usedNames: new Map(), byPath: new Map() };
}

export function toMediaFileName(fileUrl: string, registry: MediaNameRegistry, mediaDir?: string): string {
  const filePath = fileUrlToPath(fileUrl, mediaDir);

  const cached = registry.byPath.get(filePath);
  if (cached) return cached; // O(1) instead of scanning usedNames

  const ext = path.extname(filePath);
  const base = path.basename(filePath, ext).replace(/[^a-zA-Z0-9_-]/g, '_') || 'media';

  let key = `${base}${ext}`;
  if (registry.usedNames.has(key)) {
    let counter = 1;
    while (registry.usedNames.has(`${base}_${counter}${ext}`)) counter++;
    key = `${base}_${counter}${ext}`;
  }

  registry.usedNames.set(key, filePath);
  const mediaPath = `media/${key}`;
  registry.byPath.set(filePath, mediaPath);
  return mediaPath;
}

export const isZip = (buf: Buffer) => buf[0] === 0x50 && buf[1] === 0x4b; // "PK"

/**
 * Builds a .gpres ZIP in memory: finds embeddable media URLs, embeds files
 * in parallel, then rewrites the tree to the embedded media/* paths.
 */
export async function buildGpresZip(data: any, opts?: { mediaDir?: string }): Promise<{ zip: AdmZip; embeddedCount: number }> {
  const mediaDir = opts?.mediaDir;
  const urls = new Set<string>();
  walkStrings(data, (val) => { if (isEmbeddableUrl(val)) urls.add(val); });

  const registry = createMediaNameRegistry();
  const zip = new AdmZip();
  const urlToMedia = new Map<string, string>();

  await Promise.all([...urls].map(async (url) => {
    const sourcePath = normalizeLocalSourcePath(url, mediaDir);
    try {
      await fs.access(sourcePath);
      const mediaPath = toMediaFileName(url, registry, mediaDir);
      const mediaName = mediaPath.slice(mediaPath.indexOf('/') + 1);
      zip.addLocalFile(sourcePath, 'media', mediaName);
      urlToMedia.set(url, mediaPath);
    } catch (err) {
      console.warn(`[gpres] Skipping unreachable media: ${url} (${(err as Error)?.message ?? err})`);
    }
  }));

  walkStrings(data, (val, parent, key) => {
    const mapped = urlToMedia.get(val);
    if (mapped) parent[key] = mapped;
  });

  zip.addFile('presentation.json', Buffer.from(JSON.stringify(data, null, 2), 'utf-8'));
  return { zip, embeddedCount: urlToMedia.size };
}
