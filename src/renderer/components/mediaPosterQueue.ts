type CacheOptions = { maxEntries?: number; maxBytes?: number; maxWaiting?: number; failureTtlMs?: number; successTtlMs?: number; now?: () => number };
type Entry = { source: string; result: Promise<string | null>; resolve: (value: string | null) => void;
  subscribers: Array<() => boolean>; settled: boolean; value?: string | null; bytes: number; expires: number; priority: number };

/** Completed bytes, queued jobs and active work have independent hard limits.
 * Lower priority numbers win; invalidated in-flight results cannot replace a
 * newer request for the same source. */
export function createPosterQueue(load: (source: string, eligible: () => boolean) => Promise<string | null>,
  limit: number | (() => number) = 2,
  { maxEntries = 128, maxBytes = 16 * 1024 * 1024, maxWaiting = 128,
    failureTtlMs = 30_000, successTtlMs = Infinity, now = Date.now }: CacheOptions = {}) {
  const cache = new Map<string, Entry>(), completed = new Map<string, Entry>();
  const waiting: Entry[] = [];
  const listeners = new Set<() => void>();
  let bytes = 0, running = 0;
  const eligible = (entry: Entry) => entry.subscribers.some(check => check());
  function remove(entry: Entry) {
    if (cache.get(entry.source) === entry) cache.delete(entry.source);
    if (completed.get(entry.source) === entry) { completed.delete(entry.source); bytes -= entry.bytes; }
  }
  function cancel(entry: Entry) { remove(entry); entry.subscribers.length = 0; entry.resolve(null); }
  function prune() {
    for (const entry of completed.values()) if (entry.expires <= now()) remove(entry);
    while (completed.size > maxEntries || bytes > maxBytes) remove(completed.values().next().value!);
    for (let i = waiting.length - 1; i >= 0; i--) if (!eligible(waiting[i])) cancel(waiting.splice(i, 1)[0]);
  }
  function pump() {
    prune();
    const capacity = Math.max(1, typeof limit === 'function' ? limit() : limit);
    while (running < capacity && waiting.length) {
      let next = 0;
      for (let i = 1; i < waiting.length; i++) if (waiting[i].priority < waiting[next].priority) next = i;
      const entry = waiting.splice(next, 1)[0];
      if (!eligible(entry)) { cancel(entry); continue; }
      running++;
      Promise.resolve().then(() => load(entry.source, () => eligible(entry))).catch(() => null).then(value => {
        if (cache.get(entry.source) === entry) {
          if (!value && !eligible(entry)) remove(entry);
          else {
            entry.settled = true; entry.value = value;
            // UTF-16 reference/data URL bytes, not decoded bitmap or VRAM bytes.
            entry.bytes = 2 * (entry.source.length + (value?.length ?? 0));
            entry.expires = now() + (value ? successTtlMs : failureTtlMs);
            completed.set(entry.source, entry); bytes += entry.bytes; prune();
          }
        }
        entry.resolve(value);
      }).finally(() => { entry.subscribers.length = 0; running--; pump(); for (const listener of [...listeners]) listener(); });
    }
  }
  return {
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    snapshot: () => ({ running, waiting: waiting.length, entries: completed.size, bytes }),
    peek(source: string): string | null | undefined { prune(); const entry = cache.get(source); return entry?.settled ? entry.value : undefined; },
    request(source: string, check: () => boolean, priority = 0): Promise<string | null> {
      prune();
      const found = cache.get(source);
      if (found) {
        if (!found.settled) { found.subscribers.push(check); found.priority = Math.min(found.priority, priority); }
        else { completed.delete(source); completed.set(source, found); }
        return found.result;
      }
      if (!check()) return Promise.resolve(null);
      if (waiting.length >= maxWaiting) {
        let worst = 0;
        for (let i = 1; i < waiting.length; i++) if (waiting[i].priority >= waiting[worst].priority) worst = i;
        if (priority >= waiting[worst].priority) return Promise.resolve(null);
        cancel(waiting.splice(worst, 1)[0]);
      }
      let resolve!: (value: string | null) => void;
      const result = new Promise<string | null>(finish => { resolve = finish; });
      const entry: Entry = { source, result, resolve, subscribers: [check], settled: false, bytes: 0, expires: Infinity, priority };
      cache.set(source, entry); waiting.push(entry); pump();
      return result;
    },
    invalidate(source: string) { const entry = cache.get(source); if (entry) remove(entry); },
  };
}
