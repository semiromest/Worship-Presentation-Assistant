# Yerelleştirme sözlüğü ve kontrolü

## Ürün sözlüğü

Terim karşılıklarını aynı anlamdaki yeni metinlerde kullanın. Bunlar bütün cümlelere uygulanacak otomatik değiştirme kuralları değildir; bağlam, çekim ve mevcut kullanıcı içeriği korunur.

| Kavram | Türkçe | English | Deutsch | Español | 한국어 |
| --- | --- | --- | --- | --- | --- |
| Sunum dosyası/çalışması | Sunum | Presentation | Präsentation | Presentación | 프레젠테이션 |
| Tek slayt | Slayt | Slide | Folie | Diapositiva | 슬라이드 |
| Düzenlemek için seçilen | Seçili | Selected | Ausgewählt | Seleccionado | 선택됨 |
| İzleyiciye gönderilen | Canlı / Yayında | Live | Live | En directo | 송출 중 |
| Görüntüyü gönderme | Çıktı | Output | Ausgabe | Salida | 출력 |
| Sunucu görünümü | Sahne ekranı | Stage display | Bühnenansicht | Pantalla de escenario | 발표자 화면 |
| Tekrarlanan medya | Döngü | Loop | Schleife | Bucle | 반복 |
| İbadet şarkısı | İlahi | Hymn | Lied | Himno | 찬송가 |
| İlahi içindeki bölüm | İlahi kıtası / parçası | Verse / part | Strophe / Teil | Estrofa / parte | 절 / 파트 |
| Kutsal Kitap ayeti | Ayet | Bible verse | Bibelvers | Versículo bíblico | 성경 구절 |
| Slaytları gruplama | Bölüm | Section | Abschnitt | Sección | 구역 |
| Görüntüyü siyaha çevirme | Siyah ekran | Blackout | Schwarzbild | Pantalla negra | 검은 화면 |
| Alfa değeri | Opaklık | Opacity | Deckkraft | Opacidad | 불투명도 |
| Önceki işlemi geri alma | Geri al | Undo | Rückgängig | Deshacer | 실행 취소 |

Seçmek canlıya göndermek anlamına gelmez. Siyah ekran sesi durdurmayı ima etmez. Bölümü kaldırıp slaytları korumak ile bölümü slaytlarıyla silmek ayrı işlemlerdir. Kitaplığa kaydetme, dosyaya kaydetme ve otomatik yedek aynı terimle belirsizleştirilmemelidir. Bu sözlük yeni metinlere rehberdir; tüm eski metinlerin terim uyumu henüz onaylanmış değildir. Özellikle dinî terminoloji ve hedef dil nüansları ana dili konuşan incelemesine açıktır.

## Yerel komutlar

Proje kökünde:

```powershell
npm run check:locales
npm run test:locales
```

Kontrol tüm beş dosyada JSON geçerliliğini, yinelenen anahtarları (TypeScript AST), metin tipini, boş değerleri, eksik anahtar ailelerini, değişken sözleşmelerini ve i18next çözümlemesini inceler. Dil fallback'i kapalıdır. Çoğullar `Intl.PluralRules` ile değerlendirilir; Türkçe/Korece temel sayaçları sırf İngilizcede ayrı son ekler var diye hata sayılmaz. Temel metin yoksa gerekli çoğul kategorileri bulunmalıdır. İspanyolcada `many` kategorisi de vardır. Teknik hata kod 1, dosya/çalıştırma hatası kod 2 verir.

Tek boş metin istisnası `settings.navigation.categories.learning.description`: bütün dillerde bu kategori alt açıklamasızdır. Yeni istisnalar gerekçesiz eklenmemelidir.

CI'da mevcut Tour checks akışı PR'larda bu iki komutu çalıştırır; Release akışı da bu işi önkoşul olarak çağırır. Yerel `test:release` çeviri kontrolüyle başlar. Kontrolleri devreye almak için yeni bağımlılık gerekmez.

## Sınırlar

Bu kapı, metinlerin doğal veya ekranlara uygun olduğunu kanıtlamaz. Aynı İngilizce metni başka dile kopyalamak teknik olarak geçebilir. Kaynakta hardcoded metinler, dinamik anahtar çağrıları, HTML/Trans yapısı, ekran taşmaları ve anlam doğruluğu ayrıca incelenir. Kullanılmayan anahtarları otomatik silmez. Dil kalitesi için ürün sözlüğü, çağrı bağlamı ve gerçek ekranlar birlikte kullanılmalıdır.
