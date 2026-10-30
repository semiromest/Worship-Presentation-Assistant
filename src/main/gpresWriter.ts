import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import * as zlib from 'node:zlib';
import { walkMediaStrings, normalizeLocalSourcePath, isEmbeddableUrl } from '../shared/mediaTree';
import { GPRES_FORMAT, GPRES_LIMITS, validateProject, type GpresFile, type GpresManifest } from '../shared/gpresFormat';
import { parsePresentation, readGpres } from './gpresReader';
import { ensureDiskSpace } from './atomicFile';

const deflateRaw = promisify(zlib.deflateRaw);
const STREAM_CHUNK = 256 * 1024;
/** Medya dosyaları ilk geçişte (özet + CRC) aynı anda en fazla bu kadar okunur. */
const INSPECT_CONCURRENCY = 4;
const DATA_URL_HEAD = /^data:image\/(png|jpeg|jpg|webp|gif|bmp);base64,/;
const BASE64_BODY = /^[A-Za-z0-9+/]*={0,2}$/;
const SAFE_EXT = /^[a-z0-9]{1,10}$/;
const MIME_BY_EXT: Readonly<Record<string, string>> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
  mp4: 'video/mp4', webm: 'video/webm', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg',
};
const mime = (ext: string) => MIME_BY_EXT[ext] ?? 'application/octet-stream';

// ─── CRC-32 ────────────────────────────────────────────────────────────────
// Yerel zlib.crc32 (Node 20.15+/22.2+) varsa o kullanılır; tablo yalnızca yedek olarak kurulur.
const nativeCrc = (zlib as unknown as { crc32?: (bytes: Buffer, value: number) => number }).crc32;
const crcTable = nativeCrc
  ? undefined
  : Uint32Array.from({ length: 256 }, (_, n) => {
      for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
      return n >>> 0;
    });
