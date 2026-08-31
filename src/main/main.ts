/**
 * Electron main process: presentation control, projector window,
 * remote (phone) control server, and .gpres file I/O.
 */

import { app, BrowserWindow, Menu, ipcMain, dialog, screen, desktopCapturer, nativeImage, shell, protocol, net, session, systemPreferences } from 'electron';
import path       from 'node:path';
import fs         from 'node:fs/promises';
import http       from 'node:http';
import os         from 'node:os';
import { WebSocketServer, WebSocket as WsSocket } from 'ws';
import { REMOTE_HTML_NEW } from './remote-html';
import { driveService } from './driveService';
import { initUpdater } from './updater';
import { startPublicTunnel, stopPublicTunnel, getPublicTunnelStatus, disposePublicTunnel, setPublicTunnelStatusListener } from './cloudflareTunnelService';
import { initPerfMonitor, mainPerf, recordWs } from './perfMonitor';
import { createPresetStore } from './presetStore';
import { localResourceUrlToPath, isZip, mediaRefToName } from '../shared/mediaTree';
import { getMediaLibrary } from './mediaLibrary';
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

const DIST         = path.join(__dirname, '../dist');
const ICON_PATH    = path.join(__dirname, '../build', 'ico.png');
const VITE_PUBLIC  = app.isPackaged ? DIST : path.join(DIST, '../public');
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tif', '.tiff', '.avif', '.svg']);
const VIDEO_EXTS = new Set(['.mp4', '.webm', '.mov', '.mkv', '.avi', '.m4v', '.wmv', '.flv', '.mpeg', '.mpg']);
const AUDIO_EXTS = new Set(['.mp3', '.wav', '.ogg', '.flac', '.aac', '.m4a', '.wma']);

process.env.DIST        = DIST;
process.env.VITE_PUBLIC = VITE_PUBLIC;

// Phase 0 perf monitor — MUST run before any ipcMain handler is registered.
initPerfMonitor();

// Window references

let win: BrowserWindow | null = null;

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
  const raw = screen.getAllDisplays().map((display) => ({
    display,
    isPrimary: String(display.id) === primaryId,
  }));

  raw.sort((a, b) => {
    const left: DisplayInfo = {
      id: String(a.display.id),
      label: '',
      isPrimary: a.isPrimary,
      bounds: a.display.bounds,
      workArea: a.display.workArea,
      scaleFactor: a.display.scaleFactor,
    };
    const right: DisplayInfo = {
      id: String(b.display.id),
      label: '',
      isPrimary: b.isPrimary,
      bounds: b.display.bounds,
      workArea: b.display.workArea,
      scaleFactor: b.display.scaleFactor,
    };
    return compareDisplays(left, right);
  });

  let secondaryIndex = 0;
  return raw.map(({ display, isPrimary }) => ({
    id: String(display.id),
    label: isPrimary ? 'Primary' : `Screen ${++secondaryIndex}`,
    isPrimary,
    bounds: display.bounds,
    workArea: display.workArea,
    scaleFactor: display.scaleFactor,
  }));
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
  win?.webContents.send('projector-output-status', getProjectorOutputStatus());
}

function sendDisplaySnapshot(): void {
  win?.webContents.send('displays-changed', getDisplayInfos());
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
  for (const [displayId, entry] of projectorWindows) {
    const display = getRawDisplay(displayId);
    if (!display) {
      if (!entry.window.isDestroyed()) entry.window.close();
      continue;
    }
    // Fullscreen windows auto-position on their display — no reposition needed.
  }
  sendDisplaySnapshot();
}

function attachDisplayWatch(): void {
  screen.on('display-added', () => refreshProjectorWindows());
  screen.on('display-removed', () => refreshProjectorWindows());
  screen.on('display-metrics-changed', () => refreshProjectorWindows());
}

// Remote server state

let remoteServer:    http.Server     | null = null;
let wss:             WebSocketServer | null = null;
let remoteServerUrl = '';

type SlideMeta = {
  partsMode: boolean;
  parts: string[] | null;
  title: string | null;
};

let remoteStatus: {
  slideCount:          number;
  currentIndex:        number;
  isBlackout:          boolean;
  isProjectorOpen:     boolean;
  slideTransition:     string;
  transitionDurationMs: number;
  activePart:          number | null;
  partsCount:          number | null;
  slideMeta:           SlideMeta[] | null;
} = {
  slideCount:      0,
  currentIndex:    0,
  isBlackout:      false,
  isProjectorOpen: false,
  slideTransition: 'fade',
  transitionDurationMs: 400,
  activePart:  null,
  partsCount:  null,
  slideMeta:   null,
};

/** Last captured slide preview, sent immediately to new clients. */
let lastPreviewDataUrl: string | null = null;
let allSlidePreviews: string[] = [];
/** JSON snapshot of the last broadcast slideMeta, used to detect deck changes. */
let lastSlideMetaJson = '';

/** Connected WebSocket clients (remote phones). */
const wsClients = new Set<WsSocket>();

function broadcast(msg: object): void {
  const str = JSON.stringify(msg);
  recordWs(str.length);
  for (const client of wsClients) {
    if (client.readyState === WsSocket.OPEN) {
      try { client.send(str); } catch { /* dead socket, ignore */ }
    }
  }
}

/** Notify renderer of connected client count. */
function broadcastClientCount(): void {
  win?.webContents.send('remote-client-count', wsClients.size);
}

// Slide preview capture (debounced + rate-limited)

let captureTimer: ReturnType<typeof setTimeout> | null = null;
let lastCaptureTime = 0;
const CAPTURE_MIN_INTERVAL = 100; // ms, hard floor between captures

