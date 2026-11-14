/**
 * Program audio mixer for the NDI sender thread.
 *
 * Sources (program-window video, control-window music) arrive as 20 ms planar stereo blocks from
 * separate renderer processes, each paced by its own audio clock. The mixer keeps a small jitter
 * buffer per source and the sender pulls at wall-clock rate, so source clocks drift against the
 * output. Drift is absorbed by reading slightly faster or slower (linear interpolation) while the
 * smoothed buffer level sits outside its band: proportional to the offset (~3 s time constant),
 * between 0.1 % and 0.5 %, which is inaudible as pitch and never a jump. Decisions use a smoothed level because the
 * instantaneous one swings by a whole block (20 ms in, 33 ms out). A source that runs dry plays
 * silence and refills to the target before it is heard again; a buffer above the limit is cut back.
 */
export const MIXER_SAMPLE_RATE = 48_000;
export const MIXER_CHANNELS = 2;

export interface AudioMixerOptions {
  sampleRate?: number;
  /** Jitter buffer each source refills to before playing, ms. */
  targetMs?: number;
  /** Half width of the band in which no rate correction is applied, ms. */
  toleranceMs?: number;
  /** Above this a burst is dropped back to the target at once, ms. */
  maxMs?: number;
  /** A source with no input for this long is forgotten, ms. */
  idleMs?: number;
  /** Smallest rate correction once outside the band, e.g. 0.001 = 0.1 %. */
  maxCorrection?: number;
  /** Largest proportional rate correction, e.g. 0.005. */
  fastCorrection?: number;
}

class SourceBuffer {
  private left: Float32Array;
  private right: Float32Array;
  private start = 0; // read position (integer part) in the arrays
  private end = 0; // write position
  private frac = 0; // fractional read position
  primed = false;
  /** Level low-pass filtered over ~0.5 s, frames. */
  smoothed = 0;
  lastPush = 0;
  corrections = 0;
  underruns = 0;

  constructor(capacity: number) {
    this.left = new Float32Array(capacity);
    this.right = new Float32Array(capacity);
  }

  get level(): number { return this.end - this.start - this.frac; }

  push(left: Float32Array, right: Float32Array): void {
    if (left.length > this.left.length) {
      // A block larger than the whole buffer: only its newest part can ever be played.
      left = left.subarray(left.length - this.left.length);
      right = right.subarray(right.length - this.left.length);
    }
    const n = left.length;
    if (this.end + n > this.left.length) this.compact(n);
    this.left.set(left, this.end);
    this.right.set(right, this.end);
    this.end += n;
  }

  dropTo(frames: number): void {
    const excess = Math.floor(this.level - frames);
    if (excess > 0) this.start += excess;
  }

  /** Adds `n` output frames read at `ratio` input frames per output frame. Returns frames read. */
  mixInto(outL: Float32Array, outR: Float32Array, n: number, ratio: number): number {
    const available = this.end - this.start - 1; // interpolation reads one ahead
    let produced = 0;
    let pos = this.frac;
    for (; produced < n; produced++) {
      const i = Math.floor(pos);
      if (i >= available) break;
      const f = pos - i;
      const a = this.start + i;
      outL[produced] += this.left[a] + (this.left[a + 1] - this.left[a]) * f;
      outR[produced] += this.right[a] + (this.right[a + 1] - this.right[a]) * f;
      pos += ratio;
    }
    const whole = Math.floor(pos);
    this.start += whole;
    this.frac = pos - whole;
    return produced;
  }

  reset(): void { this.start = this.end = 0; this.frac = 0; this.primed = false; }

  private compact(incoming: number): void {
    const live = this.end - this.start;
    if (live + incoming > this.left.length) {
      // Larger than capacity: keep only the newest part (the maxMs drop handles the rest).
      const keep = Math.max(0, this.left.length - incoming);
      this.start = this.end - Math.min(live, keep);
    }
    this.left.copyWithin(0, this.start, this.end);
    this.right.copyWithin(0, this.start, this.end);
    this.end -= this.start;
    this.start = 0;
  }
}

export class AudioMixer {
  readonly sampleRate: number;
  private readonly target: number;
  private readonly tolerance: number;
  private readonly max: number;
  private readonly idle: number;
  private readonly maxCorrection: number;
  private readonly fastCorrection: number;
  private readonly sources = new Map<string, SourceBuffer>();

