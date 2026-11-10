# Masaüstü optimizasyonu — 4 Kasım 2026

## Uygulanan davranış

- Telefon yayını, çizimde kullanılan değişmez sahne durumunun tamamından türetilen kesin bir içerik anahtarı kullanır. Yalnız son statik metin/blackout karesi tutulur. Dosya içeren ve dinamik sahneler bu önbelleğe alınmaz; aynı dosyanın diskte değişmesi eski piksele kilitlenmez. Font yükleme sonuçları, dil/tema ve çözülmüş filigran/yazar ayarları kimliğe dahildir.
- `WPA_DISABLE_SCREEN_FRAME_CACHE=1` ile uygulama başlatıldığında kare önbelleği kapanır. Bayrak okunamazsa da önbellek kapalı kalır.
- Aynı anda bir üretim ve yalnız en yeni bekleyen sahne bulunur. Geçersizleşen sonuçlar gönderilmez. İzleyici yokken üretim aralığı, sahne kopyalama ve altyazı yerleşimi durur; gizli video duraklatılır. Yayın bittiğinde video kaynağı bırakılır.
- Statik kare iki saniyede bir tekrar gönderilir; telefon istemcisinin dört saniyelik bekleme kuralı korunur. Video/altyazı JPEG kodlaması asenkrondur. Video tuvali tekrar kullanılır; kırpılmış döngü ve oynatma hızı, izleyici geri geldiğinde geçen süreye uygulanır.
- Drive/YouTube modülleri ilk kullanımda yüklenir; eşzamanlı istekler aynı başlatmayı paylaşır. Hatalı başlatma tekrar denenebilir; iptal edilen neslin geç gelen servisi temizlenir. Kontrol hazır olduktan sonra, kullanıcı boşta ve yayın/müzik/konuşma/ekran yakalama/içe aktarma/diyalog etkin değilken modüller önceden yüklenir. Bu hazırlık oturum açma veya ağ isteği başlatmaz.
- Kontrol ve projeksiyon ayrı giriş modülleri kullanır. Ana süreç her çıktı için güncel tam durumu yamalarla birlikte saklar; yeniden yüklenen projeksiyon, kontrolün tekrar durum göndermesine ihtiyaç duymaz. Her alıcı neslinin kimliği vardır; eski nesle ait mesajlar reddedilir. İlk tam durum gelene kadar ekran siyahtır.
- Başlangıçta kabuk, belge ve masaüstü hazır işaretleri ayrı tutulur. Bunların ardından iki çizim fırsatı geçtiğinde `presenter:control-ready` kaydedilir. Bu işaret fiziksel ekranın taranmasını ölçmez.

## Ölçülen sonuç

Windows x64, Ryzen 5 3600, 16 GB RAM. Önceki çalışma ağacı paketi ve yeni paket aynı Electron/builder ayarlarıyla oluşturuldu. Her paket için 3 dışlanan ısınma açılışı ve 30 ölçülen açılış kullanıldı. Ölçümler sırayla ve aynı makinede yapıldı; eşzamanlı A/B veya rastgele sıralı deney değildir.

| Ölçüm | Önce medyan / p95 | Sonra medyan / p95 |
| --- | --- | --- |
| Süreç başlatma → görünen uygulama kabuğu | 721 / 1009 ms | 622 / 692 ms |
| Süreç başlatma → slayt ekleme, metni düzenleme ve kartta görünmesi | 1691 / 1952 ms | 1622 / 1668 ms |

Kabuk medyanı %13,7; uçtan uca kullanılabilirlik medyanı %4,1 iyileşti. p95 değerleri sırasıyla %31,4 ve %14,5 azaldı. **Kullanılabilirlik için hedeflenen en az %10 ve 100 ms medyan kazanç karşılanmadı**; bu ölçüm genel bir büyük açılış hızlanması iddiasını desteklemiyor.

Sabit telefon sahnesinde 11 periyodik kare için 1 kodlama yeterli oldu: %90,9 daha az tekrar kodlama. Kontrol renderer'ına 1700 ms'de bir 600 ms blok uygulanırken en uzun kare aralığı 2600 ms oldu. İzleyicisiz dönemde yeni üretim kaydı oluşmadı. 100 bağlantı aç/kapat döngüsü sonunda ana IPC dinleyici toplamı değişmedi. Bu kısa test, uzun süreli bellek sızıntısı olmadığına dair kanıt sayılmaz.

## Doğrulama

- TypeScript ve Vite üretim derlemesi geçti; Windows paketleme tamamlandı.
- Yeni servis/kuyruk/sahne/projeksiyon birim kontrolleri ve ilgili slayt düzenleme kontrolleri: 12 geçti.
- Electron kontrolleri: 8 geçti. Müzik penceresinin kapanması, slayt müziği, 1000 slaytlık talebe bağlı görseller, projeksiyonu açma/tekrar açma/yeniden yükleme, tam durumdan önce siyah ekran, kontrol yeniden eşitlemesi olmadan yamaların kurtarılması, eski alıcı mesajının reddi, telefonun statik kare stresi/100 bağlantısı ve video döngüsünün geri dönüş zamanı kapsandı.
- Bağımsız kod incelemesinde bulunan alıcı nesli ve izleyicisiz sahne kopyalama sorunları düzeltildi.

## Tekrar çalıştırma ve sınırlar

```powershell
node perf/optimization-run.cjs --exe "C:\absolute\win-unpacked\Worship Presentation Assistant.exe" --out .tmp/optimization-results --runs 30 --warmups 3
npx playwright test projector-startup.spec.cjs screen-frame.spec.cjs music-modal.spec.cjs slide-audio.spec.cjs preview-demand.spec.cjs
```

