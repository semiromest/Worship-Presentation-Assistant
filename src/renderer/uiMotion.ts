export const UI_MOTION_STORAGE_KEY = 'uiMotionEnabled';

export const uiMotion = {
  duration: { fast: 0.12, standard: 0.18, emphasized: 0.22 },
  ease: [0.2, 0.8, 0.2, 1] as const,
  distance: 8,
};

export function readUiMotionEnabled(): boolean {
  try {
    const value = localStorage.getItem(UI_MOTION_STORAGE_KEY);
    return value === null ? true : value === '1';
  } catch {
    return true;
  }
}

export function writeUiMotionEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(UI_MOTION_STORAGE_KEY, enabled ? '1' : '0');
  } catch {
    // The in-memory preference still applies when storage is unavailable.
  }
}
