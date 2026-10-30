type Task = () => Promise<void>;

/** One active generation and one replaceable pending generation. Enqueueing
 * rapid edits does not retain a chain of obsolete promises and snapshots. */
export class LatestPreviewQueue {
  private pending: { task: Task } | undefined;
  private running = false;
  constructor(private readonly onError: (error: unknown) => void) {}
  get pendingCount(): number { return this.pending ? 1 : 0; }
  get activeCount(): number { return this.running ? 1 : 0; }
  schedule(task: Task): () => void {
    const ticket = { task }; this.pending = ticket;
    if (!this.running) void this.drain();
    return () => { if (this.pending === ticket) this.pending = undefined; };
  }
  private async drain(): Promise<void> {
    this.running = true;
    try {
      while (this.pending) {
        const ticket = this.pending; this.pending = undefined;
        try { await ticket.task(); }
        catch (error) { try { this.onError(error); } catch { /* Logging cannot strand the pending generation. */ } }
      }
    } finally { this.running = false; }
  }
}
