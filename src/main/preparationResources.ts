import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileUrlToPath, mediaRefToName } from '../shared/mediaTree';

export async function checkMediaResources(urls: string[], mediaDir: string): Promise<Record<string, boolean>> {
  const results: Record<string, boolean> = {};
  for (const url of [...new Set(urls)].slice(0, 10000)) {
    if (typeof url !== 'string' || url.length > 16384) continue;
    if (/^(https?:|data:|blob:)/i.test(url)) continue;
    try {
      const media = mediaRefToName(url);
      const file = media ? path.join(mediaDir, media)
        : url.startsWith('local-resource://mediafile/') ? decodeURIComponent(url.slice('local-resource://mediafile/'.length))
        : fileUrlToPath(url, mediaDir);
      const stat = await fs.stat(file);
      await fs.access(file, fs.constants.R_OK);
      results[url] = stat.isFile();
    } catch { results[url] = false; }
  }
  return results;
}

const pending = new Map<string, Promise<string>>();
/** Cache CSS and binaries together for offline use, including subsequent launches. */
export function cacheGoogleFont(family: string, cacheDir: string): Promise<string> {
  const name = family.split(',')[0].replace(/['"]/g, '').trim();
  if (!name || name.length > 100 || !/^[\p{L}\p{N} -]+$/u.test(name)) return Promise.reject(new Error('Invalid font family'));
  const key = `${cacheDir}:${name}`;
  const existing = pending.get(key);
  if (existing) return existing;
  const promise = (async () => {
    const filename = path.join(cacheDir, createHash('sha256').update(name).digest('hex') + '.css');
    try { return await fs.readFile(filename, 'utf8'); } catch { /* first use */ }
    const response = await fetch(`https://fonts.googleapis.com/css2?family=${encodeURIComponent(name)}:wght@400;700&display=swap`, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error('Font stylesheet unavailable');
    let css = await response.text();
    const urls = [...new Set([...css.matchAll(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g)].map(m => m[1]))];
    if (!urls.length) throw new Error('No font files');
    for (const url of urls) {
      const font = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!font.ok) throw new Error('Font download failed');
      const bytes = Buffer.from(await font.arrayBuffer());
      if (bytes.length > 20_000_000) throw new Error('Font too large');
      css = css.replaceAll(url, `data:${font.headers.get('content-type') || 'font/woff2'};base64,${bytes.toString('base64')}`);
    }
    await fs.mkdir(cacheDir, { recursive: true });
    await fs.writeFile(filename + '.tmp', css);
    await fs.rename(filename + '.tmp', filename);
    return css;
  })();
  pending.set(key, promise);
  void promise.finally(() => pending.delete(key)).catch(() => {});
  return promise;
}