  constructor(options: AudioMixerOptions = {}) {
    this.sampleRate = options.sampleRate ?? MIXER_SAMPLE_RATE;
    const frames = (ms: number) => Math.round((ms / 1000) * this.sampleRate);
    // 100 ms, measured on Windows: the sender pulls ~33 ms per tick, blocks arrive in 20 ms steps
    // with IPC jitter, and the main process pauses up to ~80 ms every few seconds (GC under 30 fps
    // frame capture). 25 and 40 ms ran dry every few seconds. The sender delays video to match.
    this.target = frames(options.targetMs ?? 100);
    this.tolerance = frames(options.toleranceMs ?? 15);
    this.max = frames(options.maxMs ?? 250);
    this.idle = options.idleMs ?? 500;
    this.maxCorrection = options.maxCorrection ?? 0.001;
    this.fastCorrection = options.fastCorrection ?? 0.005;
  }

  /** Planar stereo block: [left × n, right × n]. */
  push(sourceId: string, planar: Float32Array, now: number): void {
    const n = Math.floor(planar.length / MIXER_CHANNELS);
    if (n <= 0) return;
    let source = this.sources.get(sourceId);
    if (!source) { source = new SourceBuffer(this.max * 4); this.sources.set(sourceId, source); }
    if (now - source.lastPush > this.idle) source.reset();
    source.lastPush = now;
    source.push(planar.subarray(0, n), planar.subarray(n, 2 * n));
    if (source.level > this.max) source.dropTo(this.target);
    if (!source.primed && source.level >= this.target) { source.primed = true; source.smoothed = source.level; }
  }

  /** Mixes `n` frames of every primed source. Returns planar stereo [left × n, right × n]. */
  pull(n: number, now: number): Float32Array {
    const out = new Float32Array(n * MIXER_CHANNELS);
    const left = out.subarray(0, n);
    const right = out.subarray(n);
    for (const [id, source] of this.sources) {
      // A stopped source (paused video, ended track) is forgotten; its leftovers are stale.
      if (now - source.lastPush > this.idle) { this.sources.delete(id); continue; }
      if (!source.primed) continue;
      if (source.level > this.max) { source.dropTo(this.target); source.smoothed = source.level; }
      source.smoothed += (source.level - source.smoothed) * Math.min(1, n / (this.sampleRate * 0.5));
      const offset = source.smoothed - this.target;
      // Proportional: an offset fades with a ~3 s time constant, bounded to [maxCorrection, fastCorrection].
      const size = Math.min(this.fastCorrection, Math.max(this.maxCorrection, Math.abs(offset) / this.sampleRate / 3));
      const ratio = offset > this.tolerance ? 1 + size : offset < -this.tolerance ? 1 - size : 1;
      if (ratio !== 1) source.corrections++;
      const produced = source.mixInto(left, right, n, ratio);
      if (produced < n) { source.underruns++; source.primed = false; }
    }
    for (let i = 0; i < out.length; i++) out[i] = out[i] > 1 ? 1 : out[i] < -1 ? -1 : out[i];
    return out;
  }

  stats(): Record<string, { levelMs: number; primed: boolean; corrections: number; underruns: number }> {
    const result: Record<string, { levelMs: number; primed: boolean; corrections: number; underruns: number }> = {};
    for (const [id, s] of this.sources) {
      result[id] = { levelMs: Math.round((s.level / this.sampleRate) * 1000), primed: s.primed, corrections: s.corrections, underruns: s.underruns };
    }
    return result;
  }
}

/**
 * Frames the sender owes at wall-clock time `now` (ms since start). Large gaps (a stalled thread)
 * are not replayed as a burst: the clock skips ahead and reports the skip.
 */
export class AudioClock {
  private sent = 0;
  constructor(private readonly sampleRate = MIXER_SAMPLE_RATE, private readonly maxBurstMs = 100) {}
  due(nowMs: number): number {
    const expected = Math.floor((nowMs / 1000) * this.sampleRate);
    let n = expected - this.sent;
    const cap = Math.round((this.maxBurstMs / 1000) * this.sampleRate);
    if (n > cap) { this.sent = expected - cap; n = cap; }
    if (n < 0) n = 0;
    this.sent += n;
    return n;
  }
}
