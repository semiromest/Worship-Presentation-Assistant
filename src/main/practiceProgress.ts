import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { assertNoLinks } from './launchPolicy';
import {
  practiceTasks, practiceExercises, exercisePage, exerciseOperation,
  type ExerciseResult, type PracticeExercise, type PracticeProgress,
  type PracticeTask, type PracticeResult, type ProgressRead,
} from '../shared/practice';

type Status = 'notStarted' | 'inProgress' | 'completed' | 'skipped';

const PROGRESS_FILE = 'practice-progress.json';
const RESET_MARKER = 'practice-reset.json';
/** Gerçek dosya birkaç KB'tır; bozuk/şişmiş dosyayı belleğe almayı reddet. */
const MAX_PROGRESS_BYTES = 64 * 1024;

const STATUSES: ReadonlySet<string> = new Set(['notStarted', 'inProgress', 'completed', 'skipped']);
const TASKS: ReadonlySet<string> = new Set(practiceTasks);
const EXERCISES: ReadonlySet<string> = new Set(practiceExercises);

/** Görev -> o göreve bağlı alıştırmalar. Modül yüklenirken bir kez hesaplanır. */
const exercisesByTask = new Map<PracticeTask, PracticeExercise[]>();
for (const exercise of practiceExercises) {
  const task = exercisePage[exercise];
  exercisesByTask.set(task, [...(exercisesByTask.get(task) ?? []), exercise]);
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const errorCode = (error: unknown) => (error as NodeJS.ErrnoException | undefined)?.code;
const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

const emptyProgress = (): PracticeProgress => ({ schemaVersion: 2, revision: 0, tasks: {}, exercises: {} });

function parseStatusMap(value: unknown, allowedKeys: ReadonlySet<string>, label: string): Record<string, Status> {
  if (!isRecord(value)) throw new Error(`Invalid ${label}`);
  for (const [key, status] of Object.entries(value)) {
    if (!allowedKeys.has(key)) throw new Error(`Unknown ${label} key`);
    if (typeof status !== 'string' || !STATUSES.has(status)) throw new Error(`Invalid ${label} status`);
  }
  return value as Record<string, Status>;
}

export function parseProgress(raw: string): PracticeProgress {
  const value: unknown = JSON.parse(raw);
  if (!isRecord(value)) throw new Error('Invalid progress');
  const { schemaVersion, revision, runId } = value;
  if (schemaVersion !== 1 && schemaVersion !== 2) throw new Error('Invalid schema version');
  if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0) throw new Error('Invalid revision');
  const tasks = parseStatusMap(value.tasks, TASKS, 'tasks');
  // schema 1'de alıştırma alanı yoktu; sessizce boş kabul edilir.
  const exercises = schemaVersion === 1 ? {} : parseStatusMap(value.exercises, EXERCISES, 'exercises');
  if (runId !== undefined && (typeof runId !== 'string' || !runId)) throw new Error('Invalid run identity');
  return {
    schemaVersion: 2,
    ...(runId ? { runId: runId as string } : {}),
    revision,
    tasks,
    exercises,
  } as PracticeProgress;
}

/** Bir göreve bağlı alıştırmaların durumundan görev durumunu türetir. */
function deriveTaskStatus(task: PracticeTask, exercises: PracticeProgress['exercises']): Status {
  const related = (exercisesByTask.get(task) ?? []).map(id => (exercises[id] ?? 'notStarted') as Status);
  if (related.length && related.every(s => s === 'completed')) return 'completed';
  if (related.length && related.every(s => s === 'skipped')) return 'skipped';
  return 'inProgress';
}

/**
 * Saf durum geçişi. Değişiklik yoksa AYNI nesneyi döndürür (çağıran diske yazmaz).
 * - Tamamlanmış kayıt hiçbir zaman düşürülmez (görev veya alıştırma düzeyinde).
 * - requiresActive: yalnızca "devam ediyor" durumundaki kayıt tamamlanabilir (geç sonuçları eler).
 */
export function applyStatus(
  progress: PracticeProgress, task: PracticeTask, status: Status,
  exercise?: PracticeExercise, requiresActive = false,
): PracticeProgress {
  const currentStatus = (exercise ? progress.exercises[exercise] : progress.tasks[task]) as Status | undefined;
  if (currentStatus === 'completed' && status !== 'completed') return progress;
  if (requiresActive && currentStatus !== 'inProgress') return progress;
  if (currentStatus === status) return progress;

  const exercises: PracticeProgress['exercises'] = exercise
    ? { ...progress.exercises, [exercise]: status }
    : progress.exercises;
  const tasks: PracticeProgress['tasks'] = { ...progress.tasks, [task]: status };
  if (exercise) tasks[task] = deriveTaskStatus(task, exercises);
  return { ...progress, revision: progress.revision + 1, tasks, exercises };
}

const TRANSIENT_FS_ERRORS: ReadonlySet<string> = new Set(['EBUSY', 'EPERM', 'EACCES']);

