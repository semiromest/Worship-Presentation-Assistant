export type DisplayMode = 'follow' | 'manual' | 'stage';

export interface DisplayRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DisplayInfo {
  /** Electron's display.id normalized to a string for IPC/state map keys. */
  id: string;
  label: string;
  isPrimary: boolean;
  bounds: DisplayRect;
  workArea: DisplayRect;
  scaleFactor: number;
}

export interface OutputAssignment {
  mode: DisplayMode;
  /** Remembered manual slide; ignored while mode is `follow`. */
  slideIndex: number;
  isOpen: boolean;
  isBlackout: boolean;
}

export interface ProjectorOutputStatus {
  displayId: string;
  isOpen: boolean;
  isReady: boolean;
}

export interface ProjectorOutputFrame {
  displayId: string;
  mode: DisplayMode;
  slideIndex: number;
  isBlackout: boolean;
}

/** Stable ordering for displays, independent of primary-display coordinates. */
export function compareDisplays(a: DisplayInfo, b: DisplayInfo): number {
  if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
  if (a.bounds.x !== b.bounds.x) return a.bounds.x - b.bounds.x;
  if (a.bounds.y !== b.bounds.y) return a.bounds.y - b.bounds.y;
  return a.id.localeCompare(b.id);
}

/**
 * Picks the first secondary display for the legacy Start Broadcast action.
 * A single-display machine falls back to primary to preserve the old behavior.
 */
export function chooseDefaultOutputDisplay(displays: DisplayInfo[]): DisplayInfo | undefined {
  const ordered = [...displays].sort(compareDisplays);
  return ordered.find((display) => !display.isPrimary) ?? ordered.find((display) => display.isPrimary);
}

export function createOutputAssignment(liveIndex = 0): OutputAssignment {
  return {
    mode: 'follow',
    slideIndex: Math.max(0, Math.floor(liveIndex)),
    isOpen: false,
    isBlackout: false,
  };
}

export function clampSlideIndex(index: number, slideCount: number): number {
  if (slideCount <= 0) return 0;
  return Math.min(Math.max(0, Math.floor(index)), slideCount - 1);
}

export function effectiveOutputSlideIndex(
  assignment: OutputAssignment | undefined,
  liveIndex: number,
  slideCount: number,
): number {
  const raw = assignment?.mode === 'manual' ? assignment.slideIndex : liveIndex;
  return clampSlideIndex(raw, slideCount);
}
