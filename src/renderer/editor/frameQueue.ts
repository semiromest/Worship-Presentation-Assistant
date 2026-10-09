/** One pending frame; flushing applies the latest sample before a gesture ends. */
export function createFrameQueue<T>(
  apply: (sample: T) => void,
  schedule: (callback: () => void) => number,
  cancel: (id: number) => void
) {
  let frame: number | null = null;
  let latest: T | undefined;
  const flush = () => {
    if (frame !== null) cancel(frame);
    frame = null;
    const sample = latest;
    latest = undefined;
    if (sample !== undefined) apply(sample);
  };
  return {
    push(sample: T) {
      latest = sample;
      if (frame === null) frame = schedule(flush);
    },
    flush,
    cancel() {
      if (frame !== null) cancel(frame);
      frame = null;
      latest = undefined;
    },
  };
}
