import { app, safeStorage, shell } from 'electron';
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import { streamPresentationDownload } from './presentationDownload';

const callback = 'http://127.0.0.1:49182/oauth/redirect';
const api = 'https://api.canva.com/rest/v1/';
const signedOut = { signedIn: false, email: null };
declare const __WPA_CANVA_CLIENT_ID__: string;
declare const __WPA_CANVA_BROKER_URL__: string;
const clientId = process.env.WPA_CANVA_CLIENT_ID || (typeof __WPA_CANVA_CLIENT_ID__ === 'string' ? __WPA_CANVA_CLIENT_ID__ : '');
const brokerUrl = process.env.WPA_CANVA_BROKER_URL || (typeof __WPA_CANVA_BROKER_URL__ === 'string' ? __WPA_CANVA_BROKER_URL__ : '');
const broker = parseBroker(brokerUrl);
const tokenEndpoint = broker ? new URL('/token', broker).href : 'http://127.0.0.1:49183/token';
const redirectUri = broker ? new URL('/oauth/redirect', broker).href : callback;
const tokenFile = () => path.join(app.getPath('userData'), 'canva-session.enc');
interface CanvaSession { token: string; expiresAt: number; refreshToken?: string }
interface CanvaTokens { access_token: string; expires_in: number; refresh_token?: string }
let session: CanvaSession | null | undefined;
let pending: AbortController | undefined;
let refreshing: Promise<CanvaSession> | undefined;

function parseBroker(value: string): URL | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash && url.pathname === '/') return url;
  } catch { /* Invalid configuration is handled by available(). */ }
  return undefined;
}

function readSession(): CanvaSession | null {
  if (!broker || !safeStorage.isEncryptionAvailable()) return null;
  try {
    const saved = JSON.parse(safeStorage.decryptString(readFileSync(tokenFile())));
    if (saved.clientId === clientId && saved.broker === broker.href && typeof saved.token === 'string' &&
        typeof saved.refreshToken === 'string' && Number.isFinite(saved.expiresAt)) return saved;
  } catch { /* Missing or unreadable sessions require sign-in. */ }
  return null;
}

function saveSession(next: CanvaSession) {
  session = next;
  if (!broker || !next.refreshToken || !safeStorage.isEncryptionAvailable()) return;
  const target = tokenFile();
  const temporary = `${target}.${process.pid}.tmp`;
  try {
    const encrypted = safeStorage.encryptString(JSON.stringify({ ...next, clientId, broker: broker.href }));
    writeFileSync(temporary, encrypted, { mode: 0o600 });
    renameSync(temporary, target);
  } catch {
    try { unlinkSync(temporary); } catch { /* No temporary file to remove. */ }
    console.warn('Could not save the Canva session to the local profile');
  }
}

class CanvaRequestError extends Error {
  constructor(readonly status: number, readonly invalidGrant: boolean) {
    super(`Canva request failed (${status})`);
  }
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...options, redirect: 'error', signal: options?.signal ?? AbortSignal.timeout(15000) });
  if (!response.ok) {
    const invalidGrant = url === tokenEndpoint && (await response.json().catch(() => ({}))).error === 'invalid_grant';
    throw new CanvaRequestError(response.status, invalidGrant);
  }
  return await response.json() as T;
}

function exchangeToken(body: URLSearchParams, signal = AbortSignal.timeout(15000)) {
  return request<CanvaTokens>(tokenEndpoint, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body, signal,
  });
}

function toSession(token: CanvaTokens, previousRefreshToken?: string): CanvaSession {
  if (typeof token.access_token !== 'string' || !token.access_token || !Number.isFinite(token.expires_in) || token.expires_in <= 0) {
    throw new Error('Invalid Canva token response');
  }
  return {
    token: token.access_token,
    expiresAt: Date.now() + token.expires_in * 1000,
    refreshToken: typeof token.refresh_token === 'string' ? token.refresh_token : previousRefreshToken,
  };
}

async function activeSession(): Promise<CanvaSession | null> {
  if (session === undefined) session = readSession();
  const current = session;
  if (!current) return null;
  if (current.expiresAt > Date.now() + 30000) return current;
  if (!broker || !current.refreshToken) return current.expiresAt > Date.now() ? current : null;
  refreshing ??= exchangeToken(new URLSearchParams({ refresh_token: current.refreshToken })).then(token => {
    if (session !== current) throw new Error('Canva session changed');
    const next = toSession(token, current.refreshToken);
    saveSession(next);
    return next;
  }).finally(() => { refreshing = undefined; });
  try { return await refreshing; }
  catch (error) {
    if (session === current && error instanceof CanvaRequestError && error.invalidGrant) {
      canvaService.signOut();
      return null;
    }
    if (session === current && current.expiresAt > Date.now()) return current;
    throw error;
  }
}

