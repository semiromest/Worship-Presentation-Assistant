import { applyPreviewUpdates } from './previewUpdates';
import { inspectRemoteFirewall } from './remoteFirewallDiagnostics';
import type { FirewallDiagnostic } from '../shared/remoteDiagnostics';
import { launchMode, restricted, practiceProfile, systemTempRoot } from './isolatedLaunch';
import { restrictPracticeSession } from './practiceSession';
import { setPracticeControl } from './practicePolicy';
import { createProgressStore } from './practiceProgress';
import { createPracticeWorkspace, readPracticeSavedPreset } from './practiceWorkspace';
import { resetFile, recoverPracticeReset } from './practiceReset';
import { spawn } from 'node:child_process';
import { inspectTourProfile, isTourProfileSender } from './tourProfile';
import { resolvePosterSource } from './mediaPosterSource';
import { YouTubeMusicService } from './youtubeMusicService';
import { checkMediaResources, cacheGoogleFont } from './preparationResources';
/**
 * Electron main process: presentation control, projector window,
 * remote (phone) control server, and .gpres file I/O.
 */

import {
  app,
  BrowserWindow,
  Menu,
  ipcMain,
  dialog,
  screen,
  desktopCapturer,
  shell,
  protocol,
  session,
  systemPreferences,
} from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import { createReadStream, type Stats } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { WebSocketServer, WebSocket as WsSocket, type RawData } from 'ws';
import { REMOTE_HTML_NEW } from './remote-html';
import { driveService } from './driveService';
import { initUpdater } from './updater';
import {
  startPublicTunnel,
  stopPublicTunnel,
  getPublicTunnelStatus,
  disposePublicTunnel,
  setPublicTunnelStatusListener,
} from './cloudflareTunnelService';
import { initPerfMonitor, mainPerf, recordWs } from './perfMonitor';
import { createPresetStore, isLiveSavePresetName } from './presetStore';
import { localResourceUrlToPath, isZip, mediaRefToName } from '../shared/mediaTree';
import { getMediaLibrary } from './mediaLibrary';
import { registerGradientService } from './gradientService';
import { getOrCreateThumbnail, thumbRefToPath, pruneThumbnailCache } from './mediaThumbnails';
import { heavyClient } from './heavyWorkerClient';
import { registerSttIpc, cleanupStt } from './sonioxService';
import {
  startShare,
  stopShare,
  isShareActive,
  publishShare,
  refreshShareHost,
  getShareStatus,
  handleShareHttp,
  handleShareConnection,
  setClientCountListener,
  disposeShare,
} from './shareService';
import {
  startScreenShare,
  stopScreenShare,
  isScreenShareActive,
  publishScreenFrame,
  refreshScreenShareHost,
  getScreenShareStatus,
  handleScreenShareHttp,
  handleScreenShareConnection,
  setScreenShareClientCountListener,
  disposeScreenShare,
} from './screenShareService';
import type { ShareSnapshot, ScreenShareStatus } from '../shared/share';
import {
  chooseDefaultOutputDisplay,
  compareDisplays,
  type DisplayInfo,
  type ProjectorOutputStatus,
} from '../shared/displays';

// Paths

const DIST = path.join(__dirname, '../dist');
const ICON_PATH = path.join(__dirname, '../build', 'ico.png');
const VITE_PUBLIC = app.isPackaged ? DIST : path.join(DIST, '../public');
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tif', '.tiff', '.avif', '.svg']);
const VIDEO_EXTS = new Set(['.mp4', '.webm', '.mov', '.mkv', '.avi', '.m4v', '.wmv', '.flv', '.mpeg', '.mpg']);
const AUDIO_EXTS = new Set(['.mp3', '.wav', '.ogg', '.flac', '.aac', '.m4a', '.wma']);

process.env.DIST = DIST;
process.env.VITE_PUBLIC = VITE_PUBLIC;

// Start profile inspection before any Chromium session/window is initialized.
const tourProfile = inspectTourProfile(app.getPath('userData'));
const progressStore = createProgressStore(practiceProfile);
const practiceWorkspace = createPracticeWorkspace(practiceProfile, progressStore);

// Phase 0 perf monitor — MUST run before any ipcMain handler is registered.
initPerfMonitor();

// Window references

let win: BrowserWindow | null = null;
let youtubeMusicService = new YouTubeMusicService();
let closingPractice = false;
let practiceRendererReady=false;
let practiceClosePending=false;
let practiceWorkspaceReady=false;

/** Kontrol penceresine güvenli gönderim: yok edilmiş pencere/webContents'e yazmak fırlatır. */
function sendToControl(channel: string, ...args: unknown[]): void {
  const target = win;
  if (!target || target.isDestroyed() || target.webContents.isDestroyed()) return;
  target.webContents.send(channel, ...args);
}

function dialogParent(): BrowserWindow | null {
  return win && !win.isDestroyed() ? win : BrowserWindow.getFocusedWindow();
}

