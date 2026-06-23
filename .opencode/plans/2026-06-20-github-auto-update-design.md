# GitHub Auto-Update Sistemi Tasarımı

**Tarih:** 2026-06-20
**Proje:** Worship Presentation Assistant (presenter)
**Platform:** Windows (NSIS kurulum)

---

## 1. Amaç

Uygulama GitHub Releases üzerinden dağıtılacak ve kullanıcılar yeni sürümleri otomatik olarak uygulama içinden güncelleyebilecek.

---

## 2. Mimari

`
GitHub'a tag push (v1.0.1)
      ↓
GitHub Actions → electron-builder → NSIS kurulum + latest.yml oluşur
      ↓
GitHub Releases'e yüklenir (Setup.exe + latest.yml)
      ↓
Kullanıcı uygulamayı açar
      ↓
electron-updater → GitHub Releases API'den latest.yml'yi çeker
      ↓
Sürüm karşılaştırması (mevcut < latest)
      ↓
IPC ile renderer'a "yeni sürüm var" bildirir
      ↓
Kullanıcıya dialog: "Yeni sürüm vX.X.X mevcut. İndirilsin mi?"
      ↓
Onay → arka planda indir → progress bildirimi
      ↓
İndirme tamam → dialog: "Güncelleme hazır. Şimdi yeniden başlat?"
      ↓
app.quit() → NSIS installer çalışır → güncelleme
`

---

## 3. Kapsam

### 3.1 Hedef Platform
- Sadece Windows (NSIS kurulum)
- Tek kanal: stable

### 3.2 Güncelleme Davranışı
- Uygulama açılışında güncelleme kontrolü
- Her 30 dakikada bir tekrar kontrol
- Kullanıcıya sor: önce indirme onayı, sonra kurulum onayı
- Manuel "Güncellemeleri Kontrol Et" butonu

---

## 4. Değişecek / Eklenecek Dosyalar

### 4.1 package.json — Publish yapılandırması
build alanına eklenecek:
`json
"publish": {
  "provider": "github",
  "owner": "<KULLANICI_ADI>",
  "repo": "presenter",
  "private": false,
  "releaseType": "release"
}
`

### 4.2 src/main/autoUpdater.ts — YENİ DOSYA
- initAutoUpdater(win) — kurulum, event listener'lar
- checkForUpdates() — kontrol
- downloadUpdate() — indirme başlat
- quitAndInstall() — kur + yeniden başlat
- stopAutoUpdater() — interval temizleme
- Event'ler: checking-for-update, update-available, update-not-available, download-progress, update-downloaded, error

### 4.3 src/main/main.ts — Değişiklik
- app.whenReady() içinde initAutoUpdater(win) çağrısı
- IPC handler'lar: check-for-updates, download-update, install-update

### 4.4 src/main/preload.ts — Değişiklik
- checkForUpdates(), downloadUpdate(), installUpdate() — invoke
- onUpdateStatus(), onUpdateAvailable(), onUpdateDownloadProgress(), onUpdateDownloaded(), onUpdateError() — listener

### 4.5 src/renderer/hooks/useAutoUpdate.ts — YENİ DOSYA
- Durum makinesi: idle → checking → available → downloading → downloaded → installing
- Auto-check on mount
- Progress tracking
- Dialog state'leri

### 4.6 src/renderer/components/UpdateDialog.tsx — YENİ DOSYA
Üç ekran:
1. UpdateAvailable: "Yeni sürüm v{version} mevcut. İndirilsin mi?" — [Güncelle] [İptal]
2. UpdateDownloading: Progress bar + "İndiriliyor: %{percent}"
3. UpdateDownloaded: "Güncelleme indirildi. Şimdi yeniden başlatılsın mı?" — [Yeniden Başlat] [Sonra]

### 4.7 src/renderer/App.tsx — Değişiklik
- useAutoUpdate hook'u eklenecek
- UpdateDialog render edilecek

### 4.8 .github/workflows/release.yml — YENİ DOSYA
`yaml
name: Build & Release
on:
  push:
    tags: ['v*']
jobs:
  release:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci
      - run: npm run build -- --publish always
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
`

---

## 5. Veri Akışı

| Adım | Kim | Ne |
|------|-----|-----|
| 1 | Main (app.whenReady) | initAutoUpdater → checkForUpdates() |
| 2 | autoUpdater | GitHub API'den latest.yml çeker |
| 3 | autoUpdater | update-available event'i fırlatır |
| 4 | Main | win.webContents.send('update-available', info) |
| 5 | Renderer (hook) | onUpdateAvailable tetiklenir → dialog göster |
| 6 | Kullanıcı | "Güncelle" butonuna basar → downloadUpdate() |
| 7 | autoUpdater | Arka planda indirir → download-progress event'leri |
| 8 | Renderer | Progress bar güncellenir |
| 9 | autoUpdater | update-downloaded event'i |
| 10 | Renderer | "Yeniden Başlat" dialog'u |
| 11 | Kullanıcı | Onay → installUpdate() |
| 12 | Main | autoUpdater.quitAndInstall() |

---

## 6. Sürüm Yayınlama Süreci

### GitHub Actions ile (otomatik):
`
git tag v1.1.0
git push origin v1.1.0
`

### Manuel (GitHub Actions olmadan):
`
npm run build
→ release/v1.1.0/ klasörü: Setup.exe + latest.yml
→ GitHub Releases sayfasından manuel yükle
`

---

## 7. Güvenlik

- electron-updater GitHub Releases API'sini kullanır (SSL)
- NSIS installer imzalanabilir (opsiyonel)
- Güncelleme dosyaları HTTPS üzerinden indirilir
- GitHub token sadece CI ortamında kullanılır

---

## 8. Gelecek Genişletmeler (Şimdilik YAGNI)

- macOS imzalama (notarization)
- Delta güncelleme
- Beta/stable kanalları
- Güncellemeyi erteleme (snooze)
- Zorunlu güncelleme (force update)
