import { chooseDefaultOutputDisplay, effectiveOutputSlideIndex } from '../shared/displays';
import { canAttachSlideMusic, isYouTubeMusicResult } from '../shared/youtubeMusic';
import type { useStore } from './state/useStore';
import type { Slide } from './types';

/** One audio owner, even when multiple output windows show the same slide. */
type MusicState = Pick<ReturnType<typeof useStore.getState>, 'displays' | 'outputAssignments' | 'isProjectorWindowOpen' | 'liveIndex' | 'presentation'>;
function audienceSlide(state: MusicState): Slide | null {
  const defaultId = chooseDefaultOutputDisplay(state.displays)?.id;
  const ids = [...new Set([
    ...(defaultId ? [defaultId] : []),
    ...Object.keys(state.outputAssignments).sort(),
  ])];
  for (const id of ids) {
    const assignment = state.outputAssignments[id];
    const open = assignment?.isOpen || (id === defaultId && state.isProjectorWindowOpen);
    if (!open || assignment?.mode === 'stage') continue;
    // The default audience output owns audio; other screens never double it.
    const index = effectiveOutputSlideIndex(assignment, state.liveIndex, state.presentation.slides.length);
    const slide = state.presentation.slides[index];
    return slide ?? null;
  }
  return null;
}

export function activeMusicSlide(state: MusicState): Slide | null {
  const slide = audienceSlide(state);
  return canAttachSlideMusic(slide ?? undefined) && isYouTubeMusicResult(slide?.youtubeMusic) ? slide : null;
}

export function hasAudienceOutput(state: MusicState): boolean { return audienceSlide(state) !== null; }

/** Physical audience cue, including slides without music, so metadata edits cannot start audio. */
export function audienceMusicCue(state: MusicState): string | null { return audienceSlide(state)?.id ?? null; }

export function musicPreparationIds(slides: Slide[], selectedId: string | null, liveIndex: number, liveVideoId?: string): string[] {
  const selected = slides.find(slide => slide.id === selectedId);
  const upcoming = [...slides.slice(liveIndex + 1), ...slides.slice(0, liveIndex + 1)]
    .find(slide => canAttachSlideMusic(slide) && isYouTubeMusicResult(slide.youtubeMusic) && slide.youtubeMusic.id !== liveVideoId);
  return [...new Set([selected && canAttachSlideMusic(selected) ? selected.youtubeMusic : undefined, upcoming?.youtubeMusic]
    .filter(isYouTubeMusicResult).map(track => track.id))].filter(id => id !== liveVideoId);
}
