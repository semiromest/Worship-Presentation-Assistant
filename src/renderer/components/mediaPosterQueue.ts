/** Deduplicated, bounded jobs; failures remain cached until an explicit retry. */
export function createPosterQueue(load: (source: string, eligible: () => boolean) => Promise<string | null>, limit = 2) {
  const cache = new Map<string, { result: Promise<string | null>; subscribers: Array<() => boolean>; settled: boolean }>();
  const waiting: Array<() => void> = [];
  let running = 0;
  function pump() {
    while (running < limit && waiting.length) waiting.shift()!();
  }
  return {
    request(source: string, eligible: () => boolean) {
      const found = cache.get(source);
      if (found) { if (!found.settled) found.subscribers.push(eligible); return found.result; }
      const subscribers = [eligible];
      const anyVisible = () => subscribers.some(check => check());
      const result = new Promise<string | null>(resolve => {
        waiting.push(() => {
          if (!anyVisible()) { cache.delete(source); resolve(null); return; }
          running++;
          Promise.resolve().then(() => load(source, anyVisible)).catch(() => null).then(value => {
            const entry = cache.get(source);
            if (entry?.subscribers === subscribers) {
              if (!value && !anyVisible()) cache.delete(source);
              else entry.settled = true;
            }
            resolve(value);
          }).finally(() => {
            subscribers.length = 0;
            running--;
            pump();
          });
        });
      });
      cache.set(source, { result, subscribers, settled: false });
      pump();
      return result;
    },
    invalidate(source: string) { cache.delete(source); },
  };
}
