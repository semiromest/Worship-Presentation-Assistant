import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { isYouTubeVideoId, type OfflineMusicStatus } from '../shared/youtubeMusic';

export interface DownloadAudio {
  audio: ReadableStream<Uint8Array>;
  mimeType: string;
  finished: () => boolean;
  abort: () => void;
}

type Extension = 'webm' | 'mp4';
interface Manifest { version: 1; extension: Extension; bytes: number; file: string }
interface Job { controller: AbortController; promise: Promise<OfflineMusicStatus> }

const DEFAULT_LIMIT_BYTES = 512 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 15 * 60 * 1000;
// fs write stream varsayılanı 16 KiB; büyük dosyalarda ağ okuması ile disk yazması daha az bekler.
const WRITE_BUFFER_BYTES = 256 * 1024;
const TOKEN_HEX_LENGTH = 32; // randomBytes(16) -> 32 hex karakter
const TOKEN_RE = /^[a-f0-9]{32}$/;
const PASSTHROUGH_ERRORS: ReadonlySet<string> = new Set(['too-large', 'unsupported-format', 'incomplete']);

const isExtension = (value: unknown): value is Extension => value === 'webm' || value === 'mp4';

/** `<id>-<32 hex>.<ext>` biçimini doğrular. Her çağrıda id'den RegExp üretmez. */
function isCacheFileName(name: unknown, id: string, extension: Extension): name is string {
  if (typeof name !== 'string') return false;
  const prefix = `${id}-`;
  const suffix = `.${extension}`;
  return name.length === prefix.length + TOKEN_HEX_LENGTH + suffix.length
    && name.startsWith(prefix)
    && name.endsWith(suffix)
    && TOKEN_RE.test(name.slice(prefix.length, prefix.length + TOKEN_HEX_LENGTH));
}

function extensionFor(mimeType: string): Extension | null {
  return mimeType.includes('webm') ? 'webm' : mimeType.includes('mp4') ? 'mp4' : null;
}

function safeAbort(audio: DownloadAudio | undefined): void {
  try { audio?.abort(); } catch { /* Already closed. */ }
}

function toErrorCode(error: unknown, cancelled: boolean): string {
  if (cancelled) return 'cancelled';
  return error instanceof Error && PASSTHROUGH_ERRORS.has(error.message) ? error.message : 'download-failed';
}

/** Profile-local files; the manifest is published only after a complete stream is written. */
export class OfflineMusicCache {
  private readonly jobs = new Map<string, Job>();
  private closed = false;

  constructor(
    private readonly directory: string,
    private readonly source: (id: string, cancelled: () => boolean) => Promise<DownloadAudio>,
    private readonly limitBytes = DEFAULT_LIMIT_BYTES,
  ) {}

  private manifestPath(id: string): string {
    return path.join(this.directory, `${id}.json`);
  }

  async file(id: string): Promise<string | null> {
    if (!isYouTubeVideoId(id)) return null;
    try {
      const record = JSON.parse(await fs.readFile(this.manifestPath(id), 'utf8'));
      if (
        record.version !== 1
        || !isExtension(record.extension)
        || !Number.isSafeInteger(record.bytes) || record.bytes <= 0
        || !isCacheFileName(record.file, id, record.extension)
      ) return null;
      const file = path.join(this.directory, record.file);
      const stat = await fs.stat(file);
      return stat.isFile() && stat.size === record.bytes ? file : null;
    } catch { return null; }
  }

  async status(id: unknown): Promise<OfflineMusicStatus> {
    if (!isYouTubeVideoId(id)) return { state: 'error', error: 'invalid-video' };
    if (this.jobs.has(id)) return { state: 'downloading' };
    return { state: await this.file(id) ? 'ready' : 'missing' };
  }

