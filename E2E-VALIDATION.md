# Fallow sonrası doğrulama — 17 Ekim 2026

Bu aşama yeni özellik veya mimari refaktör içermez. Çalışma öncesi dosyalar `.tmp/e2e-before` altında karşılaştırma için saklandı. Mevcut kullanıcı değişiklikleri korundu; dosya/bağımlılık silinmedi, commit/push/yayın yapılmadı. Konuşma takibi ve canlı projeksiyon kodu değiştirilmedi.

## Başlangıçtaki 13 başarısız testin değerlendirmesi

| Test | Sınıflandırma ve kanıt | Uygulanan düzeltme |
|---|---|---|
| guided: startup language / archived fresh restart | Eski beklenti. `practiceWorkspace.advance` editör bölümüne girerken `practice-editor-*` öğeli gerçek bir örnek ekliyor. Bölümler gezilmeden alınan deck, yeniden başlatma öncesindeki deck değil. | Arşivi yeniden başlatmanın hemen öncesindeki tam deck ile karşılaştır; örneğin gerçekten eklendiğini de doğrula. |
| guided: startup pause failure | Hazırlık yarışı. Çökme sonrası yeni BrowserWindow olayı renderer ve lazy PracticeRunner hazır olmadan geliyor; hata snapshot'ı yalnızca Loading gösteriyordu. Hazır renderer ve yüklenmiş doğru rehber adımı beklendiğinde enjekte edilen pause hatası ve başarılı kapatma yeniden denemesi doğrulandı. | Önce test köprüsünün ve eski rehber adımının hazır olmasını bekle; ardından alert, aynı deck kimliği ve diskte paused kayıt kontrolünü koru. Uygulamanın hata zamanlaması değiştirilmedi. |
| guided: first two sections / five languages | Gerçek yerleşim hatası + eski akış. 800×600 pencerenin 784×561 içerik alanında kart x=16..336, ekleme düğmesi x=318.66..537.33 idi: çakışma ölçülerek doğrulandı. Reorder adımı da testte atlanmıştı. | Kartı uygun yan boşluğa daralt; yer yoksa yüksekliği boş alana sınırlayıp içeriği kaydır. Reorder gerçek drag/drop ile tamamlanır. Beş dilde ekran sınırı ve çakışmama kontrolleri, tuş engelleme, seçim, pause/resume ve gerçek silme korunur. |
| guided: inactivity / crash resume | Eski beklenti. Add-result sonrasında `guideSteps` reorder'a gider. | Gerçek reorder ve tamamlanmış sonuç kanıtından sonra çökme/devam; aynı örnek kimliği ve deck uzunluğu kontrol edilir. |
| guided: result Continue / renderer loss | Eski beklenti ve başlangıç yarışı. Continue yeni reorder örneğini oluşturur. Yeni pencere olayı sırasında rehber hâlâ Loading durumunda olabilir. | Yüklenmiş add-result adımını bekle; ardından Resume ve hata/kurtarma kontrollerini uygula. Reorder ve tek ek örnek beklenir; beklerken değişmeme, bozuk preview'dan kurtarma ve aynı kayıt kanıtları korunur. |
| guided: committed result / failed acknowledgement | Eski sonraki-adım beklentisi. IPC sonucu diske commit edildikten sonra yanıt kaybı enjekte edilince retry sonucu doğru yüklüyor; Continue reorder'a ilerliyor. | Sonraki adımı reorder olarak doğrula; tek ek slayt, active=null ve Retry öncesi isim değişikliğinin korunmasını kontrol et. |
| guided: resumed Bible imports | Gerçek hata. Kitap seçimi ilk bölümü zaten açıyor; açık bölüm düğmesinin handler'ı hiçbir şey yapmadığından `chapterChosen` false kalıyor. | Aynı bölüm düğmesine açıkça basıldığında da `chapterChosen=true` yap. E2E önce düğmenin zaten `aria-current=true` olduğunu, sonra verse adımına ilerlediğini ve reload sonrası ayet seçiminin korunduğunu doğrular. |
| guided: remaining sections | Eski akış + tam akışın ortaya çıkardığı gerçek hatalar. Image-tools, ilahi açıklamaları, gerçek canvas görevi ve phone-controls atlanmıştı. Geniş ilahi satırı kart tarafından kapatılıyor; editör inspector'ı açık görünmesine rağmen inert kalıyordu. | Tüm adımları gerçek UI ile tamamla; tüm 10 exercise sonucunu doğrula. Yerleşim düzeltmesi geniş satırı da korur. Editörün doğrudan inert yazması mevcut `setComponentInert` ile değiştirilerek lease'in eski kapalı durumunu geri getirmesi önlenir. |
| tour: normal help | Eski Settings beklentisi. Öğrenme kontrolleri ayrı learning kategorisinde; artık iki navigation landmark var. | Görünür kategori seçicisini veya kategori düğmesini kullan; ana navigation locator'ını uygulama kabuğuyla sınırla. Tek yardım girişi, otomatik yüzey olmaması ve iki practice açma yolu korunur. |
| packaged: single help entry | Aynı eski kategori beklentisi. | Learning kategorisini gerçek UI ile aç; paketli uygulamada test köprüsü bulunmaması ve otomatik tur olmaması kontrollerini koru. |
| packaged: language / chapters / saved close | Locator artık iki nav eşleştiriyor. | Ana navigation'ı sınırla; dil izolasyonu, 10 bölüm, arşiv, fresh run ve saved close kontrollerini koru. |
| packaged: single writer / readonly progress / corruption | Eski ilerleme kartı beklentisi. `git show HEAD:src/renderer/components/PracticePanel.tsx` mevcut dosyayla aynı: yalnızca açma düğmesi var; ilerleme kartı ve renderer progress tüketicisi yok. | Yeni UI eklenmedi. Salt okunur IPC'den doğru checkpoint/tamamlanma, okuma öncesi/sonrası aynı dosya baytları, bozuk kayıtta `{ok:false,error:'unreadable'}`, korunmuş workspace ve değiştirilmemiş bozuk dosya doğrulanır. Çoklu yazıcı ve crash-resume kontrolleri korunur. |
| packaged: full ten-section learning | Eski reorder/delete-result/editor/phone-controls akışı; 8 yerine artık 10 exercise sonucu var. Eski guide-results kartı HEAD'de de yok. | Aynı gerçek UI akışı, on exercise'ın API üzerinden tamamlanması ve reset sonrası tam boş exercises nesnesi doğrulanır. Deck sayısı eklenen canvas örneğiyle uzlaştırılır; kimlik, kalıcılık, normal profil ve sıfır skipped kontrolleri korunur. |

