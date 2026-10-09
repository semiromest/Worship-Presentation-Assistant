import { createFrameQueue } from './frameQueue';

export interface PointerSample {
  pointerId: number;
  type: string;
}

/** Owns one pointer and guarantees exactly one completion, including disposal. */
export function createPointerSession<T, E extends PointerSample>(
  onMove: (event: E, start: T) => void,
  onFinish: (start: T, unmount: boolean) => void,
  schedule: (callback: () => void) => number,
  cancel: (id: number) => void
) {
  let active: { pointerId: number; start: T } | null = null;
  const queue = createFrameQueue<E>(
    (event) => {
      if (active) onMove(event, active.start);
    },
    schedule,
    cancel
  );
  const finish = (event?: E, unmount = false) => {
    if (!active || (event && event.pointerId !== active.pointerId)) return;
    if (event?.type === 'pointerup') queue.push(event);
    queue.flush();
    const start = active.start;
    active = null;
    onFinish(start, unmount);
  };
  return {
    begin(pointerId: number, start: T) {
      if (active) return false;
      active = { pointerId, start };
      return true;
    },
    move(event: E) {
      if (event.pointerId === active?.pointerId) queue.push(event);
    },
    finish,
    dispose() {
      finish(undefined, true);
      queue.cancel();
    },
  };
}
