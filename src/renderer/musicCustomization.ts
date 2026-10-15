import type { Slide } from './types';

export function musicGain(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 1;
}

export function backgroundDim(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(0.8, value)) : 0;
}

export function musicPresetStyles(styles: Slide['styles'], image?: string): NonNullable<Slide['styles']> {
  return {
    fontSize: 76, textColor: '#f8fafc', ...styles,
    backgroundColor: '#0f172a', backgroundImage: image,
    backgroundVideo: undefined, backgroundGradient: undefined, generatedBackground: undefined,
    backgroundExplicit: true, backgroundBlur: 0, backgroundDim: image ? 0.45 : 0,
    textAlign: 'center', verticalAlign: 'center',
  };
}
