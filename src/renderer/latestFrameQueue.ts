/** One in-flight render, one coalesced successor; invalidate before publish after any stop/change. */
export class LatestFrameQueue<T> {
  private running = false;
  private pending: T | undefined;
  private epoch = 0;
  private closed = false;
  constructor(private render: (value: T, valid: () => boolean) => Promise<void>,
    private error: (error: unknown) => void = console.error) {}
  request(value: T): void {
    if (this.closed) return;
    this.pending = value;
    if (!this.running) void this.pump();
  }
  invalidate(): void { this.epoch++; this.pending = undefined; }
  close(): void { this.closed = true; this.invalidate(); }
  private async pump(): Promise<void> {
    this.running = true;
    try {
      while (!this.closed && this.pending !== undefined) {
        const value = this.pending; this.pending = undefined;
        const epoch = this.epoch;
        try { await this.render(value, () => !this.closed && epoch === this.epoch); }
        catch (error) { if (!this.closed && epoch === this.epoch) this.error(error); }
      }
    } finally { this.running = false; }
  }
}
