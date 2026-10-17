import type { GeneratedBackground } from './generatedBackground';
import type { ContrastResult } from './gradientContrast';
export interface GradientDraft {
  token: string;
  image: string;
  recipe: GeneratedBackground;
  contrast: ContrastResult;
  byteLength: number;
  hash: string;
}