/** True if the frame is blank (black/flat color) — e.g. a minimized window. */
function captureIsBlank(img: Electron.NativeImage): boolean {
  try {
    const { width, height } = img.getSize();
    if (!width || !height) return true;
    const bmp = img.toBitmap(); // BGRA
    let sum = 0;
    const step = Math.max(1, Math.floor(bmp.length / (200_000 * 4)));
    for (let i = 0; i < bmp.length; i += 4 * step) {
      sum += bmp[i] + bmp[i + 1] + bmp[i + 2];
    }
    const samples = Math.max(1, Math.ceil(bmp.length / (4 * step)));
    return sum / (samples * 3) < 6;
  } catch {
    return true;
  }
}

/**
 * Captures a downscaled JPEG preview of the projector/main window and
 * broadcasts it. Debounced + rate-limited; fallback only until the renderer
 * delivers its own canvas preview (never overwrites it).
 */
function scheduleSlideCapture(delayMs = 300): void {
  if (wsClients.size === 0) return; // no one listening, skip the work
  if (captureTimer) clearTimeout(captureTimer);
  captureTimer = setTimeout(async () => {
    const now = Date.now();
    if (now - lastCaptureTime < CAPTURE_MIN_INTERVAL) return;
    lastCaptureTime = now;

    const target = [...projectorWindows.values()].find((entry) => !entry.window.isDestroyed())?.window ?? win;
    if (!target || target.isDestroyed()) return;
    try {
      const img = await target.webContents.capturePage();
      if (img.isEmpty()) return;
      if (captureIsBlank(img)) return; // minimized/occluded window → skip
      const buf = img.resize({ width: 480 }).toJPEG(65);
      lastPreviewDataUrl = `data:image/jpeg;base64,${buf.toString('base64')}`;
      broadcast({ type: 'preview', data: lastPreviewDataUrl });
    } catch { /* window not ready yet */ }
  }, delayMs);
}

// Local IPv4 detection (scored, cached for app lifetime)

let cachedLocalIP: string | null = null;
let remoteDebugInfo: {
  port: number | null;
  selectedAddress: string;
  candidates: Array<{ name: string; address: string; cidr: string | null; mac: string; score: number }>;
  timestamp: string | null;
} = {
  port: null,
  selectedAddress: '',
  candidates: [],
  timestamp: null,
};

function isLinkLocalIPv4(address: string): boolean {
  return /^169\.254\./.test(address);
}

/** Higher score = more likely to be the LAN interface the phone can reach. */
function scoreLocalIPv4Candidate(name: string, address: string): number {
  let score = 0;
  const normalized = name.toLowerCase();

  if (/wi[-_]?fi|wlan|wireless/.test(normalized)) score += 30;
  if (/eth|en\d|ethernet|lan/.test(normalized)) score += 20;
  if (/realtek|intel|qualcomm|broadcom|bcm|atheros|rtl|marvell|r\d\d/.test(normalized)) score += 10;
  if (/docker|vmware|virtual|vbox|hyper-?v|loopback|tun|tap|hamachi|bridge|br-|virbr|utun|wg|wireguard|ppp|vpn/.test(normalized)) score -= 100;

  if (isLinkLocalIPv4(address)) score -= 100;
  if (/^127\./.test(address) || /^0\./.test(address)) score -= 100;

  if (/^10\./.test(address)) score += 15;
  if (/^192\.168\./.test(address)) score += 15;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(address)) score += 15;

  if (!/^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[0-1])\.|169\.254\.)/.test(address)) {
    score += 5; // public/uncommon subnet, still possibly valid
  }

  return score;
}

function listLocalIPv4Candidates() {
  const nets = os.networkInterfaces();
  const candidates: Array<{ name: string; address: string; cidr: string | null; mac: string; score: number }> = [];

  for (const [name, addrs] of Object.entries(nets)) {
    if (!addrs) continue;
    for (const iface of addrs) {
      if (iface.family !== 'IPv4') continue;
      candidates.push({
        name,
        address: iface.address,
        cidr: iface.cidr ?? null,
        mac: iface.mac,
        score: scoreLocalIPv4Candidate(name, iface.address),
      });
    }
  }

  return candidates.sort((a, b) => b.score - a.score);
}

function getLocalIPv4(): string {
  if (cachedLocalIP) return cachedLocalIP;

  const candidates = listLocalIPv4Candidates();
  remoteDebugInfo.candidates = candidates;

  const best = candidates.find(c => c.score > -50 && !isLinkLocalIPv4(c.address));
  cachedLocalIP = best?.address ?? candidates[0]?.address ?? '127.0.0.1';
  remoteDebugInfo.selectedAddress = cachedLocalIP;
  return cachedLocalIP;
}

// Preset store (Phase 5): per-preset files under userData/presets/, see
// presetStore.ts for the migration + atomic-write logic.
const presetStore = createPresetStore(app.getPath('userData'), mainPerf);

// Persistent media library (Phase 6): userData/media/, see mediaLibrary.ts.
const mediaLibrary = getMediaLibrary();

// Generic recursive file finder
// One directory walker, parametrized by a filter, replaces two near-identical
// walkers (XML files / media files). Recursion is parallel per-directory and
// results are flattened with the built-in `flat()` instead of manual pushes.

interface ScanFolderOptions {
  recursive?: boolean;
  includeImages?: boolean;
  includeVideos?: boolean;
}

async function walkFiles(
  dir: string,
  matches: (name: string, ext: string) => boolean,
  recursive = true,
): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const tasks = entries.map(async (entry): Promise<string[]> => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return recursive ? walkFiles(full, matches, true) : [];
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
    recursive,
  );
};

