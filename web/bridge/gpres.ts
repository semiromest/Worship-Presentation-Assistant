// Browser implementation of the `.gpres` project package (ZIP). It writes the
// same layout as src/main/gpresWriter.ts (manifest.json + presentation.json,
// deflated; media/<sha256>.<ext>, stored) so files move freely between the web
// app and the desktop app. Legacy plain-JSON projects are still accepted.
import { GPRES_FORMAT, GPRES_LIMITS, validateManifest, validateProject, type GpresFile, type GpresManifest } from '../../src/shared/gpresFormat';
import { MIME_BY_EXT, mediaKeyOf, storeBlob, toHex } from './media';
import { mediaGet } from './db';

const MEDIA_KEYS = new Set(['mediaUrl', 'thumbnailUrl', 'backgroundImage', 'backgroundVideo']);
const MEDIA_PATH = /^media\/([a-f0-9]{64})\.([a-z0-9]{1,10})$/;
type Bytes = Uint8Array<ArrayBuffer>;
const encoder = new TextEncoder();

// ─── helpers ───────────────────────────────────────────────────────────────

const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function crc32(bytes: Bytes): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = crcTable[(crc ^ bytes[i]) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

async function transform(bytes: Bytes, stream: CompressionStream | DecompressionStream): Promise<Bytes> {
  const output = new Blob([bytes]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(output).arrayBuffer());
}
const deflate = (bytes: Bytes) => transform(bytes, new CompressionStream('deflate-raw'));
const inflate = (bytes: Bytes) => transform(bytes, new DecompressionStream('deflate-raw'));
const sha256 = async (bytes: Bytes) => toHex(await crypto.subtle.digest('SHA-256', bytes));

/** Visits every media-bearing string (mediaUrl, thumbnailUrl, backgroundImage, backgroundVideo). */
function walkMedia(node: unknown, visit: (value: string, parent: any, key: string) => void): void {
  const pending: unknown[] = [node];
  while (pending.length) {
    const value = pending.pop();
    if (!value || typeof value !== 'object') continue;
    for (const key of Object.keys(value)) {
      const child = (value as any)[key];
      if (typeof child === 'string' && MEDIA_KEYS.has(key)) visit(child, value, key);
      else if (child && typeof child === 'object') pending.push(child);
    }
  }
}

// ─── write ─────────────────────────────────────────────────────────────────

interface Asset { path: string; role: 'document' | 'media'; mime: string; size: number; sha256: string; crc: number; method: 0 | 8; body: Bytes }

export class MissingMediaError extends Error {
  constructor(readonly items: string[]) { super(`Missing media:\n${items.join('\n')}`); }
}

const labelOf = (ref: string) => {
  const hash = ref.indexOf('#');
  const name = hash >= 0 ? decodeURIComponent(ref.slice(hash + 1)) : ref.split(/[\\/]/).pop() ?? ref;
  return name.length > 60 ? `${name.slice(0, 57)}...` : name;
};

async function mediaAsset(ref: string): Promise<Asset | 'external' | null> {
  if (/^https?:\/\//.test(ref) && !mediaKeyOf(ref)) return 'external';
  let blob: Blob | null = null;
  let ext = 'bin';
  const key = mediaKeyOf(ref);
  if (key) {
    const record = await mediaGet(key);
    if (!record) return null;
    blob = record.blob;
    ext = key.split('.')[1];
  } else if (/^(data:image\/|blob:)/.test(ref)) {
    try { blob = await (await fetch(ref)).blob(); } catch { return null; }
    const subtype = blob.type.split('/')[1]?.replace('jpeg', 'jpg').replace('svg+xml', 'svg') ?? '';
    ext = /^[a-z0-9]{1,10}$/.test(subtype) ? subtype : 'bin';
  } else {
    return null; // desktop file paths and other unreachable references
  }
  const body = new Uint8Array(await blob.arrayBuffer());
  if (body.length > GPRES_LIMITS.entry) throw new Error('Media exceeds .gpres entry limit');
  const hash = await sha256(body);
  return { path: `media/${hash}.${ext}`, role: 'media', mime: MIME_BY_EXT[ext] ?? 'application/octet-stream', size: body.length, sha256: hash, crc: crc32(body), method: 0, body };
}

async function jsonAsset(path: string, bytes: Bytes, hash: string): Promise<Asset> {
  return { path, role: 'document', mime: 'application/json', size: bytes.length, sha256: hash, crc: crc32(bytes), method: 8, body: await deflate(bytes) };
}

/** Builds a `.gpres` archive from the renderer's presentation JSON. */
export async function writeGpres(content: string): Promise<Blob> {
  const data = JSON.parse(content);
  validateProject(data);
  if (!data.id) data.id = crypto.randomUUID();

  const locations: { parent: any; key: string; value: string }[] = [];
  walkMedia(data, (value, parent, key) => { if (value) locations.push({ parent, key, value }); });

  const byRef = new Map<string, Asset | 'external' | null>();
  for (const { value } of locations) if (!byRef.has(value)) byRef.set(value, await mediaAsset(value));

  const assets: Asset[] = [];
  const unique = new Map<string, Asset>();
  const external = new Set<string>();
  const missing: string[] = [];
  for (const [ref, asset] of byRef) {
    if (asset === 'external') { external.add(ref); continue; }
    if (!asset) { missing.push(labelOf(ref)); continue; }
    if (!unique.has(asset.sha256)) { unique.set(asset.sha256, asset); assets.push(asset); }
  }
  if (missing.length) throw new MissingMediaError([...new Set(missing)].slice(0, 20));
  for (const { parent, key, value } of locations) {
    const asset = byRef.get(value);
    if (asset && asset !== 'external') parent[key] = unique.get(asset.sha256)!.path;
  }

  const documentBytes = encoder.encode(JSON.stringify(data));
  if (documentBytes.length > GPRES_LIMITS.json) throw new Error('Project JSON exceeds limit');
  assets.unshift(await jsonAsset('presentation.json', documentBytes, await sha256(documentBytes)));

  const manifest: GpresManifest = {
    format: GPRES_FORMAT,
    containerVersion: 1,
    documentSchemaVersion: 1,
    minimumReaderVersion: 1,
    documentId: data.id,
    revision: crypto.randomUUID(),
    savedAt: new Date().toISOString(),
    producer: 'Worship Presentation Assistant (web)',
    files: assets.map(({ path, size, sha256: hash, role, mime }): GpresFile => ({ path, size, sha256: hash, role, mime })),
    externalDependencies: [...external],
  };
  assets.unshift(await jsonAsset('manifest.json', encoder.encode(JSON.stringify(manifest)), ''));
  if (assets.length > GPRES_LIMITS.entries) throw new Error('Project exceeds .gpres entry limit');

  const parts: BlobPart[] = [];
  const central: Bytes[] = [];
  let offset = 0;
  for (const asset of assets) {
    const name = encoder.encode(asset.path);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x800, true);
    local.setUint16(8, asset.method, true);
    local.setUint32(14, asset.crc, true);
    local.setUint32(18, asset.body.length, true);
    local.setUint32(22, asset.size, true);
    local.setUint16(26, name.length, true);
    parts.push(local.buffer, name, asset.body);

    const entry = new Uint8Array(46 + name.length);
    const view = new DataView(entry.buffer);
    view.setUint32(0, 0x02014b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 20, true);
    view.setUint16(8, 0x800, true);
    view.setUint16(10, asset.method, true);
    view.setUint32(16, asset.crc, true);
    view.setUint32(20, asset.body.length, true);
    view.setUint32(24, asset.size, true);
    view.setUint16(28, name.length, true);
    view.setUint32(42, offset, true);
    entry.set(name, 46);
    central.push(entry);
    offset += 30 + name.length + asset.body.length;
  }
  const directorySize = central.reduce((sum, entry) => sum + entry.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, assets.length, true);
  end.setUint16(10, assets.length, true);
  end.setUint32(12, directorySize, true);
  end.setUint32(16, offset, true);
  if (offset + directorySize + 22 > GPRES_LIMITS.archive) throw new Error('Project archive exceeds limit');
  return new Blob([...parts, ...central, end.buffer], { type: 'application/octet-stream' });
}

// ─── read ──────────────────────────────────────────────────────────────────

interface ZipEntry { name: string; method: number; crc: number; size: number; packed: number; offset: number }

function readDirectory(bytes: Bytes): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Invalid .gpres: missing ZIP directory');
  const count = view.getUint16(eocd + 10, true);
  let at = view.getUint32(eocd + 16, true);
  if (count > GPRES_LIMITS.entries) throw new Error('Invalid .gpres: too many entries');
  const decoder = new TextDecoder();
  const entries: ZipEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (at + 46 > bytes.length || view.getUint32(at, true) !== 0x02014b50) throw new Error('Invalid .gpres: corrupt directory');
    const nameLength = view.getUint16(at + 28, true);
    const extra = view.getUint16(at + 30, true);
    const comment = view.getUint16(at + 32, true);
    entries.push({
      name: decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength)),
      method: view.getUint16(at + 10, true),
      crc: view.getUint32(at + 16, true),
      packed: view.getUint32(at + 20, true),
      size: view.getUint32(at + 24, true),
      offset: view.getUint32(at + 42, true),
    });
    at += 46 + nameLength + extra + comment;
  }
  return entries;
}

