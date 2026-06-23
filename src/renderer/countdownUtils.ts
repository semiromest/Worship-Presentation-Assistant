export interface CountdownSlideData {
  minutes: number;
  seconds: number;
  totalSeconds: number;
  startTime: number;
  paused?: boolean;
  pausedRemaining?: number;
}

export function parseCountdownContent(content: string): CountdownSlideData {
  try {
    const raw = JSON.parse(content);
    const totalFromFields =
      (Math.max(0, parseInt(raw.minutes, 10) || 0) * 60) +
      Math.max(0, Math.min(59, parseInt(raw.seconds, 10) || 0));
    const totalSeconds = Math.max(
      0,
      parseInt(raw.totalSeconds, 10) || totalFromFields || 0
    );
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;

    return {
      minutes: parseInt(raw.minutes, 10) ?? minutes,
      seconds: parseInt(raw.seconds, 10) ?? seconds,
      totalSeconds,
      startTime: parseInt(raw.startTime, 10) || Date.now(),
      paused: Boolean(raw.paused),
      pausedRemaining:
        raw.pausedRemaining != null
          ? Math.max(0, parseInt(raw.pausedRemaining, 10) || 0)
          : undefined,
    };
  } catch {
    return {
      minutes: 5,
      seconds: 0,
      totalSeconds: 300,
      startTime: Date.now(),
      paused: false,
    };
  }
}

export function serializeCountdownContent(data: CountdownSlideData): string {
  const totalSeconds = Math.max(0, data.totalSeconds);
  const minutes = data.minutes ?? Math.floor(totalSeconds / 60);
  const seconds = data.seconds ?? totalSeconds % 60;

  return JSON.stringify({
    minutes,
    seconds,
    totalSeconds,
    startTime: data.startTime,
    ...(data.paused ? { paused: true, pausedRemaining: data.pausedRemaining } : {}),
  });
}

export function getCountdownRemaining(data: CountdownSlideData, now = Date.now()): number {
  if (data.paused && data.pausedRemaining != null) {
    return data.pausedRemaining;
  }
  const elapsed = Math.floor((now - data.startTime) / 1000);
  return Math.max(0, data.totalSeconds - elapsed);
}

export function formatCountdownTime(totalSeconds: number): string {
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function buildCountdownData(
  minutes: number,
  seconds: number,
  options?: { restart?: boolean; paused?: boolean; pausedRemaining?: number }
): CountdownSlideData {
  const m = Math.max(0, Math.min(99, minutes));
  const s = Math.max(0, Math.min(59, seconds));
  const totalSeconds = m * 60 + s;

  return {
    minutes: m,
    seconds: s,
    totalSeconds,
    startTime: Date.now(),
    paused: options?.paused ?? false,
    pausedRemaining: options?.pausedRemaining,
  };
}

export const COUNTDOWN_QUICK_PRESETS = [
  { label: '1 dk', minutes: 1, seconds: 0 },
  { label: '5 dk', minutes: 5, seconds: 0 },
  { label: '10 dk', minutes: 10, seconds: 0 },
  { label: '15 dk', minutes: 15, seconds: 0 },
  { label: '30 dk', minutes: 30, seconds: 0 },
] as const;

export const COUNTDOWN_THEMES = [
  { id: 'dark', name: 'Karanlık', backgroundColor: '#000000', textColor: '#ffffff' },
  { id: 'blue', name: 'Mavi', backgroundColor: '#1e3a8a', textColor: '#60a5fa' },
  { id: 'gold', name: 'Altın', backgroundColor: '#1c1917', textColor: '#f59e0b' },
  { id: 'clean', name: 'Açık', backgroundColor: '#f8fafc', textColor: '#0f172a' },
] as const;
