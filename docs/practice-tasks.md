# Önceki bağımsız alıştırma görevleri — tarihsel teslim notu

Bu belge önceki altı görev teslimini kaydeder. Görev seçim arayüzü artık kaldırılmıştır; güncel ilk iki bölümlük sıralı rehber [guided-learning.md](guided-learning.md) içindedir.

Ayarlar → Yardım → Alıştırmayı aç girişinden ayrı alıştırma örneği açılır. Görev panelinden bağımsız görev seçilir. Gerçek sunum ve normal profil kullanılmaz; canlı çıktı, kumanda, paylaşım, STT, bulut ve güncelleme kapalı kalır.

## Çalışan görevler

- Metin slaytı ekleme.
- Alıştırmanın oluşturduğu örnek slaytı silme.
- Uygulamanın sağladığı örnek resmi sunuma ekleme.
- Örnek İncil kaynağını import edip bir ayeti ekleme.
- Geçerli süreyle geri sayım ekleme.
- Sunumu alıştırma profilinin kütüphanesine kaydetme.

Tamamlanma düğme tıklamasından değil işlem sonucundan algılanır. Silme görevi yalnızca kendi değiştirilmemiş örneğinin kaldırılmasını kabul eder. Gerçek dosyaya kayıt veya dışa aktarma açılmaz. İlahiler ve canlı çıktı bu teslimin kapsamı dışındadır; Takvim, Editör ve Ayarlar için yapay görev eklenmez.

Duraklat, devam et ve atla seçenekleri bulunur. Görev değiştirmek önceki görevin checkpoint’ini korur. Devam ederken yeni oturum kimliği eski sonuçları geçersiz kılar. Tamamlanmış görev yeniden denenip atlanırsa tamamlanma geçmişi düşmez. Çıkışta slaytlar otomatik temizlenmez ve gerçek sunum snapshot’ı geri yüklenmez.

## Kalıcılık ve ilerleme

Alıştırma ana süreci tek yazıcıdır. `practice-workspace.json` schema 1 sunumu ve görev checkpoint’lerini, `practice-progress.json` schema 2 revizyonu ve görev/bölüm durumlarını saklar. Eski ilerleme schema 1’den taşınır. Atomik yazma kullanılır; yazma hatası başarı olarak gösterilmez. Süreç yeniden açıldığında yarım kalan görev duraklatılmış olarak devam ettirilebilir.

Ana uygulamanın Ayarlar listesi bu ilerlemeyi salt okunur okur; altı görevin tamamlanan, atlanan ve kalan sayısını gösterir. On bölümün haritası korunur. Liste açıkken iki saniyelik yenileme ve odak dönüşünde okuma yapılır. Bozuk kayıtta son geçerli görünüm korunur ve hata bildirilir.

## Doğrulama

- TypeScript kontrolü ve hedefli ESLint: geçti; yeni dosyalarda sıfır hata/uyarı.
- 15 saf/AST testi: geçti. Migration, eski profil politikası, capture izin listesi, görev sonuçları, oturum iptali ve checkpoint davranışları kapsanır.
- Mevcut 8 geliştirme Electron akışı: geçti.
- 6 paketlenmiş Windows akışı: geçti. Altı görevin gerçek arayüzde yapılması, duraklatma/devam, atlama, profil ayrımı, doğrudan çıktı IPC yasağı, tek yazıcı, renderer/ana süreç çökmesi ve yeniden açılış kapsanır.
- 800×600 görev paneli ekran görüntüsü incelendi.

Paketlenmiş akışların tamamı release iş akışına eklendi; ilk üç yayın için bilgi amaçlı kalır ve engelleyiciye geçiş ayrıca onay gerektirir. Typecheck, hedefli lint, saf/AST ve geliştirme Electron kapıları engelleyicidir. Fiziksel Windows %125/%150 DPI, NSIS kurulum/yükseltme ve macOS çalışma zamanı bu yerel doğrulamada yapılmadı.

## Yerel paket

Windows’ta electron-builder’ın indirilmiş runtime dizinini yeniden adlandırma adımı EPERM verdi. Aynı sabit Electron runtime’ını kullanarak paketleme başarılı oldu:

```powershell
npx electron-builder --win --dir --publish never --config.electronDist=node_modules/electron/dist --config.directories.output=release/practice-tasks-check
```

Test edilen executable: `release/practice-tasks-check/win-unpacked/Worship Presentation Assistant.exe`. Paketlenmiş testler uygulamanın ürettiği geçici smoke profillerinde çalıştı; gerçek kullanıcı profili kullanılmadı. Bu çökme sonuçları Faz 3 canlı çıktı gözetim kapısını geçmiş sayılmaz; uzak komut politikası hâlâ açık karardır.
