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
