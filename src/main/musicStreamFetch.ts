/** Time out stalled network operations, not the lifetime of a playing song. */
export const fetchMusicStream: typeof fetch = async (input, init) => {
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), 20000);
  let response: Response;
  try {
    response = await fetch(input, { ...init,
      signal: init?.signal ? AbortSignal.any([init.signal, abort.signal]) : abort.signal });
  } finally { clearTimeout(timeout); }
  if (!response.ok || !response.body) return response;
  const reader = response.body.getReader();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const timeout = setTimeout(() => abort.abort(), 20000);
      try {
        const next = await reader.read();
        if (next.done) controller.close();
        else controller.enqueue(next.value);
      } catch (error) { controller.error(error); void reader.cancel().catch(() => {}); }
      finally { clearTimeout(timeout); }
    },
    cancel() { abort.abort(); return reader.cancel(); },
  }, { highWaterMark: 0 });
  return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
};

/** Bu kadar veri getiren yanıt ilerleme sayılır; bir sonraki istek beklemeden gider. */
export const SABR_PROGRESS_BYTES = 16 * 1024;

/**
 * SABR istek döngüsünü yalnızca sunucu yeni medya vermediğinde yavaşlatır.
 * Önceki yanıt ilerleme getirdiyse (ilk saniyelerde çoğu zaman) istek hemen çıkar;
 * böylece çalmanın başı her istekte sabit bekleme yemez, boş yanıt döngüsü yine frenlenir.
 */
export function pacedMusicFetch(
  fetcher: typeof fetch,
  gapMs: number,
  wait: (ms: number) => Promise<unknown>,
): typeof fetch {
  let requests = 0;
  let lastBytes = Infinity;
  return async (input, init) => {
    if (requests++ > 0 && lastBytes < SABR_PROGRESS_BYTES) await wait(gapMs);
    lastBytes = 0;
    const response = await fetcher(input, init);
    if (!response.body) return response;
    const counter = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) { lastBytes += chunk.byteLength; controller.enqueue(chunk); },
    });
    return new Response(response.body.pipeThrough(counter), { status: response.status, statusText: response.statusText, headers: response.headers });
  };
}
