export const COLOR_PALETTES = {
  modern: {
    name: 'Modern',
    colors: [
      '#ef4444', '#f97316', '#f59e0b', '#84cc16', '#22c55e',
      '#14b8a6', '#06b6d4', '#3b82f6', '#6366f1', '#8b5cf6',
      '#a855f7', '#d946ef', '#ec4899', '#f43f5e',
    ],
  },
  pastel: {
    name: 'Pastel',
    colors: [
      '#fecaca', '#fed7aa', '#fde68a', '#d9f99d', '#bbf7d0',
      '#a7f3d0', '#a5f3fc', '#bfdbfe', '#c7d2fe', '#e9d5ff',
      '#f0abfc', '#fbcfe8', '#fecdd3',
    ],
  },
  dark: {
    name: 'Koyu',
    colors: [
      '#450a0a', '#7c2d12', '#713f12', '#365314', '#14532d',
      '#134e4a', '#164e63', '#1e3a5f', '#312e81', '#3b0764',
      '#4c1d95', '#701a75', '#831843', '#881337',
    ],
  },
  brand: {
    name: 'Marka',
    colors: [
      '#1e40af', '#2563eb', '#3b82f6', '#60a5fa', '#93c5fd',
      '#059669', '#10b981', '#34d399', '#6ee7b7', '#a7f3d0',
      '#dc2626', '#ef4444', '#f87171', '#fca5a5',
    ],
  },
  gray: {
    name: 'Gri Tonları',
    colors: [
      '#111111', '#1f1f1f', '#2d2d2d', '#404040', '#525252',
      '#737373', '#a3a3a3', '#d4d4d4', '#e5e5e5', '#f5f5f5',
    ],
  },
} as const;

export type PaletteName = keyof typeof COLOR_PALETTES;

const STORAGE_KEY = 'recent-colors';

export function getRecentColors(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function addRecentColor(color: string): void {
  if (!color || color === '#000000' || color === '#ffffff') return;
  const recent = getRecentColors().filter(c => c !== color);
  recent.unshift(color);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(recent.slice(0, 12)));
}
