import fs from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import { Readable, Transform, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import * as zlib from 'node:zlib';
import { createHash, randomUUID } from 'node:crypto';
import { walkStrings, walkMediaStrings, isEmbeddableUrl, MEDIA_REF_PREFIX } from '../shared/mediaTree';
import { GPRES_LIMITS, validateManifest, validateProject } from '../shared/gpresFormat';
export { GPRES_LIMITS } from '../shared/gpresFormat';

type Limits = typeof GPRES_LIMITS;
interface Entry {
  name: string;
  nameBytes: Buffer;
  flags: number;
  method: number;
  crc: number;
  size: number;
  packed: number;
  offset: number;
  directory: boolean;
  start: number;
}
type Kind = 'json' | 'media' | 'other';
type Reader = (offset: number, size: number) => Promise<Buffer>;

const ZIP_LOCAL = 0x04034b50;
const ZIP_CENTRAL = 0x02014b50;
const ZIP_EOCD = 0x06054b50;
const EOCD_SIZE = 22;
const MAX_EOCD_SEARCH = EOCD_SIZE + 0xffff; // EOCD + en uzun ZIP açıklaması
const MAX_CENTRAL_SIZE = 16 * 1024 ** 2;
const MAX_NAME_LENGTH = 4096;
const STREAM_CHUNK = 256 * 1024;
/** Yerel başlıklar dosyadan okunurken eşzamanlı okuma sayısı. */
const HEADER_CONCURRENCY = 32;
/** Aynı anda açılan medya girdisi. Her biri sınırlı tampon tutar; zlib iş parçacıklarında çalışır. */
const MEDIA_CONCURRENCY = 3;
const STAGING_PREFIX = '.gpres-import-';

// Her çağrıda yeniden derlenmesin diye modül düzeyinde.
// eslint-disable-next-line no-control-regex -- ZIP entry names must reject control bytes.
const UNSAFE_NAME_CHARS = /[\\:\x00-\x1f]/;
const NESTED_ARCHIVE_EXT = /\.(zip|gpres|pptx|jar|7z|rar)$/i;
const SAFE_MEDIA_EXT = /^\.[a-z0-9]{1,10}$/;
const IMAGE_DATA_URL_HEAD = /^data:image\/(png|jpe?g|webp|gif|bmp);base64,/;
const BASE64_BODY = /^[A-Za-z0-9+/]*={0,2}$/;
const UNSAFE_JSON_KEYS: ReadonlySet<string> = new Set(['__proto__', 'prototype', 'constructor']);
/** Sabit bağ desteklenmeyen dosya sistemlerinde (FAT/exFAT, bazı ağ sürücüleri) görülen kodlar. */
const LINK_UNSUPPORTED: ReadonlySet<string> = new Set(['EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'ENOSYS', 'EXDEV', 'EMLINK']);

// ─── CRC-32 ────────────────────────────────────────────────────────────────
// Yerel zlib.crc32 (Node 20.15+/22.2+) varsa kullanılır; yoksa tablo yöntemi.
const nativeCrc32 = (zlib as unknown as { crc32?: (data: Uint8Array, value?: number) => number }).crc32;
const crcTable = nativeCrc32
  ? undefined
  : Uint32Array.from({ length: 256 }, (_, n) => {
      for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
      return n >>> 0;
    });

/** `previous` bitmiş bir CRC değeridir (başlangıç 0); parçalar zincirleme eklenebilir. */
function crc32(previous: number, chunk: Uint8Array): number {
  if (nativeCrc32) return nativeCrc32(chunk, previous);
  let crc = previous ^ 0xffffffff;
  for (let i = 0; i < chunk.length; i++) crc = crcTable![(crc ^ chunk[i]) & 255] ^ (crc >>> 8); // for-of yerine indeks: Buffer yineleyicisi yavaş
  return (crc ^ 0xffffffff) >>> 0;
}

function fail(message: string): never { throw new Error(`Invalid .gpres: ${message}`); }

/** Sıra korunur. İlk hatada yeni iş başlatılmaz, ama süren işler bitene kadar beklenir (temizlik güvenli olsun). */
async function mapLimit<T, R>(items: readonly T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  let failure: { error: unknown } | undefined;
  const worker = async () => {
    while (!failure) {
      const index = next++;
      if (index >= items.length) return;
      try {
        results[index] = await task(items[index]);
      } catch (error) {
        failure ??= { error };
        return;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  if (failure) throw failure.error;
  return results;
}

// ─── JSON ──────────────────────────────────────────────────────────────────

export function parsePresentation(bytes: Buffer, limits: Limits = GPRES_LIMITS): any {
  if (bytes.length > limits.json) fail('JSON size limit exceeded');
  let text = bytes.toString('utf8');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // Windows düzenleyicilerinin eklediği BOM
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    fail('malformed JSON');
  }
  if (!data || typeof data !== 'object' || Array.isArray(data) || !Array.isArray((data as any).slides)) fail('presentation must contain slides');
  for (const slide of (data as any).slides) {
    if (!slide || typeof slide !== 'object' || Array.isArray(slide)) fail('invalid slide');
    if (slide.loopItems !== undefined && (!Array.isArray(slide.loopItems) || slide.loopItems.some((item: unknown) => !item || typeof item !== 'object' || Array.isArray(item)))) fail('invalid loop items');
  }
  // Yinelemesiz gezinti: derinlik sınırı ve tehlikeli anahtarlar. Object.entries yerine indeks/anahtar listesi (ara dizi üretmez).
  const pending: [object, number][] = [[data as object, 0]];
  while (pending.length) {
    const [node, depth] = pending.pop()!;
    if (depth > limits.depth) fail('JSON depth limit exceeded');
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) {
        const child = node[i];
        if (child && typeof child === 'object') pending.push([child, depth + 1]);
      }
    } else {
      for (const key of Object.keys(node)) {
        if (UNSAFE_JSON_KEYS.has(key)) fail('unsafe JSON key');
        const child = (node as Record<string, unknown>)[key];
        if (child && typeof child === 'object') pending.push([child, depth + 1]);
      }
    }
  }
  return data;
}

// ─── Okuma ─────────────────────────────────────────────────────────────────

function createReader(source: string | Buffer, handle: FileHandle | null, length: number): Reader {
  return async (offset, size) => {
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(size) || offset < 0 || size < 0 || offset + size > length) fail('truncated archive');
    if (!handle) return (source as Buffer).subarray(offset, offset + size);
    const out = Buffer.allocUnsafe(size); // tamamı doldurulur ya da hata verilir
    let done = 0;
    while (done < size) {
      const { bytesRead } = await handle.read(out, done, size - done, offset + done);
      if (!bytesRead) fail('truncated archive');
      done += bytesRead;
    }
    return out;
  };
}

/**
 * Dosyadan konumlu okuma. `fs.createReadStream({ fd })` kullanılmaz: o akış yok edilince (hata yolunda) ortak
 * tanımlayıcıyı kapatır ve eşzamanlı okuyanlar, yeniden kullanılmış bir tanımlayıcıya düşebilirdi.
 */
async function* readRange(handle: FileHandle, start: number, length: number): AsyncGenerator<Buffer> {
  let offset = start;
  let remaining = length;
  while (remaining > 0) {
    const chunk = Buffer.allocUnsafe(Math.min(STREAM_CHUNK, remaining));
    const { bytesRead } = await handle.read(chunk, 0, chunk.length, offset);
    if (!bytesRead) fail('truncated archive');
    yield bytesRead === chunk.length ? chunk : chunk.subarray(0, bytesRead);
    offset += bytesRead;
    remaining -= bytesRead;
  }
}

// ─── ZIP dizini ────────────────────────────────────────────────────────────

function locateCentralDirectory(tail: Buffer, length: number, limits: Limits): { count: number; size: number; offset: number } {
  let eocd = -1;
  for (let i = tail.length - EOCD_SIZE; i >= 0; i--) {
    if (tail.readUInt32LE(i) === ZIP_EOCD && i + EOCD_SIZE + tail.readUInt16LE(i + 20) === tail.length) { eocd = i; break; }
  }
  if (eocd < 0) fail('missing ZIP directory');
  const count = tail.readUInt16LE(eocd + 10);
  const size = tail.readUInt32LE(eocd + 12);
  const offset = tail.readUInt32LE(eocd + 16);
  if (tail.readUInt16LE(eocd + 4) || tail.readUInt16LE(eocd + 6) || tail.readUInt16LE(eocd + 8) !== count) fail('multi-volume ZIP');
  if (count === 65535 || size === 0xffffffff || offset === 0xffffffff) fail('ZIP64 is unsupported');
  if (count > limits.entries || size > MAX_CENTRAL_SIZE) fail('ZIP directory limit exceeded');
  if (offset + size !== length - tail.length + eocd) fail('invalid ZIP directory bounds');
  return { count, size, offset };
}

/** Girdi adları hiçbir zaman dosya yolu olarak kullanılmaz; yine de güvensiz adlar baştan reddedilir. */
function parseCentralDirectory(central: Buffer, count: number, limits: Limits): Entry[] {
  const entries: Entry[] = [];
  const names = new Set<string>();
  let cursor = 0;
  let declaredTotal = 0;
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > central.length || central.readUInt32LE(cursor) !== ZIP_CENTRAL) fail('invalid ZIP entry');
    const nameLength = central.readUInt16LE(cursor + 28), extra = central.readUInt16LE(cursor + 30), comment = central.readUInt16LE(cursor + 32);
    if (cursor + 46 + nameLength + extra + comment > central.length || nameLength > MAX_NAME_LENGTH) fail('invalid entry name');
    const nameBytes = central.subarray(cursor + 46, cursor + 46 + nameLength);
    const name = nameBytes.toString('utf8');
    if (!name || !Buffer.from(name).equals(nameBytes) || UNSAFE_NAME_CHARS.test(name) || name.startsWith('/') || name.replace(/\/$/, '').split('/').some(p => p === '..' || p === '.' || p === '')) fail('unsafe entry path');
    const normalized = name.normalize('NFC').replace(/\/$/, '').toLowerCase();
    if (names.has(normalized)) fail('duplicate entry');
    names.add(normalized);
    const mode = central.readUInt32LE(cursor + 38) >>> 16;
    if ((mode & 0xf000) === 0xa000) fail('symbolic link entry');
    const entry: Entry = {
      name, nameBytes,
      flags: central.readUInt16LE(cursor + 8), method: central.readUInt16LE(cursor + 10), crc: central.readUInt32LE(cursor + 16),
      packed: central.readUInt32LE(cursor + 20), size: central.readUInt32LE(cursor + 24), offset: central.readUInt32LE(cursor + 42),
      directory: name.endsWith('/'), start: 0,
    };
    if (central.readUInt16LE(cursor + 34) || entry.flags & (1 | 32 | 64) || ![0, 8].includes(entry.method)) fail('unsupported or encrypted entry');
    if (entry.size > limits.entry || entry.name === 'presentation.json' && entry.size > limits.json) fail('entry size limit exceeded');
    if (entry.directory && (entry.size || entry.packed)) fail('nonempty directory');
    if (entry.method === 0 && entry.packed !== entry.size) fail('inconsistent stored size'); // sıkıştırılmamış girdide boyutlar eşit olmalı: okumadan elenir
    declaredTotal += entry.size;
    if (declaredTotal > limits.total) fail('expanded size limit exceeded');
    entries.push(entry);
    cursor += 46 + nameLength + extra + comment;
  }
  if (cursor !== central.length) fail('extra directory data');
  return entries;
}

