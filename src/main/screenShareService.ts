/**
 * Live-screen phone broadcast service.
 *
 * Lets people watch the projected live screen (e.g. the Canlı Ekran source)
 * fullscreen on their phones — useful when the screen is far away. The control
 * renderer captures JPEG frames from its live screen preview and pushes them
 * here via IPC; this module validates the per-broadcast token, serves the
 * mobile client at `/screen?token=…`, and fans each frame out to every
 * connected phone over WebSocket (view-only, no controls).
 *
 * Wired into the EXISTING remote HTTP + WebSocket server in main.ts — no
 * second server, no second port. Phones never touch Electron APIs.
 */

import crypto from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { WebSocket as WsSocket } from 'ws';
import type { ScreenShareStatus } from '../shared/share';
import { SCREEN_SHARE_HTML } from './screen-share-html';

const active = {
  token: null as string | null,
  ip: null as string | null,
  port: null as number | null,
  lastFrame: null as string | null,
};

/** Connected phone clients for the CURRENT broadcast only. */
const clients = new Set<WsSocket>();

/** Optional hook so main.ts can surface the connected-client count to the UI. */
let clientCountListener: ((count: number) => void) | null = null;

export function setScreenShareClientCountListener(listener: ((count: number) => void) | null): void {
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
  return `http://${active.ip}:${active.port}/screen?token=${active.token}`;
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
export function startScreenShare(ip: string, port: number): { url: string } | null {
  if (active.token) return null;
  active.token = newToken();
  active.ip = ip;
  active.port = port;
  active.lastFrame = null;
  return { url: buildUrl() };
}

/** Stop the broadcast: invalidate the token and drop every phone connection. */
export function stopScreenShare(): void {
  for (const client of clients) {
    send(client, { type: 'ended' });
  }
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
  active.lastFrame = null;
}

export function isScreenShareActive(): boolean {
  return active.token !== null;
}

/** Publish a JPEG frame (data URL) to every connected phone. */
export function publishScreenFrame(frame: string): void {
  if (!active.token || !frame) return;
  active.lastFrame = frame;
  const str = JSON.stringify({ type: 'frame', data: frame });
  for (const client of clients) {
    if (client.readyState === WsSocket.OPEN) {
      try { client.send(str); } catch { /* ignore */ }
    }
  }
}

/** Re-resolve the host after a network change. Returns true if the URL changed. */
export function refreshScreenShareHost(ip: string, port: number): boolean {
  if (!active.token) return false;
  const before = buildUrl();
  active.ip = ip;
  active.port = port;
  return buildUrl() !== before;
}

export function getScreenShareStatus(): ScreenShareStatus {
  return {
    active: active.token !== null,
    url: active.token ? buildUrl() : '',
    clientCount: clients.size,
  };
}

/**
 * Serve the `/screen` HTTP route. Returns true when the request was handled
 * (the caller should not continue routing).
 */
export function handleScreenShareHttp(req: IncomingMessage, res: ServerResponse): boolean {
  const token = queryToken(req.url);
  if (!active.token || !tokenMatches(token)) {
    res.writeHead(403, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<!DOCTYPE html><html><body style="background:#000;color:#d6e8ff;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><p>Broadcast ended or invalid link.</p></body></html>');
    return true;
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(SCREEN_SHARE_HTML);
  return true;
}

/**
 * Handle a WebSocket upgrade. Returns true when the connection was consumed as
 * a live-screen (phone) client; the remote-control path must handle it
 * otherwise.
 */
export function handleScreenShareConnection(client: WsSocket, req: IncomingMessage): boolean {
  const url = req.url ?? '';
  if (!url.startsWith('/screen')) return false;

  const token = queryToken(url);
  if (!active.token || !tokenMatches(token)) {
    // Invalid/expired token — reject before any data is exchanged.
    try { client.close(1008, 'Invalid or expired token'); } catch { /* ignore */ }
    return true;
  }

  clients.add(client);
  notifyClientCount();

  // Send the last frame so a phone joining mid-broadcast sees content immediately.
  send(client, { type: 'hello', data: active.lastFrame });

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
export function disposeScreenShare(): void {
  for (const client of clients) {
    try { client.terminate(); } catch { /* ignore */ }
  }
  clients.clear();
  active.token = null;
  active.ip = null;
  active.port = null;
  active.lastFrame = null;
}
