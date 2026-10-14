# Birleşik öğrenme rehberi — on bölüm

Ana uygulamada Ayarlar → Yardım → Adım adım öğren, ayrı alıştırma penceresini açar. Bağımsız görev seçim listesi kaldırıldı. Rehber, on bölümü tek sırada dolaşır. Altı gerçek alıştırma vardır; bağımsız görev seçimi gerektirmez.

## Akış

Karşılama → Sunumlar tanıtımı → sidebar tanıtımı → kullanıcının Slaytlar düğmesine tıklaması → yeni metin slaytı eklemesi → ayrı örneği seçmesi → Delete ile silmesi → İncil kaynağını import et, Genesis 1:1 seç ve ekle → örnek medyayı import et ve ekle → İlahiler tanıtımı → iki dakikalık geri sayımı hazırla ve ekle → Ekran, Takvim, Editör ve Ayarlar tanıtımları → Sunumlar’a dön ve alıştırma kitaplığına kaydet → bitiş.

Anlatım adımlarında Devam vardır. İşlem adımlarında Devam yoktur; gerçek sekme değişimi, slayt oluşması, tek seçim veya değiştirilmemiş örneğin silinmesi beklenir. Alıştırmaya özel silme düğmesi eklenmemiştir. Gerçek uygulamanın tek slayt silme yolu öğretilir. Diğer slaytların kaybolması başarı değildir.

Duraklat ve Esc ilerlemeyi kaydedip rehberi duraklatır; pencere açık kalır. Alıştırmayı kapat ve pencerenin X düğmesi bekleyen gözlemleri sonuçlandırıp güncel sunum/adımı kaydeder, sonra yalnızca alıştırma sürecini kapatır. Kaydetme hatasında pencere açık kalır ve tekrar deneme sunulur. Başlangıçta X isteği renderer dinleyicisi kurulana kadar bekletilir; kayıt yükleme/duraklatma tamamlandıktan sonra doğru oturum kimliğiyle kapanır. Başlangıç duraklatması hata verse de okunan çalışma korunur ve kapanış tekrar denenebilir. Canlı projeksiyona ilişkin normal uygulama çıkış uyarısı alıştırmada gösterilmez. Örnek veya kullanıcının eklediği slaytlar otomatik silinmez. Hedef beş saniyede hazır olmazsa bekleme, on saniyede tekrar deneme/atlama/çıkış sunulur. İşlemde 30 saniye etkin ve görünür süre ilerleme olmazsa Takıldın mı yardımı çıkar. Atlama başarı sayılmaz. Duraklatılmış ekrandaki Bölüme geç on bölümün başlangıcını seçtirir; ara işlem adımları doğrudan seçilemez. Seçimden sonra Devam et ile rehber açılır. İleri geçiş yapılmayan işlemleri atlandı kaydeder; geri dönüş eski sonuçları ve slaytları korur.

İlahiler, Ekran, Takvim, Editör ve Ayarlar kartları açıkça yalnızca tanıtım yapıldığını, uygulamalı görev bulunmadığını belirtir. Ekran kaynağı seçilmez, yayın açılmaz, editör taslağı değiştirilmez. Kitap/bölüm/ayet seçimi ve örnek medya kütüphanesi yalnızca alıştırma profilinde korunur. Geçici menüler yeniden açılışta tetikleyiciye dönerek hazırlanır; yeni işlem sonucu olmadan import tamamlanmış sayılmaz.

Ana uygulamanın Yardım alanında tek Adım adım öğren girişi ve altı alıştırmanın salt okunur ilerleme özeti vardır. Bölüm haritası, kısa tur, mini tanıtım ve otomatik öneri host’u üretim uygulamasından kaldırılmıştır. Cheatsheet klavye referansı olarak korunur; öğrenme bağlantısı ayrı alıştırmayı açar.

Alıştırma açıldığında beş dil kendi adlarıyla sunulur. Son alıştırma dili seçilidir; kullanıcı Başla veya Kaldığın yerden devam et demeden rehber başlamaz. Dil hemen çevrilir ve yalnızca alıştırma profilinde saklanır.

