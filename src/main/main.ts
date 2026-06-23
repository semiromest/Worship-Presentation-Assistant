/**

 *  • Önizleme üzerinde sola/sağa kaydırma (swipe) → slayt geçişi
 */

import { app, BrowserWindow, Menu, ipcMain, dialog, screen, desktopCapturer, nativeImage } from 'electron';
import path       from 'node:path';
import fs         from 'node:fs/promises';
import http       from 'node:http';
import os         from 'node:os';
import { WebSocketServer, WebSocket as WsSocket } from 'ws';
import { REMOTE_HTML_NEW } from './remote-html';
import { getPptxService } from './pptxService';

// ─── Yollar ───────────────────────────────────────────────────────────────────

const DIST         = path.join(__dirname, '../dist');
const ICON_PATH    = path.join(__dirname, '../build', 'ico.png');
const VITE_PUBLIC  = app.isPackaged ? DIST : path.join(DIST, '../public');
const PRESETS_FILE = path.join(app.getPath('userData'), 'presets.json');

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tif', '.tiff', '.avif', '.svg']);
const VIDEO_EXTS = new Set(['.mp4', '.webm', '.mov', '.mkv', '.avi', '.m4v', '.wmv', '.flv', '.mpeg', '.mpg']);

process.env.DIST        = DIST;
process.env.VITE_PUBLIC = VITE_PUBLIC;

// ─── Pencere referansları ────────────────────────────────────────────────────

let win:          BrowserWindow | null = null;
let projectorWin: BrowserWindow | null = null;

// ─── Uzak sunucu nesneleri ────────────────────────────────────────────────────

let remoteServer:   http.Server      | null = null;
let wss:            WebSocketServer  | null = null;
let remoteServerUrl = '';let pendingProjectorPayload: any = null;
// ─── Uzak durum ve önizleme ───────────────────────────────────────────────────

let remoteStatus = {
  slideCount:      0,
  currentIndex:    0,
  isBlackout:      false,
  isProjectorOpen: false,
  slideTransition: 'fade',
  transitionDurationMs: 400,
};

/** Son yakalanan slayt önizlemesi — yeni bağlanan istemcilere hemen gönderilir */
let lastPreviewDataUrl: string | null = null;

/** Bağlı WebSocket istemcileri */
const wsClients = new Set<WsSocket>();

// ─── WebSocket yayın yardımcısı ───────────────────────────────────────────────

function broadcast(msg: object): void {
  const str = JSON.stringify(msg);
  for (const client of wsClients) {
    if (client.readyState === WsSocket.OPEN) {
      try { client.send(str); } catch { /* kapalı soket */ }
    }
  }
}

// ─── Slayt önizleme yakalama (throttled + optimized) ────────────────────────

let captureTimer: ReturnType<typeof setTimeout> | null = null;
let lastCaptureTime = 0;
const CAPTURE_MIN_INTERVAL = 100; // minimum 100ms between captures
let allSlidePreviews: string[] = [];

/**
 * Projector penceresi açıksa onu, değilse ana pencereyi yakalar.
 * Sık tetiklenmelerde debounclanır (varsayılan 300 ms).
 * Optimized: Skip capture if less than CAPTURE_MIN_INTERVAL ms since last capture.
 */
function scheduleSlideCapture(delayMs = 300): void {
  if (wsClients.size === 0) return; // Optimization: Hiç kimse bağlı değilse capture alma
  if (captureTimer) clearTimeout(captureTimer);
  captureTimer = setTimeout(async () => {
    const now = Date.now();
    // Rate limit: skip if captured too recently
    if (now - lastCaptureTime < CAPTURE_MIN_INTERVAL) {
      return;
    }
    lastCaptureTime = now;
    
    const target = projectorWin ?? win;
    if (!target || target.isDestroyed()) return;
    try {
      const img = await target.webContents.capturePage();
      if (img.isEmpty()) return;
      // JPEG @ 960 px genişlik – telefon için yeterli kalite, boyut küçük (optimized quality 72)
      const buf = img.resize({ width: 960 }).toJPEG(72);
      lastPreviewDataUrl = `data:image/jpeg;base64,${buf.toString('base64')}`;
      broadcast({ type: 'preview', data: lastPreviewDataUrl });
    } catch { /* pencere henüz hazır değil */ }
  }, delayMs);
}

// ─── IP adresi (uygulama ömründe bir kez hesaplanır) ─────────────────────────

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
    score += 5; // public or uncommon local subnets may still be valid
  }

  return score;
}