Ölçüm uygulamanın kendi `--wpa-smoke` yalıtımını kullanır. Her açılış yeni bir deneme profili oluşturur. Kalıcı kullanıcı profiliyle sıcak açılış, işletim sistemi disk önbelleği soğutulmuş açılış ve macOS Gatekeeper ölçülmedi. Ham yerel sonuçlar `.tmp/optimization-baseline/report.json` ve `.tmp/optimization-candidate/report.json` içindedir.

Telefon testinin uzatılabilir sürümü:

```powershell
$env:WPA_FRAME_SOAK_MS = '3600000'
npx playwright test screen-frame.spec.cjs --grep 'cache static'
Remove-Item Env:WPA_FRAME_SOAK_MS
```

**60 dakikalık oturum, ayrıntılı bellek/CPU eğrisi, fiziksel ikinci ekran, gerçek telefon/ağ dalgalanması ve macOS bu çalışmada doğrulanmadı.** CPU/uzun görev süresinde %20 kazanç için karşılaştırmalı kanıt yoktur. Gerçek iki ekranlı ve uzun oturumlu yayın kabulü bu sonuçtan çıkarılamaz.

Eski güvenilirlik ölçüm aracı artık bütün önizlemelerin base64'e dönüşmesini beklemiyor; ilk 12 görünür varlığı HTTP üzerinden de doğruluyor. Yeni protokol `reliability-v7-http-visible12-v1`; eski sonuçlarla karşılaştırmayı reddediyor. Bu aracın uzun ölçüm paketi burada yeniden çalıştırılmadı. Daha önce kapalı tutulan genel slayt önizleme optimizasyon bayrağı değiştirilmedi.

## Ek çalışma: değişiklik kontrolü ve kayıt kütüphanesi

Değişiklik kontrolü artık değişmez sunum/slayt nesnelerine göre önbelleklenen kesin içerik parçalarını karşılaştırır. Aynı slaytlar yeniden JSON'a çevrilmez; yalnız yeni slayt nesneleri işlenir. Geri alma, bölüm/parça değişimi, sıralama, gelecekte eklenecek alanlar ve kayıt sürerken gelen düzenlemeler korunur. Hash kullanılmaz. Sunumu ilk kez incelemenin maliyeti sürer; sonraki kontrolün maliyeti azaltılır.

Kütüphane için `preset-index.json` ve `preset-previews/` yardımcı verileri eklenmiştir. Yetkili kayıt kaynağı eski `presets/` sunum dosyalarıdır. Dizin eksik/bozuksa yeniden üretilir; dosya boyutu/zamanı değişen kayıt yeniden okunur. Mevcut kütüphanenin ilk dizin oluşturması tam tarama gerektirir. Sonraki yüklemeler yalnız hafif bilgileri okur. Kapak görünür olunca ayrı kapak verisi, kayıt açılınca tam sunum alınır. Yeni kayıt/silme/yeniden adlandırma yanıtları bütün kütüphane yerine değişen kaydı ve kaldırılan adları taşır. Eski API geçerlidir; eski ve yeni kayıt işlemleri aynı sıraya alınır. Bellekte tutulan tam kayıtlar sınırlandırılmıştır.

`scripts/bench-document-library.ts` ile 3 dışlanan ve 30 ölçülen örnek alındı. Eski preset store, bu çalışmadan önceki HEAD kaynağından alınmıştır. Belge kontrolü 1000 slayt × 4096 karakter; kütüphane 150 kayıt × 150 slayt × 512 karakter içerir.

| İşlem | Önce medyan / p95 | Sonra medyan / p95 |
| --- | --- | --- |
| Tek slayt değişikliğinden sonra belge içeriği kontrolü | 6,52 / 9,64 ms | 0,24 / 0,29 ms |
| Yeni store örneğiyle kayıt listesini hazırlama | 50,48 / 58,07 ms | 4,52 / 6,24 ms |

Liste yanıtının JSON boyutu 12.418.431 → 26.781 bayt oldu (%99,8 azalma). Bu sayı gerçek IPC bayt ölçümü değildir; yanıt nesnelerinin JSON gösterim boyutudur. İlk dizin oluşturma bu veride 107 ms sürdü ve sonraki liste ölçümlerinden ayrı tutuldu. Dizin üzerinden liste ve kapak okumasında tam sunum dosyası okuma sayısı sıfır, istenen tam kaydı açarken birdir.

Bu sonuçlar aynı Node sürecindeki yeni store örneklerinin ve içerik karşılaştırmasının sentetik ölçümüdür. Disk önbelleği sıfırlanmadı; uygulamanın toplam açılış süresinin bu oranda iyileştiği anlamına gelmez. Ham sonuç: `.tmp/document-library-benchmark.json`.

19 ilgili birim testi ve 12 Electron testi geçti. Eski kayıt geçişi, bozuk dizin, dışarıdan değişen dosya, eşzamanlı eski/yeni kayıt, başarısız yazım, saklama süresi, geç liste yanıtı, bellek sınırı, dosya değiştirme koruması, kapakların talebe bağlı yüklenmesi ve gerçek otomatik kayıt içeriği kapsandı. TypeScript, ilgili ESLint kontrolleri ve üretim derlemesi geçti. Bağımsız incelemede bulunan tekrarlı dizin taraması ve tam içerik birikmesi giderildi. Tarayıcı demosunun eski API'ye dönüşü korundu; site yayımlanmadı.
