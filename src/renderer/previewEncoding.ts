/** Encode without the synchronous canvas.toDataURL hot path. */
export function encodePreview(canvas: HTMLCanvasElement, quality = 0.65): Promise<string> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (!blob) { reject(new Error('Preview encoding returned no data')); return; }
      let reader: FileReader | undefined;
      const clear = () => { if (reader) { reader.onload = null; reader.onerror = null; reader.onabort = null; } };
      try {
        reader = new FileReader();
        reader.onload = () => { const result = reader?.result; clear(); if (typeof result === 'string') resolve(result); else reject(new Error('Invalid preview')); };
        reader.onerror = reader.onabort = () => { clear(); reject(new Error('Preview read failed')); };
        reader.readAsDataURL(blob);
      } catch (error) { clear(); reject(error); }
    }, 'image/webp', quality);
  });
}
export async function yieldPreviewWork(): Promise<void> {
  const scheduler = (globalThis as unknown as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  if (scheduler?.yield) await scheduler.yield();
  else await new Promise<void>(resolve => setTimeout(resolve, 0));
}
/** A failed lane must not let a newer generation overlap a still-running lane. */
export async function runPreviewWorkers(count: number, worker: () => Promise<void>): Promise<void> {
  const results = await Promise.allSettled(Array.from({ length: count }, worker));
  const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
  if (failure) throw failure.reason;
}

export function previewPriority(count: number, live: number, visible: number[]): number[] {
  const order = new Set([live, live - 1, live + 1, ...visible]);
  for (let i = 0; i < count; i++) order.add(i);
  return [...order].filter(i => i >= 0 && i < count);
}
export function takeNextPreview(remaining: Set<number>, live: number, visible: number[]): number | undefined {
  const next = [live, live - 1, live + 1, ...visible].find(index => remaining.has(index)) ?? remaining.values().next().value;
  if (next !== undefined) remaining.delete(next);
  return next;
}
