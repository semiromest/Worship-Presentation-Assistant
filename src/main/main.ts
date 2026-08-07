/**
 * Electron main process: presentation control, projector window,
 * remote (phone) control server, and .gpres file I/O.
 */

import { app, BrowserWindow, Menu, ipcMain, dialog, screen, desktopCapturer, nativeImage, shell, protocol, net } from 'electron';
import path       from 'node:path';
import fs         from 'node:fs/promises';
import http       from 'node:http';
import os         from 'node:os';
import { pathToFileURL, fileURLToPath as nodeFileURLToPath } from 'node:url';
import AdmZip from 'adm-zip';
import { WebSocketServer, WebSocket as WsSocket } from 'ws';
import { REMOTE_HTML_NEW } from './remote-html';
import { getPptxService } from './pptxService';
import { driveService } from './driveService';

// ─── Paths ────────────────────────────────────────────────────────────────

const DIST         = path.join(__dirname, '../dist');
const ICON_PATH    = path.join(__dirname, '../build', 'ico.png');
const VITE_PUBLIC  = app.isPackaged ? DIST : path.join(DIST, '../public');
const PRESETS_FILE = path.join(app.getPath('userData'), 'presets.json');

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tif', '.tiff', '.avif', '.svg']);
const VIDEO_EXTS = new Set(['.mp4', '.webm', '.mov', '.mkv', '.avi', '.m4v', '.wmv', '.flv', '.mpeg', '.mpg']);

process.env.DIST        = DIST;
process.env.VITE_PUBLIC = VITE_PUBLIC;

// ─── Window references ──────────────────────────────────────────────────

let win:          BrowserWindow | null = null;
let projectorWin: BrowserWindow | null = null;
let pendingProjectorPayload: any = null;

// ─── Remote server state ────────────────────────────────────────────────

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

// ─── Slide preview capture (debounced + rate-limited) ───────────────────

let captureTimer: ReturnType<typeof setTimeout> | null = null;
let lastCaptureTime = 0;
const CAPTURE_MIN_INTERVAL = 100; // ms, hard floor between captures

/**
 * True when a captured frame is essentially empty: fully black or a single
 * flat color. This happens when the window is minimized / occluded /
 * offscreen — broadcasting such a frame blanks the phone's preview screen.
 */
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
 * Captures the projector window (or main window as fallback) and
 * broadcasts a downscaled JPEG preview. Debounced by `delayMs`, then
 * additionally rate-limited so bursts of calls collapse into one capture.
 *
 * Only used as a fallback while the renderer has not yet delivered its own
 * canvas preview (`lastPreviewDataUrl === null`); once the renderer's
 * thumbnails flow, those win so a stale/black window capture can never
 * overwrite the accurate part preview on phones.
 */