Baştan başla başlangıç, duraklatma ve bitiş ekranlarında bulunur. Onay sonrası mevcut sunum, rehber ve sonuçlar alıştırma profilindeki practice-archives klasöründe tarihli, değiştirilmeyen kayda alınır. Temiz sunum, yeni çalışma/oturum kimlikleri ve sıfır ilerleme oluşturulur; undo, seçim ve geçici sayfa durumu sıfırlanır. Dil ve kitaplık kayıtları korunur. Arşiv oturumunu devam ettirme arayüzü yoktur.

## İşlem sonrası sonuç ekranları

Altı işlem, gerçek sonuç doğrulandıktan sonra özel sonuç adımında bekler: slayt ekleme, örnek silme, ayet, medya, geri sayım ve kitaplığa kaydetme. Aynı alıştırma penceresinde merkezî, kaydırılabilir ekran gerçek sonucu mevcut SlidePreviewAny ile gösterir. Devam yalnızca bu ekranı onaylayıp sonraki adıma geçer; görevi tamamlayan şey gerçek işlemdir. Import, seçim ve gezinme ayrı başarı ekranı oluşturmaz.

Silmede örneğin tarihsel görünümü açıkça etiketlenir; önceki/sonraki slayt sayısı ve kalanların özeti sunulur. Ayette oluşan slaytların metinleri gösterilir. Kaydetmede gerçek kitaplık kaydının adı, tarihi ve slayt sayısı kullanılır. Önizlemeler statiktir; medya, sayaç veya canlı çıktı çalıştırılmaz. Ekleme sonucu onaylanana kadar silme örneği hazırlanmaz.

Sonuç kanıtı ana süreçte tipli, çalışma/oturum ve kaynak kimlikleriyle oluşturulur. Workspace kanıtı önce atomik yazılır, ilerleme dosyası bundan idempotent olarak güncellenir. Çökme/yeniden açılma aynı sonuç ekranına döner; işlem tekrar yaptırılmaz. Kaydetme isteği önceden kaydedilir; kesintide yalnızca eşleşen gerçek atomik preset dosyası okunur. Bellek cache'i veya henüz yazılmamış geçici dosya başarı kanıtı değildir. Kaydetme sürerken duraklatma başarılı sonucu kaybetmez; ekran duraklatılmış olarak korunur.

Bozuk kanıt başarı görüntüsü üretmez; Tekrar dene, Duraklat ve Kapat kalır. Önizleme render hatası da bu kontrolleri gizlemez. Retry ilk başarısız gözlemi birleştirme tabanı olarak korur; hatadan sonra yapılan düzenlemeler kaybolmaz. Sonuç adımında atlama yoktur; bölüm geçişi ve baştan başlatma mevcut kuralları korur.

## Motor ve etkileşim karşılaştırması

Joyride 3.2.0 yeniden kullanılır: deklaratif run, kontrollü stepIndex, özel kart, portalElement, işlemde blockTargetInteraction=false ve disableFocusTrap=true. İlerlemeyi uygulama koordinatörü; aydınlatma/konumlandırmayı Joyride yönetir. Kütüphane patch’i, ikinci konumlandırma motoru veya yeni window capture dinleyicisi eklenmedi. Rehber yalnızca alıştırmada lazy yüklenir.

Gerçek Electron spike’ı overlay’i inert olmadan ve seçici inert ile karşılaştırdı. Her ikisinde hedef mouse ve Space/Enter ile kullanılabildi. İnert olmayan sürüm diğer düğmeleri erişilebilir DOM’da bırakırken seçici inert bunları devre dışı bıraktı. Seçilen yaklaşım Joyride pointer katmanı + sahipliği izlenen seçici inert + tek merkezi klavye/odak sınırıdır.

İzin verilen hedefin ataları açık tutulur, diğer DOM dallarına inert uygulanır. Portal hedefi de aynı izin kümesine dahildir. Önceki inert değerleri saklanır; cleanup yalnızca kendi değişikliklerini geri alır. Diğer modalın önceden inert yaptığı öğe korunur. Hedef kaybında engeller kaldırılıp kurtarma kartı gösterilir. Recovery durumunda da Esc çalışır.

