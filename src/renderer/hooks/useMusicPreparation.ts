import { useEffect } from 'react';
import { create } from 'zustand';
import { useStore } from '../state/useStore';
import { activeMusicSlide, musicPreparationIds } from '../musicSlides';
import { usePractice } from './usePractice';

type Status = 'preparing' | 'ready' | 'unavailable';
export const useMusicPreparationState = create<{ tracks: Record<string, Status> }>(() => ({ tracks: {} }));

function setStatus(id: string, status: Status) {
  useMusicPreparationState.setState(state => ({
    tracks: Object.fromEntries([...Object.entries(state.tracks).filter(([key]) => key !== id).slice(-7), [id, status]]),
  }));
}

/** Prepare the selected and next music source without touching playback. */
export function useMusicPreparation() {
  const practice = usePractice();
  const slides = useStore(state => state.presentation.slides);
  const selectedId = useStore(state => state.selectedSlideId);
  const liveIndex = useStore(state => state.liveIndex);
  const liveMusic = useStore(activeMusicSlide);
  const candidates = musicPreparationIds(slides, selectedId, liveIndex, liveMusic?.youtubeMusic?.id);
  const key = JSON.stringify(candidates);

  useEffect(() => {
    if (practice || !window.electronAPI?.youtubeMusicPrepare) return;
    let cancelled = false;
    const ids: string[] = JSON.parse(key);
    const prepare = async () => {
      for (const id of ids) {
        if (cancelled) return;
        setStatus(id, 'preparing');
        try {
          const result = await window.electronAPI.youtubeMusicPrepare(id);
          if (!cancelled) setStatus(id, result.ok ? 'ready' : 'unavailable');
        } catch { if (!cancelled) setStatus(id, 'unavailable'); }
      }
    };
    void prepare();
    const timer = setInterval(() => void prepare(), 90000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [key, practice]);
}
