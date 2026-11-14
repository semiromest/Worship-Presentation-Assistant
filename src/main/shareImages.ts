/**
 * Slide pictures for phones during a share broadcast: an allow-list of local files keyed by opaque
 * ids, served only with the live broadcast token. Pure Node (no share page import): unit-tested.
 */
import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { queryToken, tokenMatches } from './shareTransport';

/**
 * Files phones may load for the CURRENT broadcast (slide pictures and their translations), keyed by
 * an opaque id. Only files the presenter's app put on the live slide are ever listed here.
 */
const shareImages = new Map<string, string>();

export function clearShareImages(): void {
  shareImages.clear();
}
const MAX_SHARE_IMAGES = 200;

/** Lists a local file for phones; returns its path under /share/img/ (token added by the phone). */
export function registerShareImage(file: string): string {
  const key = crypto.createHash('sha256').update(file).digest('hex').slice(0, 24);
  if (!shareImages.has(key)) {
    if (shareImages.size >= MAX_SHARE_IMAGES) shareImages.delete(shareImages.keys().next().value as string);
    shareImages.set(key, file);
  }
  return `/share/img/${key}`;
}

const IMAGE_TYPES: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.bmp': 'image/bmp', '.avif': 'image/avif', '.tif': 'image/tiff', '.tiff': 'image/tiff',
};

/** Serves `/share/img/<id>?token=…` against the live token. Returns true when the request was handled. */
export function serveShareImage(req: IncomingMessage, res: ServerResponse, liveToken: string | null): boolean {
  const pathname = (req.url ?? '').split('?')[0];
  if (!pathname.startsWith('/share/img/')) return false;
  const file = shareImages.get(pathname.slice('/share/img/'.length));
  if (!liveToken || !tokenMatches(liveToken, queryToken(req.url)) || !file) {
    res.writeHead(404, { 'Cache-Control': 'no-store' });
    res.end();
    return true;
  }
  const type = IMAGE_TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
  fsp.readFile(file).then(
    (bytes) => {
      if (res.destroyed) return;
      res.writeHead(200, { 'Content-Type': type, 'Content-Length': bytes.length, 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
      res.end(bytes);
    },
    () => { if (!res.destroyed) { res.writeHead(404, { 'Cache-Control': 'no-store' }); res.end(); } },
  );
  return true;
}