// HTTP body reader

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalLength = 0;
    req.on('data', (c) => {
      chunks.push(c);
      totalLength += c.length;
      if (totalLength > 1024 * 1024 * 10) { // 10 MB limit
        req.destroy();
        reject(new Error('Payload too large'));
      }
    });
    req.on('end',   () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}

// Window creation

const QUIT_CONFIRM_TEXTS: Record<string, { message: string; detail: string; cancel: string; confirm: string }> = {
  tr: { message: 'Çıkmak istediğinize emin misiniz?', detail: 'Çıkış yaparsanız canlı yayın durdurulur.', cancel: 'Vazgeç', confirm: 'Evet, Çık' },
  en: { message: 'Are you sure you want to quit?', detail: 'Live projection will stop if you quit.', cancel: 'Cancel', confirm: 'Yes, Quit' },
  es: { message: '¿Seguro que desea salir?', detail: 'La proyección en vivo se detendrá si sale.', cancel: 'Cancelar', confirm: 'Sí, salir' },
  de: { message: 'Möchten Sie wirklich beenden?', detail: 'Die Live-Projektion wird beendet, wenn Sie beenden.', cancel: 'Abbrechen', confirm: 'Ja, beenden' },
  ko: { message: '정말 종료하시겠습니까?', detail: '종료하면 라이브 프로젝션이 중지됩니다.', cancel: '취소', confirm: '예, 종료' },
};

let rendererLanguageCache = 'tr';

/** Best-effort read of the renderer's chosen language (localStorage persisted by i18next). */
function refreshRendererLanguage(): void {
  const lng = win?.webContents.executeJavaScript(`localStorage.getItem('i18nextLng') || 'tr'`);
  if (lng && typeof (lng as unknown as Promise<string>).then === 'function') {
    (lng as unknown as Promise<string>)
      .then((value) => { rendererLanguageCache = String(value).split('-')[0] ?? 'tr'; })
      .catch(() => { /* default stays */ });
  }
}

/** Quit confirm: blocks window close until the user confirms in a native dialog. */
function attachQuitConfirm(window: BrowserWindow): void {
  let quitConfirmed = false;

  window.on('close', (e) => {
    if (quitConfirmed) return;
    e.preventDefault();

    const texts = QUIT_CONFIRM_TEXTS[rendererLanguageCache] ?? QUIT_CONFIRM_TEXTS.en;
    dialog
      .showMessageBox(window, {
        type: 'question',
        title: 'Worship Presentation Assistant',
        message: texts.message,
        detail: texts.detail,
        buttons: [texts.cancel, texts.confirm],
        defaultId: 0,
        cancelId: 0,
      })
      .then(({ response }) => {
        if (response === 1) {
          quitConfirmed = true;
          if (!window.isDestroyed()) window.close();
        }
      })
      .catch(() => {
        quitConfirmed = true;
        if (!window.isDestroyed()) window.close();
      });
  });
}

function createWindow(): void {
  win = new BrowserWindow({
    icon: ICON_PATH,
    width: 1200, height: 800, minWidth: 800, minHeight: 600,
    fullscreenable: true,
    autoHideMenuBar: true,
    title: 'Worship Presentation Assistant - Control Panel',
    webPreferences: {
      preload:          path.join(__dirname, 'preload.js'),
      nodeIntegration:  false,
      contextIsolation: true,
      webSecurity:      true,
    },
  });

  Menu.setApplicationMenu(null);

  process.env.VITE_DEV_SERVER_URL
    ? win.loadURL(process.env.VITE_DEV_SERVER_URL)
    : win.loadFile(path.join(DIST, 'index.html'));

  win.maximize();

  attachQuitConfirm(win);

  win.webContents.once('did-finish-load', refreshRendererLanguage);

  win.on('closed', () => {
    for (const entry of projectorWindows.values()) {
      if (!entry.window.isDestroyed()) entry.window.close();
    }
    win = null;
  });
}

function createProjectorWindow(requestedDisplayId?: string, initialData?: any): boolean {
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
      preload:          path.join(__dirname, 'preload.js'),
      nodeIntegration:  false,
      contextIsolation: true,
      webSecurity:      true,
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
  broadcast({ type: 'status', data: remoteStatus });

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
    initialData && typeof initialData === 'object' && (initialData as any).outputMode === 'stage'
      ? 'stage'
      : 'follow';
  const query = `mode=projector&displayId=${encodeURIComponent(displayId)}&outputMode=${encodeURIComponent(initialOutputMode)}`;
  process.env.VITE_DEV_SERVER_URL
    ? projectorWindow.loadURL(`${process.env.VITE_DEV_SERVER_URL}?${query}`)
    : projectorWindow.loadFile(path.join(DIST, 'index.html'), { query: { mode: 'projector', displayId, outputMode: initialOutputMode } });

  // Keyboard bridge: the projector window frequently holds focus. Keep the
  // existing global navigation behavior so the normal single-screen workflow
  // remains unchanged.
  const PROJECTOR_NAV_NEXT = new Set(['ArrowRight', 'ArrowDown', ' ', 'PageDown', 'j', 'J']);
  const PROJECTOR_NAV_PREV = new Set(['ArrowLeft', 'ArrowUp', 'PageUp', 'k', 'K']);

  projectorWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || input.isAutoRepeat) return;
    if (input.control || input.alt || input.meta) return;
    const sendRemote = (action: string, value?: unknown) => {
      if (win && !win.isDestroyed()) win.webContents.send('remote-action', { action, value });
    };

    const key = input.key;
    let handled = false;
    if (PROJECTOR_NAV_NEXT.has(key)) {
      sendRemote('next'); handled = true;
    } else if (PROJECTOR_NAV_PREV.has(key)) {
      sendRemote('prev'); handled = true;
    } else if (key === 'Home') {
      sendRemote('goto', 0); handled = true;
    } else if (key === 'End') {
      sendRemote('goto', 2 ** 31 - 1); handled = true;
    } else if (key === 'b' || key === 'B') {
      sendRemote('blackout'); handled = true;
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
    win?.webContents.send('projector-closed', { displayId });
    remoteStatus.isProjectorOpen = projectorWindows.size > 0;
    broadcast({ type: 'status', data: remoteStatus });
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
  if (win && !win.isDestroyed()) {
    win.webContents.send('projector-ready-ack', { displayId: entry.displayId });
  }
  sendProjectorOutputStatus();
});