function authorizationCode(url: URL, state: string, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      let target: URL;
      try { target = new URL(req.url ?? '/', callback); }
      catch { res.writeHead(400).end(); return; }
      if (target.pathname !== '/oauth/redirect' || target.searchParams.get('state') !== state) {
        res.writeHead(404).end();
        return;
      }
      const code = target.searchParams.get('code');
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'close' });
      res.end(code ? 'Return to Presenter to continue.' : 'Canva authorization was declined.');
      if (code) { cleanup(); resolve(code); }
      else fail(new Error('Canva authorization was declined'));
    });
    const cancel = () => fail(new Error('Canva authorization cancelled'));
    const timer = setTimeout(() => fail(new Error('Canva authorization timed out')), 120000);
    function cleanup() {
      clearTimeout(timer);
      signal.removeEventListener('abort', cancel);
      server.close();
    }
    function fail(error: Error) { cleanup(); reject(error); }
    signal.addEventListener('abort', cancel, { once: true });
    server.once('error', fail);
    server.listen(49182, '127.0.0.1', () => {
      if (!signal.aborted) void shell.openExternal(url.href).catch(fail);
    });
  });
}

export const canvaService = {
  available: () => !!clientId && (!brokerUrl || !!broker),
  async status() {
    if (!await activeSession()) return signedOut;
    return { signedIn: true, email: null };
  },
  cancel() { pending?.abort(); },
  signOut() {
    pending?.abort();
    if (broker) {
      try { unlinkSync(tokenFile()); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
    session = null;
  },
  async connect() {
    if (!this.available() || pending) return signedOut;
    const attempt = new AbortController();
    pending = attempt;
    try {
      const state = randomBytes(32).toString('base64url');
      const verifier = randomBytes(48).toString('base64url');
      const url = new URL('https://www.canva.com/api/oauth/authorize');
      url.search = new URLSearchParams({
        client_id: clientId, redirect_uri: redirectUri, response_type: 'code', state,
        scope: 'design:meta:read design:content:read', code_challenge_method: 's256',
        code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      }).toString();
      const code = await authorizationCode(url, state, attempt.signal);
      const token = await exchangeToken(new URLSearchParams({ code, code_verifier: verifier }),
        AbortSignal.any([attempt.signal, AbortSignal.timeout(15000)]));
      if (attempt.signal.aborted) return signedOut;
      saveSession(toSession(token));
      return { signedIn: true, email: null };
    } catch (error) {
      if (attempt.signal.aborted) return signedOut;
      throw error;
    } finally { pending = undefined; }
  },
  async list(query: string, continuation?: string) {
    const url = new URL('designs', api);
    if (query) url.searchParams.set('query', query);
    if (continuation) url.searchParams.set('continuation', continuation);
    const result = await request<{ items: { id: string; title?: string; design_types?: string[] }[]; continuation?: string }>(url.href, { headers: await auth() });
    return {
      files: result.items.filter(item => item.design_types?.includes('presentation')).map(item => ({ id: item.id, name: item.title || item.id })),
      nextPageToken: result.continuation,
    };
  },
  async export(id: string, target: string) {
    const headers = { ...await auth(), 'Content-Type': 'application/json' };
    type ExportJob = { job: { id: string; status: 'in_progress' | 'success' | 'failed'; urls?: string[] } };
    let result = await request<ExportJob>(api + 'exports', {
      method: 'POST', headers, body: JSON.stringify({ design_id: id, format: { type: 'pptx' } }),
    });
    const jobUrl = api + 'exports/' + encodeURIComponent(result.job.id);
    const deadline = Date.now() + 90000;
    while (result.job.status === 'in_progress' && Date.now() < deadline) {
      await delay(1500);
      result = await request<ExportJob>(jobUrl, { headers });
    }
    if (result.job.status !== 'success' || result.job.urls?.length !== 1) throw new Error('Canva PPTX export did not finish');
    const download = new URL(result.job.urls[0]);
    if (download.protocol !== 'https:' || !download.hostname.endsWith('.canva.com') || download.username || download.password || download.port) {
      throw new Error('Unexpected Canva download URL');
    }
    const response = await fetch(download, { redirect: 'error', signal: AbortSignal.timeout(60000) });
    if (!response.ok || !response.body) throw new Error('Canva download failed');
    await streamPresentationDownload(Readable.fromWeb(response.body as import('node:stream/web').ReadableStream), target, {
      archive: 100 * 1024 ** 2, json: 0,
    });
  },
};

async function auth() {
  const active = await activeSession();
  if (!active) throw new Error('Connect Canva again');
  return { Authorization: 'Bearer ' + active.token };
}