async function readEntry(bytes: Bytes, entry: ZipEntry): Promise<Bytes> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const at = entry.offset;
  if (at + 30 > bytes.length || view.getUint32(at, true) !== 0x04034b50) throw new Error('Invalid .gpres: corrupt entry');
  const start = at + 30 + view.getUint16(at + 26, true) + view.getUint16(at + 28, true);
  const raw = bytes.subarray(start, start + entry.packed);
  if (raw.length !== entry.packed) throw new Error('Invalid .gpres: truncated entry');
  const data = entry.method === 0 ? raw : entry.method === 8 ? await inflate(raw) : null;
  if (!data) throw new Error('Invalid .gpres: unsupported compression');
  if (data.length !== entry.size || crc32(data) !== entry.crc) throw new Error('Invalid .gpres: checksum mismatch');
  return data;
}

/** Reads a `.gpres` (ZIP or legacy JSON), imports its media and returns presentation JSON with web media URLs. */
export async function readGpres(file: Blob): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const first = bytes.findIndex(b => b !== 0x20 && b !== 0x0a && b !== 0x0d && b !== 0x09 && b !== 0xef && b !== 0xbb && b !== 0xbf);
  if (bytes[first] === 0x7b /* { */) {
    const data = JSON.parse(new TextDecoder().decode(bytes)); // TextDecoder drops a leading BOM
    if (!data || !Array.isArray(data.slides)) throw new Error('Invalid project: presentation must contain slides');
    return JSON.stringify(data);
  }
  const entries = readDirectory(bytes);
  const byName = new Map(entries.map(entry => [entry.name, entry]));
  const manifestEntry = byName.get('manifest.json');
  const documentEntry = byName.get('presentation.json');
  if (!manifestEntry || !documentEntry) throw new Error('Invalid .gpres: missing manifest or document');
  const decoder = new TextDecoder();
  const manifest = validateManifest(JSON.parse(decoder.decode(await readEntry(bytes, manifestEntry))));
  const documentBytes = await readEntry(bytes, documentEntry);
  const documentInfo = manifest.files.find(f => f.path === 'presentation.json')!;
  if ((await sha256(documentBytes)) !== documentInfo.sha256) throw new Error('Invalid .gpres: document hash mismatch');
  const data = JSON.parse(decoder.decode(documentBytes));
  validateProject(data);

  const urls = new Map<string, string>();
  for (const info of manifest.files) {
    if (info.role !== 'media') continue;
    const entry = byName.get(info.path);
    const match = MEDIA_PATH.exec(info.path);
    if (!entry || !match) throw new Error(`Invalid .gpres: missing ${info.path}`);
    const body = await readEntry(bytes, entry);
    if ((await sha256(body)) !== info.sha256) throw new Error('Invalid .gpres: media hash mismatch');
    const url = await storeBlob(new Blob([body], { type: info.mime }), `${match[1].slice(0, 12)}.${match[2]}`, match[1]);
    urls.set(info.path, url.split('#')[0]);
  }
  walkMedia(data, (value, parent, key) => {
    if (value.startsWith('media/')) {
      const url = urls.get(value);
      if (!url) throw new Error('Invalid .gpres: missing media reference');
      parent[key] = url;
    }
  });
  return JSON.stringify(data);
}
