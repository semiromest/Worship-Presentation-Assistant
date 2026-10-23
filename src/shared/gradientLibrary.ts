import type { GeneratedBackground } from './generatedBackground';

export interface GradientLibraryEntry {
  id: string;
  name: string;
  recipe: GeneratedBackground;
  image: string;
  createdAt: number;
}
export interface SaveGradientLibraryInput {
  name: string;
  token: string;
  recipe: GeneratedBackground;
}