function crc(previous: number, bytes: Buffer): number {
  if (nativeCrc) return nativeCrc(bytes, previous);
  let c = previous ^ 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = crcTable![(c ^ bytes[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * `body` yazılacak baytlardır (JSON için sıkıştırılmış, satır içi görsel için ham). Yerel medyada boştur:
 * yazma sırasında diskten akıtılır, hiçbir zaman belleğe alınmaz.
 */
type Asset = GpresFile & { source?: string; body?: Buffer; method: 0 | 8; packed: number; crc: number };
type Measured = { size: number; sha256: string; crc: number };
type Outcome = { label: string; measured?: Measured; source?: string; error?: unknown };

async function inspect(source: string): Promise<Measured> {
  const hash = createHash('sha256');
  let size = 0, checksum = 0;
  for await (const part of createReadStream(source, { highWaterMark: STREAM_CHUNK })) {
    const chunk = part as Buffer;
    size += chunk.length;
    if (size > GPRES_LIMITS.entry) throw new Error('Media exceeds .gpres entry limit');
    hash.update(chunk);
    checksum = crc(checksum, chunk);
  }
  return { size, sha256: hash.digest('hex'), crc: checksum };
}

/** Görev hata fırlatmaz (sonucu kendisi taşır); bu yüzden hepsi biter ve sıra çağıranda korunur. */
async function mapLimit<T>(items: readonly T[], limit: number, task: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => { while (next < items.length) await task(items[next++]); };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

/** Yalnızca küçük başlık bir düzenli ifadeyle okunur; gövde dilimle doğrulanır (devasa dizge kopyalanmaz). */
function decodeDataUrl(ref: string): { bytes: Buffer; ext: string } {
  const head = DATA_URL_HEAD.exec(ref);
  const body = head ? ref.slice(head[0].length) : '';
  if (!head || !body || body.length > (GPRES_LIMITS.entry * 4) / 3 || !BASE64_BODY.test(body)) throw new Error('Invalid embedded image');
  const bytes = Buffer.from(body, 'base64');
  const canonicalBody = body.endsWith('=') ? body : body + '='.repeat((4 - body.length % 4) % 4);
  if (bytes.toString('base64') !== canonicalBody) throw new Error('Invalid embedded image');
  return { bytes, ext: head[1] === 'jpeg' ? 'jpg' : head[1] };
}

/** JSON belgeleri (manifest ve sunum) sıkıştırılır; sıkıştırma eşzamansız, böylece işçi süreci bloke olmaz. */
async function jsonAsset(name: string, bytes: Buffer, sha256: string): Promise<Asset> {
  const body = await deflateRaw(bytes);
  return { path: name, role: 'document', mime: 'application/json', size: bytes.length, sha256, crc: crc(0, bytes), body, method: 8, packed: body.length };
}

/** Two streaming passes: inventory/hash, then write and recheck. No media-sized
 * Buffer is retained or sent through Electron IPC. Caller owns atomic commit. */
export async function writeGpresFile(
  content: string,
  target: string,
  mediaDir: string
): Promise<{ embeddedCount: number; bytes: number }> {
  const data = parsePresentation(Buffer.from(content));
  validateProject(data);
  if (!data.id) data.id = randomUUID();

  // Belge tek geçişte taranır: yeniden yazılacak konumlar da burada toplanır (ikinci bir tarama gerekmez).
  const refs = new Set<string>(), external = new Set<string>();
  const locations: { parent: any; key: any; value: string }[] = [];
  walkMediaStrings(data, (value, parent, key) => {
    if (isEmbeddableUrl(value) || value.startsWith('data:image/')) {
      refs.add(value);
      locations.push({ parent, key, value });
    } else if (/^https?:\/\//.test(value)) external.add(value);
  });

  // ── 1. geçiş: yerel medya aynı anda okunup özetlenir (sıra, belgedeki ilk geçiş sırasıyla aynı kalır) ──
  const ordered = [...refs];
  const cache = new Map<string, Promise<Measured>>(); // aynı dosyaya farklı biçimde işaret eden iki başvuru tek kez okunur
  const outcomes = new Map<string, Outcome>();
  await mapLimit(ordered.filter(ref => !ref.startsWith('data:')), INSPECT_CONCURRENCY, async (ref) => {
    let source: string;
    try {
      source = normalizeLocalSourcePath(ref, mediaDir);
    } catch (error) {
      // Geçersiz bir başvuru kaydı çökertmez: eksik medya listesinde raporlanır.
      outcomes.set(ref, { label: ref.length > 60 ? `${ref.slice(0, 57)}...` : ref, error });
      return;
    }
    try {
      if (!(await fs.stat(source)).isFile()) throw new Error('Not a file');
      let measuring = cache.get(source);
      if (!measuring) { measuring = inspect(source); cache.set(source, measuring); }
      outcomes.set(ref, { label: path.basename(source), source, measured: await measuring });
    } catch (error) {
      outcomes.set(ref, { label: path.basename(source), error });
    }
  });

  const assets: Asset[] = [], mapped = new Map<string, string>(), unique = new Map<string, Asset>(), missing: string[] = [];
  for (const ref of ordered) {
    if (ref.startsWith('data:')) {
      const { bytes, ext } = decodeDataUrl(ref);
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      let asset = unique.get(sha256);
      if (!asset) {
        asset = { path: `media/${sha256}.${ext}`, role: 'media', mime: mime(ext), size: bytes.length, sha256, crc: crc(0, bytes), body: bytes, method: 0, packed: bytes.length };
        unique.set(sha256, asset);
        assets.push(asset);
      }
      mapped.set(ref, asset.path);
      continue;
    }
    const outcome = outcomes.get(ref)!;
    if (outcome.error !== undefined) { missing.push(`${outcome.label}: ${String(outcome.error)}`); continue; }
    const { measured, source } = outcome as Required<Pick<Outcome, 'measured' | 'source'>>;
    let asset = unique.get(measured.sha256);
    if (!asset) {
      const ext = path.extname(source).slice(1).toLowerCase();
      const safeExt = SAFE_EXT.test(ext) ? ext : 'bin';
      asset = { ...measured, path: `media/${measured.sha256}.${safeExt}`, role: 'media', mime: mime(safeExt), source, method: 0, packed: measured.size };
      unique.set(measured.sha256, asset);
      assets.push(asset);
    }
    mapped.set(ref, asset.path);
  }
  if (missing.length)
    throw new Error(`GPRES_MISSING_MEDIA\n${missing.slice(0, 20).join('\n')}${missing.length > 20 ? '\n…' : ''}`);
  for (const { parent, key, value } of locations) parent[key] = mapped.get(value);

  const documentBytes = Buffer.from(JSON.stringify(data));
  if (documentBytes.length > GPRES_LIMITS.json) throw new Error('Project JSON exceeds limit'); // özet/CRC/sıkıştırmadan önce elenir
  const doc = await jsonAsset('presentation.json', documentBytes, createHash('sha256').update(documentBytes).digest('hex'));
  assets.unshift(doc);

  const manifest: GpresManifest = {
    format: GPRES_FORMAT,
    containerVersion: 1,
    documentSchemaVersion: 1,
    minimumReaderVersion: 1,
    documentId: data.id,
    revision: randomUUID(),
    savedAt: new Date().toISOString(),
    producer: 'Worship Presentation Assistant',
    files: assets.map(({ path: name, size, sha256, role, mime: type }) => ({ path: name, size, sha256, role, mime: type })),
    externalDependencies: [...external],
  };
  const manifestBytes = Buffer.from(JSON.stringify(manifest));
  assets.unshift(await jsonAsset('manifest.json', manifestBytes, ''));

  let total = 0, upper = 0;
  for (const a of assets) {
    total += a.size;
    upper += Math.max(a.size, a.packed) + 200 + Buffer.byteLength(a.path) * 2;
  }
  if (assets.length > GPRES_LIMITS.entries || total > GPRES_LIMITS.total || upper > GPRES_LIMITS.archive || manifestBytes.length > GPRES_LIMITS.json)
    throw new Error('Project exceeds .gpres size/count limits');
  await ensureDiskSpace(path.dirname(target), upper);

  // ── 2. geçiş: yazma. Her girdi için başlık+ad tek yazımda; medya diskten akıtılır. ──
  const file = await fs.open(target, 'wx', 0o600);
  let offset = 0, success = false;
  const central: Buffer[] = [];
  async function write(bytes: Buffer) {
    if (offset + bytes.length > GPRES_LIMITS.archive) throw new Error('Project archive exceeds limit');
    let done = 0;
    while (done < bytes.length) {
      const result = await file.write(bytes, done, bytes.length - done, offset);
      if (!result.bytesWritten) throw new Error('Incomplete project write');
      done += result.bytesWritten;
      offset += result.bytesWritten;
    }
  }
  try {
    for (const a of assets) {
      const name = Buffer.from(a.path);
      const start = offset;
      const local = Buffer.alloc(30 + name.length);
      local.writeUInt32LE(0x04034b50);
      local.writeUInt16LE(20, 4);
      local.writeUInt16LE(0x800, 6);
      local.writeUInt16LE(a.method, 8);
      local.writeUInt32LE(a.crc, 14);
      local.writeUInt32LE(a.packed, 18);
      local.writeUInt32LE(a.size, 22);
      local.writeUInt16LE(name.length, 26);
      name.copy(local, 30);
      await write(local);
      if (a.body) {
        await write(a.body);
        a.body = undefined; // yazılan bayt belleği hemen bırakılır (satır içi görseller kalıcı tutulmaz)
      } else {
        // Medya zaten sıkıştırılmış biçimde: olduğu gibi akıtılır. İlk geçişteki boyut ve CRC ile karşılaştırılır;
        // SHA-256 burada yeniden hesaplanmaz, yazılan arşivin son doğrulaması (aşağıda) her şeyi yeniden denetler.
        let size = 0, checksum = 0;
        for await (const part of createReadStream(a.source!, { highWaterMark: STREAM_CHUNK })) {
          const chunk = part as Buffer;
          size += chunk.length;
          if (size > a.size) throw new Error('Media changed during save');
          checksum = crc(checksum, chunk);
          await write(chunk);
        }
        if (size !== a.size || checksum !== a.crc) throw new Error('Media changed during save');
      }
      const entry = Buffer.alloc(46 + name.length);
      entry.writeUInt32LE(0x02014b50);
      entry.writeUInt16LE(20, 4);
      entry.writeUInt16LE(20, 6);
      entry.writeUInt16LE(0x800, 8);
      entry.writeUInt16LE(a.method, 10);
      entry.writeUInt32LE(a.crc, 16);
      entry.writeUInt32LE(a.packed, 20);
      entry.writeUInt32LE(a.size, 24);
      entry.writeUInt16LE(name.length, 28);
      entry.writeUInt32LE(start, 42);
      name.copy(entry, 46);
      central.push(entry);
    }
    // Merkezi dizin ve bitiş kaydı tek yazımda.
    const start = offset;
    const directory = Buffer.concat(central);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50);
    end.writeUInt16LE(assets.length, 8);
    end.writeUInt16LE(assets.length, 10);
    end.writeUInt32LE(directory.length, 12);
    end.writeUInt32LE(start, 16);
    await write(Buffer.concat([directory, end]));
    await file.sync();
    await file.close();
    await readGpres(target, mediaDir, GPRES_LIMITS, { validateOnly: true });
    success = true;
    return { embeddedCount: assets.length - 2, bytes: offset };
  } finally {
    await file.close().catch(() => {});
    if (!success) await fs.unlink(target).catch(() => {});
  }
}