Testler devre dışı bırakılmadı; zorla tıklama, sonuç koşullarını kaldırma veya genel retry eklenmedi. Editör input'unda inert kaldırılmasını ve gerçek klavye odağını bekleme, görünür fakat kullanılamayan alanı atlamayı önler.

## Worker teardown timeout

Önceki çıktıdaki worker, Playwright test worker'ıdır; utility/heavyWorker için bu stack'ten hata sonucu çıkarılamaz. Playwright `coreBundle.js` Electron close handler'ı `app.quit()` çağırır ve uygulama kapanışını bekler. Practice penceresi, kayıt tamamlanana kadar native kapanışı kasıtlı olarak durdurur. Enjekte edilmiş pause kayıt hatası korunursa `app.close()` tamamlanmaz.

Önceki tek timeout olayının bütün ara durumlarına ait runtime dump yok; onun birebir aynı tetikleyiciden kaynaklandığı iddia edilmiyor. Sınırsız kapanış beklemesi ve Windows'ta profil kilidi bırakan süreç ağacı sorunu bu çalışmada kontrollü olarak yeniden üretildi.

Ek negatif Electron E2E testi bu durumu bilerek üretir. Yeni fixture normal kapanışı bekler; süre aşılırsa asıl hatayı raporlar ve yalnızca kendisine ait başlatılmış süreci sonlandırır. Windows'ta yalnız üst süreci öldürmek Electron alt süreçlerini açık bırakıp geçici profil lockfile'ını kilitleyebildiği için süreç ağacı `/PID ... /T` ile kapatılır. Kapanış sonrası son bekleme de süreyle sınırlıdır. Başarılı testlerin teardown hatası hâlâ test hatasıdır; sessizce yutulmaz. Native X ile zaten kapanmış uygulamanın Playwright process nesnesine tekrar erişilmez.

Dört bağımsız fixture regresyon testi normal kapanışı, zaten kapanmış uygulamayı, sonlandırmadan sonra bile çözülmeyen close promise'inin sınırlı kalmasını ve sinyalle zaten kapanmış bir sürecin PID'sine tekrar işlem yapılmamasını doğrular.

## Son doğrulama sonuçları

| Kontrol | Sonuç |
|---|---|
| Kaynak Electron E2E, bütün yapılandırılmış gruplar | **33/33 geçti**, 3,4 dakika |
| Güncel Windows unpacked paket E2E | **7/7 geçti**, 43,4 saniye |
| Bütün birim/kontrol testleri | **398/398 geçti**, 0 skipped: 392 src + 2 capture + 4 teardown |
| TypeScript `--noEmit --incremental false` | **Geçti**, çıkış kodu 0 |
| Son Vite renderer/main/preload üretim derlemesi | **Geçti**, çıkış kodu 0 |
| Windows unpacked paket oluşturma | **Geçti**, yayın kapalı |
| Güncel native heavyWorker smoke | **19/19 geçti**, crash/respawn dahil |
| Değişen E2E/fixture dosyaları ve PracticeSpotlight ESLint | **Geçti** |