/** Yerel başlık merkezi dizinle tutarlı mı ve verinin başlangıcı nerede? Tek okumayla (30 bayt + ad). */
async function validateLocalHeader(read: Reader, entry: Entry, centralOffset: number): Promise<void> {
  const nameLength = entry.nameBytes.length;
  const local = await read(entry.offset, 30 + nameLength);
  if (local.readUInt32LE(0) !== ZIP_LOCAL || local.readUInt16LE(6) !== entry.flags || local.readUInt16LE(8) !== entry.method) fail('inconsistent local header');
  const localNameLength = local.readUInt16LE(26), localExtra = local.readUInt16LE(28);
  if (localNameLength !== nameLength || !local.subarray(30, 30 + nameLength).equals(entry.nameBytes)) fail('inconsistent entry name');
  if (!(entry.flags & 8) && (local.readUInt32LE(14) !== entry.crc || local.readUInt32LE(18) !== entry.packed || local.readUInt32LE(22) !== entry.size)) fail('inconsistent entry size');
  entry.start = entry.offset + 30 + localNameLength + localExtra;
  if (entry.start + entry.packed > centralOffset) fail('entry overlaps directory');
}

// ─── Çıkarma ───────────────────────────────────────────────────────────────

interface ExtractContext {
  limits: Limits;
  staging: string;
  validateOnly?: boolean;
  /** Çıkarılmış toplam bayt (girdiler + satır içi görseller). */
  total: number;
  input: (entry: Entry) => Readable;
}