/** Windows'ta antivirüs/indeksleyici dosyayı kısa süre kilitleyebilir; kısa, sınırlı yeniden deneme. */
async function withRetry<T>(operation: () => Promise<T>, attempts = 4): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      const code = errorCode(error);
      if (attempt >= attempts || !code || !TRANSIENT_FS_ERRORS.has(code)) throw error;
      await delay(15 * attempt);
    }
  }
}

async function readLimited(file: string): Promise<string> {
  const handle = await fs.open(file, 'r');
  try {
    const { size } = await handle.stat();
    if (size > MAX_PROGRESS_BYTES) throw new Error('Progress file too large');
    return await handle.readFile('utf8');
  } finally {
    await handle.close();
  }
}

async function exists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return false;
    throw error;
  }
}

export function createProgressStore(profile: string) {
  const file = path.join(profile, PROGRESS_FILE);
  const resetMarker = path.join(profile, RESET_MARKER);
  let queue: Promise<unknown> = Promise.resolve();
  let staleTempsCleaned = false;

  /** Tüm okuma-değiştirme-yazma işlemlerini tek sırada çalıştırır; önceki hata zinciri bozmaz. */
  function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const job = queue.then(() => undefined, () => undefined).then(operation);
    queue = job;
    return job;
  }

  async function read(): Promise<ProgressRead> {
    try {
      assertNoLinks(file);
      return { ok: true, progress: parseProgress(await withRetry(() => readLimited(file))) };
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return { ok: true, progress: emptyProgress() };
      return { ok: false, error: 'unreadable' };
    }
  }

  async function readForWrite(): Promise<PracticeProgress> {
    if (await exists(resetMarker)) throw new Error('Restart pending');
    const current = await read();
    if (!current.ok) throw new Error('Progress is unreadable');
    return current.progress;
  }

  /** Çökme sonrası kalan yetim .tmp dosyalarını bir kez temizler (tek yazıcı varsayımıyla güvenli). */
  async function removeStaleTemps() {
    if (staleTempsCleaned) return;
    staleTempsCleaned = true;
    try {
      for (const name of await fs.readdir(profile)) {
        if (name.startsWith(`${PROGRESS_FILE}.`) && name.endsWith('.tmp')) await fs.rm(path.join(profile, name), { force: true });
      }
    } catch { /* en iyi çaba */ }
  }

  /** Geçici dosya + fsync + atomik rename. Tüm yazımlar buradan geçer. */
  async function persist(next: PracticeProgress): Promise<void> {
    assertNoLinks(profile);
    await fs.mkdir(profile, { recursive: true });
    await removeStaleTemps();
    const temp = `${file}.${randomUUID()}.tmp`;
    try {
      const handle = await fs.open(temp, 'wx');
      try {
        await handle.writeFile(JSON.stringify(next));
        await handle.sync();
      } finally {
        await handle.close();
      }
      assertNoLinks(file);
      await withRetry(() => fs.rename(temp, file));
    } catch (error) {
      await fs.rm(temp, { force: true });
      throw error;
    }
  }

  function update(task: PracticeTask, status: Exclude<Status, 'notStarted'>, exercise?: PracticeExercise, requiresActive = false) {
    return enqueue(async () => {
      if (!TASKS.has(task)) throw new Error('Unknown task');
      const current = await readForWrite();
      const next = applyStatus(current, task, status, exercise, requiresActive);
      if (next === current) return current; // değişiklik yok: diske yazma, revision artırma
      await persist(next);
      return next;
    });
  }

  return {
    read,
    exclusive: enqueue,

    bindRun: (runId: string) => enqueue(async () => {
      if (typeof runId !== 'string' || !runId) throw new Error('Invalid run identity');
      const current = await readForWrite();
      if (current.runId === runId) return;
      if (current.runId) throw new Error('Progress run mismatch');
      await persist({ ...current, runId, revision: current.revision + 1 });
    }),

    // Aşağıdakiler async: geçersiz girdi artık senkron throw yerine reddedilmiş Promise döndürür.
    recordExerciseResult: async (result: ExerciseResult) => {
      if (!EXERCISES.has(result.exercise) || exerciseOperation[result.exercise] !== result.operation ||
        typeof result.sessionId !== 'string' || !result.sessionId ||
        typeof result.resourceId !== 'string' || !result.resourceId) throw new Error('Invalid exercise result');
      return update(exercisePage[result.exercise], 'completed', result.exercise, true);
    },

    setExerciseStatus: async (exercise: PracticeExercise, status: 'inProgress' | 'skipped') => {
      if (!EXERCISES.has(exercise)) throw new Error('Unknown exercise');
      return update(exercisePage[exercise], status, exercise);
    },

    setStatus: async (task: PracticeTask, status: 'inProgress' | 'skipped') => {
      if (status !== 'inProgress' && status !== 'skipped') throw new Error('Completion requires a verified result');
      return update(task, status);
    },

    recordResult: async (result: PracticeResult) => {
      if (result.task !== 'presentations' || result.operation !== 'preset-saved' || !result.resourceId?.trim())
        throw new Error('Unverified operation result');
      return update(result.task, 'completed', undefined, true);
    },
  };
}