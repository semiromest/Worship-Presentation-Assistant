import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const IS_WINDOWS = process.platform === 'win32';
const PARTIAL_NAME_RE = /^\.wpa-save-[0-9a-f-]{36}\.gpres\.partial$/;
const JOURNAL_NAME_RE = /^[0-9a-f-]{36}\.json$/;
const UNSUPPORTED_STATFS = new Set(['ENOSYS', 'ENOTSUP', 'EINVAL']);
/** Boş alan denetiminde, çıktı boyutunun %10'una ek olarak her zaman bırakılacak en az pay. */
const MIN_FREE_RESERVE = 256n * 1024n * 1024n;
/** Windows'ta antivirüs/dizinleyici yeniden adlandırmayı kısa süre kilitleyebilir (EPERM/EBUSY). */
const RENAME_RETRY_DELAYS_MS = [100, 250, 500] as const;
/** Yeni dosyaların izni (umask uygulanır). Önceki sürüm 0o600 kullanıyordu; eski davranış için 0o600 yap. */
const NEW_FILE_MODE = 0o666;
/** Hiçbir kayıt bu kadar sürmez: bundan eski günlüğün sahibi (pid yeniden kullanılmış olsa bile) ölü sayılır. */
const MAX_WRITE_AGE_MS = 24 * 60 * 60 * 1000;
/** Çözümlenemeyen/bozuk günlükler tanılama için bu süre saklanır, sonra silinir. */
const STALE_RECORD_MS = 30 * 24 * 60 * 60 * 1000;
/** PATH/çalışma dizini üzerinden değil, sistem klasöründen çalıştırılır. */
const ATTRIB_EXE = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'attrib.exe');

interface JournalRecord {
  target: string;
  partial: string;
  pid?: number;
}

/** Bu süreçte şu an yazılmakta olan günlük kimlikleri: kurtarma bunlara asla dokunmaz. */
const inFlight = new Set<string>();
let warnedStatfsUnsupported = false;

const ignoreMissing = (error: NodeJS.ErrnoException): void => {
  if (error.code !== 'ENOENT') throw error;
};

// ─── Boş alan denetimi ─────────────────────────────────────────────────────

export async function ensureDiskSpace(directory: string, outputUpperBound: number): Promise<void> {
  if (!Number.isFinite(outputUpperBound) || outputUpperBound < 0) throw new RangeError('Invalid output size');

  let free: bigint;
  try {
    const info = await fs.statfs(directory, { bigint: true });
    free = info.bavail * info.bsize;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? '';
    if (!UNSUPPORTED_STATFS.has(code)) throw error;
    if (!warnedStatfsUnsupported) {
      warnedStatfsUnsupported = true; // her kayıtta tekrar yazılmaz
      console.warn('Free disk space check unavailable', code);
    }
    return;
  }

  // BigInt ile hesap: kayan nokta yuvarlaması yok.
  const size = BigInt(Math.ceil(outputUpperBound));
  const tenth = size / 10n;
  const required = size + (tenth > MIN_FREE_RESERVE ? tenth : MIN_FREE_RESERVE);
  if (free < required) throw Object.assign(new Error('Insufficient free disk space'), { code: 'ENOSPC' });
}

// ─── Kurtarma ──────────────────────────────────────────────────────────────

function isValidRecord(value: unknown): value is JournalRecord {
  if (!value || typeof value !== 'object') return false;
  const { partial, target, pid } = value as Record<string, unknown>;
  return (
    typeof partial === 'string' &&
    typeof target === 'string' &&
    path.isAbsolute(partial) &&
    path.isAbsolute(target) &&
    PARTIAL_NAME_RE.test(path.basename(partial)) &&
    path.dirname(partial) === path.dirname(target) &&
    (pid === undefined || Number.isInteger(pid))
  );
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0); // sinyal göndermez, yalnızca var olup olmadığını sınar
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH'; // EPERM: var ama bize ait değil
  }
}

/** Başka bir uygulama örneği şu an bu günlüğü yazıyor olabilir mi? (Eski sürümün pid'siz günlükleri ölü sayılır.) */
function isLiveWriter(record: JournalRecord, mtimeMs: number): boolean {
  if (record.pid === undefined || record.pid === process.pid) return false;
  if (Date.now() - mtimeMs > MAX_WRITE_AGE_MS) return false;
  return isProcessAlive(record.pid);
}

async function recoverOne(journalDir: string, name: string): Promise<void> {
  if (inFlight.has(name.slice(0, -'.json'.length))) return;
  const journal = path.join(journalDir, name);
  let mtimeMs = Date.now();
  try {
    mtimeMs = (await fs.stat(journal)).mtimeMs;
    const record: unknown = JSON.parse(await fs.readFile(journal, 'utf8'));
    if (!isValidRecord(record)) throw new Error('Malformed journal');
    if (isLiveWriter(record, mtimeMs)) return;
    // unlink bağlantıyı siler, hedefini değil: sembolik bağ izlenmez.
    await fs.unlink(record.partial).catch(ignoreMissing);
    await fs.unlink(journal);
  } catch {
    // Kilitli ya da bozuk kayıtlar tanılama/yeniden deneme için kalır, ama sonsuza kadar birikmez.
    if (Date.now() - mtimeMs > STALE_RECORD_MS) await fs.unlink(journal).catch(() => {});
  }
}

/**
 * Her günlük, hedefin yanında özel olarak oluşturulmuş tek bir yarım dosyayı tanımlar.
 * Kurtarma kullanıcı klasörlerini hiç listelemez ve hiçbir bağlantıyı izleyip hedefi silmez.
 * Uygulama çalışırken de güvenle çağrılabilir: süren yazmalar atlanır.
 */