Spike; StrictMode, hedef değişimi, portal hedef, Tab/Enter/Space, ilgisiz kısayollar, 800×600/resize, hedef kaybı, tekrar açma ve renderer kaybından sonra yeniden açılışı kapsadı. Dört saatlik sınır dolmadan Joyride yönü doğrulandı. Gerçek Base UI İncil menüsü de Enter ile kullanıldı; Esc ve yeniden açılışta portalın yeniden hazırlanması doğrulandı.

## Kalıcılık ve güvenlik

Workspace schema 2 ve rehber sürümü 3, mevcut sunum/checkpoint verisini schema 1’den koruyarak taşır; rehber sürümü, oturum kimliği, adım, duraklama ve atlananları ekler. Eski görev tamamlanmaları yeni rehberi otomatik geçirmez. İlk iki bölümü bitirmiş sürüm-1 rehber İncil girişine taşınır; slayt ekleme/silme tekrar yaptırılmaz. Ana uygulama rehber özetini sabit dosyadan salt okunur okur.

Gözlem ve komutlar sıralanır. Esc, bekleyen sonuç sonrası güncel adımı duraklatır. Resume/jump yeni oturum kimliği üretir; eski sonuçlar reddedilir. Resume önce girişini doğrular. Komut sürerken etkileşim kapalıdır. Yazma hatası başarı göstermez; başarıyla yazılmış son workspace korunur. Sonuç kanıtı yazıldıktan sonra ilerleme yazımı hata verirse eski işlem adımına dönülmez. Gerçek deck, sonuç kaydından önce eski checkpoint ile atomik saklanır; iki dosya arasında çökme olursa devam işlemi gerçek sonucu yeniden kontrol eder ve öğretilen işlemi tekrarlamaz.

Workspace ve ilerleme ortak runId taşır. Eski kayıtlar mevcut sunum/sonuçlar korunarak bu kimliğe bağlanır. Yeniden başlatma, ilerleme yazıcılarıyla aynı özel işlem kuyruğunda çalışır; dayanıklı journal iki kaydı ve arşivi toparlar. Hata halinde eski çalışma geri yüklenir; süreç kaybında başlangıçta journal tamamlanır. Ana uygulama farklı çalışma kimliklerini veya devam eden reseti karışık özet olarak göstermez.

Geciken gözlem yanıtları, gözlem anından sonra yapılan düzenlemeleri koruyarak yalnızca koordinatör değişikliklerini birleştirir. Daha yeni kaydetme bildiriminden önceki metadata yanıtları uygulanmaz.

Normal profil, ayrı alıştırma profili, tek yazıcı ve tüm ana süreç yetki kontrolleri korunur. Canlı çıktı, kumanda, paylaşım, STT, bulut ve güncelleme yasakları devam eder. Renderer kapalı servisleri sorgulamaz. Canlı çıktı gözetimi ve uzak komut politikası Faz 3’tedir.

## Doğrulama ve yayın

Saf testler migration, sıra, gerçek sonuç, atlama, eski oturum, geçersiz resume ve iki dosya arasında çökme sonrası devamı kapsar. Gerçek Electron testleri rehberin on bölümünü, beş dili, 800×600 yerleşimi, klavyeyi, takılma/tekrar denemeyi ve renderer kaybını kapsar. Eski öğrenme yüzeylerinin görünmediği ve tek yardım girişinin alıştırmayı açtığı test edilir. Paketlenmiş testler profil/yetki sınırı, tek yazıcı, bozuk kayıt, gerçek ana süreç kaybı ve rehber akışını kapsar.

Typecheck, hedefli lint, AST capture ve geliştirme Electron testleri engelleyicidir. Paketlenmiş release testleri ilk üç yayında bilgi amaçlı kalır; engelleyiciye geçiş ayrı onay gerektirir. Fiziksel Windows %125/%150 DPI, NSIS kurulum/yükseltme ve macOS çalışma zamanı yerel otomatik doğrulama kapsamında değildir.

## Teslim doğrulaması