/** Şişirme gerçek bayt sayısıyla sınırlanır; ZIP içindeki boyut bilgilerine güvenilmez. */
async function extractEntry(ctx: ExtractContext, entry: Entry, kind: Kind): Promise<{ json?: Buffer; filename?: string; sha256: string }> {
  const { limits } = ctx;
  const ext = kind === 'media' ? path.posix.extname(entry.name).toLowerCase() : '';
  if (ext && !SAFE_MEDIA_EXT.test(ext)) fail('unsafe media extension'); // yazmadan önce elenir
  const hash = createHash('sha256');
  const chunks: Buffer[] = [];
  const temp = path.join(ctx.staging, randomUUID());
  let size = 0;
  let crc = 0;
  let head = Buffer.alloc(0);

  const meter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      size += chunk.length;
      ctx.total += chunk.length;
      if (size > entry.size || ctx.total > limits.total || kind === 'json' && size > limits.json) return callback(new Error('Invalid .gpres: expanded size limit exceeded'));
      if (kind !== 'json' && head.length < 2) {
        head = Buffer.concat([head, chunk.subarray(0, 2 - head.length)]);
        if (head.length === 2 && head[0] === 0x50 && head[1] === 0x4b) return callback(new Error('Invalid .gpres: nested archive'));
      }
      crc = crc32(crc, chunk);
      hash?.update(chunk);
      if (kind === 'json') chunks.push(chunk);
      callback(null, kind === 'media' ? chunk : undefined);
    },
  });
  const sink = kind === 'media' && !ctx.validateOnly
    ? createWriteStream(temp, { flags: 'wx', highWaterMark: STREAM_CHUNK })
    : new Writable({ write(_chunk, _encoding, callback) { callback(); } });

  if (entry.method === 8) {
    const inflater = zlib.createInflateRaw({ chunkSize: STREAM_CHUNK });
    await pipeline(ctx.input(entry), inflater, meter, sink);
    if (inflater.bytesWritten !== entry.packed) fail('inconsistent compressed size');
  } else {
    await pipeline(ctx.input(entry), meter, sink);
  }
  if (size !== entry.size || crc !== entry.crc) fail('size or CRC mismatch');

  const sha256 = hash.digest('hex');
  if (kind === 'json') return { json: Buffer.concat(chunks), sha256 };
  if (kind === 'media') {
    const filename = sha256 + (ext || '.bin');
    if (!ctx.validateOnly) await fs.rename(temp, path.join(ctx.staging, filename));
    return { filename, sha256 };
  }
  return { sha256 };
}