export async function recoverAtomicWrites(journalDir: string): Promise<void> {
  await fs.mkdir(journalDir, { recursive: true });
  for (const name of await fs.readdir(journalDir)) {
    if (JOURNAL_NAME_RE.test(name)) await recoverOne(journalDir, name);
  }
}

// ─── Yazma ─────────────────────────────────────────────────────────────────

/** Yalnızca görünüm içindir ve hiçbir zaman reddetmez. */
function setHidden(file: string, hidden: boolean): Promise<void> {
  return new Promise((resolve) => {
    execFile(ATTRIB_EXE, [hidden ? '+H' : '-H', file], { windowsHide: true }, () => resolve());
  });
}

async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fs.rename(from, to);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? '';
      const delay = RENAME_RETRY_DELAYS_MS[attempt];
      // Yeniden deneme yalnızca Windows'un geçici kilitleri içindir; diğer sistemlerde EPERM gerçek bir izin hatasıdır.
      if (!IS_WINDOWS || delay === undefined || (code !== 'EPERM' && code !== 'EBUSY')) throw error;
      await sleep(delay);
    }
  }
}

/** Yeniden adlandırmanın kendisini diske işletir (Windows'ta dizin eşitlenemez, atlanır). */
async function syncDirectory(directory: string): Promise<void> {
  if (IS_WINDOWS) return;
  try {
    const handle = await fs.open(directory, 'r');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch {
    /* bazı dosya sistemleri dizin eşitlemeyi desteklemez; veri zaten eşitlendi */
  }
}

/** Var olan dosyanın izni korunur (Windows'ta izin bitleri anlamsız, atlanır). */
async function existingMode(target: string): Promise<number | undefined> {
  if (IS_WINDOWS) return undefined;
  try {
    return (await fs.stat(target)).mode & 0o777;
  } catch {
    return undefined;
  }
}

export async function writeAtomicDocument(target: string, bytes: Uint8Array, journalDir: string): Promise<void> {
  await writeAtomicGeneratedDocument(target, journalDir, async partial => { await fs.writeFile(partial, bytes, { flag: 'wx' }); }, { estimatedBytes: bytes.byteLength });
}

type WriteOptions = { estimatedBytes?: number; validatePrevious?: (file: string) => Promise<void> };
const writes = new Map<string, Promise<void>>();
/** Serialize commits to the same target, including backup rotation. A producer
 * must close its output before returning and must never write the final path. */
export async function writeAtomicGeneratedDocument(target: string, journalDir: string, produce: (partial: string) => Promise<void>, options: WriteOptions = {}): Promise<void> {
  const resolved = path.resolve(target), key = IS_WINDOWS ? resolved.toLowerCase() : resolved;
  const previous = writes.get(key) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(() => generateAtomic(resolved, journalDir, produce, options));
  writes.set(key, next);
  try { await next; } finally { if (writes.get(key) === next) writes.delete(key); }
}

async function generateAtomic(target: string, journalDir: string, produce: (partial: string) => Promise<void>, options: WriteOptions): Promise<void> {
  const directory = path.dirname(target);
  await ensureDiskSpace(directory, options.estimatedBytes ?? 0);
  await fs.mkdir(journalDir, { recursive: true });

  const id = randomUUID();
  const partial = path.join(directory, `.wpa-save-${id}.gpres.partial`);
  const journal = path.join(journalDir, `${id}.json`);
  const mode = await existingMode(target);

  // Günlük, yarım dosyadan ÖNCE yazılır: bu iki adım arasında çökme olursa kurtarma yalnızca olmayan dosyayı siler.
  const record: JournalRecord = { target, partial, pid: process.pid };
  const journalHandle = await fs.open(journal, 'wx', 0o600);
  try { await journalHandle.writeFile(JSON.stringify(record)); await journalHandle.sync(); }
  finally { await journalHandle.close(); }
  await syncDirectory(journalDir);
  inFlight.add(id);

  let committed = false;
  try {
    await produce(partial);
    const handle = await fs.open(partial, 'r+');
    try {
      await handle.chmod(mode ?? NEW_FILE_MODE);
      await handle.sync();
    } catch (error) {
      await handle.close().catch(() => {}); // asıl hatayı kapatma hatası örtmesin
      throw error;
    }
    await handle.close();

    if (IS_WINDOWS) {
      await setHidden(partial, false);
    }
    if (options.validatePrevious) {
      let exists = true;
      try { await fs.lstat(target); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') exists = false; else throw error; }
      if (exists) {
        // Validate the backup copy, not a potentially changing original. One
        // previous revision is retained; failed backup leaves target intact.
        await generateAtomic(target + '.bak', journalDir, async backup => {
          const size = (await fs.stat(target)).size;
          await ensureDiskSpace(directory, size);
          await fs.copyFile(target, backup, 1 /* COPYFILE_EXCL */);
          await options.validatePrevious!(backup);
        }, {});
      }
    }
    await renameWithRetry(partial, target);
    committed = true; // belge artık yerinde; bundan sonraki temizlik hataları kaydı başarısız yapmaz
    await syncDirectory(directory);
  } finally {
    let cleaned = true;
    if (!committed) {
      await fs.unlink(partial).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') cleaned = false;
      });
    }
    // Yarım dosya silinemediyse günlük kalır; bir sonraki açılışta kurtarma tekrar dener.
    if (cleaned) await fs.unlink(journal).catch(() => {});
    inFlight.delete(id);
  }
}