- Typecheck ve hedefli lint geçti; yeni dosyalarda hata/uyarı yok.
- 32 saf/AST testi geçti: altı sonuç, doğrulama, migration, bozuk önizleme kanıtı, çift/geç bildirim, ilerleme yazma hatası, kaydetme/duraklatma ve son görevi atlama regresyonları kapsandı.
- 15 geliştirme Electron akışı geçti: sonuç ekranında bekleme, beş dil, renderer kaybı, önizleme hatası ve kaybolan yanıtın ardından Retry/düzenleme koruması kapsandı.
- Teslim executable’ında 7 paketlenmiş akış geçti. Gerçek ana süreç/renderer kaybı, tek yazıcı, doğrudan çıktı IPC yasağı, eski bayraklar ve gerçek rehber akışı kapsandı.
- Beş dil ve 800×600 kart sınırları doğrulandı. Kartın işlem hedefiyle örtüşmediği ayrıca test edildi; ekran görüntüsü incelendi.

Küçük pencerede normal düzenleme çekmecesi hedefi örttüğünden, yalnızca alıştırma işlem adımlarında bu düzen paneli kapatılır. Panelin kendi inert tercihi rehber temizliğinde korunur. Space/Enter, rolü button olan gerçek slayt kartının mevcut click handler’ını etkinleştirir. Komut beklerken Esc kaybolmaz; sonuç alındıktan sonra güncel oturum duraklatılır.

Windows test paketi: `release/guided-learning-check/win-unpacked/Worship Presentation Assistant.exe`.

```powershell
npx electron-builder --win --dir --publish never --config.electronDist=node_modules/electron/dist --config.directories.output=release/guided-learning-check
```

Aynı sabit Electron 43.4.0 runtime’ı kullanıldı. Normal indirme/yeniden adlandırma yolundaki yerel Windows EPERM sorunu nedeniyle çalışma alanındaki runtime seçildi; genel paketleme yapılandırması değiştirilmedi. Testler uygulamanın ürettiği izole smoke profillerinde çalıştı.

## Örnek görsel yükleme düzeltmesi

SVG kaynak önizlemesi ve slaytların doğrudan file:// yüklemesi CSP tarafından engelleniyordu. Kaynak SVG kartı ve ortak görsel önizlemeleri mevcut local-resource medya protokolünü kullanır. Mevcut workspace, sonuç ekranı ve kitaplık URL kayıtları değiştirilmez; eski file:// adresleri gösterim sırasında çözülür. CSP ve alıştırma profil sınırı gevşetilmez. Electron ve Windows paketinde gerçek naturalWidth/naturalHeight kontrolü, slayt kartı ve media-result yeniden açılışı doğrulandı.

## Örnek ilahi alıştırması

İlahiler artık yalnızca tanıtım değildir. Ayrı alıştırma profilinde beş dilde özgün kısa bir örnek hazır bulunur. Kullanıcı gerçek ilahi satırına tıklar; yalnızca örnek başlığı ve sözleriyle eşleşen yeni slayt ana süreçte doğrulandığında hymns-result ekranı açılır. Devam sonrası Geri Sayım bölümüne geçilir. Dış arşiv, ağ veya canlı çıktı yetkisi eklenmedi. Mevcut ilerleme korunur; ilerideki/biten rehber kendi kendine geriye alınmaz. Bu ekleme için kullanıcının isteğiyle test, build ve paketleme çalıştırılmadı.

## Görsel editörü ve ilahi parçaları

Medya sonucu sonrasında kullanıcı kendi eklediği örnek görseli seçer; sağ editörde İçine sığdır ve %100 gri tonlama uygular. Başarı yalnızca bu örneğin gerçek stil değerleriyle doğrulanır, diğer slaytlar korunur. İlahiler normal/parça modunu açıklayan metinle başlar. İki kıtalı özgün örnek parça modunda eklenir; sonuç onayından sonra sağdaki parça paneli salt okunur aydınlatılır. Parça geçişi yalnızca metinle açıklanır; kullanıcıdan parça değiştirmesi beklenmez. Kullanıcının isteğiyle bu ekleme için test/build/paketleme çalıştırılmadı.

## Sıralama, iki silme yöntemi ve düzenleme açıklamaları

