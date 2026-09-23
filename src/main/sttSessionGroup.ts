/** Bounded per-connection audio queues; no target misses the beginning while
 * another target has already connected. Kept independent of Electron for tests. */
export class SttSessionGroup {
  private targets = new Map<string, { ready: boolean; queue: Uint8Array[]; send: (audio: Uint8Array) => void; waiters: (() => void)[] }>();
  constructor(private onError: (message: string) => void, private limit = 200) {}
  add(key: string, send: (audio: Uint8Array) => void): void { this.targets.set(key, { ready: false, queue: [], send, waiters: [] }); }
  waitReady(key: string): Promise<void> {
    const target = this.targets.get(key);
    if (target?.ready) return Promise.resolve();
    return new Promise(resolve => { target?.waiters.push(resolve); });
  }
  ready(key: string): void {
    const target = this.targets.get(key);
    if (!target) return;
    target.ready = true;
    try {
      for (const chunk of target.queue) target.send(chunk);
      target.queue = [];
      target.waiters.splice(0).forEach(resolve => resolve());
    }
    catch (error) { this.onError(String(error)); }
  }
  get connected(): boolean { return this.targets.size > 0 && [...this.targets.values()].every(t => t.ready); }
  send(audio: Uint8Array): void {
    try {
      for (const target of this.targets.values()) {
        if (target.ready) target.send(audio);
        else if (target.queue.length < this.limit) target.queue.push(audio);
        else throw new Error('Audio connection timed out: pending audio queue is full.');
      }
    } catch (error) { this.onError(String(error)); }
  }
}

export async function finishSttSession(session: { finish(): Promise<void>; close(): void }, timeoutMs = 3000, ready: Promise<void> = Promise.resolve()): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let canceled = false;
  try {
    await Promise.race([
      ready.then(() => { if (!canceled) return session.finish(); }),
      new Promise<void>(resolve => { timer = setTimeout(resolve, timeoutMs); }),
    ]);
  } catch { /* A connecting or failed session still needs close(). */ }
  finally { canceled = true; clearTimeout(timer); try { session.close(); } catch { /* Already closed. */ } }
}
