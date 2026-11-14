import { useEffect, useRef } from 'react';
import { useStore } from '../state/useStore';
import { useSttStore } from '../state/useSttStore';
import { collectSlideImages, phoneImageLanguages, translatedPhoneImages } from '../slideImages';
import type { ShareSlideImage } from '../../shared/share';

/** Pictures phones get per slide; more than this is clutter on a phone screen. */
const MAX_PHONE_IMAGES = 2;

/**
 * Follows the live slide while the phone share runs: its pictures go to phones at once, and each
 * one is translated into every phone language in the background (stored results come back
 * instantly). Nothing is added to the deck. `publish` re-sends the share snapshot.
 */
export function useShareSlideImages(enabled: boolean, publish: () => void): React.MutableRefObject<ShareSlideImage[]> {
  const imagesRef = useRef<ShareSlideImage[]>([]);
  const publishRef = useRef(publish);
  publishRef.current = publish;

  useEffect(() => {
    if (!enabled) return;
    let generation = 0;
    let lastKey = '';

    const sync = () => {
      const state = useStore.getState();
      const stt = useSttStore.getState();
      const api = window.electronAPI?.imageTranslate;
      const active = state.shareActive && state.shareSlideImagesEnabled;
      const slide = active ? state.presentation.slides.find((s) => s.id === state.liveSlideId) : undefined;
      const urls = collectSlideImages(slide).slice(0, MAX_PHONE_IMAGES).map((img) => img.url);
      const languages = api ? phoneImageLanguages(stt.targetLanguages, stt.targetLanguage) : [];
      const key = `${urls.join('|')}#${languages.join(',')}`;
      if (key === lastKey) return;
      lastKey = key;
      const run = ++generation;
      // Phones only ever see a picture once a translated copy exists: a picture without readable
      // text (or already in the phone's language) never shows up there.
      const found = new Map<string, Record<string, string>>();
      if (imagesRef.current.length) {
        imagesRef.current = [];
        publishRef.current();
      }
      if (!api || !urls.length || !languages.length) return;

      void (async () => {
        for (const url of urls) {
          for (const lang of languages) {
            if (run !== generation) return;
            try {
              const result = await api(url, 'auto', lang);
              if (run !== generation) return;
              if (result.ok) {
                found.set(url, { ...found.get(url), [lang]: result.ref });
                imagesRef.current = translatedPhoneImages(urls, found);
                publishRef.current();
              }
            } catch {
              /* offline or failed: nothing is shown for this picture */
            }
          }
        }
      })();
    };

    const offStore = useStore.subscribe(sync);
    const offStt = useSttStore.subscribe(sync);
    sync();
    return () => {
      generation++;
      offStore();
      offStt();
      imagesRef.current = [];
    };
  }, [enabled]);

  return imagesRef;
}
