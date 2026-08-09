# GitHub Releases Auto-Update Manager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** App'in açılışta sessizce GitHub Releases'i kontrol etmesi, kullanıcının Ayarlar dişlisinden açtığı "Güncellemeler" modalında sürüm bilgisi/gelişme notları/indirme ilerlemesi görmesi ve "Şimdi yeniden başlat" ile NSIS kurucusu üzerinden güncellenmesi.

**Architecture:** Main process'te tek `updater.ts` modülü `autoUpdater` olaylarını `updater-event` IPC kanalıyla renderer'a iletir; renderer saf bir reducer (birim testli) + Zustand store ile durum makinesi tutar; GitHub'a yayınlama `v*` tag push'unda çalışan GitHub Actions workflow'uyla yapılır (GH_TOKEN otomatik).

**Tech Stack:** electron-updater 6.8.3, electron-builder 24.13.3 (NSIS, x64), vite-plugin-electron/simple, React 18 + Zustand + i18next, node:test + tsx.

## Global Constraints

- Sürüm numaraları yalnızca package.json `version` alanından gelir; tag `v${version}` formatı (ör. `v1.1.0`)
- Renderer'da `window.electronAPI` üzerinden tüm IPC; contextIsolation açık, nodeIntegration kapalı
- Tüm yeni kullanıcı görünür metinleri 5 locale'de de var olmalı (tr, en, es, de, ko); i18next `{{variable}}` interpolasyonu kullanılır
- `autoUpdater.autoDownload = false` — indirme yalnızca kullanıcı butona bastığında
- Dev modda güncelleme kontrolü varsayılan kapalı; yalnızca `FORCE_DEV_UPDATE=1` env'i ile açılır
- Windows x64 NSIS hedefi korunur; macOS/Linux kapsam dışı
- Repo: `semiromest/Worship-Presentation-Assistant` (doğrulandı: https://github.com/semiromest/Worship-Presentation-Assistant, mevcut release: https://github.com/semiromest/Worship-Presentation-Assistant/releases/tag/v1.0.0)

---

### Task 1: package.json — sürüm, artefakt adı, publish yapılandırması

**Files:**
- Modify: `package.json` (version:3, build.nsis.artifactName:97, build'e yeni `publish` bloğu)

**Interfaces:**
- Produces: `publish: {provider:github, owner:semiromest, repo:Worship-Presentation-Assistant}`; artifactName `Worship-Presentation-Assistant-Setup-${version}.${ext}`; `test:updater` script'i

- [ ] **Step 1: Sürümü yükselt ve artefakt adını düzelt**

```jsonc
// package.json
"version": "1.1.0",                                   // satır 3
// ...
"artifactName": "Worship-Presentation-Assistant-Setup-${version}.${ext}",  // satır 97 (nsis bloğunda)
```

- [ ] **Step 2: `build` bloğuna GitHub publish yapılandırması ekle** (`"directories"` üstüne, `"appId"` yakınına):

```jsonc
"publish": {
  "provider": "github",
  "owner": "semiromest",
  "repo": "Worship-Presentation-Assistant"
}
```

- [ ] **Step 3: Test script'i ekle** (`"scripts"` içine, `"test:split"` yanına):

```jsonc
"test:updater": "tsx --test src/renderer/state/updaterReducer.test.ts"
```

- [ ] **Step 4: Doğrula**

Run: `node -e "const b=require('./package.json').build; console.log(b.publish.owner, b.publish.repo, b.nsis.artifactName)"`
Expected: `semiromest Worship-Presentation-Assistant Worship-Presentation-Assistant-Setup-${version}.${ext}`

---

### Task 2: Main process — `src/main/updater.ts` + main.ts bağlama

**Files:**
- Create: `src/main/updater.ts`
- Modify: `src/main/main.ts` (`app.whenReady` bloğu + import)

**Interfaces:**
- Produces: `initUpdater(win: BrowserWindow): void`; IPC kanalları `updater:get-info`, `updater:check`, `updater:download`, `updater:install`; renderer'a `updater-event` kanalından `{ type, payload }` mesajları (type: `checking-for-update | update-available | update-not-available | download-progress | update-downloaded | update-cancelled | error`)

- [ ] **Step 1: `src/main/updater.ts` oluştur**

```ts
/**
 * Auto-update via GitHub Releases (electron-updater).
 * autoUpdater events are forwarded to the renderer over 'updater-event'.
 */

import { autoUpdater } from 'electron-updater';
import { app, BrowserWindow, ipcMain } from 'electron';

export type UpdaterEventType =
  | 'checking-for-update'
  | 'update-available'
  | 'update-not-available'
  | 'download-progress'
  | 'update-downloaded'
  | 'update-cancelled'
  | 'error';

export interface UpdaterEvent {
  type: UpdaterEventType;
  payload?: any;
}

let mainWindow: BrowserWindow | null = null;

function sendEvent(type: UpdaterEventType, payload?: any): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('updater-event', { type, payload } satisfies UpdaterEvent);
  }
}

export function initUpdater(win: BrowserWindow): void {
  mainWindow = win;

  if (process.env.FORCE_DEV_UPDATE) {
    autoUpdater.forceDevUpdateConfig = true; // dev'de dev-app-update.yml okur
  }

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.disableWebInstaller = true;

  autoUpdater.on('checking-for-update', () => sendEvent('checking-for-update'));
  autoUpdater.on('update-available', (info) =>
    sendEvent('update-available', { version: info.version, releaseNotes: info.releaseNotes ?? null }));
  autoUpdater.on('update-not-available', () => sendEvent('update-not-available'));
  autoUpdater.on('download-progress', (p) =>
    sendEvent('download-progress', {
      percent: Math.round(p.percent * 10) / 10,
      transferred: p.transferred,
      total: p.total,
      bytesPerSecond: p.bytesPerSecond,
    }));
  autoUpdater.on('update-downloaded', (info) => sendEvent('update-downloaded', { version: info.version }));
  autoUpdater.on('update-cancelled', () => sendEvent('update-cancelled'));
  autoUpdater.on('error', (err) => sendEvent('error', { message: err?.message ?? String(err) }));

  ipcMain.handle('updater:get-info', () => ({
    version: app.getVersion(),
    updaterActive: app.isPackaged || !!process.env.FORCE_DEV_UPDATE,
  }));

  ipcMain.handle('updater:check', async () => {
    try {
      await autoUpdater.checkForUpdates();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error)?.message ?? String(err) };
    }
  });

  ipcMain.handle('updater:download', async () => {
    try {
      await autoUpdater.downloadUpdate();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error)?.message ?? String(err) };
    }
  });

  ipcMain.handle('updater:install', () => {
    autoUpdater.quitAndInstall(true, true);
    return true;
  });

  // Sessiz başlangıç kontrolü — kullanıcıya bildirim yok; UI rozeti renderer'da
  win.webContents.once('did-finish-load', () => {
    if (app.isPackaged || process.env.FORCE_DEV_UPDATE) {
      autoUpdater.checkForUpdates().catch(() => { /* non-fatal */ });
    }
  });
}
```

- [ ] **Step 2: main.ts'e bağla** — import: `import { initUpdater } from './updater';`; `app.whenReady` içinde `createWindow();` sonrası: `initUpdater(win);` (win burada null olamaz; dikkat: npm run build `npx tsc --noEmit` içerir)

- [ ] **Step 3: Doğrula — tip kontrolü** — Run: `npx tsc --noEmit` — Expected: hata yok

---

### Task 3: Preload + tip tanımları — updater API yüzeyi

**Files:**
- Modify: `src/main/preload.ts` (sona, Google Drive bölümünden sonra)
- Modify: `src/renderer/vite-env.d.ts`

**Interfaces:**
- Produces: `electronAPI.getUpdaterInfo(): Promise<{version, updaterActive}>`, `checkForUpdates()`, `downloadUpdate()`, `installUpdate()`, `onUpdaterEvent(cb): unsubscribe`

- [ ] **Step 1: preload.ts'e ekle**

```ts
  // ─── Updater ─────────────────────────────────────────────────────────────

  getUpdaterInfo: () => ipcRenderer.invoke('updater:get-info'),
  checkForUpdates: () => ipcRenderer.invoke('updater:check'),
  downloadUpdate: () => ipcRenderer.invoke('updater:download'),
  installUpdate: () => ipcRenderer.invoke('updater:install'),

  onUpdaterEvent: (callback: (event: { type: string; payload?: any }) => void) => {
    const subscription = (_event: any, data: { type: string; payload?: any }) => callback(data);
    ipcRenderer.on('updater-event', subscription);
    return () => ipcRenderer.removeListener('updater-event', subscription);
  },
```

- [ ] **Step 2: `src/renderer/vite-env.d.ts` güncelle** — mevcut ElectronAPI interface'ine ekle:

```ts
      getUpdaterInfo: () => Promise<{ version: string; updaterActive: boolean }>;
      checkForUpdates: () => Promise<{ ok: boolean; error?: string }>;
      downloadUpdate: () => Promise<{ ok: boolean; error?: string }>;
      installUpdate: () => Promise<boolean>;
      onUpdaterEvent: (callback: (event: { type: string; payload?: any }) => void) => () => void;
```

- [ ] **Step 3: Doğrula** — Run: `npx tsc --noEmit` — Expected: hata yok

---

### Task 4: Renderer durum makinesi — reducer + store + birim test

**Files:**
- Create: `src/renderer/state/useUpdaterStore.ts`
- Create: `src/renderer/state/updaterReducer.test.ts`

**Interfaces:**
- Consumes: `window.electronAPI` (Task 3)
- Produces: `initialUpdaterState`, `updaterReducer(state, event)`, `useUpdaterStore` (zustand), `initUpdaterSync(): void`, `checkUpdates(): Promise<void>`, `downloadUpdate(): Promise<void>`, `installUpdate(): void`

- [ ] **Step 1: Failing test yaz — `src/renderer/state/updaterReducer.test.ts`**

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialUpdaterState, updaterReducer } from './useUpdaterStore';

test('update-available → status available, version + notes set', () => {
  const s = updaterReducer(initialUpdaterState, {
    type: 'update-available',
    payload: { version: '1.2.0', releaseNotes: '• Slayt geçişleri düzeltildi' },
  });
  assert.equal(s.status, 'available');
  assert.equal(s.nextVersion, '1.2.0');
  assert.equal(s.releaseNotes, '• Slayt geçişleri düzeltildi');
});

test('download-progress → status downloading, progress fields', () => {
  const s = updaterReducer(initialUpdaterState, {
    type: 'download-progress',
    payload: { percent: 68, transferred: 12_400_000, total: 18_200_000 },
  });
  assert.equal(s.status, 'downloading');
  assert.equal(s.percent, 68);
  assert.equal(s.transferred, 12_400_000);
  assert.equal(s.total, 18_200_000);
});

test('update-downloaded → status downloaded', () => {
  const s = updaterReducer(initialUpdaterState, { type: 'update-downloaded', payload: { version: '1.2.0' } });
  assert.equal(s.status, 'downloaded');
});

test('error → status error with message', () => {
  const s = updaterReducer(initialUpdaterState, { type: 'error', payload: { message: 'Network Error' } });
  assert.equal(s.status, 'error');
  assert.equal(s.errorMessage, 'Network Error');
});

test('update-not-available → status uptodate, version cleared', () => {
  const withUpdate = updaterReducer(initialUpdaterState, { type: 'update-available', payload: { version: '1.2.0' } });
  const s = updaterReducer(withUpdate, { type: 'update-not-available' });
  assert.equal(s.status, 'uptodate');
  assert.equal(s.nextVersion, null);
});

test('bilinmeyen event → state değişmez', () => {
  const s = updaterReducer(initialUpdaterState, { type: 'unknown' as any });
  assert.deepEqual(s, initialUpdaterState);
});
```

- [ ] **Step 2: Test'i çalıştır, FAIL görmeyi doğrula** — Run: `npx tsx --test src/renderer/state/updaterReducer.test.ts` — Expected: `Cannot find module './useUpdaterStore'`

- [ ] **Step 3: `src/renderer/state/useUpdaterStore.ts` oluştur**

```ts
import { create } from 'zustand';

export type UpdaterStatus = 'idle' | 'checking' | 'uptodate' | 'available' | 'downloading' | 'downloaded' | 'error';

export interface UpdaterState {
  status: UpdaterStatus;
  currentVersion: string;
  updaterActive: boolean;
  nextVersion: string | null;
  releaseNotes: string | Array<{ version: string; note: string; date: string }> | null;
  percent: number;
  transferred: number;
  total: number;
  errorMessage: string | null;
}

export const initialUpdaterState: UpdaterState = {
  status: 'idle',
  currentVersion: '',
  updaterActive: false,
  nextVersion: null,
  releaseNotes: null,
  percent: 0,
  transferred: 0,
  total: 0,
  errorMessage: null,
};

export function updaterReducer(state: UpdaterState, event: { type: string; payload?: any }): UpdaterState {
  switch (event.type) {
    case 'checking-for-update':
      return { ...state, status: 'checking', errorMessage: null };
    case 'update-not-available':
      return { ...state, status: 'uptodate', nextVersion: null, releaseNotes: null };
    case 'update-available':
      return {
        ...state,
        status: 'available',
        nextVersion: event.payload?.version ?? null,
        releaseNotes: event.payload?.releaseNotes ?? null,
      };
    case 'download-progress':
      return {
        ...state,
        status: 'downloading',
        percent: event.payload?.percent ?? 0,
        transferred: event.payload?.transferred ?? 0,
        total: event.payload?.total ?? 0,
      };
    case 'update-downloaded':
      return { ...state, status: 'downloaded' };
    case 'update-cancelled':
      return { ...state, status: 'available' };
    case 'error':
      return { ...state, status: 'error', errorMessage: event.payload?.message ?? 'Unknown error' };
    default:
      return state;
  }
}

export interface UpdaterActions {
  check: () => Promise<void>;
  download: () => Promise<void>;
  install: () => void;
}

const api = () => window.electronAPI;

let initialized = false;

/** Preload olaylarını store'a bağlar; App mount'ta bir kez çağrılır. */
export function initUpdaterSync(): void {
  if (initialized) return;
  initialized = true;
  if (!api()?.onUpdaterEvent) return;

  api().onUpdaterEvent((event) => {
    useUpdaterStore.setState((s) => updaterReducer(s, event));
  });

  api()
    .getUpdaterInfo()
    .then((info) => useUpdaterStore.setState({ currentVersion: info.version, updaterActive: info.updaterActive }))
    .catch(() => { /* electron API yok (ör. web önizleme) */ });
}

export async function checkUpdates(): Promise<void> {
  if (!api()?.checkForUpdates) return;
  const res = await api().checkForUpdates();
  if (!res.ok && res.error) {
    useUpdaterStore.setState((s) => updaterReducer(s, { type: 'error', payload: { message: res.error } }));
  }
}

export async function downloadUpdate(): Promise<void> {
  if (!api()?.downloadUpdate) return;
  const res = await api().downloadUpdate();
  if (!res.ok && res.error) {
    useUpdaterStore.setState((s) => updaterReducer(s, { type: 'error', payload: { message: res.error } }));
  }
}

export function installUpdate(): void {
  api()?.installUpdate?.();
}

export const useUpdaterStore = create<UpdaterState & UpdaterActions>(() => ({
  ...initialUpdaterState,
  check: checkUpdates,
  download: downloadUpdate,
  install: installUpdate,
}));
```

- [ ] **Step 4: Test'i çalıştır, PASS doğrula** — Run: `npx tsx --test src/renderer/state/updaterReducer.test.ts` — Expected: 6 test PASS

- [ ] **Step 5: Commit**

```bash
git add package.json src/main/updater.ts src/main/main.ts src/main/preload.ts src/renderer/vite-env.d.ts src/renderer/state/useUpdaterStore.ts src/renderer/state/updaterReducer.test.ts
git commit -m "feat: GitHub Releases auto-update pipeline (main + preload + state)"
```

---

### Task 5: i18n — `updates.*` anahtarları, 5 locale

**Files:**
- Modify: `src/renderer/locales/tr/translation.json`, `en`, `es`, `de`, `ko` (dosya sonuna yeni üst seviye `updates` bloğu)

**tr:**
```jsonc
"updates": {
  "title": "Güncellemeler",
  "currentVersion": "Mevcut Sürüm",
  "check": "Güncellemeleri kontrol et",
  "checking": "Güncellemeler kontrol ediliyor...",
  "uptodate": "Güncelsiniz",
  "available": "Güncelleme mevcut",
  "fromTo": "v{{current}} → v{{next}}",
  "download": "Güncellemeyi indir",
  "downloading": "Güncelleme indiriliyor...",
  "downloadedTitle": "Güncelleme hazır",
  "downloadedDesc": "v{{version}} başarıyla indirildi. Uygulama yeniden başlatıldığında güncellenecek.",
  "restartNow": "Şimdi yeniden başlat",
  "later": "Daha sonra",
  "errorTitle": "Güncelleme kontrol edilemedi",
  "errorDesc": "{{message}}",
  "releaseNotes": "Sürüm Notları",
  "devMode": "Geliştirici modundasınız — güncelleme kontrolü devre dışı.",
  "updateAvailableBadge": "Yeni sürüm mevcut",
  "updateDownloadedBadge": "Güncelleme indirildi — yeniden başlat"
}
```

**en:**
```jsonc
"updates": {
  "title": "Updates",
  "currentVersion": "Current Version",
  "check": "Check for updates",
  "checking": "Checking for updates...",
  "uptodate": "You're up to date",
  "available": "Update available",
  "fromTo": "v{{current}} → v{{next}}",
  "download": "Download update",
  "downloading": "Downloading update...",
  "downloadedTitle": "Update ready",
  "downloadedDesc": "v{{version}} downloaded successfully. The app will update on restart.",
  "restartNow": "Restart now",
  "later": "Later",
  "errorTitle": "Couldn't check for updates",
  "errorDesc": "{{message}}",
  "releaseNotes": "Release Notes",
  "devMode": "You're in developer mode — update checking is disabled.",
  "updateAvailableBadge": "A new version is available",
  "updateDownloadedBadge": "Update downloaded — restart to apply"
}
```

**es:**
```jsonc
"updates": {
  "title": "Actualizaciones",
  "currentVersion": "Versión actual",
  "check": "Buscar actualizaciones",
  "checking": "Buscando actualizaciones...",
  "uptodate": "Estás actualizado",
  "available": "Actualización disponible",
  "fromTo": "v{{current}} → v{{next}}",
  "download": "Descargar actualización",
  "downloading": "Descargando actualización...",
  "downloadedTitle": "Actualización lista",
  "downloadedDesc": "v{{version}} descargada correctamente. La app se actualizará al reiniciar.",
  "restartNow": "Reiniciar ahora",
  "later": "Más tarde",
  "errorTitle": "No se pudo buscar actualizaciones",
  "errorDesc": "{{message}}",
  "releaseNotes": "Notas de la versión",
  "devMode": "Estás en modo desarrollador — la búsqueda de actualizaciones está desactivada.",
  "updateAvailableBadge": "Hay una nueva versión disponible",
  "updateDownloadedBadge": "Actualización descargada — reinicia para aplicarla"
}
```

**de:**
```jsonc
"updates": {
  "title": "Aktualisierungen",
  "currentVersion": "Aktuelle Version",
  "check": "Nach Updates suchen",
  "checking": "Suche nach Updates...",
  "uptodate": "Sie sind auf dem neuesten Stand",
  "available": "Update verfügbar",
  "fromTo": "v{{current}} → v{{next}}",
  "download": "Update herunterladen",
  "downloading": "Update wird heruntergeladen...",
  "downloadedTitle": "Update bereit",
  "downloadedDesc": "v{{version}} erfolgreich heruntergeladen. Die App wird beim Neustart aktualisiert.",
  "restartNow": "Jetzt neu starten",
  "later": "Später",
  "errorTitle": "Update konnte nicht geprüft werden",
  "errorDesc": "{{message}}",
  "releaseNotes": "Versionshinweise",
  "devMode": "Sie befinden sich im Entwicklermodus — Updateprüfung ist deaktiviert.",
  "updateAvailableBadge": "Eine neue Version ist verfügbar",
  "updateDownloadedBadge": "Update heruntergeladen — Neustart zum Anwenden"
}
```

**ko:**
```jsonc
"updates": {
  "title": "업데이트",
  "currentVersion": "현재 버전",
  "check": "업데이트 확인",
  "checking": "업데이트 확인 중...",
  "uptodate": "최신 버전입니다",
  "available": "업데이트 가능",
  "fromTo": "v{{current}} → v{{next}}",
  "download": "업데이트 다운로드",
  "downloading": "업데이트 다운로드 중...",
  "downloadedTitle": "업데이트 준비 완료",
  "downloadedDesc": "v{{version}} 다운로드 완료. 앱을 다시 시작하면 업데이트됩니다.",
  "restartNow": "지금 다시 시작",
  "later": "나중에",
  "errorTitle": "업데이트를 확인할 수 없습니다",
  "errorDesc": "{{message}}",
  "releaseNotes": "릴리스 노트",
  "devMode": "개발자 모드입니다 — 업데이트 확인이 비활성화되어 있습니다.",
  "updateAvailableBadge": "새 버전이 있습니다",
  "updateDownloadedBadge": "업데이트 다운로드 완료 — 다시 시작하여 적용"
}
```

**Doğrulama:** `node -e "for (const l of ['tr','en','es','de','ko']) { JSON.parse(require('fs').readFileSync('src/renderer/locales/'+l+'/translation.json','utf8')); console.log(l, 'OK') }"` → 5× OK

---

### Task 6: Güncellemeler modalı — `UpdatesModal.tsx`

**Files:**
- Create: `src/renderer/components/UpdatesModal.tsx`
- Modify: `src/renderer/state/useStore.ts` (`isUpdatesOpen` + setter — `isCheatsheetOpen` deseni: interface'e `isUpdatesOpen: boolean; setIsUpdatesOpen: (open: boolean) => void;` (`isCheatsheetOpen` civarına), uygulamaya `isUpdatesOpen: false, setIsUpdatesOpen: (open) => set({ isUpdatesOpen: open }),`)

**Interfaces:**
- Consumes: `useUpdaterStore` (Task 4 — durum + `check`/`download`/`install` eylemleri store'da), `useStore.isUpdatesOpen`/`setIsUpdatesOpen` (bu Task'ta eklenir), `Dialog` bileşeni (`components/Dialog.tsx` — CheatsheetModal'daki kullanım aynısı: `open`, `onClose`, `labelledBy`, `className`)

- [ ] **Step 1: Modal bileşenini oluştur** — CheatsheetModal'ın `Dialog` sarmalayıcı desenini birebir izle: `Dialog open={isUpdatesOpen} onClose={() => setIsUpdatesOpen(false)} labelledBy="updates-title" className="bg-surface-overlay border border-white/10 rounded-2xl p-6 max-w-lg w-full mx-4 shadow-2xl"`.

Durum makinesine göre görünümler (lucide-react ikonları mevcut — örn. `Loader2`, `CheckCircle2`, `AlertTriangle`, `Download`, `RefreshCw`):
- `updaterActive === false` → `t('updates.devMode')` bilgi satırı
- `idle` → başlık + `t('updates.currentVersion')`: v{currentVersion} + "kontrol et" butonu (`check()` çağırır)
- `checking` → Loader2 spin + `t('updates.checking')`
- `uptodate` → CheckCircle2 yeşil + `t('updates.uptodate')`
- `available` → `t('updates.available')` + `t('updates.fromTo', {current, next})` + releaseNotes (string ise `<pre className="whitespace-pre-wrap text-xs ...">`, dizi ise her öğe: `v{item.version} — {item.note}`) + `t('updates.download')` butonu (`download()`)
- `downloading` → `t('updates.downloading')` + ilerleme çubuğu (`width: {percent}%`) + `{fmtMB(transferred)} / {fmtMB(total)}` — `fmtMB = (b) => (b / 1048576).toFixed(1) + ' MB'`
- `downloaded` → `t('updates.downloadedTitle')` + `t('updates.downloadedDesc', {version})` + "Şimdi yeniden başlat" (`install()`) + "Daha sonra" (modalı kapatır: `setIsUpdatesOpen(false)`)
- `error` → AlertTriangle + `t('updates.errorTitle')` + `t('updates.errorDesc', {message: errorMessage})` + tekrar dene (check again)

Buton stili: projedeki birincil butonlar `bg-blue-600 hover:bg-blue-700` (TransitionSelector/Toolbar deseni), ikincil `bg-white/5 hover:bg-white/10 border border-white/10`; `focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none` kolektif kuralı.

- [ ] **Step 2: Doğrula** — Run: `npx tsc --noEmit` — Expected: hata yok

---

### Task 7: Toolbar dişlisi + rozet, App.tsx mount, store state

**Files:**
- Modify: `src/renderer/components/Toolbar.tsx` (import `Settings2` lucide ikonu; store'dan `isUpdatesOpen/setIsUpdatesOpen`; `useUpdaterStore`'dan `updaterStatus`; dil değiştirici butonunun hemen soluna dişli butonu + yeşil rozet)
- Modify: `src/renderer/App.tsx` (import `initUpdaterSync` + `useEffect` ile çağır; `<CheatsheetModal />` yanına `<UpdatesModal />`)

- [ ] **Step 1: Toolbar dişli butonu** (dil değiştirici butonundan hemen önce; `updaterStatus = useUpdaterStore((s) => s.status)` bileşen içinde):

```tsx
<button
  onClick={() => setIsUpdatesOpen(true)}
  title={t('updates.title')}
  aria-label={t('updates.title')}
  className="relative p-2.5 rounded-md bg-white/5 hover:bg-white/10 border border-white/10 transition-colors focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none active:scale-[0.92]"
>
  <Settings2 className="w-4 h-4" aria-hidden="true" />
  {(updaterStatus === 'available' || updaterStatus === 'downloaded') && (
    <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-green-500" aria-hidden="true"
      title={updaterStatus === 'downloaded' ? t('updates.updateDownloadedBadge') : t('updates.updateAvailableBadge')} />
  )}
</button>
```

- [ ] **Step 2: App.tsx bağla**

```tsx
// App.tsx üstünde (diğer useEffect'lerin yanına)
useEffect(() => { initUpdaterSync(); }, []);
// CheatsheetModal satırının yanına
<UpdatesModal />
```

- [ ] **Step 3: Doğrula** — Run: `npm run lint` — Expected: 0 hata, 0 uyarı

---

### Task 8: GitHub Actions release workflow

**Files:**
- Create: `.github/workflows/release.yml`

- [ ] **Step 1: Workflow dosyası**

```yaml
name: Release

on:
  push:
    tags: ['v*']

jobs:
  release:
    runs-on: windows-latest

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Build
        run: npx vite build

      - name: Package & publish to GitHub Releases
        run: npx electron-builder --publish always
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

- [ ] **Step 2: Doğrula** — Run: `node -e "const y=require('fs').readFileSync('.github/workflows/release.yml','utf8'); if(!y.includes('electron-builder --publish always')||!y.includes('GH_TOKEN')) throw new Error('missing'); console.log('workflow OK')"` — Expected: `workflow OK`

---

### Task 9: Dev test düzeneği (isteğe bağlı ama önerilen)

**Files:**
- Create: `dev-app-update.yml` (proje kökü)

- [ ] **Step 1: dev-app-update.yml**

```yaml
provider: github
owner: semiromest
repo: Worship-Presentation-Assistant
```

---

### Task 10: Yayın + uçtan uca doğrulama

**Files:** yok (yayın işlemi)

- [ ] **Step 1: Yerel doğrulama** — lint + tip + test + paketleme:

Run: `npm run lint; if ($?) { npx tsc --noEmit }; if ($?) { npx tsx --test src/renderer/state/updaterReducer.test.ts }; if ($?) { npx electron-builder --publish never }`
Expected: lint temiz, tsc temiz, 6 test PASS, `release/1.1.0/` içinde `Worship-Presentation-Assistant-Setup-1.1.0.exe`, `.blockmap` ve `latest.yml` (`files[0].path` artefakt adıyla eşleşmeli)

- [ ] **Step 2: Yayınla** — tag push akışı:

```bash
git tag v1.1.0
git push origin master
git push origin v1.1.0
```

Workflow tetiklenir; GitHub Releases'te `v1.1.0` release'i (draft olarak) oluşur — release body'sine gelişme notları yazılır (kullanıcılara `releaseNotes` olarak gösterilir) ve Release "Publish" yapılır.

- [ ] **Step 3: E2E doğrulama** — eski sürüm kurulu iken: uygulamayı aç → sessiz kontrol → toolbar'da yeşil rozet → dişli → "Güncelleme mevcut v{current} → v{next}" + notlar → İndir → ilerleme % → "Şimdi yeniden başlat" → kurulum tamamlanır, `app.getVersion()` yeni sürümü döner.