function scheduleSlideCapture(delayMs = 300): void {
  if (wsClients.size === 0) return; // no one listening, skip the work
  if (captureTimer) clearTimeout(captureTimer);
  captureTimer = setTimeout(async () => {
    const now = Date.now();
    if (now - lastCaptureTime < CAPTURE_MIN_INTERVAL) return;
    lastCaptureTime = now;

    const target = projectorWin ?? win;
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

// ─── Local IPv4 detection (scored, cached for app lifetime) ────────────

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

// ─── Preset cache (write-through) ───────────────────────────────────────

type PresetItem = { name: string; presentation: unknown; createdAt: number };
let presetsCache: PresetItem[] | null = null;

async function readPresets(): Promise<PresetItem[]> {
  if (presetsCache) return presetsCache;
  try { presetsCache = JSON.parse(await fs.readFile(PRESETS_FILE, 'utf-8')); }
  catch { presetsCache = []; }
  return presetsCache!;
}

async function writePresets(list: PresetItem[]): Promise<void> {
  presetsCache = list;
  await fs.mkdir(path.dirname(PRESETS_FILE), { recursive: true });
  // Write to a temp file then rename, so a crash mid-write can't corrupt presets.json.
  const tempFile = `${PRESETS_FILE}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
  await fs.writeFile(tempFile, JSON.stringify(list, null, 2), 'utf-8');
  await fs.rename(tempFile, PRESETS_FILE);
}

// ─── Generic recursive file finder ──────────────────────────────────────
// One directory walker, parametrized by a filter, replaces two near-identical
// walkers (XML files / media files). Recursion is parallel per-directory and
// results are flattened with the built-in `flat()` instead of manual pushes.

async function walkFiles(dir: string, matches: (name: string, ext: string) => boolean): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const tasks = entries.map(async (entry): Promise<string[]> => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walkFiles(full, matches);
    if (entry.isFile() && matches(entry.name, path.extname(full).toLowerCase())) return [full];
    return [];
  });
  return (await Promise.all(tasks)).flat();
}

const walkXmlFiles   = (dir: string) => walkFiles(dir, (name) => name.toLowerCase().endsWith('.xml'));
const walkMediaFiles = (dir: string) => walkFiles(dir, (_name, ext) => IMAGE_EXTS.has(ext) || VIDEO_EXTS.has(ext));

// ─── HTTP body reader ────────────────────────────────────────────────────

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

// ─── Window creation ─────────────────────────────────────────────────────

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
  win.on('closed', () => { projectorWin?.close(); win = null; });
}

function createProjectorWindow(initialData?: any): void {
  const ext = screen.getAllDisplays().find(d => d.bounds.x !== 0 || d.bounds.y !== 0);

  projectorWin = new BrowserWindow({
    x: ext?.bounds.x ?? 0,
    y: ext?.bounds.y ?? 0,
    width:      ext?.bounds.width  ?? 1280,
    height:     ext?.bounds.height ?? 720,
    fullscreen: !!ext,
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

  // Buffer the payload until load finishes, then reveal the window.
  projectorWin.webContents.once('did-finish-load', () => {
    if (initialData) pendingProjectorPayload = initialData;
    if (projectorWin && !projectorWin.isDestroyed()) {
      projectorWin.show();
      projectorWin.focus();
    }
  });

  process.env.VITE_DEV_SERVER_URL
    ? projectorWin.loadURL(`${process.env.VITE_DEV_SERVER_URL}?mode=projector`)
    : projectorWin.loadFile(path.join(DIST, 'index.html'), { query: { mode: 'projector' } });

  projectorWin.on('closed', () => {
    projectorWin = null;
    pendingProjectorPayload = null;
    win?.webContents.send('projector-closed');
    remoteStatus.isProjectorOpen = false;
    broadcast({ type: 'status', data: remoteStatus });
    scheduleSlideCapture(120);                   // kapandıktan sonra kısa süre sonra yakala
  });
}

ipcMain.on('projector-ready', (event) => {
  if (!projectorWin || projectorWin.isDestroyed()) return;
  if (event.sender.id !== projectorWin.webContents.id) return;

  if (pendingProjectorPayload) {
    projectorWin.webContents.send('projector-update', pendingProjectorPayload);
    pendingProjectorPayload = null;
  }
});

// ─── HTTP + WebSocket remote control server ─────────────────────────────

function createRemoteServer(): void {
  remoteServer = http.createServer(async (req, res) => {
    const { pathname } = new URL(req.url ?? '/', 'http://localhost');

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

  wss.on('connection', (client: WsSocket) => {
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

// ─── App lifecycle ────────────────────────────────────────────────────────

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

app.whenReady().then(() => {
  protocol.handle('local-resource', async (request) => {
    let filePath: string;
    try {
      filePath = localResourceUrlToPath(request.url);
    } catch (err) {
      console.error(`[local-resource] Bad URL: ${request.url}`, err);
      return new Response('Bad request', { status: 400 });
    }

    // Security: only serve files inside our own <tmp>/presenter-* dirs.
    // path.resolve collapses any ".." traversal before the check.
    const resolved = path.resolve(filePath);
    const tmpRoot = path.resolve(os.tmpdir());
    const rel = path.relative(tmpRoot, resolved);
    const insideTmp = rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
    const firstSegment = rel.split(path.sep)[0] ?? '';
    if (!insideTmp || !firstSegment.startsWith('presenter-')) {
      console.error(`[local-resource] Forbidden path: ${resolved}`);
      return new Response('Forbidden', { status: 403 });
    }

    try {
      const data = await fs.readFile(resolved);
      const ext = path.extname(resolved).toLowerCase();
      return new Response(data, {
        headers: { 'Content-Type': MIME_BY_EXT[ext] || 'application/octet-stream' },
      });
    } catch (err) {
      console.error(`[local-resource] Failed to serve ${resolved}:`, err);
      return new Response('Not found', { status: 404 });
    }
  });
  createWindow();
  createRemoteServer();
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

app.on('will-quit', () => {
  cleanupTempDir();
  wss?.close();
  remoteServer?.close();
  if (captureTimer) clearTimeout(captureTimer);
});

// ─── .gpres (ZIP) helpers ─────────────────────────────────────────────────

let currentTempDir: string | null = null;

async function cleanupTempDir(): Promise<void> {
  if (!currentTempDir) return;
  try { await fs.rm(currentTempDir, { recursive: true, force: true }); }
  catch { /* file may still be in use, not fatal */ }
  currentTempDir = null;
}

// Windows drive letters, spaces, and Unicode in paths need Node's URL API
// for path <-> local-resource conversions; manual string concatenation
// (`local-resource://${p}`) misparses "C:" as a URL host and drops the
// drive letter.
function pathToLocalResourceUrl(filePath: string): string {
  return pathToFileURL(filePath).href.replace(/^file:\/\//, 'local-resource://');
}

function localResourceUrlToPath(resourceUrl: string): string {
  const fileUrl = resourceUrl.replace(/^local-resource:\/\//, 'file://');
  return nodeFileURLToPath(fileUrl);
}

function fileUrlToPath(fileUrl: string): string {
  // Presentations re-opened from disk carry local-resource:// URLs pointing
  // into the temp dir; convert those back to a real path so re-saving can
  // re-embed the media.
  if (fileUrl.startsWith('local-resource://')) return localResourceUrlToPath(fileUrl);
  return nodeFileURLToPath(fileUrl);
}

/**
 * Single recursive walker over a JSON-like tree, visiting every string leaf.
 * Replaces three separate near-identical tree walks (collect URLs, replace
 * URLs, collect media paths) with one traversal, reused via different
 * callbacks. Callback receives (value, parent, key) so it can mutate in place.
 */
function walkStrings(node: any, onString: (value: string, parent: any, key: string) => void): void {
  if (!node || typeof node !== 'object') return;
  for (const key of Object.keys(node)) {
    const val = node[key];
    if (typeof val === 'string') {
      onString(val, node, key);
    } else if (Array.isArray(val)) {
      for (const item of val) walkStrings(item, onString);
    } else if (typeof val === 'object') {
      walkStrings(val, onString);
    }
  }
}

const isEmbeddableUrl = (v: string) => v.startsWith('file:///') || v.startsWith('local-resource://');

/** Bidirectional registry so repeated files reuse one name in O(1). */
interface MediaNameRegistry {
  usedNames: Map<string, string>; // sanitized name -> source path (collision check)
  byPath:    Map<string, string>; // source path -> media/xxx (reverse lookup)
}
function createMediaNameRegistry(): MediaNameRegistry {
  return { usedNames: new Map(), byPath: new Map() };
}

function toMediaFileName(fileUrl: string, registry: MediaNameRegistry): string {
  const filePath = fileUrlToPath(fileUrl);

  const cached = registry.byPath.get(filePath);
  if (cached) return cached; // O(1) instead of scanning usedNames

  const ext = path.extname(filePath);
  const base = path.basename(filePath, ext).replace(/[^a-zA-Z0-9_\-]/g, '_') || 'media';

  let key = `${base}${ext}`;
  if (registry.usedNames.has(key)) {
    let counter = 1;
    while (registry.usedNames.has(`${base}_${counter}${ext}`)) counter++;
    key = `${base}_${counter}${ext}`;
  }

  registry.usedNames.set(key, filePath);
  const mediaPath = `media/${key}`;
  registry.byPath.set(filePath, mediaPath);
  return mediaPath;
}

const isZip = (buf: Buffer) => buf[0] === 0x50 && buf[1] === 0x4b; // "PK"

/**
 * Extracts a .gpres ZIP buffer: reads presentation.json, unpacks media to a
 * fresh temp dir, and rewrites media/* references to local-resource:// URLs
 * in a single pass (collect-and-replace combined, instead of two tree walks).
 */
async function extractGpresZip(buffer: Buffer): Promise<{ data: any; tempDir: string; mediaCount: number }> {
  await cleanupTempDir();
  const zip = new AdmZip(buffer);
  const jsonEntry = zip.getEntry('presentation.json');
  if (!jsonEntry) throw new Error('Corrupt .gpres file: missing presentation.json');

  const data = JSON.parse(zip.readAsText(jsonEntry));
  const tempDir = path.join(os.tmpdir(), `presenter-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  zip.extractAllTo(tempDir, true);
  currentTempDir = tempDir;

  const mediaMap = new Map<string, string>();
  walkStrings(data, (val, parent, key) => {
    if (!val.startsWith('media/')) return;
    let mapped = mediaMap.get(val);
    if (!mapped) {
      mapped = pathToLocalResourceUrl(path.join(tempDir, val));
      mediaMap.set(val, mapped);
    }
    parent[key] = mapped;
  });

  return { data, tempDir, mediaCount: mediaMap.size };
}

/**
 * Builds a .gpres ZIP in memory: finds every embeddable media URL, embeds
 * files in parallel (instead of one-by-one awaits), then rewrites the tree
 * to point at the embedded media/* paths.
 */
async function buildGpresZip(data: any): Promise<{ zip: AdmZip; embeddedCount: number }> {
  const urls = new Set<string>();
  walkStrings(data, (val) => { if (isEmbeddableUrl(val)) urls.add(val); });

  const registry = createMediaNameRegistry();
  const zip = new AdmZip();
  const urlToMedia = new Map<string, string>();

  await Promise.all([...urls].map(async (url) => {
    const sourcePath = fileUrlToPath(url);
    try {
      await fs.access(sourcePath);
      const mediaPath = toMediaFileName(url, registry);
      const mediaName = mediaPath.slice(mediaPath.indexOf('/') + 1);
      zip.addLocalFile(sourcePath, 'media', mediaName);
      urlToMedia.set(url, mediaPath);
    } catch (err) {
      console.warn(`[gpres] Skipping unreachable media: ${url} (${(err as Error)?.message ?? err})`);
    }
  }));

  walkStrings(data, (val, parent, key) => {
    const mapped = urlToMedia.get(val);
    if (mapped) parent[key] = mapped;
  });

  zip.addFile('presentation.json', Buffer.from(JSON.stringify(data, null, 2), 'utf-8'));
  return { zip, embeddedCount: urlToMedia.size };
}

// ─── IPC: file operations ────────────────────────────────────────────────

ipcMain.handle('save-file', async (_, content: string) => {
  const { filePath, canceled } = await dialog.showSaveDialog({
    filters: [{ name: 'Worship Presentation Assistant Files', extensions: ['gpres'] }],
  });
  if (canceled || !filePath) return null;

  const data = JSON.parse(content);
  const { zip, embeddedCount } = await buildGpresZip(data);
  zip.writeZip(filePath);

  console.info(`[save-file] Saved ${filePath} (${embeddedCount} media files embedded)`);
  return filePath;
});

ipcMain.handle('open-file', async () => {
  const { filePaths, canceled } = await dialog.showOpenDialog({
    filters: [{ name: 'Worship Presentation Assistant Files', extensions: ['gpres'] }],
    properties: ['openFile'],
  });
  if (canceled || !filePaths?.length) return null;

  const filePath = filePaths[0];
  const raw = await fs.readFile(filePath);

  if (isZip(raw)) {
    const { data, tempDir, mediaCount } = await extractGpresZip(raw);
    console.info(`[open-file] ${filePath}: ${mediaCount} media paths, tempDir=${tempDir}`);
    return { path: filePath, content: JSON.stringify(data, null, 2) };
  }

  // Legacy plain-JSON format
  return { path: filePath, content: raw.toString('utf-8') };
});

// ─── IPC: native dialogs ─────────────────────────────────────────────────

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

// ─── IPC: preset CRUD ────────────────────────────────────────────────────

ipcMain.handle('load-presets', () => readPresets());

ipcMain.handle('save-preset', async (_, preset: { name: string; presentation: unknown }) => {
  const list  = await readPresets();
  const idx   = list.findIndex(p => p.name === preset.name);
  const entry = { name: preset.name, presentation: preset.presentation, createdAt: Date.now() };
  idx >= 0 ? (list[idx] = entry) : list.push(entry);
  await writePresets(list);
  return list;
});

ipcMain.handle('delete-preset', async (_, name: string) => {
  const filtered = (await readPresets()).filter(p => p.name !== name);
  await writePresets(filtered);
  return filtered;
});

ipcMain.handle('rename-preset', async (_, oldName: string, newName: string) => {
  const list = await readPresets();
  const idx  = list.findIndex(p => p.name === oldName);
  if (idx >= 0) {
    list[idx] = { ...list[idx], name: newName };
    await writePresets(list);
  }
  return list;
});

// ─── IPC: projector ──────────────────────────────────────────────────────

ipcMain.handle('toggle-projector', (_, initialData?: any) => {
  if (projectorWin) { projectorWin.close(); return false; }
  createProjectorWindow(initialData);
  return true;
});

ipcMain.handle('update-projector', (_, data: unknown) => {
  if (!projectorWin) return false;
  projectorWin.webContents.send('projector-update', data);
  return true;
});

ipcMain.handle('get-projector-status', () => !!projectorWin);
ipcMain.handle('cleanup-temp-dir', () => { cleanupTempDir(); return true; });

// ─── IPC: remote control ─────────────────────────────────────────────────

ipcMain.handle('get-remote-url', () => remoteServerUrl);
ipcMain.handle('get-remote-debug', () => ({ remoteServerUrl, debug: remoteDebugInfo }));
ipcMain.handle('quit-app', () => { app.quit(); return true; });

ipcMain.handle('update-all-slide-previews', (_, previews: string[]) => {
  allSlidePreviews = Array.isArray(previews) ? previews : [];
  broadcast({ type: 'allPreviews', data: allSlidePreviews });
  return true;
});

/**
 * Called by the renderer on slide change / blackout toggle / etc.
 * Broadcasts the new status to all connected phones, then schedules a
 * (throttled) preview capture once the transition animation has settled.
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

// ─── IPC: media / import ─────────────────────────────────────────────────

ipcMain.handle('import-bible-xml', async (_, filePath?: string) => {
  let selected = filePath;
  if (selected) {
    try { if (!(await fs.stat(selected)).isFile()) selected = undefined; }
    catch { selected = undefined; }
  }
  if (!selected) {
    const { filePaths } = await dialog.showOpenDialog({
      filters: [{ name: 'Zefania XML Bible', extensions: ['xml'] }],
      properties: ['openFile'],
    });
    selected = filePaths?.[0];
  }
  if (!selected) return null;
  return { content: await fs.readFile(selected, 'utf-8'), path: selected };
});

ipcMain.handle('select-media-file', async (_, type: 'image' | 'video') => {
  const filters = type === 'image'
    ? [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp'] }]
    : [{ name: 'Videos', extensions: ['mp4', 'webm', 'ogg', 'mov'] }];
  const { filePaths } = await dialog.showOpenDialog({ filters, properties: ['openFile'] });
  return filePaths?.[0] ?? null;
});

ipcMain.handle('select-media-files-all', async () => {
  const filters = [
    { name: 'Media', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'mp4', 'webm', 'mov', 'mkv', 'avi'] },
  ];
  const { filePaths } = await dialog.showOpenDialog({ filters, properties: ['openFile', 'multiSelections'] });
  return filePaths?.length ? filePaths : null;
});

ipcMain.handle('select-media-folder', async () => {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle('select-audio-file', async () => {
  const { filePaths } = await dialog.showOpenDialog({
    filters: [{ name: 'Audio Files', extensions: ['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a', 'wma'] }],
    properties: ['openFile'],
  });
  return filePaths?.[0] ?? null;
});

ipcMain.handle('read-media-folder', async (_event, folderPath: string) => walkMediaFiles(folderPath));

// ─── IPC: PowerPoint ─────────────────────────────────────────────────────

ipcMain.handle('select-pptx-file', async () => {
  const { filePaths } = await dialog.showOpenDialog({
    filters: [{ name: 'PowerPoint Presentations', extensions: ['pptx', 'pptm'] }],
    properties: ['openFile'],
  });
  return filePaths?.[0] ?? null;
});

ipcMain.handle('import-pptx', async (event, filePath: string) => {
  const pptxService = getPptxService();
  return pptxService.importPptx(filePath, (current, total) => {
    event.sender.send('pptx-import-progress', { current, total });
  });
});

ipcMain.handle('import-hymn-archive', async (_, dirPath?: string) => {
  let selected = dirPath;
  if (selected) {
    try { if (!(await fs.stat(selected)).isDirectory()) selected = undefined; }
    catch { selected = undefined; }
  }
  if (!selected) {
    const { filePaths } = await dialog.showOpenDialog({ properties: ['openDirectory'] });
    selected = filePaths?.[0];
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

// ─── IPC: screen capture ─────────────────────────────────────────────────

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

// ─── IPC: Google Drive ───────────────────────────────────────────────────

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
      const { data, tempDir, mediaCount } = await extractGpresZip(buffer);
      console.log(`[drive-download] ${mediaCount} media paths, tempDir=${tempDir}`);
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

    const { zip, embeddedCount } = await buildGpresZip(data);
    const zipBuffer = Buffer.from(zip.toBuffer());

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