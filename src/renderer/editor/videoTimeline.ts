/** Smallest allowed distance between the trim start and end, in seconds (one timecode centisecond). */
const MIN_TRIM_GAP = 0.01;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * Converts a pointer position over the timeline into a time in seconds, clamped to `[0, duration]`.
 * Returns 0 when the geometry, duration or pointer position is unusable (never NaN).
 */
export function timelineTime(clientX: number, left: number, width: number, duration: number): number {
  if (!(width > 0) || !(duration > 0) || !Number.isFinite(clientX) || !Number.isFinite(left)) return 0;
  return clamp(((clientX - left) / width) * duration, 0, duration);
}

/**
 * Clamps a proposed trim boundary so the range keeps at least `MIN_TRIM_GAP` seconds and stays inside the clip.
 *
 * `start` / `end` are the current boundaries and may be non-finite (a cleared number input is NaN);
 * a missing opposite boundary simply stops constraining the result. A non-finite `time` keeps the current boundary.
 */
export function trimBoundary(
  kind: 'start' | 'end',
  time: number,
  start: number,
  end: number,
  duration: number
): number {
  if (!(duration > 0)) return 0;
  const gap = Math.min(MIN_TRIM_GAP, duration / 2);

  if (kind === 'start') {
    const upper = (Number.isFinite(end) ? Math.min(end, duration) : duration) - gap;
    const value = Number.isFinite(time) ? time : Number.isFinite(start) ? start : 0;
    return Math.max(0, Math.min(value, upper));
  }

  const lower = Number.isFinite(start) ? Math.max(start, 0) + gap : 0;
  const value = Number.isFinite(time) ? time : Number.isFinite(end) ? end : duration;
  return Math.min(duration, Math.max(value, lower));
}

const pad2 = (value: number) => value.toString().padStart(2, '0');

/**
 * Formats seconds as `mm:ss.cc` (centiseconds). Minutes are not wrapped into hours, so 75 minutes
 * reads `75:00.00`. Negative and non-finite input is shown as `00:00.00`.
 */
export function videoTimecode(seconds: number): string {
  const centiseconds = Math.round((Number.isFinite(seconds) ? Math.max(0, seconds) : 0) * 100);
  const minutes = Math.floor(centiseconds / 6000);
  const wholeSeconds = Math.floor(centiseconds / 100) % 60;
  return `${pad2(minutes)}:${pad2(wholeSeconds)}.${pad2(centiseconds % 100)}`;
}