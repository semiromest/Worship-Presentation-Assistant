# Fallow iyileştirmeleri — 17 Ekim 2026

Mevcut çalışma ağacındaki kullanıcı değişiklikleri korunarak uygulandı. Silme adayı dosyalar ve paketler kaldırılmadı. Commit, push veya yayın yapılmadı.

## Uygulanan değişiklikler

- Preview delta IPC girdileri yalnızca son tam snapshot içindeki sonlu, negatif olmayan tam sayı indeksleri kabul ediyor. Deltalar diziyi büyütemiyor.
- Ortak `ElectronAPI` sözleşmesi eklendi, renderer'daki açık uçlu index signature kaldırıldı. Preload yüzeyi bu sözleşmeye göre kontrol ediliyor. Invoke kanallarının main kayıtlarıyla eşleşmesi ve abonelik temizliği test ediliyor.
- Main ve preload performans tamponları ayrı API'lerle okunuyor ve sıfırlanıyor. Mevcut `getPerfSnapshot` preload alias'ı uyumluluk için korunuyor. Tek yönlü IPC gönderimleri senkron kalıyor.
- Practice doğrulayıcıları `practiceValidation.ts` içine taşındı; workspace/reset import döngüsü kaldırıldı. Gözleme dayalı rehber geçişleri `practiceTransitions.ts` içine çıkarıldı. Kalıcı kayıt sürümleri değiştirilmedi.
- Ana Zustand store'u presentation, preferences, media ve UI slice'larına ayrıldı. Aynı dış API, ortak no-op kontrolü, selector middleware'i ve atomik seçim/canlı yayın güncellemeleri korunuyor.
- Klavye komut çözümleme DOM hook'undan ayrıldı; editöre ait tuşların korunması ve operatör kısayolları test ediliyor.
- Canvas contain/cover, metin sarma, tipografi ve satır yerleşimi saf ortak modüle taşındı. Tarayıcı ve native canvas adaptörleri ayrı kaldı.
- Paylaşım servislerinin token oluşturma/doğrulama ve URL ayrıştırma yardımcıları ortaklaştırıldı; heartbeat ve yavaş istemci politikaları korunuyor.
- Editör kontrol bileşenleri, Scripture satırları ve Scripture indeksleme yaşam döngüsü ayrı modüllere çıkarıldı.
- Taşınabilir sunum/video/gradient tipleri shared katmanına alındı. Eski renderer tip yolları compatibility export'larıyla çalışmaya devam ediyor. `Hymn` tek tanım üzerinden kullanılıyor.
- `esbuild` ve `google-auth-library`, mevcut lockfile sürümleriyle doğrudan devDependency olarak bildirildi; npm lockfile doğrulaması geçti. Native ws yardımcıları, FFmpeg ve mediabunny yerleşimi korundu.
- Eski test beklentileri yeni reorder, phone-controls/nav-save, gizlenmiş delete-result ve boş kaynak bölüm davranışlarıyla uzlaştırıldı. Beş dilde eksik canvas alıştırması açıklaması tamamlandı.
- Geniş birim testlerinde yakalanan aynı milisaniyeli altyazı kayıtlarının kimliğe göre yanlış sıralanması giderildi. Sesin mute testleri, throttling'i ölçmedikleri için açıkça cooldownMs:0 kullanıyor.

## Fallow yapılandırması ve ölçümler

Fallow 3.33.1 kullanıldı; telemetry, hook veya otomatik fix etkinleştirilmedi.

- `.fallowrc.json`: uygulama/worker/preload girişleri, CJS test ve manuel araç girişleri, advisory katman kuralları.
- `.fallowrc.source.json`: `src` kökü üzerinden kaynak erişilebilirliği. Böylece Electron eklentisinin bütün main dosyalarını giriş kabul etmesi atıl modülleri gizlemiyor.
- Shared ve main katmanlarından renderer'a tip import'u da boundary kurallarıyla raporlanıyor; mevcut model tipleri taşındığından bu istisnaya ihtiyaç kalmadı.

| Ölçüm | Önce | Sonra |
|---|---:|---:|
| Import döngüsü | 1 | 0 |
| Mild tekrar grubu | 56 | 52 |
| Mild tekrar oranı | %2,47 | %2,09 |
| observeGuide cyclomatic / cognitive | 106 / 66 | 46 / 36 |
| handleKeyDown cyclomatic / cognitive | 88 / 66 | 29 / 16 |

Son kaynak taramasında 8 erişilemeyen dosya kaldı: localtunnelService, beş eski Tour arayüz dosyası, snapUtils ve scale. Dosyalar korundu. Bildirilmemiş bağımlılık ve boundary ihlali sayısı sıfır. Ham unused sayılarındaki düşüşün bir kısmı giriş noktası ve dosya-içi kullanım ayarlarının düzeltilmesinden kaynaklanıyor; silinen kod miktarı olarak yorumlanmamalı.

Tekrarlanabilir komutlar:

```text
npm run analyze:fallow
npm run analyze:source
npm run test:architecture
node node_modules/typescript/bin/tsc --noEmit --incremental false
```

Analiz scriptleri Fallow sürümünü sabitler; ilk çalıştırmada npm önbelleğine indirme gerekebilir. Issue bulunan analizlerin 1 çıkış kodu normaldir.