/** Geçici dosya + rename: yazma yarıda kesilirse mevcut dosya bozulmaz. */
async function writeFileAtomic(filePath: string, data: string | Uint8Array): Promise<void> {
  const temp = `${filePath}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temp, data);
    await fs.rename(temp, filePath);
  } catch (error) {
    await fs.rm(temp, { force: true }).catch(() => {});
    throw error;
  }
}

type ProjectorEntry = {
  displayId: string;
  window: BrowserWindow;
  pendingPayload: any;
  ready: boolean;
};

/** One reusable projector renderer per output display. */
const projectorWindows = new Map<string, ProjectorEntry>();

function getDisplayInfos(): DisplayInfo[] {
  if (!app.isReady()) return [];
  const primaryId = String(screen.getPrimaryDisplay().id);
  const infos: DisplayInfo[] = screen.getAllDisplays().map((display) => ({
    id: String(display.id),
    label: '',
    isPrimary: String(display.id) === primaryId,
    bounds: display.bounds,
    workArea: display.workArea,
    scaleFactor: display.scaleFactor,
  }));
  infos.sort(compareDisplays); // nesneler bir kez kurulur, karşılaştırma başına yeniden değil
  let secondary = 0;
  for (const info of infos) info.label = info.isPrimary ? 'Primary' : `Screen ${++secondary}`;
  return infos;
}

function getRawDisplay(displayId?: string): Electron.Display | undefined {
  const displays = screen.getAllDisplays();
  if (displayId) {
    return displays.find((display) => String(display.id) === displayId);
  }

  const infos = getDisplayInfos();
  const selected = chooseDefaultOutputDisplay(infos);
  return displays.find((display) => String(display.id) === selected?.id) ?? displays[0];
}

function getDefaultDisplayId(): string | undefined {
  return chooseDefaultOutputDisplay(getDisplayInfos())?.id;
}

function getProjectorOutputStatus(): ProjectorOutputStatus[] {
  return [...projectorWindows.values()].map((entry) => ({
    displayId: entry.displayId,
    isOpen: !entry.window.isDestroyed(),
    isReady: entry.ready,
  }));
}

function sendProjectorOutputStatus(): void {
  sendToControl('projector-output-status', getProjectorOutputStatus());
}

function sendDisplaySnapshot(): void {
  sendToControl('displays-changed', getDisplayInfos());
  sendProjectorOutputStatus();
}

function projectorBounds(display: Electron.Display): Electron.Rectangle {
  const isMac = process.platform === 'darwin';
  const { x, y, width, height } = display.bounds;
  return {
    x,
    y,
    width: isMac ? Math.min(Math.max(width * 0.92, 1280), width) : width,
    height: isMac ? Math.min(Math.max(height * 0.92, 720), height) : height,
  };
}

function refreshProjectorWindows(): void {
  // Hotplug önce yayımlanır: operatör bağlantısı kopan açık ekranı, bilerek kapatılandan ayırabilsin.
  sendDisplaySnapshot();
  for (const [displayId, entry] of projectorWindows) {
    if (!getRawDisplay(displayId) && !entry.window.isDestroyed()) entry.window.close();
    // Fullscreen windows auto-position on their display — no reposition needed.
  }
}

// Çözünürlük değişiminde `display-metrics-changed` arka arkaya onlarca kez gelebilir.
let displayTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleDisplayRefresh(): void {
  if (displayTimer) clearTimeout(displayTimer);
  displayTimer = setTimeout(() => {
    displayTimer = null;
    refreshProjectorWindows();
  }, 150);
}

function attachDisplayWatch(): void {
  screen.on('display-added', scheduleDisplayRefresh);
  screen.on('display-removed', scheduleDisplayRefresh);
  screen.on('display-metrics-changed', scheduleDisplayRefresh);
}

// ─── Remote server ──────────────────────────────────────────────────────────

const MAX_CONTROL_BODY = 16 * 1024;
const WS_MAX_PAYLOAD = 64 * 1024; // yalnızca komut alınır
const HEARTBEAT_MS = 20_000;
const SOFT_BUFFER_BYTES = 1024 * 1024; // üstünde: ağır/ikincil mesajlar bu telefon için atlanır
const HARD_BUFFER_BYTES = 16 * 1024 * 1024; // üstünde: telefon ölü sayılır, bağlantı kesilir
const MAX_COMMANDS_PER_SECOND = 40;
const MAX_PREVIEW_CHARS = 4 * 1024 * 1024;
const MAX_SLIDE_PREVIEWS = 20_000;
const NETWORK_TTL_MS = 5_000;
const LOCAL_HOST_RE = /^(?:localhost|\d{1,3}(?:\.\d{1,3}){3}|[^.]+\.local)$/i;
const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
} as const;
const REMOTE_PAGE = Buffer.from(REMOTE_HTML_NEW, 'utf-8');

let remoteServer: http.Server | null = null;
let wss: WebSocketServer | null = null;
let remoteServerError: string | null = null;

type SlideMeta = { partsMode: boolean; parts: string[] | null; title: string | null };
interface RemoteStatus {
  slideCount: number;
  currentIndex: number;
  isBlackout: boolean;
  isProjectorOpen: boolean;
  slideTransition: string;
  transitionDurationMs: number;
  activePart: number | null;
  partsCount: number | null;
  slideMeta: SlideMeta[] | null;
}

let remoteStatus: RemoteStatus = {
  slideCount: 0,
  currentIndex: 0,
  isBlackout: false,
  isProjectorOpen: false,
  slideTransition: 'fade',
  transitionDurationMs: 400,
  activePart: null,
  partsCount: null,
  slideMeta: null,
};

/** Her gezinmede giden küçük durum: slideMeta ayrı mesajla, yalnızca değişince yayımlanır. */
function publicStatus(): Omit<RemoteStatus, 'slideMeta'> {
  const { slideMeta: _slideMeta, ...rest } = remoteStatus;
  return rest;
}

/** Last captured slide preview, sent immediately to new clients. */
let lastPreviewDataUrl: string | null = null;
/** Renderer önizlemesi geldikten sonra pencere yakalaması onu asla ezmez. */
let rendererPreviewSeen = false;
let allSlidePreviews: string[] = [];
/** JSON snapshot of the last broadcast slideMeta, used to detect deck changes. */
let lastSlideMetaJson = '';

// ── WebSocket istemcileri ──
interface ClientState { alive: boolean; stale: boolean; windowStart: number; count: number }
const wsClients = new Map<WsSocket, ClientState>();
let clientsEverConnected = 0;
let lastClientConnectedAt = 0;

type Priority = 'normal' | 'preview' | 'bulk';

/**
 * normal: her zaman gider. preview: tampon doluysa atlanır (en yeni kare zaten sonra gelir).
 * bulk: tampon doluysa atlanır ve telefon "bayat" işaretlenir; boşalınca tam liste yeniden gönderilir.
 * Tampon HARD sınırı aşarsa telefon ölü sayılır.
 */
function broadcast(msg: object, priority: Priority = 'normal'): void {
  if (wsClients.size === 0) return; // dinleyen yoksa serileştirme yok
  const text = JSON.stringify(msg);
  recordWs(text.length);
  const isFullList = (msg as { type?: string }).type === 'allPreviews';
  for (const [client, state] of wsClients) {
    if (client.readyState !== WsSocket.OPEN) continue;
    const buffered = client.bufferedAmount;
    if (buffered > HARD_BUFFER_BYTES) {
      client.terminate();
      continue;
    }
    if (priority !== 'normal' && buffered > SOFT_BUFFER_BYTES) {
      if (priority === 'bulk') state.stale = true;
      continue;
    }
    try {
      if (state.stale && !isFullList && buffered < SOFT_BUFFER_BYTES / 4) {
        state.stale = false;
        client.send(JSON.stringify({ type: 'allPreviews', data: allSlidePreviews }));
      }
      client.send(text);
    } catch {
      client.terminate();
    }
  }
}

/** Notify renderer of connected client count. */
function broadcastClientCount(): void {
  sendToControl('remote-client-count', wsClients.size);
}

let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
function startHeartbeat(): void {
  if (heartbeatTimer) return;
  // Uykuya geçen/ağdan düşen telefonlar sessizce kalır; pong gelmeyen bir sonraki turda kesilir.
  heartbeatTimer = setInterval(() => {
    for (const [client, state] of wsClients) {
      if (!state.alive) {
        client.terminate();
        continue;
      }
      state.alive = false;
      try { client.ping(); } catch { client.terminate(); }
    }
  }, HEARTBEAT_MS);
  heartbeatTimer.unref();
}

// ── İstek güvenliği ──
function hostnameOf(host: string | undefined): string {
  if (!host) return '';
  return (host.startsWith('[') ? host.slice(1, host.indexOf(']')) : host.split(':')[0]).toLowerCase();
}

/**
 * Cloudflare tüneli üzerinden (internetten) gelen istek mi? cloudflared yerel sunucuya 127.0.0.1'den bağlanır,
 * bu yüzden kaynak adrese bakılamaz. Tünel başlıkları ya da IP/localhost/.local dışı Host yeterli işarettir.
 */
function isTunneled(req: http.IncomingMessage): boolean {
  return 'cf-connecting-ip' in req.headers || 'cf-ray' in req.headers || !LOCAL_HOST_RE.test(hostnameOf(req.headers.host));
}

/** Tarayıcı kaynaklı istek yalnızca sunucunun kendi sayfasından gelebilir (CSRF / DNS rebinding). */
function isSameOrigin(req: http.IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true; // tarayıcı dışı istemci veya aynı kaynaktan GET
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}

function forwardRemoteAction(action: unknown, value: unknown): boolean {
  if (typeof action !== 'string' || action.length === 0 || action.length > 64) return false;
  if (value !== undefined) {
    try {
      if ((JSON.stringify(value)?.length ?? 0) > 4096) return false;
    } catch { return false; }
  }
  sendToControl('remote-action', { action, value });
  return true;
}

function readBody(req: http.IncomingMessage, limit = MAX_CONTROL_BODY): Promise<string> {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > limit) {
      req.resume();
      reject(new Error('Payload too large'));
      return;
    }
    const chunks: Buffer[] = [];
    let total = 0;
    let done = false;
    req.on('data', (chunk: Buffer) => {
      if (done) return;
      total += chunk.length;
      if (total > limit) {
        done = true;
        chunks.length = 0;
        req.destroy();
        reject(new Error('Payload too large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (done) return;
      done = true;
      resolve(Buffer.concat(chunks).toString('utf-8'));
    });
    req.on('error', (error) => {
      if (done) return;
      done = true;
      reject(error);
    });
  });
}

function rawToString(raw: RawData): string {
  if (Buffer.isBuffer(raw)) return raw.toString('utf-8');
  if (Array.isArray(raw)) return Buffer.concat(raw).toString('utf-8');
  return Buffer.from(raw).toString('utf-8');
}

// ── HTTP ──
function handleRemoteRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
  let pathname: string;
  try {
    pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
  } catch {
    res.writeHead(400, NO_STORE_HEADERS);
    res.end('Bad Request');
    return;
  }

  // Token korumalı paylaşım sayfaları: tünelden de erişilebilen tek yollar.
  if (pathname === '/share' && handleShareHttp(req, res)) return;
  if (pathname === '/screen' && handleScreenShareHttp(req, res)) return;

  // Tünelden gelen istek kontrol arayüzüne, komutlara ve tanılamaya ulaşamaz.
  if (isTunneled(req)) {
    res.writeHead(404, NO_STORE_HEADERS);
    res.end('Not Found');
    return;
  }

  // Remote control web UI
  if (pathname === '/' || pathname === '/remote') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': REMOTE_PAGE.length, ...NO_STORE_HEADERS });
    res.end(REMOTE_PAGE);
    return;
  }

  // Legacy REST: status
  if (pathname === '/api/status') {
    res.writeHead(200, { 'Content-Type': 'application/json', ...NO_STORE_HEADERS });
    res.end(JSON.stringify(remoteStatus));
    return;
  }

  // Legacy REST: command
  if (pathname === '/api/control' && req.method === 'POST') {
    if (!isSameOrigin(req)) {
      res.writeHead(403, NO_STORE_HEADERS);
      res.end('Forbidden');
      return;
    }
    readBody(req)
      .then((body) => {
        const data = JSON.parse(body) as { action?: unknown; value?: unknown } | null;
        if (!forwardRemoteAction(data?.action, data?.value)) throw new Error('Bad command');
        res.writeHead(200, { 'Content-Type': 'application/json', ...NO_STORE_HEADERS });
        res.end('{"ok":true}');
      })
      .catch((error: unknown) => {
        res.writeHead(error instanceof Error && error.message === 'Payload too large' ? 413 : 400, NO_STORE_HEADERS);
        res.end('Bad Request');
      });
    return;
  }

  if (pathname === '/api/diagnostics') {
    res.writeHead(200, { 'Content-Type': 'application/json', ...NO_STORE_HEADERS });
    res.end(JSON.stringify({ remoteServerUrl: currentRemoteUrl(), debug: remoteDebugInfo, timestamp: new Date().toISOString() }));
    return;
  }

  res.writeHead(404, NO_STORE_HEADERS);
  res.end('Not Found');
}

function welcomeMessage(): string {
  return JSON.stringify({
    type: 'welcome',
    data: { status: remoteStatus, preview: lastPreviewDataUrl, allPreviews: allSlidePreviews, slideMeta: remoteStatus.slideMeta },
  });
}

function handleRemoteConnection(client: WsSocket, req: http.IncomingMessage): void {
  // Phone captions clients connect to /share?token=… and are handled (and authenticated) by the share service.
  if (handleShareConnection(client, req)) return;
  // Phone live-screen clients connect to /screen?token=… (view-only frames).
  if (handleScreenShareConnection(client, req)) return;

  if (isTunneled(req) || !isSameOrigin(req)) {
    client.close(1008, 'Forbidden');
    return;
  }

  // Bağlantı tanılaması: istemci listesine girmez, hoş geldin mesajı (büyük önizleme listesi) gönderilmez.
  if (req.url?.startsWith('/diag')) {
    client.send('{"type":"diag-pong"}', () => client.close(1000));
    return;
  }

  const state: ClientState = { alive: true, stale: false, windowStart: Date.now(), count: 0 };
  wsClients.set(client, state);
  clientsEverConnected++;
  lastClientConnectedAt = Date.now();
  broadcastClientCount();

  try { client.send(welcomeMessage()); } catch { /* ignore */ }

  client.on('pong', () => { state.alive = true; });
  client.on('message', (raw: RawData) => {
    state.alive = true;
    const now = Date.now();
    if (now - state.windowStart > 1000) {
      state.windowStart = now;
      state.count = 0;
    }
    if (++state.count > MAX_COMMANDS_PER_SECOND) return; // taşma: renderer'ı IPC ile boğmasın
    try {
      const msg = JSON.parse(rawToString(raw)) as { type?: unknown; action?: unknown; value?: unknown };
      if (msg?.type === 'command') forwardRemoteAction(msg.action, msg.value);
    } catch {
      /* invalid JSON, ignore */
    }
  });

  // Yalnızca soket gerçekten listedeyse bildirilir: `error` ardından `close` iki kez saymaz.
  const drop = () => {
    if (wsClients.delete(client)) broadcastClientCount();
  };
  client.on('close', drop);
  client.on('error', () => {
    try { client.terminate(); } catch { /* already closed */ }
    drop();
  });
}

function getRemotePort(): number {
  const address = remoteServer?.address();
  return address && typeof address === 'object' ? address.port : 0;
}

function createRemoteServer(): void {
  const server = http.createServer(handleRemoteRequest);
  remoteServer = server;
  // Dinleme hatası (EADDRINUSE/EACCES) süreci düşürmesin; tanılamada gösterilir.
  server.on('error', (error: NodeJS.ErrnoException) => {
    remoteServerError = error.code ?? error.message;
    console.error('[REMOTE SERVER] error:', error);
  });

  wss = new WebSocketServer({ server, maxPayload: WS_MAX_PAYLOAD });
  wss.on('error', (error) => console.error('[REMOTE SERVER] websocket error:', error));
  wss.on('connection', handleRemoteConnection);
  startHeartbeat();

  // Random port, all interfaces
  server.listen(0, '0.0.0.0', () => {
    remoteServerError = null;
    const scanned = scanNetwork(true);
    remoteDebugInfo.port = getRemotePort();
    announcedRemoteUrl = currentRemoteUrl();
    startNetworkWatch();
    console.info('[REMOTE SERVER] Listening on all interfaces');
    console.info('[REMOTE SERVER] URL:', announcedRemoteUrl);
    console.info('[REMOTE SERVER] Candidates:', scanned.candidates);
  });
}

// ─── Yerel IPv4 tespiti (puanlı, kısa ömürlü önbellek) ─────────────────────

interface NetCandidate {
  name: string;
  address: string;
  cidr: string | null;
  mac: string;
  score: number;
  internal: boolean;
  /** VPN / sanal / bağlantı-yerel: telefonun ulaşamayacağı adaptörler. */
  virtual: boolean;
}

let remoteDebugInfo: { port: number | null; selectedAddress: string; candidates: NetCandidate[]; timestamp: string | null } = {
  port: null,
  selectedAddress: '',
  candidates: [],
  timestamp: null,
};

const VIRTUAL_NAME_RE =
  /docker|vmware|virtual|vbox|hyper-?v|vethernet|wsl|default switch|loopback|tun|tap|hamachi|bridge|br-|virbr|utun|wg|wireguard|ppp|vpn|tailscale|zerotier|nordlynx|npcap/;

const isLinkLocalIPv4 = (address: string): boolean => /^169\.254\./.test(address);

/** Higher score = more likely to be the LAN interface the phone can reach. */
function scoreLocalIPv4Candidate(name: string, address: string): number {
  let score = 0;
  const normalized = name.toLowerCase();

  if (/wi[-_]?fi|wlan|wireless/.test(normalized)) score += 30;
  if (/eth|en\d|ethernet|lan/.test(normalized)) score += 20;
  if (/realtek|intel|qualcomm|broadcom|bcm|atheros|rtl|marvell/.test(normalized)) score += 10;
  if (VIRTUAL_NAME_RE.test(normalized)) score -= 100;

  if (isLinkLocalIPv4(address)) score -= 100;
  if (/^127\./.test(address) || /^0\./.test(address)) score -= 100;

  if (/^10\./.test(address)) score += 15;
  if (/^192\.168\./.test(address)) score += 15;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(address)) score += 15;

  if (!/^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[0-1])\.|169\.254\.)/.test(address)) score += 5; // public/uncommon, maybe valid
  return score;
}

function listLocalIPv4Candidates(): NetCandidate[] {
  const candidates: NetCandidate[] = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const iface of addrs ?? []) {
      if (iface.family !== 'IPv4' && (iface.family as unknown) !== 4) continue; // eski Node sürümleri sayı döndürür
      candidates.push({
        name,
        address: iface.address,
        cidr: iface.cidr ?? null,
        mac: iface.mac,
        score: scoreLocalIPv4Candidate(name, iface.address),
        internal: iface.internal,
        virtual: VIRTUAL_NAME_RE.test(name.toLowerCase()) || isLinkLocalIPv4(iface.address),
      });
    }
  }
  return candidates.sort((a, b) => b.score - a.score);
}

let networkCache: { at: number; ip: string; candidates: NetCandidate[] } | null = null;

/** Önbellek 5 sn geçerli: kalıcı önbellek Wi-Fi değişince bayat URL üretiyordu. */
function scanNetwork(force = false): { ip: string; candidates: NetCandidate[] } {
  if (!force && networkCache && Date.now() - networkCache.at < NETWORK_TTL_MS) return networkCache;
  const candidates = listLocalIPv4Candidates();
  const best = candidates.find((c) => c.score > -50 && !isLinkLocalIPv4(c.address));
  const ip = best?.address ?? candidates[0]?.address ?? '127.0.0.1';
  networkCache = { at: Date.now(), ip, candidates };
  remoteDebugInfo = { ...remoteDebugInfo, selectedAddress: ip, candidates, timestamp: new Date().toISOString() };
  return networkCache;
}

const getLocalIPv4 = (): string => scanNetwork().ip;

function currentRemoteUrl(): string {
  const port = getRemotePort();
  return port ? `http://${getLocalIPv4()}:${port}/remote` : '';
}

