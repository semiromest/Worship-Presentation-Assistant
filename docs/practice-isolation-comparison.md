# Çıktısız alıştırma altyapısı — Faz 2 öncesi karar kapısı

Bu rapor başlangıçtaki ayrı süreç, yetki ve ilerleme kapısını kaydeder. Kapı sonrasında kullanıcı isteğiyle altı düşük riskli görev eklendi; güncel teslim ve test sonuçları [practice-tasks.md](practice-tasks.md) içindedir. Uzak komut politikası seçilmedi; canlı çıktı Faz 3 kapsamındadır.

## Başlangıç ve dosya güvenliği

- `--wpa-profile` ve `--wpa-isolation-spike` kaldırıldı; bu bayraklar ve çakışan modlar pencere açılmadan reddedilir.
- `--wpa-practice` varsayılan kullanıcı profilinin sabit kardeş dizinini kullanır. Profil, session ve runtime/TEMP ayrıdır; ikinci alıştırma örneği mevcut pencereye yönlenir. Normal uygulamanın çoklu örnek davranışı korunur.
- `--wpa-smoke` uygulamanın oluşturduğu yeni GUID dizinini kullanır. Paketlenmiş testte ana uygulama ve alıştırma bu geçici alan içinde çalışır. Bir renderer test API’si yoktur.
- Smoke alt sürecine yalnızca uygulamanın ürettiği `WPA_SMOKE_SESSION` kimliği aktarılır. Bu bir dosya yolu değildir: çocuk sabit TEMP dizini, GUID ve doğrulanmış marker’dan profilini hesaplar. Eksik/bozuk marker ve bağlantılar başlangıcı durdurur.
- Profilin kökü/ataları ve uygulama verisindeki bağlantılar reddedilir. POSIX’te Chromium’un kendi kök Singleton bağlantıları, tek örnek kilidi alındıktan sonra veri taramasından ayrı tutulur. Windows kilit dosyası normal bir dosya olarak kabul edilir.
- Bu ayrım bir işletim sistemi sandbox’ı değildir. Aynı kullanıcı yetkileriyle çalışan kötü niyetli başka bir süreçten dosya bütünlüğü veya kimlik doğrulama garantisi vermez. Bayraklar ek yetki sağlamaz ve harici profil yolu kabul etmez.

## Yetki sınırı

Alıştırma ana sürecinde açık IPC izin listesi uygulanır; yeni kanallar kendiliğinden yetki kazanmaz. Kontrol webContents ve ana frame eşleşmesi doğrulanır. Çıktı oluşturma fonksiyonu ayrıca korumalıdır.

Projector/stage, paylaşım, tünel, kumanda sunucusu, STT, bulut ve güncelleyici kapalıdır. Harici dosyaya kaydetme, dışa aktarma, gerçek kaynak importu ve silme IPC’leri kapalıdır. Görevler için yalnızca uygulamanın ürettiği sabit örnek resim ve İncil dosyası kullanılabilir; dış kaynak yolu kabul edilmez. Yalnızca ayrı profilin preset işlemleri kullanılabilir. Doğrudan mikrofon/ekran yakalama izinleri ve renderer ağ istekleri session katmanında reddedilir. Geliştirmede yalnızca Vite’ın tam host/port’u yükleme için açıktır. Harici pencere ve gezinme reddedilir; yerel kaynaklar alıştırma profiline sınırlıdır.

Pencere başlığı ve beş dilde sabit banner alıştırmayı belirtir. Toolbar’daki çıktı, STT, kumanda ve paylaşım girişleri kaldırılmıştır. Ekran bölümü alıştırmada Faz 3 açıklaması gösterir. Sunum store’una kilit veya setter eklenmemiştir.

## İlerleme

Alıştırma ana süreci `practice-progress.json` dosyasının tek yazıcısıdır. Schema 2, monoton revizyon, altı görevin ve on bölümün durumları bulunur; schema 1 güvenli biçimde taşınır: başlanmadı, devam ediyor, tamamlandı, atlandı. Geçici dosya, flush ve atomik rename kullanılır. Bozuk/bilinmeyen kayıt değiştirilmez; yazma hatası başarı olarak dönmez.