## İlk uygulama aşamasındaki doğrulama

Bu bölüm ilk çalıştırmaların tarihsel sonucudur. Aşağıdaki E2E başarısızlıkları sonraki doğrulama aşamasında çözüldü; güncel sonuçlar belgenin sonundadır.

| Kontrol | Sonuç |
|---|---|
| Tüm src birim testleri | 392 geçti, 0 başarısız |
| TypeScript, incremental kapalı | Geçti |
| Yeni modüllerde ESLint | Geçti |
| Vite renderer/main/preload üretim build'i | Geçti |
| Windows unpacked paket oluşturma | Geçti |
| UtilityProcess smoke: gpres, PPTX round-trip, crash/respawn | 19/19 geçti |
| Eski/yeni native worker raster karşılaştırması | 27/27 görüntü birebir aynı |
| Preparation / recent-features / transitions Electron E2E | 11/11 geçti |
| Guided / Tour Electron E2E | 6 geçti, 9 başarısız; ayrıca worker teardown timeout |
| Paketli uygulama E2E | 3 geçti, 4 başarısız |

Paket `.tmp/fallow-package/win-unpacked` içinde üretildi; mevcut yerel Electron dağıtımı kullanıldı ve native rebuild çalıştırılmadı. Bu, sıfırdan npm ci kurulumu veya macOS doğrulaması değildir. `mediabunny` üretim renderer bundle'ına dahil edildi.

Geniş E2E grupları tamamen yeşil değil. Kaynak karşılaştırması; reorder adımını atlayan, editörün eklediği örneği arşivden dışlayan, Settings öğrenme kategorisini açmadan kontrol arayan ve iki navigation alanını tek locator ile seçen eski beklentiler gösteriyor. Tam rehber yardımcı akışı da yeni canvas ve phone-controls adımlarını kapsamıyor. Bu E2E testleri bu değişiklikte topluca güncellenmedi.

Ayrıca 800×600'de rehber kartının Add New Slide ile çakışması, başlangıç recovery/alert zamanlaması ve devam ettirilen Bible chapter adımında ilerlememe gözlendi. Refaktörün bunları oluşturduğuna dair kanıt yok; kök nedenleri bu çalışma kapsamında doğrulanmadı. Hata çıktıları `test-results/tour` ve `test-results/packaged-tour` altında.

Mevcut büyük dosyalarda önceden bulunan lint hataları da devam ediyor; tam proje lint'inin geçtiği iddia edilmiyor. Yeni Scripture indeks hook'unun setter bağımlılıkları eklendi. Build, CJS Vite API ve büyük chunk uyarıları veriyor.

## İnceleme ve kalan iş

Bağımsız, salt okunur kod incelemesi çalışma öncesi dosya snapshot'larıyla karşılaştırıldı; somut bir refaktör regresyonu bulunmadı. GitNexus etki sorgusu veritabanı sürüm uyuşmazlığı nedeniyle kullanılamadı; Fallow grafiği, kaynak referansları ve davranış testleri kullanıldı.

Silme adayları için ayrı karar, eski E2E akışlarının güncellenmesi ve gözlenen rehber yerleşim/kurtarma sorunlarının kök neden analizi hâlâ gerekiyor. Type-aware ve gerçek çalışma zamanı coverage kanıtı olmadan kullanılmayan adaylar için kesin silme kararı verilmedi.

Store bölümü [Zustand'ın resmi slice düzenini](https://zustand.docs.pmnd.rs/learn/guides/slices-pattern.html) izler; middleware yalnızca birleşik store'a uygulanır.

## Son doğrulama — 17 Ekim 2026

Başlangıçtaki 13 Electron E2E başarısızlığı tek tek incelendi. Güncel kaynak testleri **33/33**, yeni Windows unpacked paket testleri **7/7**, birim/kontrol testleri **398/398**, native heavyWorker smoke **19/19** geçti. TypeScript ve son renderer/main/preload üretim derlemesi geçti. Beklenmeyen teardown timeout kalmadı.

Bu aşamada uygulamada yalnızca üç dar hata düzeltildi: açık İncil bölümüne tekrar tıklamanın alıştırmayı ilerletmesi, 800×600 rehber kartının etkileşim hedeflerini kapatmaması ve editör panelinin guide lease altında eski inert durumunda takılmaması. Eski akış/UI beklentileri mevcut davranışla uzlaştırıldı. Teardown beklemeleri sınırlandı; Windows'ta yalnız teste ait süreç ağacı temizleniyor ve gerçek kapanış hatası korunuyor. Konuşma takibi/canlı projeksiyon kodu değiştirilmedi; yeni özellik/refaktör/silme yapılmadı.

Son Fallow ölçümleri: import döngüsü **0**, mild tekrar grubu **52**, oran **%2,07**; önceki ana fonksiyon karmaşıklık kazanımları korundu. Atıl aday dosyalar silinmedi. Ayrıntılı 13-test değerlendirmesi, kanıtlar, çalıştırma kayıtları, yanlış pozitifler ve kalan sınırlar [E2E-VALIDATION.md](E2E-VALIDATION.md) içindedir. İlk teardown olayının tüm ara durumlarına ait runtime dump bulunmadığı için o tek olayın birebir tetikleyicisi hakkında kesin nedensellik iddiası yoktur.
