export interface YouTubeMusicResult {
  id: string;
  title: string;
  duration: number;
}

export type YouTubeSearchResponse =
  | { ok: true; results: YouTubeMusicResult[] }
  | { ok: false; error: string };
export type YouTubePlayResponse =
  | { ok: true; streamId: string; url: string }
  | { ok: false; error: string };

export function isYouTubeVideoId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{11}$/.test(value);
}

export function isYouTubeMusicResult(value: unknown): value is YouTubeMusicResult {
  if (!value || typeof value !== 'object') return false;
  const track = value as Partial<YouTubeMusicResult>;
  return isYouTubeVideoId(track.id) && typeof track.title === 'string' &&
    track.title.trim().length > 0 && track.title.length <= 1000 &&
    typeof track.duration === 'number' && Number.isFinite(track.duration) && track.duration >= 0;
}
