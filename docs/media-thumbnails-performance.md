# Video küçük resimleri: ölçüm ve doğrulama

2026-10-11, Windows, AMD Ryzen 5 3600 (6 çekirdek).

## Değişiklik

JPEG disk önbelleği artık bulunuyor. FFmpeg keşfi senkron alt süreç yerine oturumda paylaşılan asenkron Promise kullanıyor; bulunamama da önbellekleniyor. Aynı dosya/stat/boyut anahtarındaki istekler ana süreçte birleştiriliyor ve kuyruktan çıkan iş diski yeniden kontrol ediyor. FFmpeg ve atomik yayımlama geçici dosyaları benzersiz; `finally` ile temizleniyor. Windows alt süreçleri gizli.

Renderer görünürlük, iki işlik kuyruk, liste sanallaştırması, 400 px çıktı, %8 kare seçimi ve IPC değiştirilmedi. Yeni LRU, gecikme veya öncelik kuyruğu eklenmedi.

## Yöntem

Gerçek kaynak modülü esbuild ile CommonJS'e dönüştürülüp çalıştırıldı. Yalnızca Electron `app.getPath` izole geçici klasöre yönlendirildi; FFmpeg/FFprobe gerçek sistem alt süreçleriydi. 2 saniyelik, 10 fps MPEG-4 testsrc2 videoları 1920×1080 ve 3840×2160 üretildi. Her çözünürlükte 1, 10 ve 50 farklı dosya yolu test edildi. Her aşama tek başına çalıştırıldı. Sentetik kısa videolar bütün codec ve uzun video yüklerini temsil etmez.

Soğuk önbellek, aynı modülle sıcak önbellek ve aynı disk önbelleğiyle modülü yeniden yükleme ölçüldü. **Yeniden yükleme Electron'u kapatıp açma değildir.** Çıktı görsellerinin renderer'da çözülmesi ölçüme dahil değildir.

Olay döngüsü gecikmesi 10 ms periyotlu zamanlayıcının en büyük sapmasıdır. Duvar süreleri tamamlanma sonrası 20 ms örnekleme penceresi çıkarılarak hesaplanmıştır; özellikle çok kısa sıcak sonuçlar bu zamanlayıcı sapmasını da içerir, hassas mikrobenchmark olarak okunmamalıdır. Her senaryo bir kez ölçüldü; aşağıdaki farklar tekrar üretim ve bloklama için kanıt, istatistiksel hız garantisi değildir.

## 50 video sonuçları

| Çözünürlük / durum | Başlangıç | İlk iki düzeltme | Son sürüm | Başlangıç → son FFmpeg kare üretimi |
|---|---:|---:|---:|---:|
| 1080p / soğuk | 2474 ms | 1871 ms | 2795 ms | 50 → 50 |
| 1080p / sıcak | 2353 ms | 12 ms | 11 ms | 50 → 0 |
| 1080p / yeniden yükleme | 2392 ms | 11 ms | 10 ms | 50 → 0 |
| 4K / soğuk | 6336 ms | 5992 ms | 6518 ms | 50 → 50 |
| 4K / sıcak | 6269 ms | 11 ms | 10 ms | 50 → 0 |
| 4K / yeniden yükleme | 6955 ms | 9 ms | 10 ms | 50 → 0 |

50 videoluk soğuk aşamada FFmpeg keşfi 50 senkron çağrıdan 1 asenkron çağrıya düştü. Sıcak ve yeniden yükleme aşamalarında keşif de üretim de sıfır. 4K soğuk aşamada en büyük olay döngüsü sapması 255 ms → 36 ms; sıcak aşamada 150 ms → 5 ms. 1080p soğuk aşamada 95 ms → 78 ms. Eşzamanlı asenkron alt süreç üst sınırı 6 olarak kaldı. Soğuk çözümleme süresinde genel hızlanma gösterilmedi; mevcut iş yükü hâlâ yüksek olabilir. CPU doygunluğu ayrı profil kaydı olmadan kanıtlanmış sayılmadı.

Bütün 1/10/50 senaryolarındaki ham sonuçlar: `media-thumbnails-results.json`.

## Renderer denemesi ve ölçülemeyenler

Gerçek SlideEditor bileşeni, 50 videolu bir tarayıcı test sunumunda gerçek küçük resim servisine bağlandı. Üç turda 108 kart seçimi gerçekleştirildi. Ancak bu yüzeyde requestAnimationFrame arka planda yaklaşık 1 saniyelik aralıklara sınırlandı; çift callback ölçümü yaklaşık 2 saniye üretti ve sonraki seçimlerle karıştı. Yüzeyi görünür yapmak da güvenilir boya zamanlaması sağlamadı. Bu örnekler etkileşim p95 hesabından dışlandı. **p95 ≤100 ms kabul hedefi doğrulanmadı.**

Tarayıcı, Electron'un local-resource video protokolünü oynatamadığından aktif video decode yükü de temsil edilmedi. Görünen kartın ve video kaynak URL'sinin değişmesi doğrulandı; gerçek oynatma veya ilk kare boya ölçümü yerine geçmez. Denemedeki uzun görev gözlemcisinde kayıt oluşmadı; bu da Electron için sıfır uzun görev kanıtı değildir.

Bir kaydırma örneğinde 39 renderer poster kaydı ve URL uzunluğundan hesaplanan 2652 baytlık yaklaşık string yükü görüldü; bunlar data URL değil HTTP görsel referanslarıydı. JS heap örnekleri yaklaşık 29,3 MB'dan 26,1 MB'a değişti. GC, görüntü belleği ve test yüzeyi nedeniyle bunlardan bellek sızıntısı olmadığı sonucu çıkarılmadı. Renderer fallback data URL birikimi ayrıca ölçülmeli.

## Testler ve tekrar çalıştırma

5 yeni ana süreç testi: eski JPEG, eşzamanlı aynı kaynak, değiştirilmiş dosya, bulunamayan FFmpeg, hata/zaman aşımı sonrası temizleme ve tekrar deneme, kuyrukta disk yeniden kontrolü, benzersiz geçici adlar. Mevcut poster kuyruğu ve kaynak çözümleme testleriyle toplam 9 test geçti. TypeScript ve değişen dosyalarda lint geçti. Salt okunur kod incelemesinde ek hata bulunmadı.

```
node --test src/main/mediaThumbnails.test.cjs
npx tsx --test src/renderer/components/mediaPosterQueue.test.ts src/main/mediaPosterSource.test.ts
node scripts/media-thumbnails-bench.cjs src/main/mediaThumbnails.ts final <geçici-fixture-klasörü>
```

Benchmark fixture klasörü sentetik MP4 dosyalarını ve JSON sonucunu tutar; gerçek medya/önbellek üzerinde çalıştırılmamalıdır.

## Sonraki karar

Bu sonuçlar JPEG ve senkron keşif düzeltmelerini destekliyor. Ek kuyruk veya LRU henüz gerekçelendirilmedi. Sonraki doğrulama, Electron penceresinde üç koşuda en az 100 seçim için click → seçili kart ve aktif içerik boyası p95 ölçümü; aynı oturumda CPU, renderer uzun görevleri ve decode profilidir. Ölçüm CPU doygunluğunu gösterirse eşzamanlılık/iş parçacığı sınırı, ön yükleme baskısını gösterirse öncelik ayrımı, bellek birikimini gösterirse bayt bütçesi ayrı değişiklik olarak değerlendirilmeli.