/** Satır içi `data:image/...` değerlerini ayrı dosyaya çıkarır; yalnızca küçük ön ek bir düzenli ifadeyle okunur. */
async function externalizeInlineImages(ctx: ExtractContext, urls: Iterable<string>, media: Map<string, string>): Promise<void> {
  const { limits } = ctx;
  const written = new Set<string>();
  await mapLimit([...urls], 4, async (url) => {
    const head = IMAGE_DATA_URL_HEAD.exec(url);
    if (!head) return;
    const payload = url.slice(head[0].length); // dilim: dizgi kopyalanmaz
    if (!payload || !BASE64_BODY.test(payload)) return;
    // Çözmeden önce üst sınır: devasa yükler için bellek ayrılmaz.
    if (Math.floor((payload.length * 3) / 4) > limits.entry) fail('inline image size limit exceeded');
    const bytes = Buffer.from(payload, 'base64');
    ctx.total += bytes.length;
    if (bytes.length > limits.entry || ctx.total > limits.total) fail('inline image size limit exceeded');
    const name = createHash('sha256').update(bytes).digest('hex').slice(0, 16) + '.' + (head[1] === 'jpeg' ? 'jpg' : head[1]);
    if (!written.has(name)) {
      written.add(name); // aynı içerik iki kez yazılmaz
      await fs.writeFile(path.join(ctx.staging, name), bytes);
    }
    media.set(url, name);
  });
}

