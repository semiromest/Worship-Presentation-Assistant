import { createServer } from 'node:http';

const clientId = process.env.WPA_CANVA_CLIENT_ID;
const secret = process.env.WPA_CANVA_CLIENT_SECRET;
if (!clientId || !secret) throw new Error('Set WPA_CANVA_CLIENT_ID and WPA_CANVA_CLIENT_SECRET in this terminal.');

const address = '127.0.0.1';
const port = 49183;
const authorization = 'Basic ' + Buffer.from(clientId + ':' + secret).toString('base64');

const server = createServer(async (req, res) => {
  const send = (status, data) => {
    res.writeHead(status, {
      'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
    });
    res.end(JSON.stringify(data));
  };
  if (req.method !== 'POST' || req.url !== '/token' || req.headers.host !== address + ':' + port ||
      req.headers.origin || req.headers['sec-fetch-site']) {
    return send(404, { error: 'not_found' });
  }
  if (!req.headers['content-type']?.startsWith('application/x-www-form-urlencoded')) {
    return send(415, { error: 'unsupported_content_type' });
  }
  try {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 8192) return send(413, { error: 'request_too_large' });
      chunks.push(chunk);
    }
    const input = new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
    const code = input.get('code');
    const verifier = input.get('code_verifier');
    if (!code || code.length > 2048 || !verifier || !/^[\w.~\-]{43,128}$/.test(verifier)) {
      return send(400, { error: 'invalid_request' });
    }
    const result = await fetch('https://api.canva.com/rest/v1/oauth/token', {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(12000),
      headers: { Authorization: authorization, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code', code, code_verifier: verifier,
        redirect_uri: 'http://127.0.0.1:49182/oauth/redirect',
      }),
    });
    if (!result.ok) {
      const { code } = await result.json().catch(() => ({}));
      const knownErrors = ['invalid_access_token', 'invalid_client', 'invalid_grant', 'unauthorized_client', 'unauthorized_user'];
      const reason = knownErrors.includes(code) ? code : 'canva_token_exchange_failed';
      process.stderr.write(`Canva token exchange failed (HTTP ${result.status}, ${reason})\n`);
      return send(result.status, { error: reason });
    }
    const { access_token, expires_in } = await result.json();
    return send(200, { access_token, expires_in });
  } catch {
    if (!res.headersSent) send(502, { error: 'canva_token_exchange_failed' });
  }
});

server.requestTimeout = 15000;
server.on('error', error => {
  const message = error.code === 'EADDRINUSE'
    ? 'Port 49183 is already in use. Stop the existing Canva broker before starting another.'
    : `Could not start the Canva broker (${error.code ?? 'unknown error'}).`;
  process.stderr.write(message + '\n');
  process.exitCode = 1;
});
server.listen(port, address, () => process.stdout.write('Canva test broker listening on 127.0.0.1:49183\n'));
