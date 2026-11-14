/**
 * AI image generation (desktop): text prompt → Pollinations.ai (free, no key) → userData/ai-images.
 * Shared request/result types, presets and the URL builder (pure, so it is unit-tested).
 */

export const IMAGE_GENERATE_STYLES = [
  { id: 'none', suffix: '' },
  { id: 'photo', suffix: 'photorealistic, natural light, high detail, professional photography' },
  { id: 'worship', suffix: 'soft warm light, peaceful, reverent atmosphere, cinematic, subtle bokeh, uncluttered background' },
  { id: 'painting', suffix: 'classical oil painting, rich colours, fine brush strokes' },
  { id: 'watercolor', suffix: 'delicate watercolor illustration, soft washes, paper texture' },
  { id: 'illustration', suffix: 'clean modern digital illustration, flat colours' },
  { id: 'abstract', suffix: 'abstract minimal background, smooth gradients, calm, plenty of empty space' },
] as const;
export type ImageGenerateStyle = (typeof IMAGE_GENERATE_STYLES)[number]['id'];

export const IMAGE_GENERATE_RATIOS = [
  { id: '16:9', width: 1920, height: 1080 },
  { id: '4:3', width: 1600, height: 1200 },
  { id: '1:1', width: 1280, height: 1280 },
  { id: '9:16', width: 1080, height: 1920 },
] as const;
export type ImageGenerateRatio = (typeof IMAGE_GENERATE_RATIOS)[number]['id'];

export const MAX_PROMPT_LENGTH = 1000;

export function isImageGenerateStyle(value: unknown): value is ImageGenerateStyle {
  return IMAGE_GENERATE_STYLES.some((s) => s.id === value);
}
export function isImageGenerateRatio(value: unknown): value is ImageGenerateRatio {
  return IMAGE_GENERATE_RATIOS.some((r) => r.id === value);
}

export interface ImageGenerateRequest {
  prompt: string;
  style: ImageGenerateStyle;
  ratio: ImageGenerateRatio;
  /** Same prompt + seed gives the same picture; a new seed gives a variation. */
  seed: number;
}

export type ImageGenerateResult =
  | { ok: true; /** Absolute path of the saved picture (userData/ai-images). */ path: string; seed: number; prompt: string }
  | { ok: false; reason: 'empty-prompt' | 'translate-failed' | 'rate-limited' | 'network' | 'failed'; message?: string };

export function randomSeed(): number {
  return Math.floor(Math.random() * 2_147_483_647);
}

/** Prompt text sent to the model: the user's words plus the style's keywords. */
export function composePrompt(prompt: string, style: ImageGenerateStyle): string {
  const base = prompt.replace(/\s+/g, ' ').trim().slice(0, MAX_PROMPT_LENGTH);
  const suffix = IMAGE_GENERATE_STYLES.find((s) => s.id === style)?.suffix ?? '';
  return suffix ? `${base}, ${suffix}` : base;
}

/** Anonymous Pollinations image URL (the keyless endpoint; the response body is the picture). */
export function buildPollinationsUrl(prompt: string, ratio: ImageGenerateRatio, seed: number): string {
  const size = IMAGE_GENERATE_RATIOS.find((r) => r.id === ratio) ?? IMAGE_GENERATE_RATIOS[0];
  const params = new URLSearchParams({
    width: String(size.width),
    height: String(size.height),
    seed: String(Math.max(0, Math.floor(seed)) % 2_147_483_647),
    model: 'flux',
    nologo: 'true',
    private: 'true',
    safe: 'true',
  });
  // Slashes would split the path segment even when encoded by some proxies: replace them.
  return `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt.replace(/[/\\]/g, ' '))}?${params}`;
}
