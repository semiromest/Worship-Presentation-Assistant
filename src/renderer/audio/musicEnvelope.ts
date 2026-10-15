import { musicGain } from '../musicCustomization';

export const MUSIC_FADE_IN_MS = 500;
export const MUSIC_FADE_OUT_MS = 800;
type AudioVolume = Pick<HTMLMediaElement, 'volume' | 'muted'>;
interface Clock {
  now: () => number;
  schedule: (callback: () => void) => ReturnType<typeof setTimeout>;
  cancel: (timer: ReturnType<typeof setTimeout>) => void;
}

/** The sole writer of media volume: master × slide gain × transition envelope. */
export class MusicEnvelope {
  private master = 1;
  private gain = 1;
  private factor = 1;
  private muted = false;
  private timer?: ReturnType<typeof setTimeout>;
  private generation = 0;
  constructor(private audio: () => AudioVolume | null, private clock: Clock = {
    now: () => performance.now(), schedule: callback => setTimeout(callback, 16), cancel: timer => clearTimeout(timer),
  }) {}
  update(options: { master?: number; gain?: number; muted?: boolean }) {
    if (options.master !== undefined) this.master = musicGain(options.master);
    if (options.gain !== undefined) this.gain = musicGain(options.gain);
    if (options.muted !== undefined) this.muted = options.muted;
    this.apply();
  }
  private apply() {
    const audio = this.audio();
    if (audio) { audio.volume = this.master * this.gain * this.factor; audio.muted = this.muted; }
  }
  cancel() {
    this.generation++;
    if (this.timer !== undefined) this.clock.cancel(this.timer);
    this.timer = undefined;
  }
  reset(factor = 1) { this.cancel(); this.factor = musicGain(factor); this.apply(); }
  fadeTo(target: number, duration: number, complete?: () => void) {
    this.cancel();
    const generation = this.generation;
    const from = this.factor;
    const started = this.clock.now();
    const tick = () => {
      if (generation !== this.generation) return;
      const progress = duration > 0 ? Math.min(1, Math.max(0, (this.clock.now() - started) / duration)) : 1;
      this.factor = from + (musicGain(target) - from) * progress;
      this.apply();
      if (progress < 1) this.timer = this.clock.schedule(tick);
      else { this.timer = undefined; complete?.(); }
    };
    tick();
  }
}
