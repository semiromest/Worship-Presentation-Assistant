/** Shared first-use/warmup initialization. Failures retry; disposed generations cannot escape. */
export class LazyService<T> {
  private pending?: Promise<T>;
  private value?: T;
  private epoch = 0;
  constructor(private load: () => Promise<T>, private cleanup: (value: T) => void) {}
  peek(): T | undefined { return this.value; }
  get(): Promise<T> {
    if (this.pending) return this.pending;
    const epoch = this.epoch;
    const pending = Promise.resolve().then(this.load).then(value => {
      if (epoch !== this.epoch) { this.cleanup(value); throw new Error('Service initialization cancelled'); }
      this.value = value; return value;
    }).catch(error => { if (this.pending === pending) this.pending = undefined; throw error; });
    this.pending = pending;
    return pending;
  }
  dispose(): void {
    this.epoch++; this.pending = undefined;
    if (this.value) this.cleanup(this.value);
    this.value = undefined;
  }
}
