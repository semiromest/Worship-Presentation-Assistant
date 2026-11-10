// Generated backgrounds on the web: rendering runs in a Web Worker, the draft
// stays in memory until saved, and saved images go into the media store.
// Mirrors src/main/gradientService.ts and gradientLibraryStore.ts.
import { validateGradient, type GeneratedBackground } from '../../src/shared/generatedBackground';
import type { ContrastRegion, ContrastResult } from '../../src/shared/gradientContrast';
import type { GradientDraft } from '../../src/shared/gradientDraft';
import type { GradientLibraryEntry, SaveGradientLibraryInput } from '../../src/shared/gradientLibrary';
import { kvGet, kvSet } from './db';
import { storeBlob } from './media';

const MAX_IMAGE_BYTES = 500 * 1024;
const MAX_REGIONS = 500;
const TIMEOUT_MS = 30_000;
const LIBRARY = 'gradient-library';
const MAX_NAME_LENGTH = 80;

interface Draft { token: string; blob: Blob; signature: string }
let draft: Draft | null = null;
let cancel: (() => void) | null = null;

const signatureOf = (recipe: GeneratedBackground) => {
  const base: Partial<GeneratedBackground> = { ...recipe };
  delete base.motion;
  return JSON.stringify(base);
};

function render(recipe: GeneratedBackground, regions: ContrastRegion[]): Promise<{ blob: Blob; contrast: ContrastResult; hash: string }> {
  cancel?.();
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./gradientWorker.ts', import.meta.url), { type: 'module' });
    let done = false;
    const finish = (error?: Error, result?: { blob: Blob; contrast: ContrastResult; hash: string }) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      worker.terminate();
      if (cancel === stop) cancel = null;
      if (error) reject(error); else resolve(result!);
    };
    const stop = () => finish(new Error('Gradient cancelled'));
    cancel = stop;
    const timer = setTimeout(() => finish(new Error('Gradient timed out')), TIMEOUT_MS);
    worker.onerror = () => finish(new Error('Gradient worker failed'));
    worker.onmessage = ({ data }) => data?.ok ? finish(undefined, data) : finish(new Error(data?.error ?? 'Gradient failed'));
    worker.postMessage({ recipe, regions });
  });
}

const blobToDataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result));
  reader.onerror = () => reject(reader.error);
  reader.readAsDataURL(blob);
});

export async function generateGradient(input: unknown, regionsInput: unknown): Promise<GradientDraft> {
  const recipe = validateGradient(input);
  const regions = Array.isArray(regionsInput) && regionsInput.length <= MAX_REGIONS ? regionsInput as ContrastRegion[] : [];
  draft = null;
  const result = await render(recipe, regions);
  if (result.blob.size > MAX_IMAGE_BYTES) throw new Error('Gradient exceeds image budget');
  const token = crypto.randomUUID();
  draft = { token, blob: result.blob, signature: signatureOf(recipe) };
  return { token, image: await blobToDataUrl(result.blob), recipe, contrast: result.contrast, byteLength: result.blob.size, hash: result.hash };
}

export async function discardGradient(): Promise<void> {
  cancel?.();
  draft = null;
}

async function storeDraft(token: string): Promise<string> {
  if (!draft || draft.token !== token) throw new Error('Gradient draft expired');
  return (await storeBlob(draft.blob, 'gradient.jpg')).split('#')[0];
}

export const saveGradient = (token: string) => storeDraft(token);

// ─── library ───────────────────────────────────────────────────────────────

function parseEntry(value: any): GradientLibraryEntry | null {
  if (!value || typeof value.id !== 'string' || typeof value.name !== 'string' || !Number.isFinite(value.createdAt) || typeof value.image !== 'string') return null;
  try { return { ...value, recipe: validateGradient(value.recipe) }; } catch { return null; }
}

let queue: Promise<unknown> = Promise.resolve();
function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const next = queue.then(task);
  queue = next.catch(() => {});
  return next;
}
const load = async () => ((await kvGet<unknown[]>(LIBRARY)) ?? []).map(parseEntry).filter((e): e is GradientLibraryEntry => !!e);

export const listGradientLibrary = () => enqueue(load);

export function saveGradientLibrary(input: SaveGradientLibraryInput): Promise<GradientLibraryEntry[]> {
  return enqueue(async () => {
    const name = typeof input?.name === 'string' ? input.name.trim() : '';
    if (!name || name.length > MAX_NAME_LENGTH) throw new Error('Invalid gradient name');
    const recipe = validateGradient(input.recipe);
    if (!draft || draft.token !== input.token) throw new Error('Gradient draft expired');
    if (signatureOf(recipe) !== draft.signature) throw new Error('Gradient recipe changed');
    const image = await storeDraft(input.token);
    const next = [{ id: crypto.randomUUID(), name, recipe, image, createdAt: Date.now() }, ...(await load())];
    await kvSet(LIBRARY, next);
    return next;
  });
}

export function deleteGradientLibrary(id: string): Promise<GradientLibraryEntry[]> {
  return enqueue(async () => {
    const entries = await load();
    const next = entries.filter(entry => entry.id !== id);
    if (next.length !== entries.length) await kvSet(LIBRARY, next);
    return next;
  });
}
