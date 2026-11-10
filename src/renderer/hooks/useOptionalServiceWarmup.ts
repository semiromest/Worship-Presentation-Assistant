import { useEffect } from 'react';
import { useStore } from '../state/useStore';
import { useSttStore } from '../state/useSttStore';
import { usePractice } from './usePractice';

/** Idle module initialization only. No sign-in, network calls or music playback. */
export function useOptionalServiceWarmup(importing: boolean): void {
  const practice = usePractice();
  useEffect(() => {
    if (practice || importing || !window.electronAPI.warmOptionalService) return;
    let cancelled = false, index = 0, lastInput = performance.now();
    let timer: ReturnType<typeof setTimeout> | undefined, idle: number | undefined;
    const services = ['drive', 'youtube'] as const;
    const input = () => { lastInput = performance.now(); };
    const run = () => {
      if (cancelled || index >= services.length) return;
      const s = useStore.getState();
      if (document.documentElement.dataset.controlReady !== 'true' || performance.now() - lastInput < 2000 || document.hidden || s.isProjectorWindowOpen ||
        Object.values(s.outputAssignments).some(output => output.isOpen) || s.backgroundMusicPlaying ||
        s.screenShareActive || s.activeTab === 'screen' || [...document.querySelectorAll('video')].some(video => video.srcObject !== null) || useSttStore.getState().status !== 'idle' ||
        document.querySelector('[role="dialog"], [role="alertdialog"]')) { schedule(); return; }
      // A failure is left retryable by an explicit first-use request; no retry loop.
      void window.electronAPI.warmOptionalService(services[index++]).catch(() => {}).finally(schedule);
    };
    const schedule = () => {
      if (cancelled || index >= services.length) return;
      timer = setTimeout(() => {
        if ('requestIdleCallback' in window) idle = window.requestIdleCallback(run);
        else run();
      }, 2000);
    };
    document.addEventListener('pointerdown', input, true); document.addEventListener('keydown', input, true);
    schedule();
    return () => { cancelled = true; clearTimeout(timer); if (idle !== undefined) window.cancelIdleCallback(idle);
      document.removeEventListener('pointerdown', input, true); document.removeEventListener('keydown', input, true); };
  }, [practice, importing]);
}
