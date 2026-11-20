/**
 * Constant-rate output clock for network senders.
 *
 * Offscreen windows only paint when something changes, while NDI/encoders expect a steady frame
 * rate. The clock keeps the latest frame and hands it out on every tick, repeating it on static
 * slides. At most one send is in flight: a tick that finds the sender busy is counted as dropped
 * instead of queueing, so a slow receiver never builds latency or memory.
 */
export class OutputClock<T> {
  private latest: T | null = null;
  private busy = false;
  sent = 0;
  dropped = 0;
  repeated = 0;
  private fresh = false;

  /** Replaces the frame to send; older unsent frames are discarded. */
  push(frame: T): void {
    this.latest = frame;
    this.fresh = true;
  }

  /** Called on every clock tick. Returns the frame to send now, or null. */
  tick(): T | null {
    if (this.latest === null) return null;
    if (this.busy) { this.dropped++; return null; }
    this.busy = true;
    if (!this.fresh) this.repeated++;
    this.fresh = false;
    return this.latest;
  }

  /** The send started by the last non-null tick finished (successfully or not). */
  done(ok: boolean): void {
    this.busy = false;
    if (ok) this.sent++;
  }

  clear(): void {
    this.latest = null;
    this.fresh = false;
  }
}

/**
 * Holds video frames back by a fixed delay before they reach the output clock. The program audio
 * path (capture, 20 ms blocks, jitter buffer) trails the video; delaying the picture by the same
 * amount keeps lip sync on the receiver. Only a few frames are ever held.
 */
export class FrameDelay<T> {
  private queue: { frame: T; at: number }[] = [];
  constructor(private readonly delayMs: number, private readonly maxFrames = 8) {}

  push(frame: T, now: number): void {
    // Bursty paints or a delayed tick must never retain an unbounded number of full-size images.
    if (this.queue.length >= this.maxFrames) this.queue.shift();
    this.queue.push({ frame, at: now });
  }

  /** The newest frame old enough to show at `now`, or null if none became due. */
  release(now: number): T | null {
    let due: T | null = null;
    while (this.queue.length && now - this.queue[0].at >= this.delayMs) due = this.queue.shift()!.frame;
    return due;
  }

  clear(): void { this.queue = []; }
}