/** Kitaplığa sabit bağla alır: varsa dokunmaz. Sabit bağ yoksa aynı birimde atomik taşır. */
async function promote(from: string, to: string): Promise<void> {
  try {
    await fs.link(from, to);
    return;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? '';
    if (code === 'EEXIST') return;
    if (!LINK_UNSUPPORTED.has(code)) throw error;
  }
  try {
    await fs.rename(from, to);
  } catch (error) {
    if (!(await fs.access(to).then(() => true, () => false))) throw error; // başka biri aynı dosyayı koymuşsa sorun yok
  }
}

// ─── Giriş noktası ─────────────────────────────────────────────────────────

/** No archive entry name is ever used as a filesystem destination. Inflation is
 * streamed and bounded by actual bytes, independently of untrusted ZIP sizes. */
export async function readGpres(source: string | Buffer, mediaDir: string, limits: Limits = GPRES_LIMITS, options: { validateOnly?: boolean } = {}): Promise<{ data: any; mediaCount: number }> {
  const handle = typeof source === 'string' ? await fs.open(source, 'r') : null;
  let staging: string | undefined;
  try {
    const length = handle ? (await handle.stat()).size : (source as Buffer).length; // stat hata verirse tutamaç yine kapanır
    const read = createReader(source, handle, length);
    if (length > limits.archive) fail('archive size limit exceeded');

    const signature = await read(0, Math.min(4, length));
    if (signature.length < 2 || signature.readUInt16LE(0) !== 0x4b50) {
      // Eski biçim: düz JSON
      if (length > limits.json) fail('JSON size limit exceeded');
      return { data: parsePresentation(await read(0, length), limits), mediaCount: 0 };
    }

    const tailSize = Math.min(length, MAX_EOCD_SEARCH);
    const directory = locateCentralDirectory(await read(length - tailSize, tailSize), length, limits);
    const entries = parseCentralDirectory(await read(directory.offset, directory.size), directory.count, limits);

    // Yerel başlıklar birbirinden bağımsız: dosyadan okunuyorsa eşzamanlı okunur (10.000 girdide art arda beklemek yavaştı).
    await mapLimit(entries, HEADER_CONCURRENCY, (entry) => validateLocalHeader(read, entry, directory.offset));
    const sorted = [...entries].sort((a, b) => a.offset - b.offset);
    for (let i = 1; i < sorted.length; i++) if (sorted[i].offset < sorted[i - 1].start + sorted[i - 1].packed) fail('overlapping entries');

    const files = entries.filter(e => !e.directory);
    const jsonEntry = files.find(e => e.name === 'presentation.json');
    if (!jsonEntry || files.filter(e => e.name === 'presentation.json').length !== 1) fail('missing presentation.json');
    for (const entry of files) if (NESTED_ARCHIVE_EXT.test(entry.name)) fail('nested archive'); // hiçbir şey çıkarılmadan önce

    if (!options.validateOnly) {
      await fs.mkdir(mediaDir, { recursive: true });
      staging = await fs.mkdtemp(path.join(mediaDir, STAGING_PREFIX));
    }
    const ctx: ExtractContext = {
      limits,
      staging: staging ?? '',
      validateOnly: options.validateOnly,
      total: 0,
      input: (entry) => {
        if (entry.packed === 0) return Readable.from([], { objectMode: false });
        if (handle) return Readable.from(readRange(handle, entry.start, entry.packed), { objectMode: false });
        return Readable.from([(source as Buffer).subarray(entry.start, entry.start + entry.packed)], { objectMode: false });
      },
    };

    // JSON önce: geçersiz bir belge medya çıkarmadan reddedilir.
    const manifestEntry = files.find(e => e.name === 'manifest.json');
    const manifest = manifestEntry ? validateManifest(JSON.parse((await extractEntry(ctx, manifestEntry, 'json')).json!.toString('utf8'))) : undefined;
    if (manifest) {
      const inventory = new Map(manifest.files.map(f => [f.path, f]));
      if (files.length !== inventory.size + 1 || files.some(e => e !== manifestEntry && inventory.get(e.name)?.size !== e.size)) fail('manifest inventory mismatch');
    }
    const document = await extractEntry(ctx, jsonEntry!, 'json');
    const data = parsePresentation(document.json!, limits);
    const expected = new Map(manifest?.files.map(f => [f.path, f]) ?? []);
    if (manifest) {
      if (expected.get('presentation.json')?.sha256 !== document.sha256) fail('document hash mismatch');
      validateProject(data);
      walkMediaStrings(data, value => {
        if (value.startsWith('media/')) { if (!expected.has(value)) fail('missing media reference'); }
        else if (isEmbeddableUrl(value) || value.startsWith('data:')) fail('unpackaged media reference');
      });
    }

    const media = new Map<string, string>();
    await mapLimit(files.filter(e => e !== jsonEntry && e !== manifestEntry), MEDIA_CONCURRENCY, async (entry) => {
      const { filename, sha256 } = await extractEntry(ctx, entry, entry.name.startsWith('media/') ? 'media' : 'other');
      if (manifest && expected.get(entry.name)?.sha256 !== sha256) fail('media hash mismatch');
      if (filename) media.set(entry.name, filename);
    });

    // Belge tek geçişte taranır: yalnızca medya adı ya da satır içi görsel olabilecek dizgilerin konumu toplanır.
    const refs: { parent: any; key: any; value: string }[] = [];
    const inline = new Set<string>();
    walkStrings(data, (value, parent, key) => {
      if (value.startsWith('data:image/')) inline.add(value);
      else if (!value.startsWith('media/')) return;
      refs.push({ parent, key, value });
    });
    if (options.validateOnly) return { data, mediaCount: media.size };
    await externalizeInlineImages(ctx, inline, media);

    await mapLimit([...new Set(media.values())], 8, (name) => promote(path.join(staging!, name), path.join(mediaDir, name)));
    for (const { parent, key, value } of refs) {
      const name = media.get(value);
      if (name) parent[key] = MEDIA_REF_PREFIX + name;
    }
    return { data, mediaCount: media.size };
  } finally {
    // Temizlik hataları (antivirüs kilidi gibi) başarılı bir içe aktarmayı ya da asıl hatayı örtmesin.
    await handle?.close().catch(() => {});
    if (staging) await fs.rm(staging, { recursive: true, force: true }).catch(() => {});
  }
}

/** Çökme ya da kapanma yüzünden yetim kalan hazırlık klasörlerini siler. Açılışta bir kez çağrılabilir. */
export async function sweepGpresStaging(mediaDir: string, maxAgeMs = 60 * 60 * 1000): Promise<void> {
  let names: string[];
  try {
    names = await fs.readdir(mediaDir);
  } catch {
    return;
  }
  const now = Date.now();
  await Promise.all(
    names
      .filter((name) => name.startsWith(STAGING_PREFIX))
      .map(async (name) => {
        const dir = path.join(mediaDir, name);
        try {
          const info = await fs.stat(dir);
          if (info.isDirectory() && now - info.mtimeMs > maxAgeMs) await fs.rm(dir, { recursive: true, force: true });
        } catch {
          /* başka bir süreç siliyor olabilir */
        }
      }),
  );
}
