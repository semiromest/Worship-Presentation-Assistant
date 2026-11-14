/**
 * AI image generation (desktop, main process).
 *
 *   prompt ─(always → English: Google, then MyMemory; error if neither answers)→ + style keywords
 *          ─Pollinations.ai (keyless, Flux)→ JPEG/PNG bytes ─→ content-addressed file in userData/ai-images
 *
 * Runs in the main process so the request is not subject to the renderer's CSP and the result
 * is a plain local file the media tab and slides can use. It is kept out of the presentation media
 * library on purpose: "remove unused media" would otherwise delete pictures only the media tab lists.
 * One request at a time: the anonymous tier allows roughly one image every ~15 s, so parallel clicks would only earn 429s.
 */
import {
  buildPollinationsUrl, composePrompt, MAX_PROMPT_LENGTH,
  type ImageGenerateRequest, type ImageGenerateResult,
} from '../shared/imageGenerate';
import type { TranslateFn } from './imageTranslate';

export interface ImageGenerateDeps {
  /** Saves the picture and returns its absolute path (or null on failure). */
  storeBytes: (data: Buffer, ext: string) => Promise<string | null>;
  fetch?: typeof fetch;
  /** Primary translator (Google, free endpoints). */
  translate?: TranslateFn;
  /** Second translator; defaults to MyMemory over `fetch`, null disables it. */
  fallbackTranslate?: TranslateFn | null;
  timeoutMs?: number;
}

const MAX_BYTES = 25 * 1024 * 1024;
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

/** Image extension for a response, from its content type or, failing that, its magic bytes. */
export function imageExt(contentType: string | null, bytes: Uint8Array): '.jpg' | '.png' | '.webp' | null {
  const type = (contentType ?? '').toLowerCase();
  if (type.includes('jpeg') || type.includes('jpg')) return '.jpg';
  if (type.includes('png')) return '.png';
  if (type.includes('webp')) return '.webp';
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return '.jpg';
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return '.png';
  if (bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return '.webp';
  return null;
}

/**
 * MyMemory (free, keyless, auto-detects the source): the fallback when Google rate-limits.
 * English input comes back as "PLEASE SELECT TWO DISTINCT LANGUAGES": that means "already English".
 */
export function myMemoryTranslate(doFetch: typeof fetch): TranslateFn {
  return async (texts) => Promise.all(texts.map(async (text) => {
    const url = `https://api.mymemory.translated.net/get?langpair=${encodeURIComponent('Autodetect|en')}&q=${encodeURIComponent(text.slice(0, 500))}`;
    const response = await doFetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } });
    const body = await response.json() as { responseStatus?: number | string; responseDetails?: string; responseData?: { translatedText?: string } };
    if (/DISTINCT LANGUAGES/i.test(body.responseDetails ?? '')) return text;
    const out = body.responseData?.translatedText?.trim();
    if (String(body.responseStatus) !== '200' || !out) throw new Error(body.responseDetails || `MyMemory HTTP ${response.status}`);
    return out;
  }));
}

const translations = new Map<string, string>();

/**
 * The model only understands English: a Turkish prompt sent as is comes back as an unrelated
 * stock portrait. So every prompt is translated (an English one comes back unchanged) and, when no
 * translator answers, the caller reports an error instead of generating a random picture.
 */
export async function englishPrompt(prompt: string, translators: TranslateFn[]): Promise<string | null> {
  const cached = translations.get(prompt);
  if (cached) return cached;
  for (const translate of translators) {
    try {
      const [out] = await translate([prompt], 'auto', 'en');
      const text = out?.trim();
      if (text) {
        if (translations.size > 200) translations.clear();
        translations.set(prompt, text);
        return text;
      }
    } catch { /* next translator */ }
  }
  return null;
}

let queue: Promise<unknown> = Promise.resolve();

export function generateImage(deps: ImageGenerateDeps, request: ImageGenerateRequest): Promise<ImageGenerateResult> {
  const run = queue.then(() => generateNow(deps, request), () => generateNow(deps, request));
  queue = run.catch(() => undefined);
  return run;
}

async function generateNow(deps: ImageGenerateDeps, request: ImageGenerateRequest): Promise<ImageGenerateResult> {
  const raw = typeof request.prompt === 'string' ? request.prompt.trim().slice(0, MAX_PROMPT_LENGTH) : '';
  if (!raw) return { ok: false, reason: 'empty-prompt' };
  const doFetch = deps.fetch ?? fetch;
  const fallback = deps.fallbackTranslate === undefined ? myMemoryTranslate(doFetch) : deps.fallbackTranslate;
  const english = await englishPrompt(raw, [deps.translate, fallback].filter((t): t is TranslateFn => !!t));
  if (!english) return { ok: false, reason: 'translate-failed' };
  const prompt = composePrompt(english, request.style);
  const url = buildPollinationsUrl(prompt, request.ratio, request.seed);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? 120_000);
  try {
    let response: Response;
    try {
      response = await doFetch(url, { signal: controller.signal, headers: { 'User-Agent': USER_AGENT, Accept: 'image/*' } });
    } catch (error) {
      return { ok: false, reason: 'network', message: error instanceof Error ? error.message : String(error) };
    }
    if (response.status === 429 || response.status === 402) {
      return { ok: false, reason: 'rate-limited', message: `HTTP ${response.status}` };
    }
    if (!response.ok) return { ok: false, reason: 'failed', message: `HTTP ${response.status}` };
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length || bytes.length > MAX_BYTES) return { ok: false, reason: 'failed', message: 'Unexpected image size' };
    const ext = imageExt(response.headers.get('content-type'), bytes);
    if (!ext) return { ok: false, reason: 'failed', message: 'The service did not return an image' };
    const saved = await deps.storeBytes(bytes, ext);
    if (!saved) return { ok: false, reason: 'failed', message: 'Could not store the generated image' };
    return { ok: true, path: saved, seed: request.seed, prompt };
  } catch (error) {
    const aborted = controller.signal.aborted;
    return { ok: false, reason: aborted ? 'network' : 'failed', message: aborted ? 'Timed out' : error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
}
