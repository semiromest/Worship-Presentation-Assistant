import fs from 'node:fs';
import path from 'node:path';

export interface Rect { x: number; y: number; width: number; height: number }
export interface WindowState { bounds: Rect; maximized: boolean }

const MIN_WIDTH = 800;
const MIN_HEIGHT = 600;
/** At least this much of the title bar area must land on a connected display. */
const MIN_VISIBLE = 120;

function isRect(value: unknown): value is Rect {
  if (!value || typeof value !== 'object') return false;
  const r = value as Record<string, unknown>;
  return ['x', 'y', 'width', 'height'].every(key => typeof r[key] === 'number' && Number.isFinite(r[key] as number));
}

function overlap(a: Rect, b: Rect): { width: number; height: number } {
  return {
    width: Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x),
    height: Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y),
  };
}

/**
 * Validates a saved state against the displays connected now. A window saved on a
 * projector or a disconnected monitor must not reopen off-screen, so anything whose
 * top strip is not reachable on a current work area falls back to the default.
 */
export function restoreWindowState(raw: unknown, workAreas: Rect[]): WindowState | null {
  if (!raw || typeof raw !== 'object') return null;
  const { bounds, maximized } = raw as { bounds?: unknown; maximized?: unknown };
  if (!isRect(bounds)) return null;
  const sized: Rect = {
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
    width: Math.max(MIN_WIDTH, Math.round(bounds.width)),
    height: Math.max(MIN_HEIGHT, Math.round(bounds.height)),
  };
  const titleStrip: Rect = { x: sized.x, y: sized.y, width: sized.width, height: 40 };
  const area = workAreas.find(candidate => {
    const o = overlap(titleStrip, candidate);
    return o.width >= MIN_VISIBLE && o.height > 0;
  });
  if (!area) return null;
  // Never larger than the display it lands on.
  sized.width = Math.min(sized.width, Math.max(MIN_WIDTH, area.width));
  sized.height = Math.min(sized.height, Math.max(MIN_HEIGHT, area.height));
  return { bounds: sized, maximized: maximized !== false };
}

export function readWindowState(file: string, workAreas: Rect[]): WindowState | null {
  try {
    return restoreWindowState(JSON.parse(fs.readFileSync(file, 'utf-8')), workAreas);
  } catch {
    return null;
  }
}

/** Synchronous on purpose: it runs from the window `close` event while the app may be quitting. */
export function writeWindowState(file: string, state: WindowState): void {
  const temp = `${file}.${process.pid}.tmp`;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(temp, JSON.stringify(state));
    fs.renameSync(temp, file);
  } catch {
    try { fs.rmSync(temp, { force: true }); } catch { /* best effort */ }
  }
}
