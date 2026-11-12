const loopback = 'http://127.0.0.1:49182/oauth/redirect';
const tokenUrl = 'https://api.canva.com/rest/v1/oauth/token';
const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const json = (data, status = 200) => Response.json(data, { status, headers });
    if (request.method === 'GET' && url.pathname === '/health') return json({ ok: true });
    if (request.method === 'GET' && url.pathname === '/oauth/redirect') {
      const state = url.searchParams.get('state');
      const code = url.searchParams.get('code');
      if (!/^[\w-]{43}$/.test(state ?? '') || (code !== null && (!code || code.length > 2048))) {
        return json({ error: 'invalid_callback' }, 400);
      }
      const next = new URL(loopback);
      next.searchParams.set('state', state);
      if (code) next.searchParams.set('code', code);
      return new Response(null, { status: 303, headers: { ...headers, Location: next.href } });
    }
    if (url.pathname !== '/token' || request.method !== 'POST' || request.headers.has('origin')) {
      return json({ error: 'not_found' }, 404);
    }
    if (!request.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded')) {
      return json({ error: 'invalid_request' }, 415);
    }
    if (!env.CANVA_CLIENT_ID || !env.CANVA_CLIENT_SECRET || !env.CANVA_REDIRECT_URI) {
      return json({ error: 'not_configured' }, 503);
    }

    const reader = request.body?.getReader();
    const decoder = new TextDecoder();
    let body = '';
    let bytes = 0;
    try {
      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 8192) { await reader.cancel(); return json({ error: 'invalid_request' }, 413); }
        body += decoder.decode(value, { stream: true });
      }
      const input = new URLSearchParams(body + decoder.decode());
      const refresh = input.get('refresh_token');
      const code = input.get('code');
      const verifier = input.get('code_verifier');
      let form;
      if (refresh && refresh.length <= 4096 && !code && !verifier) {
        form = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refresh });
      } else if (!refresh && code && code.length <= 2048 && /^[\w.~\-]{43,128}$/.test(verifier ?? '')) {
        form = new URLSearchParams({
          grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: env.CANVA_REDIRECT_URI,
        });
      } else {
        return json({ error: 'invalid_request' }, 400);
      }

      const result = await fetch(tokenUrl, {
        method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(12000),
        headers: {
          Authorization: 'Basic ' + btoa(env.CANVA_CLIENT_ID + ':' + env.CANVA_CLIENT_SECRET),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: form,
      });
      if (result.status >= 300 && result.status < 400) return json({ error: 'unexpected_canva_redirect' }, 502);
      if (!result.ok) {
        const { code: reason } = await result.json().catch(() => ({}));
        return json({ error: reason === 'invalid_grant' ? reason : 'canva_token_exchange_failed' }, result.status);
      }
      const { access_token, refresh_token, expires_in } = await result.json();
      return json({ access_token, refresh_token, expires_in });
    } catch {
      return json({ error: 'canva_unreachable' }, 502);
    }
  },
};
