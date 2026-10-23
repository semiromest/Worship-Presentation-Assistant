import type { Slide } from './presentation';

/** Hymn groups imported before kind existed carry a hymn color/author. */
export function canAttachSlideMusic(slide: Slide | undefined): boolean {
  return !!slide && slide.type !== 'video' && slide.type !== 'screen' && !slide.styles?.backgroundVideo &&
    !slide.partsMode && !slide.parts?.length && !slide.group?.kind && !slide.group?.color && !slide.group?.author &&
    !(slide.type === 'loop' && slide.loopItems?.some(item => item.type === 'video'));
}

/** Existing standalone music slides retain autoplay; new attachments opt in. */
export function slideMusicAutoPlay(slide: Slide): boolean {
  return slide.musicSettings?.autoPlay ?? !slide.musicSettings?.attachment;
}

export interface YouTubeMusicResult {
  id: string;
  title: string;
  duration: number;
}

export type OfflineMusicStatus = { state: 'missing' | 'downloading' | 'ready' } | { state: 'error'; error: string };

export type YouTubeSearchResponse =
  | { ok: true; results: YouTubeMusicResult[]; nextCursor?: string }
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
