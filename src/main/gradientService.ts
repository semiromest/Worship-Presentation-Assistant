import { ipcMain, utilityProcess, type WebContents } from 'electron';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { validateGradient, type GeneratedBackground } from '../shared/generatedBackground';
import type { ContrastRegion } from '../shared/gradientContrast';
import type { MediaLibrary } from './mediaLibrary';
import type { encodeGradient } from './gradientRender';
import { createGradientLibraryStore } from './gradientLibraryStore';
import type { SaveGradientLibraryInput } from '../shared/gradientLibrary';

type Rendered = ReturnType<typeof encodeGradient>;

interface Draft {
  token: string;
  bytes: Buffer;
  /** Motion hariç tarif imzası; kütüphaneye kaydederken tarifin değişmediğini doğrulamak için. */
  signature: string;
}
interface Session {
  draft?: Draft;
  cancel?: () => void;
}

const MAX_REGIONS = 500;
const MAX_COORDINATE = 10_000;
const MAX_IMAGE_BYTES = 500 * 1024;
const WORKER_TIMEOUT_MS = 30_000;
const WORKER_PATH = path.join(__dirname, 'gradientWorker.js');

// NaN ve ±Infinity, `Math.abs(v) <= MAX` karşılaştırmasında zaten false verir; ayrıca isFinite gerekmez.
const isCoordinate = (v: unknown): v is number => typeof v === 'number' && Math.abs(v) <= MAX_COORDINATE;
const isByte = (v: unknown): boolean => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 255;

function isRegion(value: unknown): value is ContrastRegion {
  if (!value || typeof value !== 'object') return false;
  const { x, y, width, height, color } = value as Record<string, unknown>;
  return (
    isCoordinate(x) &&
    isCoordinate(y) &&
    isCoordinate(width) &&
    isCoordinate(height) &&
    width >= 0 &&
    height >= 0 &&
    Array.isArray(color) &&
    color.length === 3 &&
    color.every(isByte)
  );
}

function parseRegions(input: unknown): ContrastRegion[] {
  if (!Array.isArray(input) || input.length > MAX_REGIONS || !input.every(isRegion)) {
    throw new Error('Invalid text regions');
  }
  return input;
}

function rasterSignature(recipe: GeneratedBackground): string {
  const { motion: _motion, ...base } = recipe;
  return JSON.stringify(base);
}

/** Her istek kendi izole sürecinde çalışır; iptal, zaman aşımı ve çıkış tek `finish` yolundan geçer. */
function renderInWorker(recipe: GeneratedBackground, regions: ContrastRegion[], session: Session): Promise<Rendered> {
  return new Promise<Rendered>((resolve, reject) => {
    const worker = utilityProcess.fork(WORKER_PATH, [], { serviceName: 'presenter-gradient' });
    let done = false;
    const finish = (error?: Error, result?: Rendered) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      worker.kill();
      session.cancel = undefined;
      if (error) reject(error);
      else resolve(result!);
    };
    const timer = setTimeout(() => finish(new Error('Gradient timed out')), WORKER_TIMEOUT_MS);
    session.cancel = () => finish(new Error('Gradient cancelled'));
    worker.once('exit', () => finish(new Error('Gradient worker exited')));
    worker.once('message', (message: { ok: boolean; result?: Rendered }) =>
      message.ok && message.result ? finish(undefined, message.result) : finish(new Error('Gradient failed')),
    );
    worker.postMessage({ recipe, regions });
  });
}

/** One bounded, memory-only draft and one isolated generator per renderer. */
export function registerGradientService(library: MediaLibrary, userData: string) {
  const saved = createGradientLibraryStore(userData);
  const sessions = new Map<number, Session>();
  const owners = new WeakSet<WebContents>();

  const cancelSession = (ownerId: number) => sessions.get(ownerId)?.cancel?.();
  const draftOf = (ownerId: number) => sessions.get(ownerId)?.draft;

  /** Önceki isteği iptal eder, bu renderer için yeni oturum açar. */
  function startSession(owner: WebContents, ownerId: number): Session {
    cancelSession(ownerId);
    const session: Session = {};
    sessions.set(ownerId, session);
    if (!owners.has(owner)) {
      owners.add(owner);
      owner.once('destroyed', () => {
        cancelSession(ownerId);
        sessions.delete(ownerId);
      });
    }
    return session;
  }

  async function storeDraftImage(draft: Draft): Promise<string> {
    const ref = await library.storeBytes(draft.bytes, 'jpg');
    if (!ref) throw new Error('Gradient could not be saved');
    return ref;
  }

  ipcMain.handle('gradient:generate', async (event, input: unknown, regionsInput: unknown) => {
    const recipe = validateGradient(input);
    const regions = parseRegions(regionsInput);
    const owner = event.sender;
    const ownerId = owner.id; // 'destroyed' sonrası özelliğe erişmek yerine baştan yakalanır.
    const session = startSession(owner, ownerId);

    const result = await renderInWorker(recipe, regions, session);
    if (sessions.get(ownerId) !== session || owner.isDestroyed()) throw new Error('Stale gradient');

    // Boyut, kopyalamadan önce kontrol edilir.
    if (result.bytes.length > MAX_IMAGE_BYTES) throw new Error('Gradient exceeds image budget');
    const bytes = Buffer.from(result.bytes);
    const token = randomUUID();
    session.draft = { token, bytes, signature: rasterSignature(recipe) };
    return {
      token,
      image: `data:image/jpeg;base64,${bytes.toString('base64')}`,
      recipe,
      contrast: result.contrast,
      byteLength: bytes.length,
      hash: result.jpegHash,
    };
  });

  ipcMain.handle('gradient:discard', (event) => {
    const ownerId = event.sender.id;
    cancelSession(ownerId);
    sessions.delete(ownerId);
  });

  ipcMain.handle('gradient:save', async (event, token: unknown) => {
    const draft = draftOf(event.sender.id);
    if (!draft || draft.token !== token) throw new Error('Gradient draft expired');
    return storeDraftImage(draft);
  });

  ipcMain.handle('gradient-library:list', () => saved.list());
  ipcMain.handle('gradient-library:remove', (_, id: string) => saved.remove(id));

  ipcMain.handle('gradient-library:save', async (event, input: SaveGradientLibraryInput) => {
    const draft = input ? draftOf(event.sender.id) : undefined;
    if (!input || !draft || draft.token !== input.token) throw new Error('Gradient draft expired');
    const recipe = validateGradient(input.recipe);
    if (rasterSignature(recipe) !== draft.signature) throw new Error('Gradient recipe changed');
    const image = await storeDraftImage(draft);
    return saved.save({ name: input.name, recipe, image });
  });
}