function listLocalIPv4Candidates() {
  const nets = os.networkInterfaces();
  const candidates: Array<{ name: string; address: string; cidr: string | null; mac: string; score: number }> = [];

  for (const [name, addrs] of Object.entries(nets)) {
    if (!addrs) continue;
    for (const iface of addrs) {
      if (iface.family === 'IPv4') {
        const address = iface.address;
        const score = scoreLocalIPv4Candidate(name, address);
        candidates.push({
          name,
          address,
          cidr: iface.cidr ?? null,
          mac: iface.mac,
          score,
        });
      }
    }
  }

  return candidates.sort((a, b) => b.score - a.score);
}

function getLocalIPv4(): string {
  if (cachedLocalIP) return cachedLocalIP;

  const candidates = listLocalIPv4Candidates();
  remoteDebugInfo.candidates = candidates;

  const best = candidates.find((entry) => entry.score > -50 && !isLinkLocalIPv4(entry.address));
  if (best) {
    cachedLocalIP = best.address;
    remoteDebugInfo.selectedAddress = cachedLocalIP;
    return cachedLocalIP;
  }

  if (candidates.length > 0) {
    cachedLocalIP = candidates[0].address;
    remoteDebugInfo.selectedAddress = cachedLocalIP;
    return cachedLocalIP;
  }

  cachedLocalIP = '127.0.0.1';
  remoteDebugInfo.selectedAddress = cachedLocalIP;
  return cachedLocalIP;
}

