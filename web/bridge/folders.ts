// Media folders on the web (Chrome/Edge): the folder is chosen with
// showDirectoryPicker, its handle is kept in IndexedDB under the folder's
// name (the "path" the renderer stores), and scans import new or changed files
// into the media store. Unchanged files are recognised by path, size and
// modification time, so rescans do not re-hash large videos.
import { kvGet, kvSet } from './db';
import { storeBlob } from './media';

type Permission = 'granted' | 'denied' | 'prompt';
interface DirectoryHandle {
  kind: 'directory';
  name: string;
  values(): AsyncIterable<DirectoryHandle | FileHandle>;
  queryPermission?(options: { mode: 'read' }): Promise<Permission>;
  requestPermission?(options: { mode: 'read' }): Promise<Permission>;
}
interface FileHandle { kind: 'file'; name: string; getFile(): Promise<File> }

const picker = (window as unknown as { showDirectoryPicker?: (options?: object) => Promise<DirectoryHandle> }).showDirectoryPicker;
const IMAGE = /\.(png|jpe?g|webp|gif|bmp|svg|avif)$/i;
const VIDEO = /\.(mp4|webm|mov|m4v|mkv|ogv)$/i;
const MAX_FILES = 2000;

const handleKey = (path: string) => `media-folder:${path}`;
const scanKey = (path: string) => `media-folder-scan:${path}`;
const INDEX = 'media-folder-index';

export const supportsFolders = () => typeof picker === 'function';

export async function selectMediaFolder(): Promise<string | null> {
  if (!picker) return null;
  try {
    const handle = await picker({ id: 'wpa-media', mode: 'read' });
    await kvSet(handleKey(handle.name), handle);
    return handle.name;
  } catch {
    return null; // cancelled
  }
}

async function ensurePermission(handle: DirectoryHandle): Promise<boolean> {
  if (!handle.queryPermission) return true;
  if ((await handle.queryPermission({ mode: 'read' })) === 'granted') return true;
  // Only succeeds right after a click (for example "Rescan"); a startup scan falls back to the last result.
  try { return (await handle.requestPermission?.({ mode: 'read' })) === 'granted'; } catch { return false; }
}

async function* walk(dir: DirectoryHandle, recursive: boolean, prefix = ''): AsyncGenerator<{ path: string; handle: FileHandle }> {
  for await (const entry of dir.values()) {
    if (entry.kind === 'file') yield { path: `${prefix}${entry.name}`, handle: entry };
    else if (recursive) yield* walk(entry, true, `${prefix}${entry.name}/`);
  }
}

export async function readMediaFolder(
  path: string,
  options: { recursive?: boolean; includeImages?: boolean; includeVideos?: boolean } = {},
): Promise<{ paths: string[]; missing: boolean } | null> {
  const handle = await kvGet<DirectoryHandle>(handleKey(path));
  if (!handle) return { paths: [], missing: true };
  if (!(await ensurePermission(handle))) {
    const last = await kvGet<string[]>(scanKey(path));
    return { paths: last ?? [], missing: false };
  }
  const wantImages = options.includeImages !== false;
  const wantVideos = options.includeVideos !== false;
  const index = (await kvGet<Record<string, string>>(INDEX)) ?? {};
  const seen = new Set<string>();
  const paths: string[] = [];
  try {
    for await (const entry of walk(handle, !!options.recursive)) {
      if (paths.length >= MAX_FILES) break;
      const isImage = IMAGE.test(entry.path);
      const isVideo = VIDEO.test(entry.path);
      if (!(isImage && wantImages) && !(isVideo && wantVideos)) continue;
      const file = await entry.handle.getFile();
      const signature = `${path}/${entry.path}|${file.size}|${file.lastModified}`;
      let url = index[signature];
      if (!url) {
        url = await storeBlob(file, file.name);
        index[signature] = url;
      }
      seen.add(signature);
      paths.push(url);
    }
  } catch (error) {
    console.warn('[web folders] scan failed', error);
    return { paths: [], missing: true };
  }
  // Forget this folder's files that are gone or changed (only a full scan knows that).
  const prefix = `${path}/`;
  if (paths.length < MAX_FILES) for (const key of Object.keys(index)) if (key.startsWith(prefix) && !seen.has(key)) delete index[key];
  await kvSet(INDEX, index);
  await kvSet(scanKey(path), paths);
  return { paths, missing: false };
}
