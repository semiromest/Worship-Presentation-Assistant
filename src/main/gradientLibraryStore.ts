import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { GradientLibraryEntry } from '../shared/gradientLibrary';
import { validateGradient } from '../shared/generatedBackground';

type Entries = GradientLibraryEntry[];

const IMAGE_RE = /^local-resource:\/\/media\/[a-zA-Z0-9_-]+\.jpg$/;
const MAX_NAME_LENGTH = 80;
const MAX_ID_LENGTH = 80;

const isGradientImage = (value: unknown): value is string =>
  typeof value === 'string' && IMAGE_RE.test(value);

/** Geçerli girdiyi döndürür, bozuksa null. Tek bozuk kayıt tüm kütüphaneyi kilitlemez. */
function parseEntry(value: any): GradientLibraryEntry | null {
  if (
    !value ||
    typeof value.id !== 'string' ||
    typeof value.name !== 'string' ||
    !Number.isFinite(value.createdAt) ||
    !isGradientImage(value.image)
  )
    return null;
  try {
    return { ...value, recipe: validateGradient(value.recipe) } as GradientLibraryEntry;
  } catch {
    return null;
  }
}

export function createGradientLibraryStore(userData: string) {
  const file = path.join(userData, 'gradient-library.json');
  const tempPrefix = `${path.basename(file)}.`;
  let queue: Promise<unknown> = Promise.resolve();
  // Tüm erişim kuyruktan geçtiği için tek yazar var; bellekteki kopya diskle aynı kalır.
  let cache: Entries | undefined;

  const backupPath = () => `${file}.corrupt-${Date.now()}`;

  /** Önceki çökmelerden kalan yarım yazma dosyalarını temizler. */
  async function sweepTemps(): Promise<void> {
    try {
      for (const name of await fs.readdir(userData)) {
        if (name.startsWith(tempPrefix) && name.endsWith('.tmp')) {
          await fs.unlink(path.join(userData, name)).catch(() => {});
        }
      }
    } catch {
      /* Dizin henüz yok. */
    }
  }

  async function persist(entries: Entries): Promise<void> {
    await fs.mkdir(userData, { recursive: true });
    const temp = `${file}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temp, JSON.stringify(entries), 'utf8');
      await fs.rename(temp, file);
    } catch (error) {
      // Başarıda temp zaten rename edildi; yalnızca hata yolunda temizle.
      await fs.unlink(temp).catch(() => {});
      throw error;
    }
  }

  async function read(): Promise<Entries> {
    let raw: string;
    try {
      raw = await fs.readFile(file, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error; // İzin hatası gibi gerçek G/Ç sorunları yutulmaz.
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = undefined;
    }

    if (!Array.isArray(parsed)) {
      // Dosya tümüyle bozuk: yedeğe taşı, boş kütüphaneyle devam et.
      await fs.rename(file, backupPath()).catch(() => {});
      return [];
    }

    const entries = parsed.map(parseEntry).filter((entry): entry is GradientLibraryEntry => entry !== null);
    if (entries.length !== parsed.length) {
      // Bazı kayıtlar bozuk: özgün dosyayı yedekle, temizlenmiş halini yaz.
      await fs.copyFile(file, backupPath()).catch(() => {});
      await persist(entries).catch(() => {});
    }
    return entries;
  }

  async function load(): Promise<Entries> {
    if (!cache) {
      await sweepTemps();
      cache = await read();
    }
    return cache;
  }

  function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const job = queue.then(task);
    queue = job.catch(() => {});
    return job;
  }

  /** `update` aynı diziyi döndürürse değişiklik yok demektir ve dosya yeniden yazılmaz. */
  function mutate(update: (entries: Entries) => Entries): Promise<Entries> {
    return enqueue(async () => {
      const current = await load();
      const next = update(current);
      if (next === current) return current;
      await persist(next);
      cache = next; // Yazma başarısız olursa önbellek eski (diskle uyumlu) halinde kalır.
      return next;
    });
  }

  return {
    list(): Promise<Entries> {
      return enqueue(load);
    },
    async save(input: Omit<GradientLibraryEntry, 'id' | 'createdAt'>): Promise<Entries> {
      const name = typeof input.name === 'string' ? input.name.trim() : '';
      if (!name || name.length > MAX_NAME_LENGTH) throw new Error('Invalid gradient name');
      const recipe = validateGradient(input.recipe);
      if (!isGradientImage(input.image)) throw new Error('Invalid gradient image');
      const entry: GradientLibraryEntry = {
        id: randomUUID(),
        name,
        recipe,
        image: input.image,
        createdAt: Date.now(),
      };
      return mutate((entries) => [entry, ...entries]);
    },
    async remove(id: string): Promise<Entries> {
      if (typeof id !== 'string' || id.length > MAX_ID_LENGTH) throw new Error('Invalid gradient id');
      // Media is shared with presentations and deliberately remains on disk.
      return mutate((entries) => {
        const next = entries.filter((entry) => entry.id !== id);
        return next.length === entries.length ? entries : next;
      });
    },
  };
}