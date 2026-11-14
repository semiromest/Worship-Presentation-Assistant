import { useEffect, type RefObject } from 'react';
import { ProgramAudioTap, type ProgramAudioSource } from '../audio/programAudioTap';

const send = (source: ProgramAudioSource, block: Float32Array) => window.electronAPI?.programAudioPcm?.(source, block);

/** NDI Program window: every <video> it renders feeds the program audio (muted ones contribute silence). */
export function useProgramVideoAudio(enabled: boolean): void {
  useEffect(() => {
    if (!enabled || !window.electronAPI?.programAudioPcm) return;
    const tap = new ProgramAudioTap('video', send);
    const known = new Set<HTMLVideoElement>();
    const scan = () => {
      const current = new Set(document.querySelectorAll('video'));
      for (const video of current) if (!known.has(video)) { known.add(video); void tap.add(video); }
      for (const video of known) if (!current.has(video)) { known.delete(video); tap.remove(video); }
    };
    const observer = new MutationObserver(scan);
    observer.observe(document.body, { childList: true, subtree: true });
    scan();
    return () => { observer.disconnect(); tap.stop(); };
  }, [enabled]);
}

/** Control window: background music joins the program audio while NDI Program is on. */
export function useProgramMusicAudio(audioRef: RefObject<HTMLAudioElement | null>, enabled: boolean): void {
  useEffect(() => {
    const audio = audioRef.current;
    if (!enabled || !audio || !window.electronAPI?.programAudioPcm) return;
    const tap = new ProgramAudioTap('music', send);
    void tap.add(audio);
    return () => tap.stop();
  }, [audioRef, enabled]);
}