Başlangıçtaki 13 başarısız E2E testi son tam çalıştırmalarda geçti. Beklenmeyen worker teardown timeout kalmadı. Negatif teardown testindeki 1000 ms kapanış hatası kasıtlıdır; test bu hatanın korunmasını ve süreç ağacının temizlenmesini doğrulayarak geçer. İlk ara çalıştırmalardaki EBUSY ve Loading yarışı giderilmeden sonuç başarılı sayılmadı.

Bağımsız salt okunur inceleme; uygulama düzeltmelerini çalışma öncesi snapshot'larla, test beklentilerini mevcut UI/API ile karşılaştırdı. İncelemede bulunan sınırsız son kapanış beklemesi ve sinyalle kapanmış PID'nin tekrar hedeflenmesi sorunları düzeltildi ve test edildi. Açık önemli inceleme bulgusu veya doğrulamayı engelleyen sorun kalmadı.

Çalıştırma kayıtları:

- `.tmp/e2e-source.log`: varsayılan Playwright yapılandırmasındaki bütün kaynak Electron E2E testleri.
- `.tmp/e2e-packaged.log`: yeni `.tmp/fallow-package/win-unpacked/Worship Presentation Assistant.exe` üzerinde paketli E2E.
- `.tmp/e2e-unit.log`, `.tmp/e2e-typescript.log`, `.tmp/e2e-build.log`: son birim test, TypeScript ve üretim derlemesi.
- `.tmp/e2e-worker.stdout.log`: güncel heavyWorker smoke çıktısı.
- `test-results/packaged-tour/packaged-guided-learning-t-26ea0-sh-and-retained-normal-data/guide-add-800x600.png`: hedefi kapatmayan kart; görüntü ayrıca görsel olarak incelendi.

Kaynak E2E için `node node_modules/@playwright/test/cli.js test`, paketli E2E için `WPA_PACKAGED_EXE` yerel exe'ye ayarlanarak `--config playwright.packaged.config.cjs` kullanılır. Birim test kapsamı tüm `src/**/*.test.{ts,cjs}`, `scripts/check-tour-capture.test.cjs` ve `tests/tour/teardown.test.cjs` dosyalarıdır. Üretim çıktısı `node node_modules/vite/bin/vite.js build` ile, yerel paket `electron-builder --dir --publish never` ile hazırlandı; mevcut Electron dağıtımı kullanıldı ve native rebuild yapılmadı.

## Fallow karşılaştırması ve sınırlar

Fallow 3.33.1, salt analiz; telemetry/hook/fix etkinleştirilmedi. Ham JSON kanıtları `.tmp/e2e-fallow-{dead,source,dupes,health}.json` dosyalarında.

| Ölçüm | İlk analiz | İyileştirme sonrası | Bu doğrulama sonunda |
|---|---:|---:|---:|
| Runtime import döngüsü | 1 | 0 | 0 |
| Mild tekrar grubu | 56 | 52 | 52 |
| Mild tekrar oranı | %2,47 | %2,09 | %2,07 |
| observeGuide cyclomatic / cognitive | 106 / 66 | 46 / 36 | 46 / 36 |
| handleKeyDown cyclomatic / cognitive | 88 / 66 | 29 / 16 | 29 / 16 |
| Bildirilmemiş bağımlılık | 3 ham aday | 0 | 0 |
| Yapılandırılmış boundary ihlali | Kurallar yoktu | 0 | 0 |

Dosya/giriş noktası kapsamı değiştiği için ham unused sayıları veya tekrar yüzdesindeki farklar silinen kod miktarı değildir. Kaynak lensinde 8 atıl aday hâlâ korunuyor. Kök taramada 37 ham bulgu / 9 unused file var; Electron bootstrap dosyası `electron.launch(args)` ile, yeni teardown testi ise açık Node test komutuyla çalıştırıldığından statik unused bulguları yanlış pozitiftir. Kaynak lensindeki `renderer/index.html` → `/src/renderer/main.tsx` unresolved bulgusu, `src` analiz kökü ile Vite proje kökü farkından kaynaklanır; kök analizde unresolved=0. Otomatik suppression veya silme uygulanmadı.

Geniş bileşenlerin karmaşıklığı, özellikle SlideEditor 90/172, devam ediyor. Yerleşim middleware'i de 21/16 eşiğine ulaşıyor; bu görevde yeni bir mimari refaktör başlatılmadı. 800×600 ve mevcut test senaryoları doğrulanır; her olası ekran ölçüsü/font kombinasyonu için garanti verilmez. Çok dar kullanılabilir alanlarda minimum kart yüksekliği sınırı vardır. Gerçek runtime coverage ve type-aware companion kullanılmadı.

Vite'ın CJS API/büyük chunk uyarıları ve önceden raporlanan tam proje lint sorunları ayrı kalır. Sıfırdan `npm ci`, macOS ve kurulum paketi çalıştırılmadı; Windows unpacked uygulama doğrulandı. `mediabunny` paketleme şekli ve native bağımlılıkların yerleşimi değiştirilmedi.
