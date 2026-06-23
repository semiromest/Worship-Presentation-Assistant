# Worship Presentation Assistant

Worship Presentation Assistant, kiliseler ve sunum ihtiyacı olan topluluklar için TypeScript, React ve Electron kullanılarak geliştirilmiş modern bir masaüstü uygulamasıdır. Bu MVP sürümü, temel sunum oluşturma, slayt yönetimi ve yerel dosya işlemlerini içerir.

## Özellikler

- **Slayt Yönetimi:** Slayt ekleme, silme ve düzenleme.
- **Canlı Yayın:** Slaytları tam ekran modunda (F11/Canlı Yayın butonu) sunma.
- **Yerel Depolama:** Sunumları `.gpres` uzantılı dosyalar olarak kaydetme ve açma.
- **Modern Arayüz:** Tailwind CSS ile oluşturulmuş, kullanıcı dostu ve karanlık mod destekli tasarım.

## Gereksinimler

- [Node.js](https://nodejs.org/) (v18 veya üzeri önerilir)
- npm (Node.js ile birlikte gelir)

## Nasıl Çalıştırılır?

### 1. Bağımlılıkları Yükleyin

Proje dizininde terminali açın ve aşağıdaki komutu çalıştırın:

```powershell
npm install
```

### 2. Geliştirme Modunda Başlatın

Uygulamayı geliştirme modunda (HMR destekli) çalıştırmak için:

```powershell
npm run dev
```

### 3. Kod Kalitesi Kontrolleri

Kodunuzu ESLint ile kontrol etmek ve Prettier ile formatlamak için:

```powershell
# Hataları kontrol et
npm run lint

# Kod formatını düzelt
npm run format
```

## Derleme ve Paketleme (Windows)

Uygulamayı Windows için derleyip yüklenebilir bir `.exe` dosyası haline getirmek için:

```powershell
npm run build
```

Bu komut şunları yapar:
1. TypeScript kodunu derler.
2. Vite ile frontend varlıklarını (assets) paketler.
3. `electron-builder` kullanarak `release/` klasörü altında Windows için bir installer (NSIS) oluşturur.

**Not:** Bu uygulama şu anda sadece Windows platformu için konfigüre edilmiştir.

## Dosya Yapısı

- `src/main`: Electron ana süreç (Main Process) kodları.
- `src/preload`: Electron ve Renderer arasındaki güvenli köprü (Preload Scripts).
- `src/renderer`: React tabanlı kullanıcı arayüzü kodları.
- `dist`: Derlenmiş frontend dosyaları.
- `dist-electron`: Derlenmiş Electron dosyaları.
- `release`: Dağıtıma hazır paketlenmiş uygulama dosyaları.

## İleri Aşamada Eklenecek Özellikler

- Çoklu ekran desteği (Projector Output).
- İncil (Bible) entegrasyonu.
- Uzaktan kontrol (Remote Control) web arayüzü.
- Medya (Video/Resim) desteği.