// Ağ izleme: IP değişince (Wi-Fi yeniden bağlanma, kablo takma) uzak URL ve paylaşım URL'leri yenilenir.
let networkTimer: ReturnType<typeof setInterval> | null = null;
let announcedRemoteUrl = '';

function startNetworkWatch(): void {
  if (networkTimer) return;
  networkTimer = setInterval(() => {
    const { ip } = scanNetwork(true);
    const port = getRemotePort();

    const url = currentRemoteUrl();
    if (url !== announcedRemoteUrl) {
      announcedRemoteUrl = url;
      sendToControl('remote-url-changed', { url });
    }
    if (isShareActive() && refreshShareHost(ip, port)) {
      sendToControl('share:network-changed', { url: getShareStatus().url });
    }
    if (isScreenShareActive() && refreshScreenShareHost(ip, port)) {
      sendToControl('screen-share:network-changed', { url: getScreenShareStatus().url });
    }
  }, 10_000);
  networkTimer.unref();
}

// ─── Slide preview capture (debounced + rate-limited) ───────────────────────

const CAPTURE_MIN_INTERVAL = 100; // ms
let captureTimer: ReturnType<typeof setTimeout> | null = null;
let lastCaptureTime = 0;
let capturing = false;

/** Küçültülmüş görüntüde parlaklık örneği: tam çözünürlükte 8 MB'lık bitmap taramak gerekmez. */
function captureIsBlank(img: Electron.NativeImage): boolean {
  try {
    const { width, height } = img.getSize();
    if (!width || !height) return true;
    const bmp = img.toBitmap(); // BGRA
    let sum = 0;
    let samples = 0;
    for (let i = 0; i < bmp.length; i += 4) {
      sum += bmp[i] + bmp[i + 1] + bmp[i + 2];
      samples++;
    }
    return samples === 0 || sum / (samples * 3) < 6;
  } catch {
    return true;
  }
}

/**
 * Projektör/ana pencerenin küçültülmüş JPEG önizlemesini yayınlar. Yalnızca renderer kendi önizlemesini
 * göndermeden önceki yedektir; renderer önizlemesi geldikten sonra asla üzerine yazmaz.
 */
function scheduleSlideCapture(delayMs = 300): void {
  if (wsClients.size === 0) return; // dinleyen yok
  if (captureTimer) clearTimeout(captureTimer);
  captureTimer = setTimeout(() => {
    captureTimer = null;
    void captureSlide();
  }, delayMs);
}

async function captureSlide(): Promise<void> {
  if (capturing || rendererPreviewSeen || wsClients.size === 0) return;
  const wait = lastCaptureTime + CAPTURE_MIN_INTERVAL - Date.now();
  if (wait > 0) {
    scheduleSlideCapture(wait); // hız sınırı yakalamayı düşürmez, erteler
    return;
  }
  capturing = true;
  lastCaptureTime = Date.now();
  try {
    const target = [...projectorWindows.values()].find((entry) => !entry.window.isDestroyed())?.window ?? win;
    if (!target || target.isDestroyed() || target.webContents.isDestroyed()) return;
    const full = await target.webContents.capturePage();
    if (full.isEmpty()) return;
    const small = full.resize({ width: 480, quality: 'good' });
    if (captureIsBlank(small)) return; // minimized/occluded window → skip
    if (rendererPreviewSeen) return; // yakalama sürerken renderer önizlemesi geldi
    lastPreviewDataUrl = `data:image/jpeg;base64,${small.toJPEG(65).toString('base64')}`;
    broadcast({ type: 'preview', data: lastPreviewDataUrl }, 'preview');
  } catch {
    /* window not ready yet */
  } finally {
    capturing = false;
  }
}

// Preset store (Phase 5): per-preset files under userData/presets/, see
// presetStore.ts for the migration + atomic-write logic.
const presetStore = createPresetStore(app.getPath('userData'), mainPerf);

// Persistent media library (Phase 6): userData/media/, see mediaLibrary.ts.
const mediaLibrary = getMediaLibrary();
registerGradientService(mediaLibrary, app.getPath('userData'));

// Generic recursive file finder
// One directory walker, parametrized by a filter, replaces two near-identical
// walkers (XML files / media files). Recursion is parallel per-directory and
// results are flattened with the built-in `flat()` instead of manual pushes.

interface ScanFolderOptions {
  recursive?: boolean;
  includeImages?: boolean;
  includeVideos?: boolean;
}

const READDIR_CONCURRENCY = 8;
const MAX_WALK_DEPTH = 32;
let activeReaddirs = 0;
const readdirWaiters: Array<() => void> = [];

/** Aynı anda en fazla 8 `readdir`: büyük ağaçlarda `EMFILE` önlenir. Sonuç sırası değişmez. */
async function readdirLimited(dir: string) {
  if (activeReaddirs >= READDIR_CONCURRENCY) await new Promise<void>((resolve) => readdirWaiters.push(resolve));
  else activeReaddirs++;
  try {
    return await fs.readdir(dir, { withFileTypes: true });
  } finally {
    const next = readdirWaiters.shift();
    if (next) next(); // yuva beklemedeki işe devredilir
    else activeReaddirs--;
  }
}

async function walkFiles(
  dir: string,
  matches: (name: string, ext: string) => boolean,
  recursive = true,
  depth = 0
): Promise<string[]> {
  let entries;
  try {
    entries = await readdirLimited(dir);
  } catch (error) {
    if (depth === 0) throw error; // okunamayan KÖK klasör "eksik" sayılır
    return []; // okunamayan alt klasör (izin hatası) tüm taramayı düşürmesin
  }
  const tasks = entries.map(async (entry): Promise<string[]> => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return recursive && depth < MAX_WALK_DEPTH ? walkFiles(full, matches, true, depth + 1) : [];
    if (entry.isFile() && matches(entry.name, path.extname(full).toLowerCase())) return [full];
    return [];
  });
  return (await Promise.all(tasks)).flat();
}

const walkXmlFiles = (dir: string) => walkFiles(dir, (name) => name.toLowerCase().endsWith('.xml'));

const walkAudioFiles = (dir: string, recursive = true): Promise<string[]> =>
  walkFiles(dir, (_name, ext) => AUDIO_EXTS.has(ext), recursive);

const walkMediaFiles = (dir: string, opts: ScanFolderOptions = {}): Promise<string[]> => {
  const { recursive = true, includeImages = true, includeVideos = true } = opts;
  return walkFiles(
    dir,
    (_name, ext) => (includeImages && IMAGE_EXTS.has(ext)) || (includeVideos && VIDEO_EXTS.has(ext)),
    recursive
  );
};

// Window creation

const QUIT_CONFIRM_TEXTS: Record<string, { message: string; detail: string; cancel: string; confirm: string }> = {
  tr: {
    message: 'Çıkmak istediğinize emin misiniz?',
    detail: 'Çıkış yaparsanız canlı yayın durdurulur.',
    cancel: 'Vazgeç',
    confirm: 'Evet, Çık',
  },
  en: {
    message: 'Are you sure you want to quit?',
    detail: 'Live projection will stop if you quit.',
    cancel: 'Cancel',
    confirm: 'Yes, Quit',
  },
  es: {
    message: '¿Seguro que desea salir?',
    detail: 'La proyección en vivo se detendrá si sale.',
    cancel: 'Cancelar',
    confirm: 'Sí, salir',
  },
  de: {
    message: 'Möchten Sie wirklich beenden?',
    detail: 'Die Live-Projektion wird beendet, wenn Sie beenden.',
    cancel: 'Abbrechen',
    confirm: 'Ja, beenden',
  },
  ko: {
    message: '정말 종료하시겠습니까?',
    detail: '종료하면 라이브 프로젝션이 중지됩니다.',
    cancel: '취소',
    confirm: '예, 종료',
  },
};

let rendererLanguageCache = 'tr';

/** Best-effort read of the renderer's chosen language (localStorage persisted by i18next). */
async function readRendererLanguage(window: BrowserWindow): Promise<string> {
  try {
    if (window.isDestroyed() || window.webContents.isDestroyed()) return rendererLanguageCache;
    const value = await Promise.race([
      window.webContents.executeJavaScript(`localStorage.getItem('i18nextLng') || 'tr'`) as Promise<unknown>,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 500)),
    ]);
    rendererLanguageCache = String(value).split('-')[0] || 'tr';
  } catch {
    /* önbellekteki dil kalır */
  }
  return rendererLanguageCache;
}

/** Quit confirm: blocks window close until the user confirms in a native dialog. */
function attachQuitConfirm(window: BrowserWindow): void {
  let quitConfirmed = false;
  let dialogOpen = false;

  window.on('close', (e) => {
    if (quitConfirmed) return;
    e.preventDefault();
    if (dialogOpen) return; // kapat tuşuna tekrar basınca ikinci diyalog açılmaz
    dialogOpen = true;
    void (async () => {
      try {
        const texts = QUIT_CONFIRM_TEXTS[await readRendererLanguage(window)] ?? QUIT_CONFIRM_TEXTS.en;
        const { response } = await dialog.showMessageBox(window, {
          type: 'question',
          title: 'Worship Presentation Assistant',
          message: texts.message,
          detail: texts.detail,
          buttons: [texts.cancel, texts.confirm],
          defaultId: 0,
          cancelId: 0,
        });
        if (response === 1) quitConfirmed = true;
      } catch {
        quitConfirmed = true;
      } finally {
        dialogOpen = false;
      }
      if (quitConfirmed && !window.isDestroyed()) window.close();
    })();
  });
}

function createWindow(): void {
  youtubeMusicService.dispose();
  youtubeMusicService = new YouTubeMusicService();
  const musicForWindow = youtubeMusicService;
  if(restricted){practiceRendererReady=false;practiceClosePending=false;practiceWorkspaceReady=false;}
  win = new BrowserWindow({
    icon: ICON_PATH,
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    fullscreenable: true,
    autoHideMenuBar: true,
    title: restricted ? 'Worship Presentation Assistant — PRACTICE' : 'Worship Presentation Assistant - Control Panel',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
    },
  });
  const controlWindow = win;

  setPracticeControl(win.webContents);
  if (restricted) restrictPracticeSession(win.webContents, DIST);
  if(restricted)win.webContents.on('did-start-navigation',(_event,_url,inPlace,mainFrame)=>{if(mainFrame&&!inPlace){practiceRendererReady=false;practiceWorkspaceReady=false;}});
  if (restricted) win.on('page-title-updated', event => event.preventDefault());
  Menu.setApplicationMenu(null);

  process.env.VITE_DEV_SERVER_URL
    ? win.loadURL(process.env.VITE_DEV_SERVER_URL)
    : win.loadFile(path.join(DIST, 'index.html'));

  win.maximize();

  if (restricted) win.on('close', event => { if(!closingPractice){event.preventDefault();if(practiceRendererReady)win?.webContents.send('practice:close-request');else practiceClosePending=true;} });
  else attachQuitConfirm(win);

  win.webContents.once('did-finish-load', () => void readRendererLanguage(controlWindow));

  controlWindow.once('closed', () => musicForWindow.dispose());
  if (restricted) controlWindow.webContents.on('render-process-gone', (_event, details) => {
    if (closingPractice || details.reason === 'clean-exit' || controlWindow.isDestroyed()) return;
    // Keep a window alive so window-all-closed cannot quit during recovery.
    createWindow();
    controlWindow.destroy();
  });
  if (!restricted) {
    // Kontrol penceresi çökerse beyaz ekranda kalmasın; döngüye girmesin diye dakikada en çok 3 deneme.
    const crashes: number[] = [];
    controlWindow.webContents.on('render-process-gone', (_event, details) => {
      if (details.reason === 'clean-exit' || controlWindow.isDestroyed()) return;
      const now = Date.now();
      while (crashes.length && now - crashes[0] > 60_000) crashes.shift();
      crashes.push(now);
      if (crashes.length <= 3) controlWindow.webContents.reload();
    });
  }
  win.on('closed', () => {
    for (const entry of projectorWindows.values()) {
      if (!entry.window.isDestroyed()) entry.window.close();
    }
    if (win === controlWindow) win = null;
  });
}

