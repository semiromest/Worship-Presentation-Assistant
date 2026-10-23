export const OPEN_SLIDE_MUSIC = 'presenter:open-slide-music';
export const PLAY_SLIDE_MUSIC = 'presenter:play-slide-music';

export function requestSlideMusic(slideId: string, trigger: HTMLButtonElement) {
  trigger.dispatchEvent(new CustomEvent(OPEN_SLIDE_MUSIC, { bubbles: true, detail: { slideId } }));
}

export function requestSlideMusicPlay(slideId: string) {
  window.dispatchEvent(new CustomEvent(PLAY_SLIDE_MUSIC, { detail: { slideId } }));
}
