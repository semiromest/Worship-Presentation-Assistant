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