// HTTP + WebSocket remote control server

function createRemoteServer(): void {
  remoteServer = http.createServer(async (req, res) => {
    const { pathname } = new URL(req.url ?? '/', 'http://localhost');

    // Phone captions/translation share (token-guarded, only while active)
    if (pathname === '/share') {
      if (handleShareHttp(req, res)) return;
    }

    // Phone live-screen share (token-guarded, only while active)
    if (pathname === '/screen') {
      if (handleScreenShareHttp(req, res)) return;
    }

    // Remote control web UI
    if (pathname === '/' || pathname === '/remote') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(REMOTE_HTML_NEW);
      return;
    }

    // Legacy REST: status
    if (pathname === '/api/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(remoteStatus));
      return;
    }

    // Legacy REST: command
    if (pathname === '/api/control' && req.method === 'POST') {
      try {
        const data = JSON.parse(await readBody(req));
        win?.webContents.send('remote-action', { action: data.action, value: data.value });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"ok":true}');
      } catch {
        res.writeHead(400);
        res.end('Bad Request');
      }
      return;
    }

    if (pathname === '/api/diagnostics') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        remoteServerUrl,
        debug: remoteDebugInfo,
        timestamp: new Date().toISOString(),
      }));
      return;
    }

    res.writeHead(404);
    res.end('Not Found');
  });

  wss = new WebSocketServer({ server: remoteServer, maxPayload: 1024 * 512 }); // 512KB cap (DoS guard)

  wss.on('connection', (client: WsSocket, req: http.IncomingMessage) => {
    // Phone captions clients connect to /share?token=… and are handled (and
    // authenticated) entirely by the share service.
    if (handleShareConnection(client, req)) return;

    // Phone live-screen clients connect to /screen?token=… (view-only frames).
    if (handleScreenShareConnection(client, req)) return;

    wsClients.add(client);
    broadcastClientCount();

    // Send current state to the newly connected client immediately.
    try {
      client.send(JSON.stringify({
        type: 'welcome',
        data: { status: remoteStatus, preview: lastPreviewDataUrl, allPreviews: allSlidePreviews, slideMeta: remoteStatus.slideMeta },
      }));
    } catch { /* ignore */ }

    client.on('message', (raw: WsSocket) => {
      try {
        const msg = JSON.parse(raw.toString()) as { type: string; action?: string; value?: unknown };
        if (msg.type === 'command' && msg.action) {
          win?.webContents.send('remote-action', { action: msg.action, value: msg.value });
        }
      } catch { /* invalid JSON, ignore */ }
    });

    client.on('close', () => { wsClients.delete(client); broadcastClientCount(); });
    client.on('error', () => {
      try { client.terminate(); } catch { /* already closed */ }
      wsClients.delete(client);
      broadcastClientCount();
    });
  });

  // Random port, all interfaces
  remoteServer.listen(0, '0.0.0.0', () => {
    const addr = remoteServer?.address();
    if (addr && typeof addr === 'object') {
      const selectedIp = getLocalIPv4();
      remoteServerUrl = `http://${selectedIp}:${addr.port}/remote`;
      remoteDebugInfo.port = addr.port;
      remoteDebugInfo.timestamp = new Date().toISOString();
      remoteDebugInfo.selectedAddress = selectedIp;
      remoteDebugInfo.candidates = listLocalIPv4Candidates();
      console.info('[REMOTE SERVER] Listening on all interfaces');
      console.info('[REMOTE SERVER] URL:', remoteServerUrl);
      console.info('[REMOTE SERVER] Candidates:', remoteDebugInfo.candidates);
    }
  });
}

// Phone captions share: network re-resolution while a broadcast is live.
// The LAN IP can change (Wi-Fi reconnect, cable swap); when it does we rebuild
// the share URL and tell the renderer so it can regenerate the QR code.
let shareNetworkTimer: ReturnType<typeof setInterval> | null = null;

function startShareNetworkWatch(): void {
  if (shareNetworkTimer) return;
  shareNetworkTimer = setInterval(() => {
    const addr = remoteServer?.address();
    const port = addr && typeof addr === 'object' ? addr.port : 0;
    cachedLocalIP = null; // force a fresh scan
    const ip = getLocalIPv4();

    if (isShareActive()) {
      const shareChanged = refreshShareHost(ip, port);
      if (shareChanged) {
        win?.webContents.send('share:network-changed', { url: getShareStatus().url });
      }
    }

    if (isScreenShareActive()) {
      const screenChanged = refreshScreenShareHost(ip, port);
      if (screenChanged) {
        win?.webContents.send('screen-share:network-changed', { url: getScreenShareStatus().url });
      }
    }
  }, 10000);
}

// App lifecycle

protocol.registerSchemesAsPrivileged([
  { scheme: 'local-resource', privileges: { bypassCSP: true, stream: true, supportFetchAPI: true } },
]);

