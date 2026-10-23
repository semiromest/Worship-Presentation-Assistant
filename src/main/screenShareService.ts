import { newToken, tokenMatches, queryToken } from './shareTransport';
/**
 * Live-screen phone broadcast service.
 *
 * Lets people watch the projected live screen (e.g. the Canlı Ekran source) fullscreen on their
 * phones. The control renderer captures JPEG frames from its live screen preview and pushes them
 * here via IPC; this module validates the per-broadcast token, serves the mobile client at
 * `/screen?token=…`, and fans each frame out to every connected phone over WebSocket (view-only).
 *
 * Wired into the EXISTING remote HTTP + WebSocket server in main.ts — no second server, no second
 * port. Phones never touch Electron APIs.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { WebSocket as WsSocket } from 'ws';
import type { ScreenShareStatus } from '../shared/share';
import { SCREEN_SHARE_HTML } from './screen-share-html';

/** Bir telefonun gönderim tamponu bunu aşarsa o kare o telefon için atlanır (canlı yayında en yeni kare önemlidir). */
const BACKPRESSURE_BYTES = 1024 * 1024;
/** Tampon bu süre boyunca hiç boşalmazsa telefon ölü sayılır ve bağlantısı kesilir. */
const STALL_LIMIT_MS = 10_000;
/** 1080p JPEG'in base64 hali bile bunun çok altındadır; aşırı büyük veri yayına alınmaz. */
const MAX_FRAME_CHARS = 8 * 1024 * 1024;
/** Yayın bitince 'ended' mesajının ulaşması ve kapanış el sıkışması için tanınan süre. */
const END_GRACE_MS = 1000;
const SCREEN_PATH_RE = /^\/screen(?:[?#]|$)/;

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
} as const;

// Statik sayfalar bir kez Buffer'a çevrilir; Content-Length bilindiği için chunked kodlama gerekmez.
const SCREEN_PAGE = Buffer.from(SCREEN_SHARE_HTML, 'utf-8');
const FORBIDDEN_PAGE = Buffer.from(
  '<!DOCTYPE html><html><body style="background:#000;color:#d6e8ff;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><p>Broadcast ended or invalid link.</p></body></html>',
  'utf-8',
);

interface Broadcast {
  token: string;
  /** Telefonlara verilen adres; ağ değişince `refreshScreenShareHost` günceller. */
  url: string;
  lastFrame: string | null;
}

let broadcast: Broadcast | null = null;

/** Connected phone clients for the CURRENT broadcast only. */
const clients = new Set<WsSocket>();
/** Tamponu dolu olduğu için kare atlanan telefonlar ve ilk atlandıkları an. */
const stalledSince = new Map<WsSocket, number>();

/** Optional hook so main.ts can surface the connected-client count to the UI. */
let clientCountListener: ((count: number) => void) | null = null;

export function setScreenShareClientCountListener(listener: ((count: number) => void) | null): void {
  clientCountListener = listener;
}

function notifyClientCount(): void {
  clientCountListener?.(clients.size);
}

function buildUrl(ip: string, port: number, token: string): string {
  return ip && port ? `http://${ip}:${port}/screen?token=${token}` : '';
}

/** Küçük kontrol mesajları için. Yalnızca açık soketlere gönderir (ws, açık olmayan sokette fırlatmaz). */
function send(client: WsSocket, message: object): void {
  if (client.readyState === WsSocket.OPEN) client.send(JSON.stringify(message));
}

/** Start a broadcast. Returns the QR/URL, or null when already active. */
export function startScreenShare(ip: string, port: number): { url: string } | null {
  if (broadcast) return null;
  const token = newToken();
  broadcast = { token, url: buildUrl(ip, port, token), lastFrame: null };
  return { url: broadcast.url };
}

/** Stop the broadcast: invalidate the token and drop every phone connection. */
export function stopScreenShare(): void {
  const doomed = [...clients];
  clients.clear();
  stalledSince.clear();
  broadcast = null;
  notifyClientCount();
  if (doomed.length === 0) return;

  for (const client of doomed) {
    send(client, { type: 'ended' });
    // Kapanış çerçevesi kuyruktaki 'ended' mesajından sonra gider; terminate() onu kesebilirdi.
    try { client.close(1000, 'ended'); } catch { /* already closed */ }
  }
  // Karşı taraf el sıkışmayı tamamlamazsa (örneğin telefon ağdan düştüyse) bağlantı zorla kapatılır.
  setTimeout(() => {
    for (const client of doomed) {
      if (client.readyState !== WsSocket.CLOSED) client.terminate();
    }
  }, END_GRACE_MS).unref();
}

export function isScreenShareActive(): boolean {
  return broadcast !== null;
}

/** Publish a JPEG frame (data URL) to every connected phone. */
export function publishScreenFrame(frame: string): void {
  if (!broadcast || typeof frame !== 'string' || !frame || frame.length > MAX_FRAME_CHARS) return;
  broadcast.lastFrame = frame; // Sonradan katılan telefon ilk kareyi hemen görsün.
  if (clients.size === 0) return; // Dinleyen yoksa büyük dizgiyi JSON'a çevirmenin anlamı yok.

  const message = JSON.stringify({ type: 'frame', data: frame });
  const now = Date.now();
  for (const client of clients) {
    if (client.readyState !== WsSocket.OPEN) continue;
    if (client.bufferedAmount > BACKPRESSURE_BYTES) {
      // Yavaş telefon: bu kareyi atla, bağlantıyı koparma. Uzun süre hiç boşalmıyorsa ölü kabul et.
      const since = stalledSince.get(client);
      if (since === undefined) stalledSince.set(client, now);
      else if (now - since > STALL_LIMIT_MS) client.terminate(); // temizliği 'close' olayı yapar
      continue;
    }
    stalledSince.delete(client);
    client.send(message);
  }
}

/** Re-resolve the host after a network change. Returns true if the URL changed. */
export function refreshScreenShareHost(ip: string, port: number): boolean {
  if (!broadcast) return false;
  const url = buildUrl(ip, port, broadcast.token);
  const changed = url !== broadcast.url;
  broadcast.url = url;
  return changed;
}

export function getScreenShareStatus(): ScreenShareStatus {
  return {
    active: broadcast !== null,
    url: broadcast?.url ?? '',
    clientCount: clients.size,
  };
}

/**
 * Serve the `/screen` HTTP route. Returns true when the request was handled
 * (the caller should not continue routing).
 */
export function handleScreenShareHttp(req: IncomingMessage, res: ServerResponse): boolean {
  const current = broadcast;
  if (!current || !tokenMatches(current.token, queryToken(req.url))) {
    res.writeHead(403, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': FORBIDDEN_PAGE.length,
      ...NO_STORE_HEADERS,
    });
    res.end(FORBIDDEN_PAGE);
    return true;
  }
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': SCREEN_PAGE.length,
    ...NO_STORE_HEADERS,
  });
  res.end(SCREEN_PAGE);
  return true;
}