Slayt ekleme sonucunun ardından tek sürükle-bırak alıştırması gelir. Rehberin hazırladığı örnek ile yeni eklenen slayt kullanılabilir; diğer kartlar inert kalır. Aynı slayt kimlikleri korunup örneğin gerçek sırası değişince ilerlenir. Bu örnek sonraki silme alıştırmasında yeniden kullanılır; ek bir kalıcı slayt bırakılmaz. Silme adımında gerçek sağ panel çöp kutusu aydınlatılır, Delete de kabul edilir. Doğrulanmış silme hemen İncil gezinmesine geçer; eski delete-result kayıtları da bu konuma taşınır ve görünür adım sayısına katılmaz.

İncil girişinde yerel XML ve çevrimiçi kaynak arama açıklanır. İlahi parçalarından sonra sağ panelde yazı boyutu alanı salt okunur gösterilir. Görsel düzenleme iki basit işlemle sınırlıdır: içine sığdırma ve gri tonlama. Öncesinde gerçek kalem düğmesi üzerinden sağ panel ve ayrıntılı Slayt Editör ayrımı, video düzenleme desteği açıklanır. Metinler beş dile eklenmiştir.

Kullanıcının isteğiyle bu değişiklikler için test, lint, typecheck, build veya paketleme çalıştırılmadı. Önceki doğrulama sonuçları ve executable bu son değişiklikleri kapsamıyor.

## Küçük ekran gri tonlama ve takılma yardımı

Gerçek Electron 43.4.0 penceresinde izole profillerle 1366×768, 1024×768 ve 800×600 boyutları doğrulandı (istemci alanları 1350×729, 1008×729, 784×561). Gri tonlama kontrolü görünür, inert dışında ve rehber kartıyla örtüşmüyor. İlk ölçümde alt kenara çok yakın olduğundan bu hedef için scrollIntoView center kullanıldı. Laptop boyutunda fareyle, diğer boyutlarda End tuşuyla gerçek %100 gri tonlama sonucu doğrulandı. 800×600’de gerçek 30 saniyelik aktif bekleme sonrası yardım, ayrı ve boşluklu düğmeler, hedefi yeniden göster ve ardından tamamlanma doğrulandı.

Yardım metni beş dilde yeniden deneme ve açık atlamayı anlatır; atlanan adım tamamlanmış sayılmaz. Düğmelerin çerçevesi, hover ve klavye focus stilleri vardır. Güncel Vite build başarılı; tam regresyon paketi, paketlenmiş executable ve fiziksel Windows DPI bu hedefli kontrolde çalıştırılmadı.

## Ayarlar: kategoriler ve arama

Ayarlar artık Genel, Sunum, İlahi ve logo, Altyazı ve çeviri, Otomatik kayıt, Güncellemeler, Nasıl Kullanılır? kategorilerine ayrılır. 840 px eşik Ayarlar kapsayıcısının genişliğine uygulanır; geniş alanda 200 px yan menü, dar alanda seçici vardır. Başlık/arama sabit, içerik kaydırılabilirdir. Son kategori yalnızca renderer oturumunda tutulur. Panel değişimleri gizleme ile yapılır; API anahtarı taslağı ve filigran panel durumu korunur.

Tipli ayar tanımı arama ve odak hedeflerini birleştirir. Beş dilde statik ad/açıklama/eş anlamlılar aramada kullanılır; kullanıcı değerleri, anahtarlar ve kayıt adları indekslenmez. Sonuç seçimi ilgili bölüme gider ve kullanılabilir kontrolü odaklar. Gizli paneller ekran okuyucu ve klavye erişimine kapalıdır. Mevcut ayar işlemleri ve IPC/depolama sözleşmeleri değişmez.

Kaynak kodu incelemesi yapıldı; kullanıcı talebiyle test/lint/typecheck/build/uygulama açma yapılmadı. Manuel kabul: 800×600 / 1024×768 / 1366×768 düzeni; kategori değişiminde API taslağı; beş dilde aksan/büyük-küçük harf araması, sonuç odağı, temizleme/Esc, bulunamayan sonuç; gizli panel Tab erişimi; eski ayar kontrollerinin çalışması ve alıştırma Ayarlar hedefi.