  async download(id: unknown): Promise<OfflineMusicStatus> {
    if (this.closed || !isYouTubeVideoId(id)) return { state: 'error', error: 'unavailable' };
    const existing = this.jobs.get(id);
    if (existing) return existing.promise;
    if (await this.file(id)) return { state: 'ready' };
    // Recheck after disk lookup so simultaneous requests share one writer.
    const raced = this.jobs.get(id);
    if (raced) return raced.promise;
    if (this.closed) return { state: 'error', error: 'unavailable' };
    if (this.jobs.size) return { state: 'error', error: 'busy' };

    const controller = new AbortController();
    // finally geri çağrısı her zaman en az bir microtask sonra çalışır; o anda `job` tanımlıdır.
    // Böylece yer tutucu bir Promise oluşturup sonradan ezmeye gerek kalmıyor.
    const promise = this.write(id, controller).finally(() => {
      if (this.jobs.get(id) === job) this.jobs.delete(id);
    });
    const job: Job = { controller, promise };
    this.jobs.set(id, job);
    return promise;
  }

  /** Kaynak kurulumu bitmese bile iptal hemen sonuçlanır; geç gelen kaynak yazıcıya dönüşmeden kapatılır. */
  private openSource(id: string, signal: AbortSignal): Promise<DownloadAudio> {
    const cancelled = () => signal.aborted || this.closed;
    return new Promise<DownloadAudio>((resolve, reject) => {
      const onAbort = () => reject(new Error('cancelled'));
      signal.addEventListener('abort', onAbort, { once: true });
      this.source(id, cancelled).then(
        value => {
          signal.removeEventListener('abort', onAbort);
          if (cancelled()) {
            safeAbort(value);
            reject(new Error('cancelled'));
          } else resolve(value);
        },
        error => {
          signal.removeEventListener('abort', onAbort);
          reject(error);
        },
      );
    });
  }

  private async write(id: string, controller: AbortController): Promise<OfflineMusicStatus> {
    const { signal } = controller;
    const cancelled = () => signal.aborted || this.closed;
    const token = randomBytes(16).toString('hex');
    const partial = path.join(this.directory, `${id}-${token}.part`);
    const manifestPart = path.join(this.directory, `${id}-${token}.json.part`);
    let source: DownloadAudio | undefined;
    let final: string | undefined;
    let committed = false;

    const timeout = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
    const abortSource = () => safeAbort(source);
    signal.addEventListener('abort', abortSource, { once: true });

    try {
      await fs.mkdir(this.directory, { recursive: true });
      if (cancelled()) throw new Error('cancelled');

      source = await this.openSource(id, signal);
      if (cancelled()) throw new Error('cancelled');

      const extension = extensionFor(source.mimeType);
      if (!extension) throw new Error('unsupported-format');

      let bytes = 0;
      const limiter = new Transform({
        transform: (chunk, _encoding, done) => {
          bytes += chunk.length;
          done(bytes > this.limitBytes ? new Error('too-large') : null, chunk);
        },
      });
      await pipeline(
        Readable.fromWeb(source.audio as Parameters<typeof Readable.fromWeb>[0]),
        limiter,
        createWriteStream(partial, { flags: 'w', highWaterMark: WRITE_BUFFER_BYTES }),
        { signal },
      );
      if (!bytes || !source.finished() || cancelled()) throw new Error('incomplete');

      const file = `${id}-${token}.${extension}`;
      final = path.join(this.directory, file);
      await fs.rename(partial, final);
      const manifest: Manifest = { version: 1, extension, bytes, file };
      await fs.writeFile(manifestPart, JSON.stringify(manifest));
      if (cancelled()) throw new Error('cancelled');
      await fs.rename(manifestPart, this.manifestPath(id));
      committed = true;
      return { state: 'ready' };
    } catch (error) {
      return { state: 'error', error: toErrorCode(error, cancelled()) };
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener('abort', abortSource);
      abortSource();
      // Başarıda üç yol da zaten rename edilmiş durumda; boşuna rm çağrısı yapma.
      if (!committed) {
        await Promise.all(
          [partial, manifestPart, final]
            .filter((file): file is string => Boolean(file))
            .map(file => fs.rm(file, { force: true }).catch(() => {})),
        );
      }
    }
  }

  cancel(id: unknown): void { if (isYouTubeVideoId(id)) this.jobs.get(id)?.controller.abort(); }
  dispose(): void { this.closed = true; for (const job of this.jobs.values()) job.controller.abort(); }
}