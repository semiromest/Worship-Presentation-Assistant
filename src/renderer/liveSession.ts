import type { Presentation } from './types';
import { getSlideDisplayContent } from '../shared/slideContent';

const KEY = 'presenter.liveSession.v1';
interface Session { savedAt: number; slideId: string | null; parts: Record<string, number> }
type Sessions = Record<string, Session>;
function read(): Sessions {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; }
}
export function writeLiveSession(presentation: Presentation, slideId: string | null): void {
  const sessions = read();
  sessions[presentation.id || presentation.name] = {
    savedAt: Date.now(), slideId,
    parts: Object.fromEntries(presentation.slides.filter(s => s.partsMode).map(s => [s.id, s.activePart ?? 0])),
  };
  const entries = Object.entries(sessions).sort((a, b) => b[1].savedAt - a[1].savedAt).slice(0, 100);
  localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(entries)));
}
export function restoreLiveSession(presentation: Presentation, savedAt: number): Presentation {
  const session = read()[presentation.id || presentation.name];
  if (!session || !Number.isFinite(session.savedAt) || session.savedAt < savedAt) return presentation;
  const slides = presentation.slides.map(s => {
    const part = session.parts?.[s.id];
    if (!s.partsMode || !s.parts?.length || !Number.isInteger(part) || part < 0 || part >= s.parts.length) return s;
    const next = { ...s, activePart: part };
    return { ...next, content: getSlideDisplayContent(next) };
  });
  return { ...presentation, slides, liveSlideId: slides.some(s => s.id === session.slideId) ? session.slideId! : presentation.liveSlideId };
}
/** Part navigation updates compatibility content, but does not edit the deck. */
export function isSessionOnlyChange(previous: Presentation, next: Presentation): boolean {
  if (previous === next) return true;
  const keys = new Set([...Object.keys(previous), ...Object.keys(next)]);
  for (const key of keys) {
    if (key !== 'slides' && previous[key as keyof Presentation] !== next[key as keyof Presentation]) return false;
  }
  return previous.slides.length === next.slides.length && previous.slides.every((old, i) => {
    const slide = next.slides[i];
    if (old === slide) return true;
    if (!old.partsMode || !slide.partsMode || old.parts !== slide.parts) return false;
    return [...new Set([...Object.keys(old), ...Object.keys(slide)])].every(key =>
      key === 'activePart' || key === 'content' || old[key as keyof typeof old] === slide[key as keyof typeof slide],
    ) && slide.content === getSlideDisplayContent(slide);
  });
}