/**
 * Handle a WebSocket upgrade. Returns true when the connection was consumed as
 * a live-screen (phone) client; the remote-control path must handle it
 * otherwise.
 */
export function handleScreenShareConnection(client: WsSocket, req: IncomingMessage): boolean {
  const url = req.url ?? '';
  if (!SCREEN_PATH_RE.test(url)) return false;

  const current = broadcast;
  if (!current || !tokenMatches(current.token, queryToken(url))) {
    // Invalid/expired token — reject before any data is exchanged.
    try { client.close(1008, 'Invalid or expired token'); } catch { /* ignore */ }
    return true;
  }

  clients.add(client);
  notifyClientCount();

  // Send the last frame so a phone joining mid-broadcast sees content immediately.
  send(client, { type: 'hello', data: current.lastFrame });

  // Yalnızca soket gerçekten kümedeydiyse sayı bildirilir: `error` ardından gelen `close`
  // ve `stopScreenShare` sonrası kapanan eski telefonlar yinelenen bildirim üretmez.
  const drop = () => {
    stalledSince.delete(client);
    if (clients.delete(client)) notifyClientCount();
  };
  client.on('close', drop);
  client.on('error', () => {
    try { client.terminate(); } catch { /* ignore */ }
    drop();
  });

  return true;
}

/** Called on app quit — drop every phone connection without an `ended` frame. */
export function disposeScreenShare(): void {
  for (const client of clients) {
    try { client.terminate(); } catch { /* ignore */ }
  }
  clients.clear();
  stalledSince.clear();
  broadcast = null;
}