const MIME_BY_EXT: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.png': 'image/png', '.gif': 'image/gif',
  '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp', '.avif': 'image/avif',
  '.tif': 'image/tiff', '.tiff': 'image/tiff',
  '.mp4': 'video/mp4', '.webm': 'video/webm',
  '.mov': 'video/quicktime', '.m4v': 'video/x-m4v',
  '.mkv': 'video/x-matroska',
};

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

app.whenReady().then(() => {
  setupMediaPermissionHandlers();
  protocol.handle('local-resource', async (request) => {
    let filePath: string;
    const mediaName = mediaRefToName(request.url);
    if (mediaName) {
      // Phase 6 media library: userData/media/<name>, name validated above.
      filePath = path.join(mediaLibrary.dir, mediaName);
    } else {
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

    try {
      const data = await fs.readFile(filePath);
      const ext = path.extname(filePath).toLowerCase();
      return new Response(data, {
        headers: { 'Content-Type': MIME_BY_EXT[ext] || 'application/octet-stream' },
      });
    } catch (err) {
      console.error(`[local-resource] Failed to serve ${filePath}:`, err);
      return new Response('Not found', { status: 404 });
    }
  });
  createWindow();
  if (win) initUpdater(win);
  attachDisplayWatch();
  createRemoteServer();
  setPublicTunnelStatusListener((next) => win?.webContents.send('public-tunnel:status', next));
  setClientCountListener((count) => win?.webContents.send('share:client-count', count));
  setScreenShareClientCountListener((count) => win?.webContents.send('screen-share:client-count', count));
  registerSttIpc();
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

app.on('will-quit', () => {
  cleanupTempDir();
  if (shareNetworkTimer) clearInterval(shareNetworkTimer);
  disposeShare();
  disposeScreenShare();
  disposePublicTunnel();
  wss?.close();
  remoteServer?.close();
  cleanupStt();
  if (captureTimer) clearTimeout(captureTimer);
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
    await Promise.all(entries
      .filter((e) => e.startsWith('presenter-'))
      .map((e) => fs.rm(path.join(tmp, e), { recursive: true, force: true })));
  } catch { /* nothing to clean */ }
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
  } catch { /* ignore */ }
}

ipcMain.handle('save-file', async (_, content: string) => {
  const { filePath, canceled } = await dialog.showSaveDialog({
    defaultPath: lastDialogDir,
    filters: [{ name: 'Worship Presentation Assistant Files', extensions: ['gpres'] }],
  });
  if (canceled || !filePath) return null;
  rememberDir(filePath);

  // Phase 7: zip build (deflate CPU) runs in the heavy UtilityProcess.
  const { embeddedCount, zipBuffer } = await heavyClient.buildGpres(content, mediaLibrary.dir);
  await fs.writeFile(filePath, zipBuffer);

  console.info(`[save-file] Saved ${filePath} (${embeddedCount} media files embedded)`);
  return filePath;
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
    return { path: filePath, content: JSON.stringify(data, null, 2) };
  }

  // Legacy plain-JSON format
  return { path: filePath, content: raw.toString('utf-8') };
});

// IPC: native dialogs

ipcMain.handle(
  'show-confirm-dialog',
  async (_, options: { message: string; title?: string; detail?: string; confirmLabel?: string; cancelLabel?: string }) => {
    const parent = win ?? BrowserWindow.getFocusedWindow();
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
  },
);

ipcMain.handle(
  'show-alert-dialog',
  async (_, options: { message: string; title?: string; detail?: string; okLabel?: string }) => {
    const parent = win ?? BrowserWindow.getFocusedWindow();
    const boxOptions = {
      type: 'info' as const,
      buttons: [options.okLabel ?? 'OK'],
      title: options.title ?? 'Worship Presentation Assistant',
      message: options.message,
      detail: options.detail,
    };
    parent ? await dialog.showMessageBox(parent, boxOptions) : await dialog.showMessageBox(boxOptions);
  },
);

// IPC: preset CRUD

ipcMain.handle('load-presets', (_, retentionMs?: number) => presetStore.readPresets(retentionMs));

ipcMain.handle('save-preset', async (_, preset: { name: string; presentation: unknown; retentionMs?: number }) => {
  return presetStore.savePreset(preset);
});

ipcMain.handle('delete-preset', async (_, name: string, retentionMs?: number) => {
  return presetStore.deletePreset(name, retentionMs);
});

ipcMain.handle('rename-preset', async (_, oldName: string, newName: string, retentionMs?: number) => {
  return presetStore.renamePreset(oldName, newName, retentionMs);
});

// IPC: displays and projector outputs

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
  const outputs = payload.outputs && typeof payload.outputs === 'object' ? payload.outputs as Record<string, any> : null;

  for (const entry of projectorWindows.values()) {
    if (entry.window.isDestroyed()) continue;

    const output = outputs?.[entry.displayId];
    const frame = {
      ...payload,
      ...(outputs ? { outputs: undefined } : {}),
      ...(output && typeof output === 'object'
        ? {
            liveIndex: output.slideIndex,
            isBlackout: !!output.isBlackout,
            outputMode: output.mode,
            outputDisplayId: entry.displayId,
          }
        : { outputDisplayId: entry.displayId }),
    };
    delete frame.outputs;

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
ipcMain.handle('cleanup-temp-dir', () => { cleanupTempDir(); return true; });

// IPC: remote control

ipcMain.handle('get-remote-url', () => remoteServerUrl);

ipcMain.handle('public-tunnel:start', async () => {
  const addr = remoteServer?.address();
  const port = addr && typeof addr === 'object' ? addr.port : 0;
  if (!port) return { active: false, url: '', state: 'error', error: 'server-not-ready' };
  return startPublicTunnel(port);
});
ipcMain.handle('public-tunnel:stop', () => stopPublicTunnel());
ipcMain.handle('public-tunnel:status', () => getPublicTunnelStatus());
ipcMain.handle('get-remote-debug', () => ({ remoteServerUrl, debug: remoteDebugInfo }));

ipcMain.handle('get-remote-diagnostics', async () => {
  const result: {
    ok: boolean;
    serverRunning: boolean;
    serverUrl: string | null;
    port: number | null;
    selectedAddress: string;
    interfaces: Array<{ name: string; address: string; score: number }>;
    selfConnectTest: { tried: boolean; success: boolean; error?: string };
    firewallWarning: boolean;
    checks: Array<{ label: string; pass: boolean; detail: string }>;
  } = {
    ok: false,
    serverRunning: false,
    serverUrl: null,
    port: null,
    selectedAddress: '',
    interfaces: [],
    selfConnectTest: { tried: false, success: false },
    firewallWarning: false,
    checks: [],
  };

  // 1. Check if the HTTP server is listening
  const addr = remoteServer?.address();
  const listening = !!(addr && typeof addr === 'object');
  result.serverRunning = listening;
  result.port = listening ? (addr as any).port : null;

  // 2. Get address info
  const ip = getLocalIPv4();
  result.selectedAddress = ip;
  result.serverUrl = remoteServerUrl;

  // 3. List interfaces
  const candidates = listLocalIPv4Candidates();
  result.interfaces = candidates.slice(0, 6).map((c) => ({
    name: c.name,
    address: c.address,
    score: c.score,
  }));

  // 4. Self-connect test
  if (listening) {
    const testUrl = `http://${ip}:${addr.port}/api/status`;
    try {
      const testResult = await new Promise<{ ok: boolean; error?: string }>((resolve) => {
        const req = http.get(testUrl, { timeout: 3000 }, (res) => {
          let body = '';
          res.on('data', (chunk: Buffer) => { body += chunk.toString(); });
          res.on('end', () => {
            try { JSON.parse(body); resolve({ ok: true }); }
            catch { resolve({ ok: false, error: 'invalid-json' }); }
          });
        });
        req.on('error', (err: NodeJS.ErrnoException) => {
          resolve({ ok: false, error: err.code ?? err.message });
        });
        req.on('timeout', () => {
          req.destroy();
          resolve({ ok: false, error: 'timeout' });
        });
      });
      result.selfConnectTest = { tried: true, success: testResult.ok, ...(testResult.error ? { error: testResult.error } : {}) };
    } catch {
      result.selfConnectTest = { tried: true, success: false, error: 'unexpected-error' };
    }
  }

  // 5. Build checks
  result.checks.push({
    label: 'serverListening',
    pass: listening,
    detail: listening
      ? `Listening on port ${result.port ?? '?'}`
      : 'Server could not start — try restarting the app',
  });

  const hasGoodInterface = candidates.some((c) => c.score > -50);
  result.checks.push({
    label: 'networkInterface',
    pass: hasGoodInterface,
    detail: hasGoodInterface
      ? `Active interface: ${ip}`
      : 'No suitable network interface found — check your Wi-Fi or Ethernet connection',
  });

  const isPrivateIP = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(ip);
  result.checks.push({
    label: 'privateSubnet',
    pass: isPrivateIP,
    detail: isPrivateIP
      ? `IP is on a local network (${ip})`
      : `IP (${ip}) does not appear to be on a local network — phone must be on the same network`,
  });

  result.checks.push({
    label: 'selfConnect',
    pass: result.selfConnectTest.success,
    detail: result.selfConnectTest.success
      ? 'App can connect to itself — server is working'
      : result.selfConnectTest.error === 'timeout'
        ? 'Self-connect timed out — firewall or antivirus may be blocking'
        : result.selfConnectTest.error === 'ECONNREFUSED'
          ? 'Connection refused — firewall may be blocking the port'
          : `Self-test failed (${result.selfConnectTest.error || 'unknown error'}) — check your firewall`,
  });

  // Firewall warning: self-connect fails but server is listening
  result.firewallWarning = !!(listening && !result.selfConnectTest.success);

  // Overall ok: server running AND self-test passed (means firewall isn't blocking)
  result.ok = !!(listening && result.selfConnectTest.success && hasGoodInterface && isPrivateIP);

  return result;
});

// ─── Phone captions/translation share IPC ──────────────────────────────────
ipcMain.handle('share:start', async (_, subdomain?: string) => {
  try {
    const addr = remoteServer?.address();
    const port = addr && typeof addr === 'object' ? addr.port : 0;
    if (!port) return { ok: false, error: 'server-not-ready' };
    const result = startShare(getLocalIPv4(), port);
    if (!result) return { ok: false, error: 'already-active' };
    startShareNetworkWatch();
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
  const addr = remoteServer?.address();
  const port = addr && typeof addr === 'object' ? addr.port : 0;
  if (!port) return { ok: false, error: 'server-not-ready' };
  const result = startScreenShare(getLocalIPv4(), port);
  if (!result) return { ok: false, error: 'already-active' };
  startShareNetworkWatch();
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

ipcMain.handle('quit-app', () => { app.quit(); return true; });

ipcMain.handle('update-all-slide-previews', (_, previews: string[]) => {
  allSlidePreviews = Array.isArray(previews) ? previews : [];
  broadcast({ type: 'allPreviews', data: allSlidePreviews });
  return true;
});

// Phase 3: renderer sends only the thumbnails that actually changed as
// {index, url} pairs. Main patches its snapshot array in place and forwards
// the tiny delta, so a single-slide edit no longer rebroadcasts the whole
// list (~23 KB instead of ~117 MB at 5000 slides).
ipcMain.handle('update-slide-previews-delta', (_, updates: { i: number; url: string }[]) => {
  if (!Array.isArray(updates) || updates.length === 0) return false;
  const applied: { i: number; url: string }[] = [];
  for (const u of updates) {
    if (!u || typeof u.i !== 'number' || typeof u.url !== 'string') continue;
    // '' is a falsy placeholder, equivalent to the null entries the full-list
    // path can carry (remote renders it as an empty slot).
    while (allSlidePreviews.length <= u.i) allSlidePreviews.push('');
    if (allSlidePreviews[u.i] === u.url) continue; // already current, skip
    allSlidePreviews[u.i] = u.url;
    applied.push(u);
  }
  if (applied.length > 0) broadcast({ type: 'previewsDelta', data: applied });
  return true;
});

/**
 * Renderer hook on slide change / blackout / etc: broadcasts status to
 * phones, then schedules a throttled preview capture after the transition.
 */
ipcMain.handle('update-remote-status', (_, status: Partial<typeof remoteStatus> & { slidePreviews?: SlideMeta[] }) => {
  remoteStatus = {
    slideCount:      typeof status.slideCount   === 'number' ? status.slideCount   : remoteStatus.slideCount,
    currentIndex:    typeof status.currentIndex === 'number' ? status.currentIndex : remoteStatus.currentIndex,
    isBlackout:      !!status.isBlackout,
    isProjectorOpen: !!status.isProjectorOpen,
    slideTransition: typeof (status as any).slideTransition === 'string' ? (status as any).slideTransition : remoteStatus.slideTransition,
    transitionDurationMs: typeof (status as any).transitionDurationMs === 'number' ? (status as any).transitionDurationMs : remoteStatus.transitionDurationMs,
    // partsMode fields — null when live slide is not a partsMode slide
    activePart:  typeof (status as any).activePart  === 'number' ? (status as any).activePart  : null,
    partsCount:  typeof (status as any).partsCount  === 'number' ? (status as any).partsCount  : null,
    slideMeta:   Array.isArray((status as any).slidePreviews) ? (status as any).slidePreviews : remoteStatus.slideMeta,
  };

  // slideMeta rides its own message (broadcast only when it changes), so strip
  // it from the per-navigation status payload to keep traffic minimal.
  const statusPayload = {
    slideCount: remoteStatus.slideCount,
    currentIndex: remoteStatus.currentIndex,
    isBlackout: remoteStatus.isBlackout,
    isProjectorOpen: remoteStatus.isProjectorOpen,
    slideTransition: remoteStatus.slideTransition,
    transitionDurationMs: remoteStatus.transitionDurationMs,
    activePart: remoteStatus.activePart,
    partsCount: remoteStatus.partsCount,
  };
  broadcast({ type: 'status', data: statusPayload });

  // Per-slide metadata (partsMode flags + part texts) changes only when the
  // deck changes, so broadcast it as its own message only on change to keep
  // traffic minimal on every slide navigation.
  if (Array.isArray(remoteStatus.slideMeta)) {
    const metaJson = JSON.stringify(remoteStatus.slideMeta);
    if (metaJson !== lastSlideMetaJson) {
      lastSlideMetaJson = metaJson;
      broadcast({ type: 'slideMeta', data: remoteStatus.slideMeta });
    }
  }

  const duration = Math.max(0, remoteStatus.transitionDurationMs || 0);
  const transitionDelay = remoteStatus.slideTransition !== 'none' && duration > 0
    ? Math.max(300, duration + 120)
    : 300;

  // Renderer thumbnails (send-slide-preview) are the accurate preview source
  // for parts/lyrics changes; the window capture is only a first-connect
  // fallback until the first renderer preview arrives, so it can never race
  // and overwrite a fresh part preview with a stale or black frame.
  if (lastPreviewDataUrl === null) {
    scheduleSlideCapture(transitionDelay);
  }
  return true;
});

/**
 * Optional: renderer captures its own canvas as base64 and sends it here.
 * More accurate and cheaper than capturePage(). Renderer usage:
 *   await window.electronAPI.sendSlidePreview(canvas.toDataURL('image/jpeg', 0.8));
 */
ipcMain.handle('send-slide-preview', (_, dataUrl: string) => {
  if (!dataUrl) return false;
  lastPreviewDataUrl = dataUrl;
  broadcast({ type: 'preview', data: dataUrl });
  return true;
});

// IPC: media / import

ipcMain.handle('import-bible-xml', async (_, filePath?: string) => {
  let selected = filePath;
  if (selected) {
    try { if (!(await fs.stat(selected)).isFile()) selected = undefined; }
    catch { selected = undefined; }
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

ipcMain.handle('save-bible-data', async (_, id: string, data: unknown) => {
  try {
    const dir = getBiblesDir();
    await fs.mkdir(dir, { recursive: true });
    const safeName = String(id).replace(/[^a-zA-Z0-9_.\-]/g, '_').replace(/\.\./g, '_') || 'bible';
    const filePath = path.join(dir, `${safeName}.json`);
    await fs.writeFile(filePath, JSON.stringify(data), 'utf-8');
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
  const filters = type === 'image'
    ? [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp'] }]
    : [{ name: 'Videos', extensions: ['mp4', 'webm', 'ogg', 'mov'] }];
  const { filePaths } = await dialog.showOpenDialog({ defaultPath: lastDialogDir, filters, properties: ['openFile'] });
  rememberDir(filePaths?.[0]);
  return filePaths?.[0] ?? null;
});

ipcMain.handle('select-media-files-all', async () => {
  const filters = [
    { name: 'Media', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'mp4', 'webm', 'mov', 'mkv', 'avi'] },
  ];
  const { filePaths } = await dialog.showOpenDialog({ defaultPath: lastDialogDir, filters, properties: ['openFile', 'multiSelections'] });
  if (filePaths?.length) rememberDir(filePaths[0]);
  return filePaths?.length ? filePaths : null;
});

ipcMain.handle('select-media-folder', async () => {
  const result = await dialog.showOpenDialog({ defaultPath: lastDialogDir, properties: ['openDirectory', 'createDirectory'] });
  if (result.canceled || result.filePaths.length === 0) return null;
  lastDialogDir = result.filePaths[0]; // the selection IS a directory
  return result.filePaths[0];
});

/* YouTube music integration removed.
/* ipcMain.handle('youtube-search', async (_, query: string) => {
  const cleanQuery = typeof query === 'string' ? query.trim().slice(0, 200) : '';
  if (!cleanQuery) return { ok: false, results: [], error: 'empty-query' };
  try {
    const response = await fetch(`https://www.youtube.com/results?search_query=${encodeURIComponent(cleanQuery)}`, {
      headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'text/html' },
    });
    if (!response.ok) throw new Error(`YouTube HTTP ${response.status}`);
    const html = await response.text();
    const results: Array<{ id: string; title: string; duration?: string }> = [];
    const seen = new Set<string>();
    const re = /"videoId":"([\\w-]{11})"[\\s\\S]{0,2000}?"title":\{"runs":\[\{"text":"((?:[^"\\\\]|\\\\.)*)"/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(html)) && results.length < 12) {
      const id = match[1];
      if (seen.has(id)) continue;
      seen.add(id);
      results.push({ id, title: JSON.parse('"' + match[2] + '"') });
    }
    return { ok: true, results };
  } catch (error) {
    console.error('[youtube-search] failed:', error);
    return { ok: false, results: [], error: 'search-failed' };
  }});

*/

ipcMain.handle('select-audio-folder', async () => {
  const result = await dialog.showOpenDialog({ defaultPath: lastDialogDir, properties: ['openDirectory', 'createDirectory'] });
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

  const baseName = String(data?.name || 'presentation')
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
    try { if (!(await fs.stat(selected)).isDirectory()) selected = undefined; }
    catch { selected = undefined; }
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
      chunk.map(fp => fs.readFile(fp, 'utf-8').then(content => ({ name: path.basename(fp), content }))),
    );
    contents.push(...results);
  }

  return { results: contents, path: selected };
});

// IPC: screen capture

interface ScreenSource {
  id: string;
  name: string;
  thumbnail: string;
  display_id: string;
  appIcon?: string;
}

ipcMain.handle('get-screen-sources', async () => {
  try {
    const sources = await desktopCapturer.getSources({
      types: ['window', 'screen'],
      thumbnailSize: { width: 320, height: 180 },
      fetchWindowIcons: false,
    });
    return sources.map(source => ({
      id: source.id,
      name: source.name,
      thumbnail: source.thumbnail.toDataURL(),
      display_id: source.display_id,
    }));
  } catch (error) {
    console.error('Error getting screen sources:', error);
    return [];
  }
});

ipcMain.handle('capture-screen-source', async (_, sourceId: string) => {
  try {
    const sources = await desktopCapturer.getSources({
      types: ['window', 'screen'],
      thumbnailSize: { width: 1920, height: 1080 },
      fetchWindowIcons: false,
    });
    const source = sources.find(s => s.id === sourceId);
    return source ? source.thumbnail.toDataURL() : null;
  } catch (error) {
    console.error('Error capturing screen source:', error);
    return null;
  }
});

// IPC: Google Drive

ipcMain.handle('drive-sign-in', async () => {
  try { return await driveService.signIn(); }
  catch (error) {
    console.error('Drive sign-in error:', error);
    return { signedIn: false, email: null };
  }
});

ipcMain.handle('drive-sign-out', () => { driveService.signOut(); });
ipcMain.handle('drive-status', async () => driveService.getStatus());

ipcMain.handle('drive-list-files', async () => {
  try { return await driveService.listFiles(); }
  catch (error) {
    console.error('Drive list error:', error);
    return [];
  }
});

ipcMain.handle('drive-upload', async (_, name: string, content: string) => {
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
      return { ok: true, data: JSON.stringify(data, null, 2) };
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

ipcMain.handle('drive-save-presentation', async (_, content: string, customName?: string) => {
  try {
    const data = JSON.parse(content);

    const trimmed = (customName ?? '').trim();
    if (trimmed) data.name = trimmed;

    // Phase 7: zip build (deflate CPU) runs in the heavy UtilityProcess; the
    // renamed presentation (customName) must reach the worker, so re-serialize.
    const { embeddedCount, zipBuffer } = await heavyClient.buildGpres(JSON.stringify(data), mediaLibrary.dir);

    // Strip characters invalid in filenames / Drive names.
    const baseName = String(data.name || 'presentation').replace(/[\\/:*?"<>|]/g, '_').trim() || 'presentation';
    const name = `${baseName}.gpres`;

    const id = await driveService.uploadBuffer(name, zipBuffer);
    console.info(`[drive-save-presentation] Uploaded ${name} (${embeddedCount} media files), id=${id}`);
    return { ok: true, id };
  } catch (error) {
    console.error('[drive-save-presentation] Error:', error);
    return { ok: false, error: String(error) };
  }
});