// ─── Preset önbelleği (write-through) ────────────────────────────────────────

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
  // Atomic write to prevent file corruption on sudden crash
  const tempFile = `${PRESETS_FILE}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
  await fs.writeFile(tempFile, JSON.stringify(list, null, 2), 'utf-8');
  await fs.rename(tempFile, PRESETS_FILE);
}

// ─── XML arşiv tarayıcısı (optimized: parallel + flatMap) ──────────────────

async function walkXmlFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const results: string[] = [];
  
  const tasks = entries.map(async (entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return walkXmlFiles(full); // recursive
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.xml')) {
      return [full];
    }
    return [];
  });
  
  // Flatten results efficiently (flatMap equivalent for async)
  const allResults = await Promise.all(tasks);
  for (const result of allResults) {
    results.push(...result);
  }
  return results;
}

// ─── HTTP body yardımcısı ────────────────────────────────────────────────────

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalLength = 0;
    req.on('data',  c  => {
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



// ─── Pencere oluşturma ────────────────────────────────────────────────────────

function createWindow(): void {
  win = new BrowserWindow({
    icon: ICON_PATH,
    width: 1200, height: 800, minWidth: 800, minHeight: 600,
    fullscreenable: true,
    autoHideMenuBar: true,
    title: 'Worship Presentation Assistant - Kontrol Paneli',
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

  // Pencere yüklendiğinde payload'ı tamponla ve pencereyi göster
  projectorWin.webContents.once('did-finish-load', () => {
    if (initialData) {
      pendingProjectorPayload = initialData;
    }

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
    scheduleSlideCapture(120);                   // kapandıktan kısa süre sonra yakala
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

// ─── HTTP + WebSocket uzak sunucusu ───────────────────────────────────────────

function createRemoteServer(): void {
  // ── HTTP ──────────────────────────────────────────────────────────────────
  remoteServer = http.createServer(async (req, res) => {
    const { pathname } = new URL(req.url ?? '/', 'http://localhost');

    /** Remote arayüzü */
    if (pathname === '/' || pathname === '/remote') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(REMOTE_HTML_NEW);
      return;
    }

    /** Geriye dönük uyumluluk: REST durum */
    if (pathname === '/api/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(remoteStatus));
      return;
    }

    /** Geriye dönük uyumluluk: REST komut */
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

  // ── WebSocket ─────────────────────────────────────────────────────────────
  wss = new WebSocketServer({ server: remoteServer, maxPayload: 1024 * 512 }); // 512KB limit DoS protection

  wss.on('connection', (client: WsSocket) => {
    wsClients.add(client);
    broadcastClientCount();

    // Yeni istemciye anlık durum + önizleme gönder
    try {
      client.send(JSON.stringify({
        type: 'welcome',
        data: { status: remoteStatus, preview: lastPreviewDataUrl, allPreviews: allSlidePreviews },
      }));
    } catch { /* hata durumunda atla */ }

    // Telefondan gelen komutlar
    client.on('message', (raw: WsSocket) => {
      try {
        const msg = JSON.parse(raw.toString()) as { type: string; action?: string; value?: unknown };
        if (msg.type === 'command' && msg.action) {
          win?.webContents.send('remote-action', {
            action: msg.action,
            value:  msg.value,
          });
        }
      } catch { /* geçersiz JSON */ }
    });

    client.on('close',  () => { wsClients.delete(client); broadcastClientCount(); });
    client.on('error',  () => {
      try { client.terminate(); } catch { /* soket zaten kapalı */ }
      wsClients.delete(client);
      broadcastClientCount();
    });
  });

  // Rastgele port, tüm arayüzler
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
      console.info('[REMOTE SERVER] Selected remote URL:', remoteServerUrl);
      console.info('[REMOTE SERVER] Network candidates:', remoteDebugInfo.candidates);
    }
  });
}

/** Bağlı istemci sayısını renderer'a bildirir */
function broadcastClientCount(): void {
  win?.webContents.send('remote-client-count', wsClients.size);
}

// ─── Uygulama yaşam döngüsü ───────────────────────────────────────────────────

app.whenReady().then(() => { createWindow(); createRemoteServer(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

app.on('will-quit', () => {
  wss?.close();
  remoteServer?.close();
  if (captureTimer) clearTimeout(captureTimer);
});

// ─── IPC: Dosya işlemleri ────────────────────────────────────────────────────

ipcMain.handle('save-file', async (_, content: string) => {
  const { filePath } = await dialog.showSaveDialog({
    filters: [{ name: 'Worship Presentation Assistant Files', extensions: ['gpres'] }],
  });
  if (filePath) { await fs.writeFile(filePath, content, 'utf-8'); return filePath; }
  return null;
});

ipcMain.handle('open-file', async () => {
  const { filePaths } = await dialog.showOpenDialog({
    filters: [{ name: 'Worship Presentation Assistant Files', extensions: ['gpres'] }],
    properties: ['openFile'],
  });
  if (filePaths?.length) {
    return { path: filePaths[0], content: await fs.readFile(filePaths[0], 'utf-8') };
  }
  return null;
});

// ─── IPC: Native dialogs ─────────────────────────────────────────────────────

ipcMain.handle(
  'show-confirm-dialog',
  async (
    _,
    options: {
      message: string;
      title?: string;
      detail?: string;
      confirmLabel?: string;
      cancelLabel?: string;
    },
  ) => {
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
  async (
    _,
    options: { message: string; title?: string; detail?: string; okLabel?: string },
  ) => {
    const parent = win ?? BrowserWindow.getFocusedWindow();
    const boxOptions = {
      type: 'info' as const,
      buttons: [options.okLabel ?? 'Tamam'],
      title: options.title ?? 'Worship Presentation Assistant',
      message: options.message,
      detail: options.detail,
    };
    if (parent) {
      await dialog.showMessageBox(parent, boxOptions);
    } else {
      await dialog.showMessageBox(boxOptions);
    }
  },
);

// ─── IPC: Preset CRUD ────────────────────────────────────────────────────────

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
  const list  = await readPresets();
  const idx   = list.findIndex(p => p.name === oldName);
  if (idx >= 0) {
    list[idx] = { ...list[idx], name: newName };
    await writePresets(list);
  }
  return list;
});

// ─── IPC: Projektör ──────────────────────────────────────────────────────────

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

// ─── IPC: Uzak kontrol ───────────────────────────────────────────────────────

ipcMain.handle('get-remote-url', () => remoteServerUrl);
ipcMain.handle('get-remote-debug', () => ({
  remoteServerUrl,
  debug: remoteDebugInfo,
}));

ipcMain.handle('quit-app', () => {
  app.quit();
  return true;
});

ipcMain.handle('update-all-slide-previews', (_, previews: string[]) => {
  allSlidePreviews = Array.isArray(previews) ? previews : [];
  broadcast({ type: 'allPreviews', data: allSlidePreviews });
  return true;
});

/**
 * Renderer tarafından çağrılır (slayt geçişi, blackout vb.)
 * → WebSocket ile tüm bağlı telefonlara anlık yayın yapar
 * → capturePage() ile slayt görüntüsünü de yayınlar (throttled)
 */
ipcMain.handle('update-remote-status', (_, status: Partial<typeof remoteStatus>) => {
  remoteStatus = {
    slideCount:      typeof status.slideCount   === 'number' ? status.slideCount   : remoteStatus.slideCount,
    currentIndex:    typeof status.currentIndex === 'number' ? status.currentIndex : remoteStatus.currentIndex,
    isBlackout:      !!status.isBlackout,
    isProjectorOpen: !!status.isProjectorOpen,
    slideTransition: typeof (status as any).slideTransition === 'string' ? (status as any).slideTransition : remoteStatus.slideTransition,
    transitionDurationMs: typeof (status as any).transitionDurationMs === 'number' ? (status as any).transitionDurationMs : remoteStatus.transitionDurationMs,
  };

  broadcast({ type: 'status', data: remoteStatus });

  const duration = Math.max(0, remoteStatus.transitionDurationMs || 0);
  const transitionDelay = remoteStatus.slideTransition !== 'none' && duration > 0
    ? Math.max(300, duration + 120)
    : 300;

  scheduleSlideCapture(transitionDelay);

  return true;
});

/**
 * Opsiyonel: Renderer kendi canvas'ını yakalayıp base64 olarak gönderebilir.
 * Bu, capturePage'e göre daha doğru ve hızlı bir önizleme sağlar.
 * Renderer'da kullanımı:
 *   await window.electronAPI.sendSlidePreview(canvas.toDataURL('image/jpeg', 0.8));
 */
ipcMain.handle('send-slide-preview', (_, dataUrl: string) => {
  if (!dataUrl) return false;
  lastPreviewDataUrl = dataUrl;
  broadcast({ type: 'preview', data: dataUrl });
  return true;
});

// ─── IPC: Medya / içe aktarma ────────────────────────────────────────────────

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
    { name: 'Medya', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'mp4', 'webm', 'mov', 'mkv', 'avi'] },
  ];
  const { filePaths } = await dialog.showOpenDialog({ filters, properties: ['openFile', 'multiSelections'] });
  return filePaths?.length ? filePaths : null;
});

// ─── IPC: PowerPoint dosyası seçme ─────────────────────────────────────────────

ipcMain.handle('select-pptx-file', async () => {
  const { filePaths } = await dialog.showOpenDialog({
    filters: [{ name: 'PowerPoint Presentations', extensions: ['pptx', 'pptm'] }],
    properties: ['openFile'],
  });
  return filePaths?.[0] ?? null;
});

// ─── IPC: PowerPoint import ───────────────────────────────────────────────────

ipcMain.handle('import-pptx', async (event, filePath: string) => {
  const pptxService = getPptxService();
  
  const result = await pptxService.importPptx(filePath, (current, total) => {
    // İlerleme durumu gönder
    event.sender.send('pptx-import-progress', { current, total });
  });
  
  return result;
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
  
  // Chunk okumalarıyla memory limit aşımını (OOM) önle
  const CHUNK_SIZE = 50;
  for (let i = 0; i < xmlPaths.length; i += CHUNK_SIZE) {
    const chunk = xmlPaths.slice(i, i + CHUNK_SIZE);
    const results = await Promise.all(
      chunk.map(fp => fs.readFile(fp, 'utf-8').then(content => ({ name: path.basename(fp), content })))
    );
    contents.push(...results);
  }

  return { results: contents, path: selected };
});

ipcMain.handle('select-media-folder', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory', 'createDirectory'],
  });
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

async function walkMediaFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const results: string[] = [];
  const tasks = entries.map(async (entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return walkMediaFiles(full);
    } else if (entry.isFile()) {
      const ext = path.extname(full).toLowerCase();
      if (IMAGE_EXTS.has(ext) || VIDEO_EXTS.has(ext)) return [full];
    }
    return [];
  });
  const allResults = await Promise.all(tasks);
  for (const result of allResults) results.push(...result);
  return results;
}

ipcMain.handle('read-media-folder', async (_event, folderPath: string) => {
  return walkMediaFiles(folderPath);
});

// ─── IPC: Ekran Yakalama ─────────────────────────────────────────────────────

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
      fetchWindowIcons: true,
    });

    return sources.map(source => ({
      id: source.id,
      name: source.name,
      thumbnail: source.thumbnail.toDataURL(),
      display_id: source.display_id,
      appIcon: source.appIcon?.toDataURL(),
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
    if (!source) return null;

    const thumbnail = source.thumbnail;
    return thumbnail.toDataURL();
  } catch (error) {
    console.error('Error capturing screen source:', error);
    return null;
  }
});