const PROJECTOR_NAV_NEXT = new Set(['ArrowRight', 'ArrowDown', ' ', 'PageDown', 'j', 'J']);
const PROJECTOR_NAV_PREV = new Set(['ArrowLeft', 'ArrowUp', 'PageUp', 'k', 'K']);

function createProjectorWindow(requestedDisplayId?: string, initialData?: any): boolean {
  if (restricted) return false;
  const display = getRawDisplay(requestedDisplayId);
  if (!display) return false;

  const displayId = String(display.id);
  if (projectorWindows.has(displayId)) return true;

  const bounds = projectorBounds(display);
  const isPrimaryTarget = String(display.id) === String(screen.getPrimaryDisplay().id);
  const projectorWindow = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    // True fullscreen only on EXTERNAL (secondary) displays — that is the
    // projection screen case. When the only available display is the primary
    // (nothing to broadcast to), keep the old windowed behavior so the control
    // panel stays reachable. `fullscreenable` keeps F11 as an opt-in toggle.
    fullscreen: !isPrimaryTarget,
    fullscreenable: true,
    frame: true,
    resizable: true,
    movable: true,
    autoHideMenuBar: true,
    show: false,
    backgroundColor: '#000000',
    title: 'Worship Presentation Assistant - Projection',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
    },
  });

  const entry: ProjectorEntry = {
    displayId,
    window: projectorWindow,
    pendingPayload: initialData ?? null,
    ready: false,
  };
  projectorWindows.set(displayId, entry);
  remoteStatus.isProjectorOpen = true;
  broadcast({ type: 'status', data: publicStatus() });

  // Çöken projektör renderer'ı yeniden yüklenir: ekran canlı yayında kara kalmasın.
  // Yeniden yüklenince 'projector-ready' tam durumu yeniden kurar. Döngüye girmesin diye dakikada en çok 3 deneme.
  const crashTimes: number[] = [];
  projectorWindow.webContents.on('render-process-gone', (_event, details) => {
    if (details.reason === 'clean-exit' || projectorWindow.isDestroyed()) return;
    const now = Date.now();
    while (crashTimes.length && now - crashTimes[0] > 60_000) crashTimes.shift();
    crashTimes.push(now);
    entry.ready = false;
    sendProjectorOutputStatus();
    if (crashTimes.length <= 3) projectorWindow.webContents.reload();
  });

  // Projector windows on external displays open in true fullscreen (no window
  // chrome, no taskbar — the full display area is used). On the primary display
  // they open as a normal window so the control panel remains usable.
  projectorWindow.webContents.once('did-finish-load', () => {
    if (!projectorWindow.isDestroyed()) {
      projectorWindow.show();
      projectorWindow.focus();
    }
  });

  // The initial output mode rides the URL so the window renders the right
  // view from the very first paint (no projector flash in a stage window).
  // Mid-session mode switches are applied via projector-update → outputMode.
  const initialOutputMode =
    initialData && typeof initialData === 'object' && (initialData as any).outputMode === 'stage' ? 'stage' : 'follow';
  const query = `mode=projector&displayId=${encodeURIComponent(displayId)}&outputMode=${encodeURIComponent(initialOutputMode)}`;
  process.env.VITE_DEV_SERVER_URL
    ? projectorWindow.loadURL(`${process.env.VITE_DEV_SERVER_URL}?${query}`)
    : projectorWindow.loadFile(path.join(DIST, 'index.html'), {
        query: { mode: 'projector', displayId, outputMode: initialOutputMode },
      });

  // Keyboard bridge: the projector window frequently holds focus. Keep the
  // existing global navigation behavior so the normal single-screen workflow
  // remains unchanged.
  projectorWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || input.isAutoRepeat) return;
    if (input.control || input.alt || input.meta) return;
    const sendRemote = (action: string, value?: unknown) => sendToControl('remote-action', { action, value });

    const key = input.key;
    let handled = false;
    if (PROJECTOR_NAV_NEXT.has(key)) {
      sendRemote('next');
      handled = true;
    } else if (PROJECTOR_NAV_PREV.has(key)) {
      sendRemote('prev');
      handled = true;
    } else if (key === 'Home') {
      sendRemote('goto', 0);
      handled = true;
    } else if (key === 'End') {
      sendRemote('goto', 2 ** 31 - 1);
      handled = true;
    } else if (key === 'b' || key === 'B') {
      sendRemote('blackout');
      handled = true;
    } else if (key === 'Escape') {
      handled = true;
      if (!projectorWindow.isDestroyed()) projectorWindow.close();
    }
    if (handled) event.preventDefault();
  });

  projectorWindow.on('closed', () => {
    if (projectorWindows.get(displayId)?.window === projectorWindow) {
      projectorWindows.delete(displayId);
    }
    sendToControl('projector-closed', { displayId });
    remoteStatus.isProjectorOpen = projectorWindows.size > 0;
    broadcast({ type: 'status', data: publicStatus() });
    sendProjectorOutputStatus();
    scheduleSlideCapture(120);
  });

  sendProjectorOutputStatus();
  return true;
}

ipcMain.on('projector-ready', (event) => {
  const entry = [...projectorWindows.values()].find((candidate) => candidate.window.webContents.id === event.sender.id);
  if (!entry || entry.window.isDestroyed()) return;

  entry.ready = true;
  if (entry.pendingPayload) {
    entry.window.webContents.send('projector-update', entry.pendingPayload);
    entry.pendingPayload = null;
  }

  // Acknowledge the exact output so the control renderer can establish a
  // fresh full-snapshot base after every output open/reload.
  sendToControl('projector-ready-ack', { displayId: entry.displayId });
  sendProjectorOutputStatus();
});

// App lifecycle

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'local-resource',
    privileges: {
      bypassCSP: true,
      corsEnabled: true,
      secure: true,
      standard: true,
      stream: true,
      supportFetchAPI: true,
    },
  },
]);

const MIME_BY_EXT: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.m4v': 'video/x-m4v',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.wmv': 'video/x-ms-wmv',
  '.flv': 'video/x-flv',
  '.mpeg': 'video/mpeg',
  '.mpg': 'video/mpeg',
};

// ── Media file streaming over local-resource://mediafile/<base64url path> ───
// The renderer cannot load `file://` URLs when it is served over http (dev
// mode), which is why video thumbnails never appeared: the media library's
// in-renderer fallback (a <video src="file://..."> element) is silently
// blocked by webSecurity. This branch serves any *media* file the renderer
// asks for, with HTTP Range support so a <video> element can stream and seek
// (moov atom, target frame) without the main process or the renderer ever
// holding the whole file in memory. Restricted to media extensions so a
// compromised renderer cannot read arbitrary files (e.g. .env) through it.
const MEDIAFILE_REF_PREFIX = 'local-resource://mediafile/';
const MEDIAFILE_ALLOWED_EXTS = new Set([...IMAGE_EXTS, ...VIDEO_EXTS]);
const MEDIAFILE_CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Range, Content-Type',
  'Access-Control-Expose-Headers': 'Accept-Ranges, Content-Length, Content-Range, Content-Type',
};
const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable';

async function serveMediaFile(url: string, request: Request, immutable = false): Promise<Response | null> {
  if (!url.startsWith(MEDIAFILE_REF_PREFIX)) return null;
  const encoded = url.slice(MEDIAFILE_REF_PREFIX.length);
  if (!encoded || encoded.length > 4096) return new Response('Bad request', { status: 400 });
  let filePath: string;
  try {
    filePath = decodeURIComponent(encoded);
  } catch {
    return new Response('Bad request', { status: 400 });
  }
  const resolved = path.resolve(filePath);
  const ext = path.extname(resolved).toLowerCase();
  if (!path.isAbsolute(resolved) || !MEDIAFILE_ALLOWED_EXTS.has(ext)) return new Response('Forbidden', { status: 403 });

  let stat: Stats;
  try {
    stat = await fs.stat(resolved);
  } catch {
    return new Response('Not found', { status: 404 });
  }
  if (!stat.isFile()) return new Response('Not found', { status: 404 }); // dizin: createReadStream EISDIR verir

  const headersBase = {
    ...MEDIAFILE_CORS_HEADERS,
    'Content-Type': MIME_BY_EXT[ext] || 'application/octet-stream',
    'Accept-Ranges': 'bytes',
    ...(immutable ? { 'Cache-Control': IMMUTABLE_CACHE } : {}),
  };

  const open = (options?: { start: number; end: number }): ReadableStream => {
    const stream = createReadStream(resolved, options);
    // İstek iptal edilirse (video atlandı, sayfa kapandı) dosya tutamacı hemen bırakılır.
    request.signal.addEventListener('abort', () => stream.destroy(), { once: true });
    return Readable.toWeb(stream) as unknown as ReadableStream;
  };

  // Range support: video elements issue byte-range requests when seeking and
  // even for metadata (moov atom at the end of non-faststart files). Without
  // 206 responses Chromium falls back to a full download.
  const rangeHeader = request.headers.get('Range');
  if (rangeHeader) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
    if (m) {
      let start = m[1] === '' ? null : parseInt(m[1], 10);
      let end = m[2] === '' ? null : parseInt(m[2], 10);
      if (start === null) {
        start = Math.max(0, stat.size - (end ?? 0)); // suffix range: son N bayt
        end = stat.size - 1;
      } else if (end === null) {
        end = stat.size - 1;
      }
      if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= stat.size) {
        return new Response('Range not satisfiable', { status: 416, headers: { 'Content-Range': `bytes */${stat.size}` } });
      }
      end = Math.min(end, stat.size - 1);
      return new Response(open({ start, end }), {
        status: 206,
        headers: {
          ...headersBase,
          'Content-Range': `bytes ${start}-${end}/${stat.size}`,
          'Content-Length': String(end - start + 1),
        },
      });
    }
  }

  return new Response(open(), { headers: { ...headersBase, 'Content-Length': String(stat.size) } });
}

// Microphone / media permission handling.
//
// The renderer asks for the microphone via navigator.mediaDevices.getUserMedia
// and for screen capture via getUserMedia({ chromeMediaSource: 'desktop' })
// (the ScreenCaptureRenderer path). Without an explicit handler here,
// Chromium's default varies by platform — on macOS apps are denied by default.
// We grant the 'media' permission (microphone + the existing screen-capture
// flow; the app never uses the camera) and, on macOS, additionally request the
// OS consent via systemPreferences.askForMediaAccess so the mic actually opens.
function setupMediaPermissionHandlers(): void {
  if (restricted) return;
  const ses = session.defaultSession;

  ses.setPermissionRequestHandler((_webContents, permission, callback) => {
    // 'media' covers both getUserMedia microphone requests and the app's own
    // screen-capture stream. Everything else (camera, geolocation,
    // notifications, …) stays denied.
    callback(permission === 'media');
  });

  ses.setPermissionCheckHandler((_webContents, permission) => {
    return permission === 'media';
  });

  // macOS: getUserMedia inside Electron will not open the mic until the app
  // has OS-level consent. Ask for it up-front so the first Start is seamless.
  if (process.platform === 'darwin') {
    const status = systemPreferences.getMediaAccessStatus('microphone');
    if (status !== 'granted' && status !== 'denied') {
      systemPreferences.askForMediaAccess('microphone').catch(() => {});
    }
  }
}

