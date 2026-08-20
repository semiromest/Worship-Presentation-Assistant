/**
 * Phone captions/translation share service.
 *
 * A pure consumer of the renderer's normalized STT state. The renderer pushes
 * a `ShareSnapshot` via IPC; this module holds the latest snapshot, validates
 * the per-broadcast token, serves the mobile client at `/share?token=…`, and
 * fans the snapshot out to every connected phone over WebSocket.
 *
 * It is wired into the EXISTING remote HTTP + WebSocket server in main.ts (no
 * second server, no second port). Phones never touch Soniox, Node, or any
 * Electron API — they only receive the normalized strings below.
 */

import crypto from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { WebSocket as WsSocket } from 'ws';
import type { ShareSnapshot, ShareStatus } from '../shared/share';
import { SHARE_HTML } from './share-html';

/** Bounded finalized history kept for late-joining phones. */
const MAX_HISTORY = 15;

const active = {
  token: null as string | null,
  ip: null as string | null,
  port: null as number | null,
  lastSnapshot: null as ShareSnapshot | null,
};

/** Connected phone clients for the CURRENT broadcast only. */
const clients = new Set<WsSocket>();

/** Optional hook so main.ts can surface the connected-client count to the UI. */
let clientCountListener: ((count: number) => void) | null = null;

export function setClientCountListener(listener: ((count: number) => void) | null): void {
  clientCountListener = listener;
}

function newToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

function tokenMatches(provided: string | null | undefined): boolean {
  if (!active.token || !provided) return false;
  const a = Buffer.from(active.token);
  const b = Buffer.from(provided);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function queryToken(url: string | undefined): string | null {
  try {
    return new URL(url ?? '/', 'http://localhost').searchParams.get('token');
  } catch {
    return null;
  }
}

function buildUrl(): string {
  if (!active.ip || !active.port || !active.token) return '';
  return `http://${active.ip}:${active.port}/share?token=${active.token}`;
}

function send(client: WsSocket, msg: object): void {
  if (client.readyState !== WsSocket.OPEN) return;
  try {
    client.send(JSON.stringify(msg));
  } catch {
    /* dead socket, ignore */
  }
}

function notifyClientCount(): void {
  clientCountListener?.(clients.size);
}

/** Start a broadcast. Returns the QR/URL, or null when already active. */
export function startShare(ip: string, port: number): { url: string } | null {
  if (active.token) return null;
  active.token = newToken();
  active.ip = ip;
  active.port = port;
  active.lastSnapshot = null;
  return { url: buildUrl() };
}

/** Stop the broadcast: invalidate the token and drop every phone connection. */
export function stopShare(): void {
  for (const client of clients) {
    send(client, { type: 'ended' });
  }
  // Let the `ended` frame flush briefly before tearing the sockets down.
  const doomed = [...clients];
  clients.clear();
  notifyClientCount();
  const timer = setTimeout(() => {
    for (const client of doomed) {
      try { client.terminate(); } catch { /* already closed */ }
    }
  }, 50);
  timer.unref?.();
  active.token = null;
  active.ip = null;
  active.port = null;
  active.lastSnapshot = null;
}

export function isShareActive(): boolean {
  return active.token !== null;
}

export function publishShare(snapshot: ShareSnapshot): void {
  if (!active.token) return;
  // Bound the history the phones receive (they only need the recent tail).
  const bounded: ShareSnapshot = {
    ...snapshot,
    history: snapshot.history.slice(-MAX_HISTORY),
  };
  active.lastSnapshot = bounded;
  const str = JSON.stringify({ type: 'snapshot', data: bounded });
  for (const client of clients) {
    if (client.readyState === WsSocket.OPEN) {
      try { client.send(str); } catch { /* ignore */ }
    }
  }
}

/** Re-resolve the host after a network change. Returns true if the URL changed. */
export function refreshShareHost(ip: string, port: number): boolean {
  if (!active.token) return false;
  const before = buildUrl();
  active.ip = ip;
  active.port = port;
  return buildUrl() !== before;
}

export function getShareStatus(): ShareStatus {
  return {
    active: active.token !== null,
    url: active.token ? buildUrl() : '',
    clientCount: clients.size,
  };
}

/**
 * Serve the `/share` HTTP route. Returns true when the request was handled
 * (the caller should not continue routing).
 */
export function handleShareHttp(req: IncomingMessage, res: ServerResponse): boolean {
  const token = queryToken(req.url);
  if (!active.token || !tokenMatches(token)) {
    res.writeHead(403, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<!DOCTYPE html><html><body style="background:#000;color:#d6e8ff;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><p>Broadcast ended or invalid link.</p></body></html>');
    return true;
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(SHARE_HTML);
  return true;
}

/**
 * Handle a WebSocket upgrade. Returns true when the connection was consumed as
 * a share (phone) client; the remote-control path must handle it otherwise.
 */
export function handleShareConnection(client: WsSocket, req: IncomingMessage): boolean {
  const url = req.url ?? '';
  if (!url.startsWith('/share')) return false;

  const token = queryToken(url);
  if (!active.token || !tokenMatches(token)) {
    // Invalid/expired token — reject before any data is exchanged.
    try { client.close(1008, 'Invalid or expired token'); } catch { /* ignore */ }
    return true;
  }

  clients.add(client);
  notifyClientCount();

  // Initial snapshot so a phone joining mid-broadcast sees text immediately.
  if (active.lastSnapshot) {
    send(client, { type: 'hello', data: active.lastSnapshot });
  } else {
    send(client, { type: 'hello', data: null });
  }

  client.on('close', () => {
    clients.delete(client);
    notifyClientCount();
  });
  client.on('error', () => {
    try { client.terminate(); } catch { /* ignore */ }
    clients.delete(client);
    notifyClientCount();
  });

  return true;
}

/** Called on app quit — drop every phone connection without an `ended` frame. */
export function disposeShare(): void {
  for (const client of clients) {
    try { client.terminate(); } catch { /* ignore */ }
  }
  clients.clear();
  active.token = null;
  active.ip = null;
  active.port = null;
  active.lastSnapshot = null;
}