Renderer’dan tamamlandı durumuna geçiş kabul edilmez. Görev koordinatörü gerçek sunum sonucunu kontrol eder ve tipli işlem sonucu üretir. Kütüphane görevi ana süreçte başarılı preset kaydını bekler; autosave tamamlanma değildir. Oturum ve aktiflik denetimi seri işlem içinde yapılır; duraklatılmış veya eski oturumun sonucu tamamlanma yazamaz.

Ana uygulama sabit dosyayı salt okunur IPC ile okur. Ayarlar açılışı, odak dönüşü ve görünür liste için iki saniyelik yenileme vardır. Okuma hatasında son geçerli görünüm ve hata bilgisi korunur. Devam eden iş yeniden açılışta tamamlandı sayılmaz; Ayarlar devam girişini gösterir. Altı görev çalışır durumdadır. Takvim, Editör ve Ayarlar için görev uydurulmamıştır; İlahiler sonraki teslim, Ekran Faz 3 olarak işaretlidir.

## Devam/vazgeç ölçütleri

Teknik doğrulama bütçesi en fazla 12 mühendislik saatidir. Bu teslimde görev motoru kurulmadan başlangıç/yol, yetki ve ilerleme/çökme kapıları sınanır. Bir koşul başarısızsa görev teslimine başlanmaz; ek maliyet raporlanır. Süre kendiliğinden uzatılmaz ve ayrı pencere mimarisine otomatik geçilmez.

| Ölçüt | Son doğrulama |
|---|---|
| Typecheck, hedefli lint, 13 saf/AST testi | Geçti |
| Mevcut 8 geliştirme Electron akışı | Geçti |
| Gerçek paketlenmiş smoke ve 4 alıştırma kabul akışı | Geçti — 5 paketlenmiş akış |
| Mikrofon/ağ, doğrudan IPC çıktı yasağı, tek yazıcı, ilerleme ve çökme | Geçti — doğrudan IPC, izin sorgusu, erişilebilir ağ fixture’ı, gerçek main PID kaybı ve yeniden açılış |

Testler uygulamanın oluşturduğu smoke alanını kullanır; harici profil bayrağı yoktur. İlk test denemesinde Windows’un APPDATA değişkeniyle profil yolunu değiştirmediği yakalandı ve fixture bunun üzerine güvenli smoke alt süreç tasarımına geçirildi. Normal kullanıcı profiline görev veya sunum işlemi yapılmadı.

Paketlenmiş Windows başlatıcısının PID’si gerçek Electron ana süreç PID’sinden farklıdır. Önceki spike’ın başlatıcıyı sonlandıran denemesi ana süreç çökmesini kanıtlamıyordu; son test gerçek `process.pid` değerini sonlandırır. Renderer kaybında yeni pencere önce oluşturulur ve eski pencere kaldırılır; geçerli ilerleme korunur. Canlı çıktı hâlâ yasaktır ve bu sonuç Faz 3 çıktı gözetim kapısını geçmiş sayılmaz.

12 saatlik teknik doğrulama sınırı aşılmadan bu Windows ön kapısı geçti. Düşük riskli görev yönergeleri ve görev motoru sonraki kullanıcı isteğiyle ayrı teslim olarak eklendi.

Fiziksel Windows DPI, NSIS kurulum/yükseltme ve macOS çalışma zamanı kontrolleri bu yerel Windows doğrulamasının parçası değildir.

## Release davranışı

Paketlenmiş duman testi ilk üç yayın için bilgi amaçlıdır: başarısızlık tek başına yayını durdurmaz, workflow özeti ve hata artefaktları korunur. Üç yayının ardından engelleyiciye geçiş ayrıca kullanıcı onayı gerektirir; otomatik geçiş yoktur. Typecheck, hedefli lint, AST ve geliştirme Electron testleri engelleyicidir.

Canlı çıktı görevi için sahiplik/gözetim kapısı ve uzak komut politikası Faz 3’te ayrıca seçilecektir. Kapı geçmezse ana uygulamada salt okunur açıklama sunulacaktır.