app.whenReady().then(async () => {
  if (restricted) await recoverPracticeReset(practiceProfile);
  await tourProfile;
  setupMediaPermissionHandlers();
  protocol.handle('local-resource', async (request) => {
    if (restricted) {
      try {
        const media = mediaRefToName(request.url);
        const target = thumbRefToPath(request.url) ?? (media ? path.join(mediaLibrary.dir, media) :
          request.url.startsWith(MEDIAFILE_REF_PREFIX) ? decodeURIComponent(request.url.slice(MEDIAFILE_REF_PREFIX.length)) : localResourceUrlToPath(request.url));
        const relative = path.relative(app.getPath('userData'), path.resolve(target));
        if (relative.startsWith('..') || path.isAbsolute(relative)) return new Response('Forbidden', { status: 403 });
      } catch { return new Response('Forbidden', { status: 403 }); }
    }
    let filePath: string;
    const thumbPath = thumbRefToPath(request.url);
    if (thumbPath) {
      filePath = thumbPath;
    } else {
      const mediaName = mediaRefToName(request.url);
      if (mediaName) {
        // Phase 6 media library: userData/media/<name>, name validated above. Içerik adresli: değişmez.
        filePath = path.join(mediaLibrary.dir, mediaName);
        const mediaResponse = await serveMediaFile(`${MEDIAFILE_REF_PREFIX}${encodeURIComponent(filePath)}`, request, true);
        if (mediaResponse) return mediaResponse;
      } else {
        // Arbitrary media files (folder-scanned images/videos) streamed with
        // Range support — see serveMediaFile. Works from http (dev) and
        // file:// (packaged) renderer origins alike.
        const mediaFileRes = await serveMediaFile(request.url, request);
        if (mediaFileRes) return mediaFileRes;
        try {
          filePath = localResourceUrlToPath(request.url);
        } catch (err) {
          console.error(`[local-resource] Bad URL: ${request.url}`, err);
          return new Response('Bad request', { status: 400 });
        }

        // Security: legacy refs only serve files inside our own <tmp>/presenter-*
        // dirs (path.resolve collapses any ".." traversal before the check).
        const resolved = path.resolve(filePath);
        const tmpRoot = path.resolve(os.tmpdir());
        const rel = path.relative(tmpRoot, resolved);
        const insideTmp = rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
        const firstSegment = rel.split(path.sep)[0] ?? '';
        if (!insideTmp || !firstSegment.startsWith('presenter-')) {
          console.error(`[local-resource] Forbidden path: ${resolved}`);
          return new Response('Forbidden', { status: 403 });
        }
      }
    }

    try {
      const data = await fs.readFile(filePath);
      const ext = path.extname(filePath).toLowerCase();
      return new Response(data, {
        headers: {
          'Content-Type': MIME_BY_EXT[ext] || 'application/octet-stream',
          'Access-Control-Allow-Origin': '*',
          // Küçük resim adı kaynak dosyanın boyut ve mtime'ını içerir: değişen kaynak yeni ad alır.
          'Cache-Control': thumbPath ? IMMUTABLE_CACHE : 'no-cache',
        },
      });
    } catch (err) {
      console.error(`[local-resource] Failed to serve ${filePath}:`, err);
      return new Response('Not found', { status: 404 });
    }
  });
  createWindow();
  if (win && !restricted) initUpdater(win);
  if (restricted) ipcMain.handle('updater:get-info', () => ({ version: app.getVersion(), updaterActive: false }));
  attachDisplayWatch();
  if (!restricted) createRemoteServer();
  setPublicTunnelStatusListener((next) => sendToControl('public-tunnel:status', next));
  setClientCountListener((count) => sendToControl('share:client-count', count));
  setScreenShareClientCountListener((count) => sendToControl('screen-share:client-count', count));
  if (!restricted) registerSttIpc(() => win);
  void pruneThumbnailCache();
  void cleanupTempDir(); // kapanışta bekletilmeden çağrılıyordu ve yarım kalabilirdi
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('will-quit', () => {
  youtubeMusicService.dispose();
  for (const timer of [captureTimer, displayTimer]) if (timer) clearTimeout(timer);
  for (const timer of [heartbeatTimer, networkTimer]) if (timer) clearInterval(timer);
  disposeShare();
  disposeScreenShare();
  disposePublicTunnel();
  for (const client of wsClients.keys()) client.terminate();
  wsClients.clear();
  wss?.close();
  remoteServer?.closeAllConnections(); // bekleyen keep-alive bağlantıları kapanışı geciktirmesin
  remoteServer?.close();
  cleanupStt();
  for (const entry of projectorWindows.values()) {
    if (!entry.window.isDestroyed()) entry.window.close();
  }
  projectorWindows.clear();
});

// .gpres (ZIP) helpers

/** Sweeps leftover temp dirs from pre-Phase-6 versions (presenter-*). */
async function cleanupTempDir(): Promise<void> {
  try {
    const tmp = os.tmpdir();
    const entries = await fs.readdir(tmp);
    await Promise.all(
      entries
        .filter((e) => e.startsWith('presenter-'))
        .map((e) => fs.rm(path.join(tmp, e), { recursive: true, force: true }))
    );
  } catch {
    /* nothing to clean */
  }
}

// IPC: file operations

// Electron ≥ 43 breaking change: dialogs without defaultPath now always open
// in the Downloads folder and the OS no longer remembers the last-used
// directory. Track it here so the previous UX ("open where I last was") is
// preserved across all file dialogs.
let lastDialogDir = app.getPath('documents');
function rememberDir(fromPath: string | undefined | null): void {
  if (!fromPath) return;
  try {
    const dir = path.dirname(fromPath);
    if (dir && dir !== fromPath) lastDialogDir = dir;
  } catch {
    /* ignore */
  }
}

ipcMain.handle('check-media-resources', async (_, urls: unknown) => {
  if (!Array.isArray(urls) || urls.some(url => typeof url !== 'string')) throw new Error('Invalid resources');
  return checkMediaResources(urls, mediaLibrary.dir);
});
ipcMain.handle('cache-google-font', async (_, family: unknown) => {
  if (typeof family !== 'string') throw new Error('Invalid font');
  return cacheGoogleFont(family, path.join(app.getPath('userData'), 'fonts'));
});

ipcMain.handle('save-file', async (_, content: unknown) => {
  if (typeof content !== 'string') throw new Error('Invalid presentation data');
  const { filePath, canceled } = await dialog.showSaveDialog({
    defaultPath: lastDialogDir,
    filters: [{ name: 'Worship Presentation Assistant Files', extensions: ['gpres'] }],
  });
  if (canceled || !filePath) return null;
  const target = /\.gpres$/i.test(filePath) ? filePath : `${filePath}.gpres`; // Linux iletişim kutusu uzantı eklemez
  rememberDir(target);

  // Phase 7: zip build (deflate CPU) runs in the heavy UtilityProcess.
  const { embeddedCount, zipBuffer } = await heavyClient.buildGpres(content, mediaLibrary.dir);
  await writeFileAtomic(target, zipBuffer); // yazma yarıda kesilse mevcut dosya bozulmaz

  console.info(`[save-file] Saved ${target} (${embeddedCount} media files embedded)`);
  return target;
});

ipcMain.handle('open-file', async () => {
  const { filePaths, canceled } = await dialog.showOpenDialog({
    defaultPath: lastDialogDir,
    filters: [{ name: 'Worship Presentation Assistant Files', extensions: ['gpres'] }],
    properties: ['openFile'],
  });
  if (canceled || !filePaths?.length) return null;

  const filePath = filePaths[0];
  rememberDir(filePath);
  const raw = await fs.readFile(filePath);

  if (isZip(raw)) {
    // Phase 7: unzip + media externalization run in the heavy UtilityProcess.
    const { data, mediaCount } = await heavyClient.extractGpres(raw, mediaLibrary.dir);
    console.info(`[open-file] ${filePath}: ${mediaCount} media refs externalized`);
    return { path: filePath, content: JSON.stringify(data) };
  }

  // Legacy plain-JSON format
  return { path: filePath, content: raw.toString('utf-8') };
});

// IPC: native dialogs

ipcMain.handle(
  'show-confirm-dialog',
  async (
    _,
    options: { message: string; title?: string; detail?: string; confirmLabel?: string; cancelLabel?: string }
  ) => {
    const parent = dialogParent();
    const boxOptions = {
      type: 'question' as const,
      buttons: [options.cancelLabel ?? 'Cancel', options.confirmLabel ?? 'Confirm'],
      defaultId: 0,
      cancelId: 0,
      title: options.title ?? 'Worship Presentation Assistant',
      message: options.message,
      detail: options.detail,
    };
    const { response } = parent
      ? await dialog.showMessageBox(parent, boxOptions)
      : await dialog.showMessageBox(boxOptions);
    return response === 1;
  }
);

ipcMain.handle(
  'show-alert-dialog',
  async (_, options: { message: string; title?: string; detail?: string; okLabel?: string }) => {
    const parent = dialogParent();
    const boxOptions = {
      type: 'info' as const,
      buttons: [options.okLabel ?? 'OK'],
      title: options.title ?? 'Worship Presentation Assistant',
      message: options.message,
      detail: options.detail,
    };
    parent ? await dialog.showMessageBox(parent, boxOptions) : await dialog.showMessageBox(boxOptions);
  }
);

// IPC: preset CRUD

ipcMain.handle('load-presets', (_, retentionMs?: number) => presetStore.readPresets(retentionMs));

ipcMain.handle('save-preset', async (_, preset: { name: string; presentation: unknown; retentionMs?: number }) => {
  const practiceSessionId = practiceWorkspace.sessionId();
  if (restricted && !isLiveSavePresetName(preset.name)) await practiceWorkspace.prepareSave(practiceSessionId, preset);
  const saved = await presetStore.savePreset(preset);
  if (restricted && !isLiveSavePresetName(preset.name)) {
    const record = saved.find(item => item.name === preset.name);
    const workspace = await practiceWorkspace.saved(preset.presentation, practiceSessionId, record);
    if (workspace) sendToControl('practice:workspace-changed', { sessionId: practiceSessionId, workspace });
  }

  return saved;
});

ipcMain.handle('delete-preset', async (_, name: string, retentionMs?: number) => {
  return presetStore.deletePreset(name, retentionMs);
});

ipcMain.handle('rename-preset', async (_, oldName: string, newName: string, retentionMs?: number) => {
  return presetStore.renamePreset(oldName, newName, retentionMs);
});

// IPC: displays and projector outputs

for (const action of ['read', 'start', 'observe', 'pause', 'resume'] as const) {
  ipcMain.handle('practice:workspace:' + action, async(event, ...args) => {
    if (!restricted || !isTourProfileSender(event.sender, event.senderFrame, win?.webContents ?? null)) throw new Error('Unauthorized practice workspace');
    if (action === 'read') {
      let value=await practiceWorkspace.read(args[0]);
      if(value.guide.step==='save' && value.active?.saveIntent) {
        // A failed write may leave the normal store's cache ahead of disk.
        // Recovery reads the one atomic record without store cache or GC.
        const record=await readPracticeSavedPreset(app.getPath('userData'),value.active.saveIntent.name);
        value=await practiceWorkspace.recoverSaved(record?[record]:[]) ?? value;
      }
      if(event.sender===win?.webContents)practiceWorkspaceReady=true;return value;
    }
    if (action === 'start') return practiceWorkspace.start(args[0], args[1], args[2]);
    if (action === 'resume') return practiceWorkspace.resume(args[0], args[1]);
    if (action === 'observe') return practiceWorkspace.observe(args[0], args[1]);
    return practiceWorkspace.pause(args[0], args[1] === true);
  });
}
ipcMain.handle('practice:guide', (event, ...args) => {
  if (!restricted || !isTourProfileSender(event.sender, event.senderFrame, win?.webContents ?? null)) throw new Error('Unauthorized guide');
  return practiceWorkspace.guide(args[0], args[1], args[2], args[3], args[4], args[5]);
});
ipcMain.handle('practice:info', () => ({ mode: launchMode }));
ipcMain.handle('practice:ready',event=>{
  if(!restricted || !isTourProfileSender(event.sender,event.senderFrame,win?.webContents??null))throw new Error('Unauthorized readiness');
  practiceRendererReady=true;
  if(practiceClosePending){practiceClosePending=false;setImmediate(()=>win?.webContents.send('practice:close-request'));}
});
ipcMain.handle('practice:close', async(event,id?:string)=>{
  if(!restricted || !isTourProfileSender(event.sender,event.senderFrame,win?.webContents??null))throw new Error('Unauthorized practice close');
  if(id)await practiceWorkspace.closeReady(id);
  else if(practiceWorkspaceReady)throw new Error('Save the current practice before closing');
  closingPractice=true;setImmediate(()=>{win?.destroy();app.quit();});return {ok:true};
});
ipcMain.handle('practice:progress', async event => {
  if (!isTourProfileSender(event.sender, event.senderFrame, win?.webContents ?? null)) throw new Error('Unauthorized sender');
  const result = await progressStore.read();
  if (!result.ok) return result;
  try {
    try { await fs.access(resetFile(practiceProfile)); throw new Error('Restart pending'); }catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
    const summary=await practiceWorkspace.summaryRun();const confirm=await progressStore.read();
    if(!confirm.ok || confirm.progress.revision!==result.progress.revision || result.progress.runId!==summary.runId)throw new Error('Progress changed');
    try { await fs.access(resetFile(practiceProfile)); throw new Error('Restart pending'); }catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
    return { ...result, guide:summary.guide };
  }
  catch { return { ok: false, error: 'unreadable' }; }
});
ipcMain.handle('practice:open', async event => {
  if (restricted || !isTourProfileSender(event.sender, event.senderFrame, win?.webContents ?? null)) throw new Error('Unauthorized sender');
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  env.TEMP = systemTempRoot;
  env.TMP = systemTempRoot;
  env.TMPDIR = systemTempRoot;
  if (app.isPackaged) delete env.VITE_DEV_SERVER_URL;
  const args = app.isPackaged ? ['--wpa-practice'] : [app.getAppPath(), '--wpa-practice'];
  const child = spawn(process.execPath, args, { env, stdio: 'ignore', windowsHide: true });
  await new Promise<void>((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
  return { ok: true };
});
ipcMain.handle('practice:set-status', (event, task, status) => {
  if (!restricted || !isTourProfileSender(event.sender, event.senderFrame, win?.webContents ?? null)) throw new Error('Unauthorized sender');
  return progressStore.setStatus(task, status);
});
ipcMain.handle('tour:profile', event => {
  if (restricted) return { profileKind: 'existing' };
  if (!isTourProfileSender(event.sender, event.senderFrame, win?.webContents ?? null)) throw new Error('Unauthorized tour profile request');
  return tourProfile;
});

ipcMain.handle('get-displays', () => getDisplayInfos());
ipcMain.handle('get-projector-outputs', () => getProjectorOutputStatus());

ipcMain.handle('toggle-projector', (_, initialData?: any, requestedDisplayId?: string) => {
  const display = getRawDisplay(requestedDisplayId);
  if (!display) return false;
  const displayId = String(display.id);
  const current = projectorWindows.get(displayId);
  if (current) {
    if (!current.window.isDestroyed()) current.window.close();
    return false;
  }
  const opened = createProjectorWindow(displayId, initialData);
  return opened;
});

ipcMain.handle('open-projector', (_, displayId: string, initialData?: any) => {
  const display = getRawDisplay(displayId);
  if (!display) return false;
  const normalizedId = String(display.id);
  if (projectorWindows.has(normalizedId)) return true;
  return createProjectorWindow(normalizedId, initialData);
});

ipcMain.handle('close-projector', (_, displayId: string) => {
  const entry = projectorWindows.get(String(displayId));
  if (!entry) return false;
  if (!entry.window.isDestroyed()) entry.window.close();
  return true;
});

ipcMain.handle('update-projector', (_, data: unknown) => {
  if (!data || typeof data !== 'object') return false;
  const payload = data as Record<string, any>;
  const outputs =
    payload.outputs && typeof payload.outputs === 'object' ? (payload.outputs as Record<string, any>) : null;

  for (const entry of projectorWindows.values()) {
    if (entry.window.isDestroyed()) continue;

    const output = outputs?.[entry.displayId];
    const { outputs: _outputs, ...base } = payload;
    const frame = {
      ...base,
      ...(output && typeof output === 'object'
        ? {
            liveIndex: output.slideIndex,
            liveSlideId: output.slideId,
            isBlackout: !!output.isBlackout,
            outputMode: output.mode,
            outputDisplayId: entry.displayId,
          }
        : { outputDisplayId: entry.displayId }),
    };

    if (!entry.ready) {
      // Keep the initial full snapshot when a newly opened output receives a
      // navigation-only update before its renderer sends `projector-ready`.
      entry.pendingPayload = entry.pendingPayload?.fullPresentation
        ? { ...entry.pendingPayload, ...frame, fullPresentation: entry.pendingPayload.fullPresentation }
        : frame;
      continue;
    }
    entry.window.webContents.send('projector-update', frame);
  }
  return projectorWindows.size > 0;
});

// Kept for the existing single-output toolbar/status flow. It reflects the
// default secondary display, with a safe fallback to any open output.
ipcMain.handle('get-projector-status', () => {
  const defaultId = getDefaultDisplayId();
  return defaultId ? projectorWindows.has(defaultId) : projectorWindows.size > 0;
});
ipcMain.handle('cleanup-temp-dir', async () => {
  await cleanupTempDir();
  return true;
});

// IPC: remote control

ipcMain.handle('get-remote-url', () => currentRemoteUrl());

ipcMain.handle('public-tunnel:start', async () => {
  const port = getRemotePort();
  if (!port) return { active: false, url: '', state: 'error', error: 'server-not-ready' };
  return startPublicTunnel(port);
});
ipcMain.handle('public-tunnel:stop', () => stopPublicTunnel());
ipcMain.handle('public-tunnel:status', () => getPublicTunnelStatus());
ipcMain.handle('get-remote-debug', () => ({ remoteServerUrl: currentRemoteUrl(), debug: remoteDebugInfo }));

// ─── Bağlantı tanılaması ────────────────────────────────────────────────────

interface DiagnosticCheck {
  label: string;
  pass: boolean;
  detail: string;
  /** Arayüz kırmızı/sarı/gri ayrımı için; eski arayüz yok sayabilir. */
  severity: 'info' | 'warning' | 'error';
  hint?: string;
}
interface ProbeResult { ok: boolean; ms: number; status?: number; error?: string }

/** Tek bir HTTP isteği; `json` verilirse gövdenin geçerli JSON olması da gerekir. */
function httpProbe(host: string, port: number, urlPath: string, json = false, timeoutMs = 3000): Promise<ProbeResult> {
  return new Promise((resolve) => {
    const started = Date.now();
    let settled = false;
    const finish = (result: Omit<ProbeResult, 'ms'>) => {
      if (settled) return;
      settled = true;
      resolve({ ...result, ms: Date.now() - started });
    };
    const req = http.get({ host, port, path: urlPath, timeout: timeoutMs, agent: false }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => { if (json && body.length < 65536) body += chunk; });
      res.on('error', (error: NodeJS.ErrnoException) => finish({ ok: false, error: error.code ?? error.message }));
      res.on('end', () => {
        if (res.statusCode !== 200) return finish({ ok: false, status: res.statusCode, error: `http-${res.statusCode}` });
        if (json) {
          try { JSON.parse(body); } catch { return finish({ ok: false, status: 200, error: 'invalid-json' }); }
        }
        finish({ ok: true, status: 200 });
      });
    });
    req.on('timeout', () => { req.destroy(); finish({ ok: false, error: 'timeout' }); });
    req.on('error', (error: NodeJS.ErrnoException) => finish({ ok: false, error: error.code ?? error.message }));
  });
}

/** WebSocket el sıkışması + sunucudan ilk mesaj. /diag yolu istemci listesine girmez. */
function wsProbe(host: string, port: number, timeoutMs = 3000): Promise<ProbeResult> {
  return new Promise((resolve) => {
    const started = Date.now();
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const socket = new WsSocket(`ws://${host}:${port}/diag`, { handshakeTimeout: timeoutMs });
    const finish = (result: Omit<ProbeResult, 'ms'>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { socket.terminate(); } catch { /* already closed */ }
      resolve({ ...result, ms: Date.now() - started });
    };
    timer = setTimeout(() => finish({ ok: false, error: 'timeout' }), timeoutMs);
    socket.on('message', () => finish({ ok: true }));
    socket.on('error', (error: NodeJS.ErrnoException) => finish({ ok: false, error: error.code ?? error.message }));
    socket.on('close', () => finish({ ok: false, error: 'closed' }));
  });
}

ipcMain.handle('get-remote-diagnostics', async () => {
  const port = getRemotePort();
  const listening = port > 0;
  const netInfo = scanNetwork(true);
  const ip = netInfo.ip;
  const selected = netInfo.candidates.find((c) => c.address === ip);
  const viable = netInfo.candidates.filter((c) => !c.internal && !c.virtual && c.score > -50);

  let loopback: ProbeResult | null = null;
  let lan: ProbeResult | null = null;
  let page: ProbeResult | null = null;
  let socket: ProbeResult | null = null;
  let firewall: FirewallDiagnostic | undefined;
  if (listening) {
    // Dört yol paralel: yerel döngü, LAN IP üzerinden HTTP, uzak sayfa, WebSocket; güvenlik duvarı sorgusu da aynı anda.
    [loopback, lan, page, socket, firewall] = await Promise.all([
      httpProbe('127.0.0.1', port, '/api/status', true),
      httpProbe(ip, port, '/api/status', true),
      httpProbe(ip, port, '/remote'),
      wsProbe(ip, port),
      inspectRemoteFirewall(ip, port).catch(() => undefined),
    ]);
  }

  const checks: DiagnosticCheck[] = [];
  const add = (label: string, pass: boolean, detail: string, severity?: DiagnosticCheck['severity'], hint?: string) => {
    const level = severity ?? (pass ? 'info' : 'error');
    checks.push({
      label,
      // Eski arayüz yalnızca label/pass/detail okur: uyarı düzeyi kırmızı hata gibi görünmesin diye pass true yapılır.
      pass: pass || level === 'warning',
      // Öneri eski arayüzde de görünsün diye detail'e eklenir. Arayüz `hint` alanını okumaya başlayınca bu birleştirme kaldırılmalı.
      detail: hint ? `${detail} — ${hint}` : detail,
      severity: level,
      ...(hint ? { hint } : {}),
    });
  };

  add(
    'serverListening',
    listening,
    listening ? `Listening on port ${port}` : `Server could not start${remoteServerError ? ` (${remoteServerError})` : ''} — try restarting the app`
  );

  const hasGoodInterface = netInfo.candidates.some((c) => c.score > -50);
  add(
    'networkInterface',
    hasGoodInterface,
    hasGoodInterface
      ? `Active interface: ${selected?.name ?? '?'} (${ip})`
      : 'No suitable network interface found — check your Wi-Fi or Ethernet connection',
    undefined,
    hasGoodInterface ? undefined : 'Connect this computer to the same Wi-Fi or router as the phone.'
  );

  const isPrivateIP = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(ip);
  add(
    'privateSubnet',
    isPrivateIP,
    isPrivateIP
      ? `IP is on a local network (${ip}${selected?.cidr ? `, ${selected.cidr}` : ''})`
      : `IP (${ip}) does not appear to be on a local network — phone must be on the same network`,
    undefined,
    isLinkLocalIPv4(ip) ? 'A 169.254.x.x address means this computer received no address from the router (DHCP failure).' : undefined
  );

  if (netInfo.candidates.some((c) => c.virtual && !c.internal)) {
    add(
      'virtualAdapter',
      !selected?.virtual,
      selected?.virtual
        ? `Only a virtual/VPN adapter is available (${selected.name}) — the phone cannot reach it`
        : 'VPN or virtual adapters detected; they are ignored when choosing the address',
      selected?.virtual ? 'error' : 'info',
      selected?.virtual ? 'Disconnect the VPN or connect to Wi-Fi/Ethernet.' : undefined
    );
  }

  if (viable.length > 1) {
    add(
      'multipleNetworks',
      false,
      `${viable.length} usable networks found (${viable.map((c) => `${c.name} ${c.address}`).join(', ')}); the phone must be on the one using ${ip}`,
      'warning',
      'If the phone cannot connect, check which network it is on, or disable the unused adapter.'
    );
  }

  if (listening && loopback && lan && page && socket) {
    add(
      'loopbackConnect',
      loopback.ok,
      loopback.ok ? `Server answers locally (${loopback.ms} ms)` : `Server does not answer on 127.0.0.1 (${loopback.error ?? 'unknown'})`
    );

    const lanDetail = lan.ok
      ? `App can reach itself over the network address (${lan.ms} ms)`
      : lan.error === 'timeout'
        ? 'Self-connect timed out — firewall or antivirus may be blocking'
        : lan.error === 'ECONNREFUSED'
          ? 'Connection refused — firewall may be blocking the port'
          : `Self-test failed (${lan.error || 'unknown error'}) — check your firewall`;
    add(
      'selfConnect',
      lan.ok,
      lanDetail,
      undefined,
      !lan.ok && loopback.ok ? 'Works locally but not on the network address: a firewall, antivirus or security suite is likely filtering it.' : undefined
    );

    add(
      'remotePage',
      page.ok,
      page.ok ? 'Remote control page is served' : `Remote control page failed (${page.error ?? 'unknown'})`
    );

    add(
      'webSocket',
      socket.ok,
      socket.ok ? `Live connection works (${socket.ms} ms)` : `WebSocket failed (${socket.error ?? 'unknown'})`,
      undefined,
      !socket.ok && page.ok ? 'The page loads but live connections are blocked — usually a security suite or proxy filtering WebSocket traffic.' : undefined
    );
  }

  // Yerel testler geçse bile telefon bağlanamayabilir: bilgi amaçlı, ok'u etkilemez.
  add(
    'phoneConnections',
    true,
    wsClients.size > 0
      ? `${wsClients.size} phone(s) connected now`
      : clientsEverConnected > 0
        ? `No phone is connected now (last connection ${Math.round((Date.now() - lastClientConnectedAt) / 1000)} s ago)`
        : 'No phone has connected yet',
    'info',
    wsClients.size === 0 && clientsEverConnected === 0
      ? 'If every check above passes but the phone cannot open the page: it must be on the same Wi-Fi, and the router must not isolate clients ("AP/client isolation", guest networks).'
      : undefined
  );

  const tunnel = getPublicTunnelStatus();
  add('publicTunnel', true, `Public tunnel: ${tunnel.state}${tunnel.error ? ` (${tunnel.error})` : ''}`, 'info');

  // A local self-test cannot establish whether inbound LAN traffic is allowed.
  const firewallWarning = !!(
    listening &&
    (!lan?.ok || firewall?.status === 'blocked' || firewall?.status === 'missingPermission')
  );

  return {
    ok: !!(listening && lan?.ok && socket?.ok && hasGoodInterface && isPrivateIP && !firewallWarning),
    serverRunning: listening,
    serverUrl: currentRemoteUrl() || null,
    port: listening ? port : null,
    selectedAddress: ip,
    interfaces: netInfo.candidates.slice(0, 6).map((c) => ({ name: c.name, address: c.address, score: c.score, cidr: c.cidr, virtual: c.virtual })),
    selfConnectTest: { tried: listening, success: !!lan?.ok, ...(lan && !lan.ok && lan.error ? { error: lan.error } : {}) },
    loopbackTest: loopback ? { success: loopback.ok, ms: loopback.ms } : null,
    webSocketTest: socket ? { success: socket.ok, ms: socket.ms, ...(socket.error ? { error: socket.error } : {}) } : null,
    clientCount: wsClients.size,
    firewallWarning,
    ...(firewall ? { firewall } : {}),
    checks,
  };
});

// ─── Phone captions/translation share IPC ──────────────────────────────────
ipcMain.handle('share:start', async (_, subdomain?: string) => {
  try {
    const port = getRemotePort();
    if (!port) return { ok: false, error: 'server-not-ready' };
    const result = startShare(getLocalIPv4(), port);
    if (!result) return { ok: false, error: 'already-active' };
    startNetworkWatch();
    if (process.platform === 'darwin') {
      return { ok: true, url: result.url, localOnly: true };
    }
    const tunnel = await startPublicTunnel(port);
    if (!tunnel.active || !tunnel.url) {
      stopShare();
      return { ok: false, error: tunnel.error ?? 'cloudflare-tunnel-start-failed' };
    }
    const token = new URL(result.url).searchParams.get('token');
    return { ok: true, url: `${tunnel.url}/share?token=${encodeURIComponent(token ?? '')}`, localOnly: false };
  } catch (error) {
    stopShare();
    console.error('[share:start] failed:', error);
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('share:stop', async () => {
  stopShare();
  if (process.platform !== 'darwin') await stopPublicTunnel();
  return { ok: true };
});

ipcMain.on('share:publish', (_event, snapshot: ShareSnapshot) => {
  publishShare(snapshot);
});

ipcMain.handle('share:get-status', () => {
  const status = getShareStatus();
  if (process.platform === 'darwin') return status;
  const tunnel = getPublicTunnelStatus();
  if (!status.active || !tunnel.active || !tunnel.url) return status;
  const token = new URL(status.url).searchParams.get('token');
  return { ...status, url: `${tunnel.url}/share?token=${encodeURIComponent(token ?? '')}` };
});

// ─── Live-screen phone broadcast IPC ────────────────────────────────────────
ipcMain.handle('screen-share:start', () => {
  const port = getRemotePort();
  if (!port) return { ok: false, error: 'server-not-ready' };
  const result = startScreenShare(getLocalIPv4(), port);
  if (!result) return { ok: false, error: 'already-active' };
  startNetworkWatch();
  return { ok: true, url: result.url };
});

ipcMain.handle('screen-share:stop', () => {
  stopScreenShare();
  return { ok: true };
});

ipcMain.on('screen-share:frame', (_event, frame: string) => {
  if (typeof frame !== 'string' || !frame) return;
  publishScreenFrame(frame);
});

ipcMain.handle('screen-share:get-status', (): ScreenShareStatus => getScreenShareStatus());

ipcMain.handle('quit-app', () => {
  app.quit();
  return true;
});

ipcMain.handle('update-all-slide-previews', (_, previews: unknown) => {
  // Küçük resmi henüz üretilmemiş slaytlar için renderer null gönderir; bu girdiler geçerlidir.
  // (Telefona JSON'da null olarak gider, uygulamanın önceki davranışıyla aynı.)
  if (!Array.isArray(previews) || previews.length > MAX_SLIDE_PREVIEWS || !previews.every((p) => p == null || typeof p === 'string')) return false;
  allSlidePreviews = previews as string[];
  broadcast({ type: 'allPreviews', data: allSlidePreviews }, 'bulk');
  return true;
});

// Phase 3: renderer sends only the thumbnails that actually changed as
// {index, url} pairs. Main patches its snapshot array in place and forwards
// the tiny delta, so a single-slide edit no longer rebroadcasts the whole
// list (~23 KB instead of ~117 MB at 5000 slides).
ipcMain.handle('update-slide-previews-delta', (_, updates: { i: number; url: string }[]) => {
  if (!Array.isArray(updates) || updates.length === 0) return false;
  const applied = applyPreviewUpdates(allSlidePreviews, updates);
  if (applied.length > 0) broadcast({ type: 'previewsDelta', data: applied }, 'bulk');
  return true;
});

/**
 * Thumbnail generation via UtilityProcess (Phase 7).
 * Renderer sends slide data → heavy worker renders via @napi-rs/canvas →
 * returns base64 WebP data URI. Offloads CPU-intensive canvas work from
 * the renderer main thread.
 */
ipcMain.handle('generate-thumbnail', async (_event, slide: any) => {
  try {
    return await heavyClient.generateThumbnail(slide);
  } catch (err) {
    console.error('[main] generate-thumbnail failed:', err);
    return null;
  }
});

/**
 * Renderer hook on slide change / blackout / etc: broadcasts status to
 * phones, then schedules a throttled preview capture after the transition.
 */
ipcMain.handle('update-remote-status', (_, input: unknown) => {
  if (!input || typeof input !== 'object') return false;
  const status = input as Record<string, unknown>;
  const num = (value: unknown, fallback: number) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);
  const previews = Array.isArray(status.slidePreviews) && status.slidePreviews.length <= MAX_SLIDE_PREVIEWS
    ? (status.slidePreviews as SlideMeta[])
    : null;

  remoteStatus = {
    slideCount: num(status.slideCount, remoteStatus.slideCount),
    currentIndex: num(status.currentIndex, remoteStatus.currentIndex),
    isBlackout: !!status.isBlackout,
    isProjectorOpen: !!status.isProjectorOpen,
    slideTransition: typeof status.slideTransition === 'string' ? status.slideTransition.slice(0, 32) : remoteStatus.slideTransition,
    transitionDurationMs: num(status.transitionDurationMs, remoteStatus.transitionDurationMs),
    // partsMode fields — null when live slide is not a partsMode slide
    activePart: typeof status.activePart === 'number' ? status.activePart : null,
    partsCount: typeof status.partsCount === 'number' ? status.partsCount : null,
    slideMeta: previews ?? remoteStatus.slideMeta,
  };

  // slideMeta rides its own message (broadcast only when it changes), so it is
  // stripped from the per-navigation status payload to keep traffic minimal.
  broadcast({ type: 'status', data: publicStatus() });

  // Per-slide metadata (partsMode flags + part texts) changes only when the
  // deck changes; it arrives only in those calls, so skip serialization otherwise.
  if (previews) {
    const json = JSON.stringify(previews);
    if (json !== lastSlideMetaJson) {
      lastSlideMetaJson = json;
      broadcast({ type: 'slideMeta', data: previews });
    }
  }

  const duration = Math.max(0, remoteStatus.transitionDurationMs || 0);
  const transitionDelay = remoteStatus.slideTransition !== 'none' && duration > 0 ? Math.max(300, duration + 120) : 300;

  // Renderer thumbnails (send-slide-preview) are the accurate preview source;
  // the window capture is only a fallback until the first renderer preview arrives,
  // so it can never race and overwrite a fresh part preview with a stale or black frame.
  if (!rendererPreviewSeen) scheduleSlideCapture(transitionDelay);
  return true;
});

/**
 * Optional: renderer captures its own canvas as base64 and sends it here.
 * More accurate and cheaper than capturePage(). Renderer usage:
 *   await window.electronAPI.sendSlidePreview(canvas.toDataURL('image/jpeg', 0.8));
 */
ipcMain.handle('send-slide-preview', (_, dataUrl: unknown) => {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/') || dataUrl.length > MAX_PREVIEW_CHARS) return false;
  lastPreviewDataUrl = dataUrl;
  rendererPreviewSeen = true;
  broadcast({ type: 'preview', data: dataUrl }, 'preview');
  return true;
});

/**
 * Broadcast a short transient notice to connected phones (e.g. the result of a
 * quick-verse command). Text is capped so a malformed renderer call cannot be
 * used to push an oversized frame to every client.
 */
ipcMain.handle('send-remote-notice', (_, notice: { text?: string; tone?: 'ok' | 'error' }) => {
  const text = typeof notice?.text === 'string' ? notice.text.slice(0, 160) : '';
  if (!text) return false;
  broadcast({ type: 'notice', data: { text, tone: notice?.tone === 'error' ? 'error' : 'ok' } });
  return true;
});

// IPC: media / import

ipcMain.handle('import-bible-xml', async (_, filePath?: string) => {
  if (restricted) {
    if (filePath && path.resolve(filePath) !== path.join(app.getPath('userData'), 'practice-assets', 'practice-bible.xml')) throw new Error('Only the practice sample is available');
    return practiceWorkspace.sampleBible(!filePath);
  }
  let selected = filePath;
  if (selected) {
    try {
      if (!(await fs.stat(selected)).isFile()) selected = undefined;
    } catch {
      selected = undefined;
    }
  }
  if (!selected) {
    const { filePaths } = await dialog.showOpenDialog({
      defaultPath: lastDialogDir,
      filters: [{ name: 'Zefania XML Bible', extensions: ['xml'] }],
      properties: ['openFile'],
    });
    selected = filePaths?.[0];
  }
  if (!selected) return null;
  rememberDir(selected);
  return { content: await fs.readFile(selected, 'utf-8'), path: selected };
});

// IPC: downloaded (API) Bibles — persisted as JSON under userData so they
// survive app restarts exactly like locally imported XML files do.

function getBiblesDir(): string {
  return path.join(app.getPath('userData'), 'bibles');
}

ipcMain.handle('save-bible-data', async (_, id: unknown, data: unknown) => {
  try {
    const dir = getBiblesDir();
    await fs.mkdir(dir, { recursive: true });
    const safeName =
      String(id)
        .replace(/[^a-zA-Z0-9_.\-]/g, '_')
        .replace(/\.\./g, '_') || 'bible';
    const filePath = path.join(dir, `${safeName}.json`);
    await writeFileAtomic(filePath, JSON.stringify(data));
    return filePath;
  } catch (error) {
    console.error('[save-bible-data] failed:', error);
    return null;
  }
});

ipcMain.handle('read-bible-data', async (_, filePath: string) => {
  try {
    const resolved = path.resolve(filePath);
    const root = path.resolve(getBiblesDir()) + path.sep;
    if (!resolved.startsWith(root)) {
      console.warn('[read-bible-data] Forbidden path:', resolved);
      return null;
    }
    return { content: await fs.readFile(resolved, 'utf-8') };
  } catch (error) {
    console.error('[read-bible-data] failed:', error);
    return null;
  }
});

ipcMain.handle('delete-bible-data', async (_, filePath: string) => {
  try {
    const resolved = path.resolve(filePath);
    const root = path.resolve(getBiblesDir()) + path.sep;
    if (!resolved.startsWith(root)) return null;
    await fs.unlink(resolved);
    return true;
  } catch {
    return null;
  }
});

ipcMain.handle('select-media-file', async (_, type: 'image' | 'video') => {
  if (restricted) return type === 'image' ? practiceWorkspace.sampleMedia() : null;
  const filters =
    type === 'image'
      ? [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp'] }]
      : [{ name: 'Videos', extensions: ['mp4', 'webm', 'ogg', 'mov'] }];
  const { filePaths } = await dialog.showOpenDialog({ defaultPath: lastDialogDir, filters, properties: ['openFile'] });
  rememberDir(filePaths?.[0]);
  return filePaths?.[0] ?? null;
});

ipcMain.handle('select-media-files-all', async () => {
  if (restricted) return [await practiceWorkspace.sampleMedia()];
  const filters = [
    { name: 'Media', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'mp4', 'webm', 'mov', 'mkv', 'avi'] },
  ];
  const { filePaths } = await dialog.showOpenDialog({
    defaultPath: lastDialogDir,
    filters,
    properties: ['openFile', 'multiSelections'],
  });
  if (filePaths?.length) rememberDir(filePaths[0]);
  return filePaths?.length ? filePaths : null;
});

ipcMain.handle('select-media-folder', async () => {
  const result = await dialog.showOpenDialog({
    defaultPath: lastDialogDir,
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  lastDialogDir = result.filePaths[0]; // the selection IS a directory
  return result.filePaths[0];
});

function isMusicControl(event: Electron.IpcMainInvokeEvent): boolean {
  return !restricted && !!win && !win.isDestroyed() && event.sender === win.webContents &&
    event.senderFrame === win.webContents.mainFrame;
}
ipcMain.handle('soniox:open-website', async event => {
  if (!isMusicControl(event)) return { ok: false };
  await shell.openExternal('https://soniox.com/');
  return { ok: true };
});
ipcMain.handle('youtube-music:search', (event, query: unknown, cursor?: unknown) => isMusicControl(event)
  ? youtubeMusicService.search(query, cursor) : { ok: false, error: 'unavailable' });
ipcMain.handle('youtube-music:play', (event, id: unknown) => isMusicControl(event)
  ? youtubeMusicService.play(id) : { ok: false, error: 'unavailable' });
ipcMain.handle('youtube-music:prepare', (event, id: unknown) => isMusicControl(event)
  ? youtubeMusicService.prepare(id) : { ok: false });
ipcMain.handle('youtube-music:offline-status', (event, id: unknown) => isMusicControl(event)
  ? youtubeMusicService.offlineStatus(id) : { state: 'error', error: 'unavailable' });
ipcMain.handle('youtube-music:download', (event, id: unknown) => isMusicControl(event)
  ? youtubeMusicService.download(id) : { state: 'error', error: 'unavailable' });
ipcMain.handle('youtube-music:cancel-download', (event, id: unknown) => {
  if (isMusicControl(event)) youtubeMusicService.cancelDownload(id);
});
ipcMain.handle('youtube-music:stop', (event, streamId?: unknown) => {
  if (isMusicControl(event) && (streamId === undefined || typeof streamId === 'string'))
    youtubeMusicService.stop(streamId);
});

ipcMain.handle('select-audio-folder', async () => {
  const result = await dialog.showOpenDialog({
    defaultPath: lastDialogDir,
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  lastDialogDir = result.filePaths[0];
  return result.filePaths[0];
});

ipcMain.handle('read-audio-folder', async (_, folderPath: string, recursive = true) => {
  try {
    await fs.stat(folderPath);
    return { paths: await walkAudioFiles(folderPath, recursive), missing: false };
  } catch (error) {
    console.error('read-audio-folder error:', error);
    return { paths: [], missing: true };
  }
});

ipcMain.handle('select-audio-file', async () => {
  const { filePaths } = await dialog.showOpenDialog({
    defaultPath: lastDialogDir,
    filters: [{ name: 'Audio Files', extensions: ['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a', 'wma'] }],
    properties: ['openFile'],
  });
  rememberDir(filePaths?.[0]);
  return filePaths?.[0] ?? null;
});

ipcMain.handle('read-media-folder', async (_event, folderPath: string, options?: ScanFolderOptions) => {
  try {
    await fs.stat(folderPath);
    const paths = await walkMediaFiles(folderPath, options);
    return { paths, missing: false };
  } catch (error) {
    console.error('read-media-folder error:', error);
    return { paths: [], missing: true };
  }
});

ipcMain.handle('media:getThumbnail', async (_evt, filePath: string, maxEdge: number) => {
  if (restricted && path.resolve(filePath) !== practiceWorkspace.mediaPath) throw new Error('Only the practice image is available');
  try {
    const resolved = resolvePosterSource(filePath, mediaLibrary.dir);
    if (!resolved) return null;
    return await getOrCreateThumbnail(resolved, { maxEdge });
  } catch {
    return null;
  }
});

// IPC: PowerPoint

ipcMain.handle('select-pptx-file', async () => {
  const { filePaths } = await dialog.showOpenDialog({
    defaultPath: lastDialogDir,
    filters: [{ name: 'PowerPoint Presentations', extensions: ['pptx', 'pptm'] }],
    properties: ['openFile'],
  });
  rememberDir(filePaths?.[0]);
  return filePaths?.[0] ?? null;
});

ipcMain.handle('import-pptx', async (event, filePath: string) => {
  // Phase 7: conversion (resvg warm-up + per-slide CPU) runs in the heavy
  // UtilityProcess; the main event loop stays responsive throughout.
  return heavyClient.importPptx(filePath, mediaLibrary.dir, (current, total) => {
    event.sender.send('pptx-import-progress', { current, total });
  });
});

ipcMain.handle('export-pptx', async (event, content: string) => {
  let data: any;
  try {
    data = JSON.parse(content);
  } catch {
    return { success: false, error: 'Invalid presentation data' };
  }

  const baseName =
    String(data?.name || 'presentation')
      .replace(/[\\/:*?"<>|]/g, '_')
      .trim() || 'presentation';

  const { filePath, canceled } = await dialog.showSaveDialog({
    title: 'Export PowerPoint',
    defaultPath: `${baseName}.pptx`,
    filters: [{ name: 'PowerPoint Presentations', extensions: ['pptx'] }],
  });
  if (canceled || !filePath) return { success: false, canceled: true };
  rememberDir(filePath);

  // Phase 7: PptxGenJS rendering runs in the heavy UtilityProcess.
  return heavyClient.exportPptx(content, filePath, mediaLibrary.dir, (current, total) => {
    event.sender.send('pptx-export-progress', { current, total });
  });
});

ipcMain.handle('import-hymn-archive', async (_, dirPath?: string) => {
  let selected = dirPath;
  if (selected) {
    try {
      if (!(await fs.stat(selected)).isDirectory()) selected = undefined;
    } catch {
      selected = undefined;
    }
  }
  if (!selected) {
    const { filePaths } = await dialog.showOpenDialog({ defaultPath: lastDialogDir, properties: ['openDirectory'] });
    selected = filePaths?.[0];
    if (selected) lastDialogDir = selected;
  }
  if (!selected) return null;

  const xmlPaths = await walkXmlFiles(selected);
  const contents: Array<{ name: string; content: string }> = [];

  // Read in bounded-size chunks to avoid an OOM spike on huge archives.
  const CHUNK_SIZE = 50;
  for (let i = 0; i < xmlPaths.length; i += CHUNK_SIZE) {
    const chunk = xmlPaths.slice(i, i + CHUNK_SIZE);
    const results = await Promise.all(
      chunk.map((fp) => fs.readFile(fp, 'utf-8').then((content) => ({ name: path.basename(fp), content })))
    );
    contents.push(...results);
  }

  return { results: contents, path: selected };
});

// IPC: screen capture

ipcMain.handle('get-screen-sources', async () => {
  try {
    const sources = await desktopCapturer.getSources({
      types: ['window', 'screen'],
      thumbnailSize: { width: 320, height: 180 },
      fetchWindowIcons: false,
    });
    return sources.map((source) => ({
      id: source.id,
      name: source.name,
      // Seçici küçük resimleri için JPEG, PNG'den çok daha küçük
      thumbnail: `data:image/jpeg;base64,${source.thumbnail.toJPEG(75).toString('base64')}`,
      display_id: source.display_id,
    }));
  } catch (error) {
    console.error('Error getting screen sources:', error);
    return [];
  }
});

ipcMain.handle('capture-screen-source', async (_, sourceId: unknown) => {
  if (typeof sourceId !== 'string') return null;
  try {
    // Kimliğin öneki türü verir: tüm pencereleri 1920×1080 yakalamak yerine yalnızca ilgili tür.
    const types: Array<'window' | 'screen'> = sourceId.startsWith('screen:')
      ? ['screen']
      : sourceId.startsWith('window:')
        ? ['window']
        : ['window', 'screen'];
    const sources = await desktopCapturer.getSources({ types, thumbnailSize: { width: 1920, height: 1080 }, fetchWindowIcons: false });
    return sources.find((s) => s.id === sourceId)?.thumbnail.toDataURL() ?? null;
  } catch (error) {
    console.error('Error capturing screen source:', error);
    return null;
  }
});

// IPC: Google Drive

ipcMain.handle('drive-sign-in', async () => {
  try {
    return await driveService.signIn();
  } catch (error) {
    console.error('Drive sign-in error:', error);
    return { signedIn: false, email: null };
  }
});

ipcMain.handle('drive-sign-in-cancel', () => {
  driveService.cancelSignIn();
});

ipcMain.handle('drive-sign-out', () => {
  driveService.cancelSignIn();
  driveService.signOut();
});
ipcMain.handle('drive-status', async () => driveService.getStatus());

ipcMain.handle('drive-list-files', async () => {
  try {
    return await driveService.listFiles();
  } catch (error) {
    console.error('Drive list error:', error);
    return [];
  }
});

ipcMain.handle('drive-upload', async (_, name: unknown, content: unknown) => {
  if (typeof name !== 'string' || typeof content !== 'string') return { ok: false, error: 'Invalid upload' };
  try {
    const id = await driveService.uploadFile(name, content);
    return { ok: true, id };
  } catch (error) {
    console.error('Drive upload error:', error);
    return { ok: false, error: String(error) };
  }
});

ipcMain.handle('drive-download', async (_, fileId: string) => {
  try {
    const buffer = await driveService.downloadFile(fileId);

    if (isZip(buffer)) {
      // Phase 7: unzip + media externalization run in the heavy UtilityProcess.
      const { data, mediaCount } = await heavyClient.extractGpres(buffer, mediaLibrary.dir);
      console.log(`[drive-download] ${mediaCount} media refs externalized`);
      return { ok: true, data: JSON.stringify(data) };
    }

    // Plain JSON (legacy or non-ZIP)
    return { ok: true, data: buffer.toString('utf-8') };
  } catch (error) {
    console.error('Drive download error:', error);
    return { ok: false, error: String(error) };
  }
});

ipcMain.handle('drive-delete-file', async (_, fileId: string) => {
  try {
    await driveService.deleteFile(fileId);
    return { ok: true };
  } catch (error) {
    console.error('Drive delete error:', error);
    return { ok: false, error: String(error) };
  }
});

ipcMain.handle('drive-save-presentation', async (_, content: unknown, customName?: string) => {
  if (typeof content !== 'string') return { ok: false, error: 'Invalid presentation data' };
  try {
    const data = JSON.parse(content);

    const trimmed = (customName ?? '').trim();
    if (trimmed) data.name = trimmed;

    // Phase 7: zip build (deflate CPU) runs in the heavy UtilityProcess. Yeniden serileştirme yalnızca ad değiştiyse gerekir.
    const payload = trimmed ? JSON.stringify(data) : content;
    const { embeddedCount, zipBuffer } = await heavyClient.buildGpres(payload, mediaLibrary.dir);

    // Strip characters invalid in filenames / Drive names.
    const baseName =
      String(data.name || 'presentation')
        .replace(/[\\/:*?"<>|]/g, '_')
        .trim() || 'presentation';
    const name = `${baseName}.gpres`;

    const id = await driveService.uploadBuffer(name, zipBuffer);
    console.info(`[drive-save-presentation] Uploaded ${name} (${embeddedCount} media files), id=${id}`);
    return { ok: true, id };
  } catch (error) {
    console.error('[drive-save-presentation] Error:', error);
    return { ok: false, error: String(error) };
  }
});