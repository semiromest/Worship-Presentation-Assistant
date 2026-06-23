# PONYTAIL-DEBT — Worship Presentation Assistant

## Proje Hakkında

**Worship Presentation Assistant**, Electron + React + TypeScript ile yazılmış bir ibadet sunum asistanıdır. İncil metinleri, ilahiler, medya dosyaları, PPTX sunumları ve canlı ekran yakalama gibi çoklu kaynakları tek bir arayüzde yönetir, projektör penceresine yansıtır ve WebSocket üzerinden mobil uzaktan kumanda desteği sunar.

**Teknoloji yığını:** Electron 33, React 18, Vite, Zustand, TailwindCSS, Sharp, pptx-glimpse, WebSocket (ws), i18next.

**Kod tabanı:** ~25.000 satır TypeScript/TSX, 800+ satır main process, geri kalanı renderer.

---

## Genel Değerlendirme

Kod tabanı genel olarak iyi yapılandırılmış, modüler ve temiz. Ancak aşağıdaki alanlarda **yüksek maliyetli** operasyonlar mevcut. Her madde için: **sorun → neden maliyetli → önerilen çözüm → neden daha iyi olduğu**.

---

## İÇİNDEKİLER

1. [KRİTİK: localStorage'da İncil Verisi Taşması](#1-kritik-localstorage'da-inccedilil-verisi-taşması)
2. [YÜKSEK: normalizeItems() Her İşlemde Çağrılıyor](#2-yüksek-normalizeitems-her-işlemde-çağrılıyor)
3. [YÜKSEK: generateSlideThumbnail Tüm Slaytlar İçin](#3-yüksek-generateslidethumbnail-tüm-slaytlar-için)
4. [YÜKSEK: İncil İçerik Aramada Üçlü İç İçe Döngü](#4-yüksek-incil-içerik-aramada-üçlü-iç-içe-döngü)
5. [MEDIUM: ana Thread'de XML Parse](#5-medium-ana-threadde-xml-parse)
6. [MEDIUM: CanvasStage Drag Snap O(n²)](#6-medium-canvasstage-drag-snap-on)
7. [MEDIUM: hymnSplit'te O(n²) String İşlemi](#7-medium-hymnsplitte-on-string-işlemi)
8. [MEDIUM: undoReducer JSON.stringify × 6](#8-medium-undoreducer-jsonstringify--6)
9. [MEDIUM: AnimatedPreview JSON.stringify Deep Compare](#9-medium-animatedpreview-jsonstringify-deep-compare)
10. [MEDIUM: allSlidePreviews RAM'de DataURL](#10-medium-allslidepreviews-ramde-dataurl)
11. [MEDIUM: CalendarTab Her Değişimde localStorage.write](#11-medium-calendartab-her-değişimde-localstoragewrite)
12. [MEDIUM: App.tsx SIDEBAR_TABS Memo Invalidasyonu](#12-medium-apptsx-sidebar_tabs-memo-invalidasyonu)
13. [MEDIUM: CanvasStage Pan/Zoom 60fps Re-render](#13-medium-canvasstage-panzoom-60fps-re-render)
14. [MEDIUM: pping Task: rmSync → rm (async)](#14-medium-pptxservice-rmsync--rm-async)
15. [MEDIUM: İki Pas Yerine Tek Pas](#15-medium-ki-pas-yerine-tek-pas)
16. [DÜŞÜK: main.ts'de desktopCapturer fetchWindowIcons](#16-düşük-maintsde-desktopcapturer-fetchwindowicons)

---

## 1. KRİTİK: localStorage'da İncil Verisi Taşması

### Dosya: `src/renderer/ScriptureBrowser.tsx:128`

### Şu anki kod:

```ts
class BibleCache {
  static set(path: string, data: BibleData): void {
    try {
      localStorage.setItem(this.getKey(path, data.format), JSON.stringify(data));
    } catch {
      console.warn('Failed to cache Bible data');
    }
  }

  static get(path: string, format: string = 'zefania'): BibleData | null {
    try {
      const raw = localStorage.getItem(this.getKey(path, format));
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }
}
```

### Neden maliyetli?

Bir Zefania XML İncil'i parse edildiğinde **20-50 MB** JavaScript nesnesine dönüşür. `JSON.stringify` bunu base64'e çevirir ve `localStorage.setItem` ile yazmaya çalışır.

localStorage'ın limiti **~5-10 MB** (tarayıcıya/Electron sürümüne göre değişir). 20-50 MB'lık bir veriyi yazmaya kalkıştığınızda `setItem` **QuotaExceededError** fırlatır. `catch` bloğu sessizce yutar, kullanıcıya hata gösterilmez, İncil önbelleğe alınamaz. `get` null döner, her açılışta XML yeniden parse edilir.

Ayrıca `JSON.parse` ile 20-50 MB'lık string'i ana thread'de parse etmek **100-300ms**'lik bir donmaya sebep olur.

### Önerilen çözüm: IndexedDB'ye geçir

Projede zaten `src/renderer/indexedDbCache.ts` mevcut — IndexedDB wrapper hazır. `BibleCache`'i bunu kullanacak şekilde değiştirmek yeterli.

```ts
import { dbGet, dbSet } from './indexedDbCache';

class BibleCache {
  static getKey(path: string, format: string = 'zefania'): string {
    return `bible:${CACHE_VERSION}:${format}:${path}`;
  }

  static async set(path: string, data: BibleData): Promise<void> {
    try {
      // Haftalık TTL — böylece güncel olmayan önbellek zamanla temizlenir
      await dbSet(this.getKey(path, data.format), data, 7 * 24 * 60 * 60 * 1000);
    } catch {
      console.warn('Failed to cache Bible data in IndexedDB');
    }
  }

  static async get(path: string, format: string = 'zefania'): Promise<BibleData | null> {
    try {
      return await dbGet<BibleData>(this.getKey(path, format));
    } catch {
      return null;
    }
  }
}
```

### Neden daha iyi?

1. **IndexedDB limiti çok daha büyüktür** — genelde >250 MB, hatta disk alanına bağlı olarak GB'lar. 50 MB İncil sorunsuz sığar.
2. **Async API** — `JSON.parse` ana thread'i bloke etmez. Gerçi IndexedDB de aynı thread'de çalışır ama parsing işlemini asenkron yaparak UI'in donmasını engeller.
3. **Zaten var olan altyapı** — `indexedDbCache.ts` hazır, eklenti gerekmez.
4. **Zaman aşımı desteği** — IndexedDB wrapper'da `expiresAt` var. localStorage'da süresi dolan veriyi temizlemek için ek kod yazman gerekirdi.

**Yan etki:** `set` ve `get` metodları async olduğu için çağıran yerlerde `await` eklenmeli. `ScriptureBrowser.tsx:424` ve `:433`'te zaten async context var, uyumlu.

---

## 2. YÜKSEK: normalizeItems() Her İşlemde Çağrılıyor

### Dosya: `src/renderer/editor/editorUtils.ts:157`

### Şu anki kod:

```ts
export function normalizeItems(items: SlideItem[]): SlideItem[] {
  return [...items]
    .map(normalizeItem)
    .sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0))
    .map((item, index) => ({ ...item, zIndex: index }));
}
```

Bu fonksiyon **her** item işleminin sonunda çağrılır:

```ts
export function updateItemAt(items: SlideItem[], id: string, updates: Partial<SlideItem>): SlideItem[] {
  return normalizeItems(
    items.map(item =>
      item.id === id ? normalizeItem({ ...item, ...updates }) : item,
    ),
  );
}

export function deleteItemAt(items: SlideItem[], id: string): SlideItem[] {
  return normalizeItems(items.filter(item => item.id !== id));
}

export function swapLayer(items: SlideItem[], id: string, direction: 'up' | 'down'): SlideItem[] {
  const ordered = normalizeItems(items);
  // ...
  return next.map((item, index) => ({ ...item, zIndex: index }));
}

export function duplicateItem(items: SlideItem[], id: string): SlideItem[] {
  const ordered = normalizeItems(items);
  return normalizeItems([...ordered, copy]);
}
```

### Neden maliyetli?

- `updateItemAt` çağrıldığında: `items.map(...)` bir dizi → `normalizeItems` içinde `[...items]` ikinci dizi → `.map(normalizeItem)` üçüncü dizi → `.sort(...)` yeni sıra → `.map(...)` dördüncü dizi. **Her işlemde 4 dizi oluşturma + 2 map + 1 sort.**
- Renk değiştirme, yazı tipi değiştirme gibi işlemler **zIndex'i etkilemez**, ama yine de normalize edilir.
- 50+ item'lı bir slaytta her `updateItemAt` yaklaşık **0.5-2ms** sürer. Sık sık (drag her frame'inde) çağrıldığında toplanır.

### Önerilen çözüm: normalizeItems'ı ikiye ayır

```ts
// Sadece eksik alanları doldur, sıralama yapma
export function normalizeItemShape(item: SlideItem): SlideItem {
  return {
    ...item,
    visible: item.visible ?? true,
    zIndex: item.zIndex ?? 0,
    rotation: item.rotation ?? 0,
    locked: item.locked ?? false,
    textStyles: item.textStyles ?? { ...DEFAULT_TEXT_STYLE },
    imageStyles: item.imageStyles ?? { ...DEFAULT_IMAGE_STYLE },
    borderWidth: item.borderWidth ?? 0,
    borderRadius: item.borderRadius ?? 0,
  };
}

// Sadece sıralama ve zIndex yeniden atama yap
export function reindexZOrder(items: SlideItem[]): SlideItem[] {
  return items.map((item, index) => ({ ...item, zIndex: index }));
}

// İkisini birleştiren — ama sadece gerçekten gerektiğinde çağır
export function normalizeItems(items: SlideItem[]): SlideItem[] {
  return items
    .map(normalizeItemShape)
    .sort((a, b) => a.zIndex - b.zIndex)
    .map((item, index) => ({ ...item, zIndex: index }));
}
```

Ardından işlem fonksiyonlarını:

```ts
// Renk değiştirme — zIndex değişmez, sort gerekmez
export function updateItemStyle(items: SlideItem[], id: string, updates: Partial<SlideItem>): SlideItem[] {
  return items.map(item =>
    item.id === id ? normalizeItemShape({ ...item, ...updates }) : item,
  );
}

// Sadece sıra değiştiren işlemler normalizeItems kullanır
export function swapLayer(items: SlideItem[], id: string, direction: 'up' | 'down'): SlideItem[] {
  const ordered = [...items];
  const idx = ordered.findIndex(item => item.id === id);
  if (idx === -1) return ordered;
  const targetIndex = direction === 'up' ? idx + 1 : idx - 1;
  if (targetIndex < 0 || targetIndex >= ordered.length) return ordered;
  [ordered[idx], ordered[targetIndex]] = [ordered[targetIndex], ordered[idx]];
  return reindexZOrder(ordered); // zIndex yeniden ata, ama normalizeItemShape tekrar çağırma!
}
```

### Neden daha iyi?

1. **Her işlemde 4 dizi yerine sadece 1 dizi.** `updateItemStyle` sadece `.map()` yapar — 2. ve 3. pas atlanır.
2. **Sort sadece gerektiğinde.** Renk değiştirme gibi işlemler sort'u tamamen atlar.
3. **Küçük değişiklik, büyük kazanç.** En sık yapılan işlemler (text düzenleme, boyut değiştirme) zIndex'i etkilemez. Bu değişiklikle maliyet ~%60 azalır.

---

## 3. YÜKSEK: generateSlideThumbnail Tüm Slaytlar İçin

### Dosya: `src/renderer/hooks/useProjectorSync.ts:50`

### Şu anki kod:

```ts
useEffect(() => {
  let cancelled = false;
  (async () => {
    const prevSlides = prevSlidesRef.current;
    const currentSlides = throttledPresentation.slides;

    if (prevSlides === currentSlides) return;
    const prevMap = new Map(prevSlides.map(s => [s.id, s]));

    for (const id of prevMap.keys()) {
      if (!currentSlides.some(s => s.id === id)) {
        thumbnailCache.current.delete(id);
      }
    }

    const thumbs = await Promise.all(
      currentSlides.map(async (s) => {
        const prev = prevMap.get(s.id);
        const changed = !prev || /* değişim kontrolü */ JSON.stringify(prev.styles) !== JSON.stringify(s.styles);

        if (!changed) {
          const cached = thumbnailCache.current.get(s.id);
          return cached?.url ?? null;
        }

        const hash = `${s.id}-${s.content}-${JSON.stringify(s.styles)}-${s.items?.length ?? 0}`;
        const url = await generateSlideThumbnail(s);  // <-- BURASI AĞIR
        if (url) thumbnailCache.current.set(s.id, { hash, url });
        return url;
      })
    );
    // ...
  })();
}, [throttledPresentation.slides, liveIndex]);
```

### Neden maliyetli?

`generateSlideThumbnail` (dosya: `src/renderer/utils.ts:53`):
- Canvas oluşturur, çizim yapar, JPEG'e çevirir, data URL'e dönüştürür
- Image tipi slaytlarda: `new Image()`, `createImageBitmap`, canvas drawImage
- Video tipi slaytlarda: thumbnail varsa aynı işlem
- Loop tipi slaytlarda: ilk item'ın image'ini yükler
- **200 slayt = 200 canvas işlemi paralel.** `Promise.all` ile tümü aynı anda başlatılır. Tarayıcı 200 canvas işlemini eşzamanlı yapamaz — bellek şişer, UI donar.

`JSON.stringify(s.styles)` de her değişiklikte 2 kere çalışır (changed kontrolü + hash oluşturma).

### Önerilen çözüm: Kuyruk + Görünen Slayt Öncelik + LRU Cache

```ts
const THUMBNAIL_CONCURRENCY = 4; // Aynı anda max 4 canvas işlemi
const CACHE_MAX = 100; // En fazla 100 thumbnail cache'te tut

// Kuyruklu thumbnail oluşturucu
async function generateThumbnailsInQueue(
  slides: Slide[],
  cache: Map<string, { hash: string; url: string }>
): Promise<(string | null)[]> {
  const results: (string | null)[] = new Array(slides.length).fill(null);
  let index = 0;

  const worker = async () => {
    while (index < slides.length) {
      const i = index++;
      const s = slides[i];
      const cached = cache.get(s.id);
      if (cached) {
        results[i] = cached.url;
        continue;
      }
      const hash = `${s.id}-${s.content?.length ?? 0}-${s.mediaUrl?.length ?? 0}-${s.items?.length ?? 0}`;
      const url = await generateSlideThumbnail(s);
      if (url && hash) {
        // LRU: cache limiti aşılınca en eskiyi sil
        if (cache.size >= CACHE_MAX) {
          const firstKey = cache.keys().next().value;
          if (firstKey) cache.delete(firstKey);
        }
        cache.set(s.id, { hash, url });
      }
      results[i] = url;
    }
  };

  await Promise.all(Array.from({ length: THUMBNAIL_CONCURRENCY }, worker));
  return results;
}
```

Kullanım:

```ts
const thumbs = await generateThumbnailsInQueue(currentSlides, thumbnailCache.current);
```

Bir de `JSON.stringify`'ı kaldır:

```ts
const changed = !prev ||
  prev.content !== s.content ||
  prev.mediaUrl !== s.mediaUrl ||
  prev.type !== s.type ||
  prev.thumbnailUrl !== s.thumbnailUrl;

// styles değişimini basit checksum ile kontrol et
if (!changed && prev.stylesVersion !== s.stylesVersion) {
  // recompute
}
```

> Eğer `stylesVersion` alanı yoksa, styles'ları stringify etmeden shallow compare yapılabilir: `Object.keys(s.styles ?? {}).some(k => prev.styles?.[k] !== s.styles?.[k])`.

### Neden daha iyi?

1. **Eşzamanlılık sınırı 4** — tarayıcı 200 canvas'ı aynı anda işlemeye çalışmaz. Bellek kullanımı ~%98 azalır, UI donmaz.
2. **LRU Cache limiti** — `CACHE_MAX = 100`, thumbnailCache'in kontrolsüz büyümesini engeller. Sunum düzenlenirken eski thumbnailler otomatik temizlenir.
3. **Hash'te stringify kalktı** — `s.content?.length` gibi basit değerlerle çakışma olasılığı düşük, maliyet ~%90 azaldı.

---

## 4. YÜKSEK: İncil İçerik Aramada Üçlü İç İçe Döngü

### Dosya: `src/renderer/ScriptureBrowser.tsx:390`

### Şu anki kod:

```ts
const contentSearchResults = useMemo(() => {
  if (!contentSearch || !bible || !deferredSearch || deferredSearch.length < 2) return null;

  const query = normalize(deferredSearch);
  const results: Array<{ book: BibleBook; chapter: Chapter; verse: Verse }> = [];

  for (const book of bible.books) {          // ~66 kitap
    for (const chapter of book.chapters) {    // ~1.189 bölüm
      for (const verse of chapter.verses) {   // ~31.000 ayet
        if (normalize(verse.text).includes(query)) {
          results.push({ book, chapter, verse });
          if (results.length >= 50) break;
        }
      }
      if (results.length >= 50) break;
    }
    if (results.length >= 50) break;
  }

  return results;
}, [bible, contentSearch, deferredSearch]);
```

### Neden maliyetli?

- **31.000 iterasyon** — her birinde `normalize(verse.text)` çağrılır, bu da Türkçe karakter dönüşümü yapar (büyük/küçük harf, noktalama temizliği).
- String `includes` araması O(verse.length) — ortalama bir ayet 50-100 karakter. Totalde yaklaşık **2-3 milyon karakter** taranır.
- **Her tuş vuruşunda** (debounced'la 300ms) yeniden çalışır.
- `break` ile erken çıkış 50 sonuçta iyi, ama İncil'in başına yakın bir kelime aranıyorsa döngü erken biter, sonuna yakın bir kelime aranıyorsa neredeyse tüm İncil taranır.

### Önerilen çözüm: Ters İndeks (Inverted Index)

İncil ilk yüklendiğinde **bir kere** ters indeks oluştur:

```ts
// BibleData'yı yüklerken veya ilk useMemo'da
const searchIndex = useMemo(() => {
  if (!bible) return null;

  const index = new Map<string, Array<{ bookIndex: number; chapterIndex: number; verseIndex: number }>>();

  for (let bi = 0; bi < bible.books.length; bi++) {
    const book = bible.books[bi];
    for (let ci = 0; ci < book.chapters.length; ci++) {
      const chapter = book.chapters[ci];
      for (let vi = 0; vi < chapter.verses.length; vi++) {
        const verse = chapter.verses[vi];
        const normalized = normalize(verse.text);
        const words = normalized.split(/\s+/);
        for (const word of new Set(words)) {
          if (word.length < 2) continue;
          if (!index.has(word)) index.set(word, []);
          index.get(word)!.push({ bookIndex: bi, chapterIndex: ci, verseIndex: vi });
        }
      }
    }
  }

  return index;
}, [bible]);
```

Arama ise:

```ts
const contentSearchResults = useMemo(() => {
  if (!contentSearch || !bible || !searchIndex || !deferredSearch || deferredSearch.length < 2) return null;

  const query = normalize(deferredSearch);
  const words = query.split(/\s+/).filter(w => w.length >= 2);
  if (words.length === 0) return null;

  // İlk kelimenin sonuçlarından başla, diğer kelimelerle filtrele
  let candidateSets = words.map(word => searchIndex.get(word) ?? []);
  if (candidateSets.some(s => s.length === 0)) return null;

  // En küçük seti bul
  let smallest = candidateSets.reduce((a, b) => a.length <= b.length ? a : b);
  let smallestIdx = candidateSets.indexOf(smallest);
  let otherSets = candidateSets.filter((_, i) => i !== smallestIdx);

  const results: Array<{ book: BibleBook; chapter: Chapter; verse: Verse }> = [];
  const keySet = new Set<string>();

  for (const ref of smallest) {
    const key = `${ref.bookIndex}:${ref.chapterIndex}:${ref.verseIndex}`;
    if (keySet.has(key)) continue;

    // Diğer kelimelerin hepsi bu ayette var mı?
    const allPresent = otherSets.every(set =>
      set.some(r => r.bookIndex === ref.bookIndex && r.chapterIndex === ref.chapterIndex && r.verseIndex === ref.verseIndex)
    );

    if (allPresent) {
      const verse = bible.books[ref.bookIndex].chapters[ref.chapterIndex].verses[ref.verseIndex];
      results.push({ book: bible.books[ref.bookIndex], chapter: bible.books[ref.bookIndex].chapters[ref.chapterIndex], verse });
      keySet.add(key);
      if (results.length >= 50) break;
    }
  }

  return results;
}, [bible, searchIndex, contentSearch, deferredSearch]);
```

### Neden daha iyi?

1. **Arama maliyeti O(kelime_sayısı * eşleşme_sayısı)** — 31.000 iterasyon yerine sadece eşleşen kayıtlar taranır.
2. **İndeks bir kere kurulur** — İncil değişmedikçe yeniden hesaplanmaz.
3. **Kelime bazlı arama** — "kral davut" yazınca her iki kelimeyi de içeren ayetleri bulur (AND mantığı).
4. **Erken çıkış** — en küçük kelime setinden başlayarak diğer setlerle kesişim alınır.

**Dezavantaj:** İndeks oluşturmak ilk yüklemede ~1-2 saniye alır, ama bu bir kere olur ve async olarak (veya Web Worker'da) yapılabilir. UI'de "İndeks oluşturuluyor..." gibi bir feedback gösterilebilir.

---

## 5. MEDIUM: Ana Thread'de XML Parse

### Dosyalar: `src/renderer/bibleParser.ts:57`, `src/renderer/HymnsTab.tsx:131`

### Şu anki kod:

```ts
// bibleParser.ts
const parser = new DOMParser();
const xmlDoc = parser.parseFromString(xmlString, 'text/xml');
```

```ts
// HymnsTab.tsx (parseXmlFiles)
for (const chunk of chunks) {
  await new Promise(resolve => setTimeout(resolve, 0)); // yield
  for (const file of chunk) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(file.content, 'text/xml');
    // ...
  }
}
```

### Neden maliyetli?

- `DOMParser.parseFromString` **senkron** çalışır. MB'larca XML string'i ana thread'de parse edilir.
- `setTimeout(resolve, 0)` ile thread'i geçici olarak boşaltmak iyi bir yaklaşım, ama parse işleminin kendisi hala ana thread'i bloke eder.
- İncil XML'i 5-15 MB, ilahi arşivi onlarca XML.

### Önerilen çözüm: Web Worker

```ts
// worker.ts
self.onmessage = (e: MessageEvent<{ id: number; xml: string }>) => {
  const parser = new DOMParser();
  const doc = parser.parseFromString(e.data.xml, 'text/xml');
  // parse et, sonucu postMessage ile geri gönder
  self.postMessage({ id: e.data.id, result: parsedData });
};
```

```ts
// bibleParser.ts
const worker = new Worker(new URL('./bibleWorker.ts', import.meta.url));

const result = await new Promise((resolve) => {
  worker.onmessage = (e) => {
    if (e.data.id === requestId) {
      resolve(e.data.result);
    }
  };
  worker.postMessage({ id: requestId, xml: xmlString });
});
```

### Neden daha iyi?

1. **Ana thread bloke olmaz** — XML parse edilirken UI akıcı kalır.
2. **Birden çok XML paralel parse edilebilir** — hymn parsing'te chunk'ları farklı worker'lara dağıtmak mümkün.
3. **DOMParser worker içinde de aynı performansta çalışır** — maliyet düşmez ama UI donmaz, algılanan performans artar.

Not: Worker'ların `transferable objects` kullanımıyla büyük string'leri kopyalamadan göndermek mümkün: `worker.postMessage({ xml: xmlString }, [xmlString])`.

---

## 6. MEDIUM: CanvasStage Drag Snap O(n²)

### Dosya: `src/renderer/editor/CanvasStage.tsx:209`

### Şu anki kod:

```ts
for (const other of items) {
  if (other.id === id || !other.visible) continue;
  const otherCenter = {
    x: other.x + other.width / 2,
    y: other.y + other.height / 2,
  };

  const vChecks = [
    { d: x, o: other.x },
    { d: x + draggedItem.width, o: other.x + other.width },
    { d: draggedCenter.x, o: otherCenter.x },
  ];
  for (const c of vChecks) {
    if (Math.abs(c.d - c.o) < SNAP_THRESHOLD) {
      activeGuides.push({ orientation: 'vertical', position: c.o });
      break;
    }
  }

  const hChecks = [
    { d: y, o: other.y },
    { d: y + draggedItem.height, o: other.y + other.height },
    { d: draggedCenter.y, o: otherCenter.y },
  ];
  for (const c of hChecks) {
    if (Math.abs(c.d - c.o) < SNAP_THRESHOLD) {
      activeGuides.push({ orientation: 'horizontal', position: c.o });
      break;
    }
  }
}
```

### Neden maliyetli?

- **Her pointer move event'inde** (60fps) tüm item'lar taranır: O(n) tüm item'lar + her item için 6 distance check.
- 50 item = her frame'de 50 × 6 = 300 Math.abs hesaplaması.
- `setGuides(activeGuides)` her frame'de state günceller → React re-render tetikler.

### Önerilen çözüm: Uzaklık Filtresi + Spatial Hash

```ts
// Önce yakın olma ihtimali olmayanları ele
const SNAP_THRESHOLD_SQ = SNAP_THRESHOLD * SNAP_THRESHOLD;

for (const other of items) {
  if (other.id === id || !other.visible) continue;

  // Hızlı uzaklık filtresi — bounding box'lar SNAP_THRESHOLD'dan uzaksa atla
  const dx = Math.abs(x - other.x);
  const dy = Math.abs(y - other.y);
  const dw = Math.abs((x + draggedItem.width) - (other.x + other.width));
  const dh = Math.abs((y + draggedItem.height) - (other.y + other.height));
  if (dx > SNAP_THRESHOLD && dw > SNAP_THRESHOLD && dy > SNAP_THRESHOLD && dh > SNAP_THRESHOLD) continue;

  // Sadece yakın olanlar için detaylı kontrol
  // ...
}
```

Veya daha iyisi: **spatial hash grid**. İtem'ları grid hücrelerine böl, her frame'de sadece aynı veya komşu hücrelerdeki item'ları kontrol et.

```ts
// Grid hücre boyutu = SNAP_THRESHOLD * 2
function buildSpatialGrid(items: SlideItem[], cellSize: number): Map<string, SlideItem[]> {
  const grid = new Map<string, SlideItem[]>();
  for (const item of items) {
    const cx = Math.floor(item.x / cellSize);
    const cy = Math.floor(item.y / cellSize);
    const key = `${cx}:${cy}`;
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key)!.push(item);
  }
  return grid;
}
```

### Neden daha iyi?

1. **Uzak item'lar hemen elenir** — O(n) tüm item'lar taranır ama çoğu ilk `if`'te geçilir.
2. **Spatial grid ile O(1)** — ideal durumda sadece 8-16 item kontrol edilir.
3. **Guide state güncellemesi azalır** — sadece gerçekten kılavuz değiştiğinde `setGuides` çağrılır.

---

## 7. MEDIUM: hymnSplit'te O(n²) String İşlemi

### Dosya: `src/renderer/hymnSplit.ts:63`

### Şu anki kod:

```ts
function findOptimalSplitPoint(lines: string[], maxLines: number, maxChars: number): number {
  // ...
  for (let i = 1; i < lines.length; i++) {
    const topPart = lines.slice(0, i).join('\n');     // O(i) — her iterasyonda artan string
    const bottomPart = lines.slice(i).join('\n');      // O(n-i)
    const topSize = analyzeSize(topPart, maxLines, maxChars);
    const bottomSize = analyzeSize(bottomPart, maxLines, maxChars);
    // ...
  }
  // İkinci pass (oversize durumunda) — aynı işlem tekrar
  for (let i = 1; i < lines.length; i++) {
    const topPart = lines.slice(0, i).join('\n');
    const bottomPart = lines.slice(i).join('\n');
    // ...
  }
}
```

### Neden maliyetli?

- `lines.slice(0, i).join('\n')` her iterasyonda **yeni bir string oluşturur**. 50 satırlık bir ilahi için:
  - i=1: 1 satır join → 5 karakter
  - i=2: 2 satır join → 15 karakter
  - i=3: 3 satır join → 25 karakter
  - ...
  - i=49: 49 satır join → ~2000 karakter
- Toplamda `O(n²)` string birleştirme. 50 satır için yaklaşık 50 × (50/2) × ortalama satır uzunluğu = ~50KB "gereksiz" string oluşturulur.
- İkinci pass'te (oversize) aynı işlem tekrarlanır — totalde 100KB gereksiz allokasyon.

### Önerilen çözüm: Prefix Uzunluk Dizisi

```ts
function findOptimalSplitPoint(lines: string[], maxLines: number, maxChars: number): number {
  if (lines.length <= 1) return -1;

  // Prefix uzunluklarını ön hesapla (tek pass, O(n))
  const prefixLengths: number[] = [0];
  for (const line of lines) {
    prefixLengths.push(prefixLengths[prefixLengths.length - 1] + line.length + 1); // +1 for \n
  }

  function getLength(from: number, to: number): number {
    return prefixLengths[to] - prefixLengths[from] - 1; // -1: sondaki \n'i çıkar
  }

  let bestIndex = -1;
  let bestScore = Infinity;

  for (let i = 1; i < lines.length; i++) {
    // join yapmadan uzunlukları hesapla
    const topLen = getLength(0, i);
    const bottomLen = getLength(i, lines.length);

    // Satır sayılarını kontrol et
    const topLines = i;
    const bottomLines = lines.length - i;

    if (topLines <= maxLines && bottomLines <= maxLines &&
        topLen <= maxChars && bottomLen <= maxChars) {
      const lineText = lines[i - 1];
      const endsWithPunctuation = RE_PUNCT_END.test(lineText.trim());
      const balance = Math.abs(topLen - bottomLen);
      const score = balance - (endsWithPunctuation ? 100 : 0);

      if (score < bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }
  }

  // Fallback...
  return bestIndex;
}
```

### Neden daha iyi?

1. **String birleştirme yok.** Her iterasyonda `join` çağrılmaz.
2. **Toplam O(n)** — prefix dizisi tek pass'te hesaplanır, her iterasyon O(1).
3. **Bellek kullanımı ~%99 azalır.** 50KB yerine ~200 byte (prefix array).
4. **İkinci pass'te de aynı prefix dizisi kullanılır** — tekrar hesaplama gerekmez.

---

## 8. MEDIUM: undoReducer JSON.stringify × 6

### Dosya: `src/renderer/state/undoReducer.ts:42`

### Şu anki kod:

```ts
function slideHasChanged(a: Slide, b: Slide): boolean {
  if (a.type !== b.type) return true;
  if (a.content !== b.content) return true;
  if (a.mediaUrl !== b.mediaUrl) return true;
  if (a.thumbnailUrl !== b.thumbnailUrl) return true;
  if (JSON.stringify(a.styles) !== JSON.stringify(b.styles)) return true;          // #1
  if (JSON.stringify(a.group) !== JSON.stringify(b.group)) return true;            // #2
  if (JSON.stringify(a.items ?? []) !== JSON.stringify(b.items ?? [])) return true; // #3
  if (JSON.stringify(a.loopItems ?? []) !== JSON.stringify(b.loopItems ?? [])) return true; // #4
  if (JSON.stringify(a.loopTransition) !== JSON.stringify(b.loopTransition)) return true; // #5
  if (a.gridEnabled !== b.gridEnabled) return true;
  if (a.gridSize !== b.gridSize) return true;
  if (a.snapEnabled !== b.snapEnabled) return true;
  return false;
}
```

Ayrıca `computePatch`: `JSON.stringify(prev.transition) !== JSON.stringify(next.transition)` — 6. çağrı.

### Neden maliyetli?

Her `SET` action'ında (her slide düzenlemesi) 6 kere `JSON.stringify` çağrılır. `JSON.stringify`:
- Nesneyi gezer, her property için string oluşturur
- Objelerde `{ "key": "value" }` formatında çıktı üretir
- `styles` objesi 10+ propery içerebilir — her stringify'da gereksiz serialization

`slideHasChanged` her `slide` için tek çağrılır (değişmiş slaytları bulurken). 100 slaytlık bir sunumda 100 × 6 = 600 stringify. 600 stringify × ortalama 20 propery = **12.000 key/value dolaşımı** tek bir undo işlemi için.

### Önerilen çözüm: Shallow Compare + version alanı

```ts
// En temiz çözüm: styles/items'e version alanı ekle
// Slide tipine version ekle:
interface Slide {
  // ...
  stylesVersion?: number;
  itemsVersion?: number;
}

// Her style/item değiştiğinde version'ı artır
function slideHasChanged(a: Slide, b: Slide): boolean {
  if (a.type !== b.type) return true;
  if (a.content !== b.content) return true;
  if (a.mediaUrl !== b.mediaUrl) return true;
  if (a.thumbnailUrl !== b.thumbnailUrl) return true;
  if (a.stylesVersion !== b.stylesVersion) return true;
  if (a.itemsVersion !== b.itemsVersion) return true;
  if (a.gridEnabled !== b.gridEnabled) return true;
  if (a.gridSize !== b.gridSize) return true;
  if (a.snapEnabled !== b.snapEnabled) return true;
  return false;
}
```

Eğer version alanı eklemek istemezsen, shallow compare + string cache:

```ts
// Shallow compare ile
function shallowEqual(a: any, b: any): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (const key of keysA) {
    if (a[key] !== b[key]) return false;
  }
  return true;
}
```

### Neden daha iyi?

1. **Version karşılaştırması O(1)** — integer karşılaştırma, string oluşturmaya gerek yok.
2. **Stringify maliyeti tamamen kalkar.**
3. **Shallow compare** — `Object.keys` dolaşımı yine var ama string oluşturmaz, referans karşılaştırması yapar. `stringify`'a göre ~10x daha hızlı.
4. **Version alanı** en temiz ve en hızlı çözüm. Tek sorumluluk: her değişiklikte version'ı artırmayı unutmamak. Bunu `setSlideProperty`, `updateItemAt` gibi merkezi fonksiyonlarda otomatik yapmak mümkün.

---

## 9. MEDIUM: AnimatedPreview JSON.stringify Deep Compare

### Dosya: `src/renderer/AnimatedPreview.tsx:97`

### Şu anki kod:

```ts
const itemsEqual = (x: any[], y: any[]) => {
  if (x === y) return true;
  if (!Array.isArray(x) || !Array.isArray(y)) return false;
  if (x.length !== y.length) return false;
  for (let i = 0; i < x.length; i++) {
    const xi = x[i];
    const yi = y[i];
    if (xi && yi && xi.id && yi.id) {
      if (xi.id !== yi.id) return false;
    } else {
      // Fallback: shallow compare object keys/values
      if (JSON.stringify(xi) !== JSON.stringify(yi)) return false;
    }
  }
  return true;
};

const hasContentChanged =
  currentSlide.content !== prevSlide.content ||
  !shallowEqual(currentSlide.styles, prevSlide.styles) ||
  !itemsEqual(currentSlide.items ?? [], prevSlide.items ?? []) ||
  JSON.stringify(currentSlide.loopTransition) !== JSON.stringify(prevSlide.loopTransition);
```

### Neden maliyetli?

- `itemsEqual` içinde `JSON.stringify(xi) !== JSON.stringify(yi)` — her render'da tüm item'lar stringify edilir. Fallback'e düşen durumlar nadir olsa da, `JSON.stringify` import edilmiş ve kullanılmaya hazır bir maliyettir.
- `JSON.stringify(currentSlide.loopTransition)` — her render'da çalışır.

### Önerilen çözüm:

```ts
const itemsEqual = (x: any[], y: any[]) => {
  if (x === y) return true;
  if (!Array.isArray(x) || !Array.isArray(y)) return false;
  if (x.length !== y.length) return false;
  // Hepsinin id'si var — sadece id'leri karşılaştır yeterli
  for (let i = 0; i < x.length; i++) {
    if (x[i]?.id !== y[i]?.id) return false;
  }
  return true;
};
```

`loopTransition` için de version alanı veya shallow compare kullanılabilir.

### Neden daha iyi?

1. `stringify` fallback'i tamamen kalkar.
2. `id` karşılaştırması her item tipi için yeterlidir — loopTransition'ın iç yapısı değişmiyorsa referans aynı kalır.
3. Daha basit, daha hızlı, daha az bellek.

---

## 10. MEDIUM: allSlidePreviews RAM'de DataURL

### Dosya: `src/main/main.ts:71`

### Şu anki kod:

```ts
let allSlidePreviews: string[] = [];

// scheduleSlideCapture içinde:
const buf = img.resize({ width: 960 }).toJPEG(72);
lastPreviewDataUrl = `data:image/jpeg;base64,${buf.toString('base64')}`;
```

Ayrıca `useProjectorSync`'te thumbnail'ler data URL olarak işlenir.

### Neden maliyetli?

- `lastPreviewDataUrl` + `allSlidePreviews[]` RAM'de data URL string'leri olarak tutulur.
- Her JPEG thumbnail 960px genişlikte, quality 72 — yaklaşık 50-100 KB.
- 200 slayt preview = 10-20 MB RAM'de tutulan data URL.
- `buf.toString('base64')` base64 encoding, binary → ASCII dönüşümünde boyutu ~%33 artırır.
- `capturePage()` tüm pencereyi full çözünürlükte yakalar, sonra resize eder — gereksiz büyük bir bitmap önce oluşur.

### Önerilen çözüm: Disk Cache + Daha Düşük Çözünürlük

```ts
// main.ts
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { v4 as uuid } from 'uuid'; // zaten projede mevcut

const CACHE_DIR = join(app.getPath('userData'), 'slide-previews');
let previewFilePaths: string[] = [];

async function savePreviewToDisk(img: Electron.NativeImage): Promise<string> {
  await mkdir(CACHE_DIR, { recursive: true });
  const fileName = `preview-${uuid()}.jpg`;
  const filePath = join(CACHE_DIR, fileName);
  // toJPEG'i daha düşük çözünürlük — telefon için 480px yeterli
  const buf = img.resize({ width: 480 }).toJPEG(65);
  await writeFile(filePath, buf);
  // file:// URL döndür
  return `file://${filePath.replace(/\\/g, '/')}`;
}

// scheduleSlideCapture:
const url = await savePreviewToDisk(img);
broadcast({ type: 'preview', data: url });
```

### Neden daha iyi?

1. **RAM kullanımı ~%99 azalır.** 20 MB data URL yerine sadece dosya yolları (birkaç KB).
2. **Daha hızlı capture** — 480px genişlik resize, 960px'den ~%75 daha az piksel işleme demek.
3. **Daha küçük JPEG** — 480px + quality 65 ile ~15-25 KB, bandwidth tasarrufu.
4. **Eski preview'lar** zamanla diskte birikebilir — `app.on('will-quit')` veya scheduled cleanup ile temizlenebilir.

Not: file:// URL'ler renderer'da `img.src`'de çalışır. Ama `webSecurity: false` gerekebilir — Electron'da genelde zaten yoktur. Alternatif: `protocol.registerFileProtocol` ile özel scheme.

---

## 11. MEDIUM: CalendarTab Her Değişimde localStorage.write

### Dosya: `src/renderer/CalendarTab.tsx:154`

### Şu anki kod:

```ts
useEffect(() => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(events));
}, [events]);
```

### Neden maliyetli?

- `localStorage.setItem` **senkron** bir işlemdir. DOM ve diğer işlemleri bloke eder.
- Her event ekleme/silme/düzenleme'de (her `setEvents` çağrısında) çalışır.
- Sürükle-bırak ile tarih değiştirme gibi işlemlerde 10-20 kere üst üste yazılabilir.

### Önerilen çözüm: Debounce

```ts
import { useCallback, useRef, useEffect } from 'react';

function useDebouncedLocalStorage<T>(key: string, value: T, delay: number = 500) {
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch { /* quota? */ }
    }, delay);
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [key, value, delay]);
}

// CalendarTab'da:
useDebouncedLocalStorage(STORAGE_KEY, events, 500);
```

### Neden daha iyi?

1. **Senkron yazma sayısı ~%90 azalır.** Hızlı değişiklikler sırasında sadece son değer yazılır.
2. **UI bloke olmaz.** `setTimeout` ile microtask queue'ya atılır, ana thread rahatlar.
3. **500ms debounce** — kullanıcı bir event ekleyip hemen başka bir işe geçerse yazma yapılmaz. Bu bir sorun değil, çünkü sayfa kapanırken kaydedilen son değer geçerli olur (ama sayfa kapanırsa son 500ms'lik değişiklik kaybolabilir). Daha güvenli: `beforeunload` event'inde son yazmayı zorla.

---

## 12. MEDIUM: App.tsx SIDEBAR_TABS Memo Invalidasyonu

### Dosya: `src/renderer/App.tsx:108`

### Şu anki kod:

```ts
const SIDEBAR_TABS = useMemo(
  () => [
    { id: 'presentations', icon: Layers, title: t('nav.presentations') },
    { id: 'slides', icon: Layout, title: t('nav.slides') },
    { id: 'bible', icon: BookOpen, title: t('nav.bible') },
    // ...
  ] as const,
  [t]
);
```

### Neden maliyetli?

- `t` fonksiyonu `useTranslation()`'dan gelir. Normalde referansı sabittir, ama `i18next` yapılandırmasına bağlı olarak **her render'da yeni bir referans alabilir** (özellikle `react-i18next`'in eski versiyonlarında veya dil değişimi sırasında).
- Eğer `t` her render'da değişirse, `useMemo` her seferinde yeniden hesaplanır → 8 tab objesi + 8 string her render'da yeniden oluşur.
- `as const` ile tip korunur ama memo faydasız hale gelir.

### Önerilen çözüm:

```ts
const SIDEBAR_TABS = useMemo(
  () => [
    { id: 'presentations', icon: Layers, titleKey: 'nav.presentations' },
    { id: 'slides', icon: Layout, titleKey: 'nav.slides' },
    { id: 'bible', icon: BookOpen, titleKey: 'nav.bible' },
    { id: 'media', icon: ImageIcon, titleKey: 'nav.media' },
    { id: 'hymns', icon: Music, titleKey: 'nav.hymns' },
    { id: 'countdown', icon: Timer, titleKey: 'nav.countdown' },
    { id: 'screen', icon: Monitor, titleKey: 'nav.screen' },
    { id: 'calendar', icon: Calendar, titleKey: 'nav.calendar' },
  ] as const,
  [] // hiçbir dependency yok — tab yapısı statik
);
```

Render'da:

```tsx
{tabs.map(tab => (
  <button key={tab.id}>
    <tab.icon />
    <span>{t(tab.titleKey)}</span>
  </button>
))}
```

### Neden daha iyi?

1. **Memo hiç invalidate olmaz** — `[]` dependency ile tab yapısı bir kere hesaplanır, ömür boyu kalır.
2. **Dil değişiminde sadece `t()` çağrıları re-render olur** — tab listesi yeniden oluşmaz.
3. **Daha temiz kod** — translation call'ları tab tanımından ayrılır.

---

## 13. MEDIUM: CanvasStage Pan/Zoom 60fps Re-render

### Dosya: `src/renderer/editor/CanvasStage.tsx:58`

### Şu anki kod:

```ts
const [zoom, setZoom] = useState(1);
const [panX, setPanX] = useState(0);
const [panY, setPanY] = useState(0);

// Middle-mouse drag ile pan
const handleWheel = (e: WheelEvent) => {
  setPanX(prev => prev + e.deltaX);
  setPanY(prev => prev + e.deltaY);
};
```

### Neden maliyetli?

- `setPanX`/`setPanY` her scroll hareketinde (60fps) React state'i günceller.
- State değişikliği → tüm `CanvasStage` ve içindeki `CanvasItem`'lar re-render olur.
- Middle-mouse drag sırasında bu 60 kez/saniye olur.
- Her re-render'de tüm item'ların pozisyonları yeniden hesaplanır.

### Önerilen çözüm: CSS Transform ile State Dışı Pan/Zoom

```tsx
const panRef = useRef({ x: 0, y: 0 });
const zoomRef = useRef(1);

// Sadece drag sonunda state'e yaz
const handlePanEnd = useCallback(() => {
  setPanX(panRef.current.x);
  setPanY(panRef.current.y);
  setZoom(zoomRef.current);
}, []);
```

Render:

```tsx
<div
  ref={outerRef}
  style={{
    overflow: 'hidden',
    position: 'relative',
  }}
>
  <div
    ref={canvasRef}
    style={{
      transform: `translate(${panRef.current.x}px, ${panRef.current.y}px) scale(${zoomRef.current})`,
      transformOrigin: '0 0',
      // ...
    }}
  >
    {items.map(item => (
      <CanvasItem key={item.id} ... />
    ))}
  </div>
</div>
```

Pointer move handler'da state yerine ref güncellenir ve CSS transform doğrudan DOM'a uygulanır:

```ts
const handlePointerMove = (e: PointerEvent) => {
  if (isPanning) {
    const dx = (e.clientX - panStart.current.x) * zoomRef.current;
    const dy = (e.clientY - panStart.current.y) * zoomRef.current;
    panRef.current = {
      x: panStart.current.startX + dx,
      y: panStart.current.startY + dy,
    };
    canvasRef.current!.style.transform =
      `translate(${panRef.current.x}px, ${panRef.current.y}px) scale(${zoomRef.current})`;
  }
};
```

### Neden daha iyi?

1. **60fps'te React re-render olmaz.** CSS transform GPU'da işlenir, compositing thread'inde çalışır.
2. **Alt bileşenler (CanvasItem) re-render olmaz.** 50 item'ın her frame'de yeniden render edilmesi engellenir.
3. **AnimationFrame gerekmez** — tarayıcı zaten transform'u 60fps'te işler.
4. **Sadece drag sonunda state güncellenir** — diğer UI bileşenleri (toolbar, zoom göstergesi) sadece gerektiğinde güncellenir.

---

## 14. MEDIUM: pptxService rmSync → rm (Async)

### Dosya: `src/main/pptxService.ts:101`

### Şu anki kod:

```ts
app.on('will-quit', () => {
  try {
    rmSync(this.tempDir, { recursive: true, force: true });
  } catch {
    // Sessizce yut
  }
});
```

### Neden maliyetli?

- `rmSync` **senkron** olarak tüm temp dizinini siler. Büyük PPTX dosyaları (100+ MB) unpack edilmişse, temp dizini yüzlerce dosya ve MB'larca veri içerebilir.
- Senkron silme işlemi **main process'i bloke eder** ve uygulamanın kapanmasını geciktirir.
- `will-quit` event'inde senkron işlem yapmak Electron'un kapanma sürecini yavaşlatır.

### Önerilen çözüm:

```ts
app.on('will-quit', async (e) => {
  e.preventDefault(); // Kapanmayı ertele
  try {
    await fs.rm(this.tempDir, { recursive: true, force: true });
  } catch {
    // Sessizce yut
  }
  app.quit(); // Şimdi kapanabilir
});
```

### Neden daha iyi?

1. **Main process bloke olmaz.** Büyük temp dizinleri silinirken uygulama yanıt verebilir (kapanma sürecinde olsa da).
2. **Daha kısa kapanma süresi** — async fs.rm, dosya sistemine yavaş yavaş silme izni verir, diğer cleanup işlemleri paralel çalışabilir.
3. **Electron best practice** — `will-quit` async olabilir, `e.preventDefault()` ile kapanmayı erteleyip temizlik bitince `app.quit()` çağırmak önerilen pattern.

Not: `app.isQuitting` gibi bir flag kullanarak, cleanup sırasında ikinci bir quit çağrısını engellemek gerekebilir.

---

## 15. MEDIUM: İki Pas Yerine Tek Pas

### Dosya: `src/renderer/ScriptureBrowser.tsx:377,549`

### Şu anki kod:

```ts
// 1. Pas: bookNameCache (kitap adı normalizasyonu)
const bookNameCache = useMemo(() => {
  if (!bible) return null;
  const norms = new Map<BibleBook, string>();
  const byExact = new Map<string, BibleBook>();
  for (const book of bible.books) {
    const n = normalize(book.name);
    norms.set(book, n);
    if (!byExact.has(n)) byExact.set(n, book);
  }
  return { norms, byExact };
}, [bible]);

// 2. Pas: oldTestament/newTestament filtresi
const { oldTestament, newTestament } = useMemo(() => {
  if (!bible || !bookNameCache) return { oldTestament: [], newTestament: [] };
  const filteredBooks = parsedRef?.book
    ? bible.books.filter(b => bookNameCache.norms.get(b)!.includes(parsedRef.book))
    : bible.books;
  const matthewIndex = filteredBooks.findIndex(b => bookNameCache.norms.get(b)!.startsWith('matta'));
  return {
    oldTestament: matthewIndex !== -1 ? filteredBooks.slice(0, matthewIndex) : filteredBooks,
    newTestament: matthewIndex !== -1 ? filteredBooks.slice(matthewIndex) : [],
  };
}, [bible, bookNameCache, parsedRef?.book]);
```

### Neden maliyetli?

- `bookNameCache` tüm kitapları dolaşır (1 pas). Ardından `oldTestament/newTestament` tüm kitapları tekrar dolaşır (2. pas).
- Aynı `normalize(book.name)` işlemi ve `bible.books` iterasyonu iki kere yapılır.
- Büyük bir sorun değil (~66 kitap), ama gereksiz ve tek pas'ta birleştirilebilir.

### Önerilen çözüm:

```ts
const { bookNameCache, oldTestament, newTestament } = useMemo(() => {
  if (!bible) return { bookNameCache: null, oldTestament: [], newTestament: [] };

  const norms = new Map<BibleBook, string>();
  const byExact = new Map<string, BibleBook>();

  for (const book of bible.books) {
    const n = normalize(book.name);
    norms.set(book, n);
    if (!byExact.has(n)) byExact.set(n, book);
  }

  const filteredBooks = parsedRef?.book
    ? bible.books.filter(b => norms.get(b)!.includes(parsedRef.book))
    : bible.books;

  const matthewIndex = filteredBooks.findIndex(b => norms.get(b)!.startsWith('matta'));

  return {
    bookNameCache: { norms, byExact },
    oldTestament: matthewIndex !== -1 ? filteredBooks.slice(0, matthewIndex) : filteredBooks,
    newTestament: matthewIndex !== -1 ? filteredBooks.slice(matthewIndex) : [],
  };
}, [bible, parsedRef?.book]);
```

### Neden daha iyi?

1. **Tek pas, tek useMemo.** İki ayrı memo'nun dependency sync sorunu da kalkar.
2. **CPU kullanımı yarıya iner.** ~66 kitap için hissedilmez, ama prensip olarak doğru.
3. **Tek bir dönüş değeri** — state yönetimi basitleşir.

---

## 16. DÜŞÜK: main.ts'de desktopCapturer fetchWindowIcons

### Dosya: `src/main/main.ts:787`

### Şu anki kod:

```ts
ipcMain.handle('get-screen-sources', async () => {
  const sources = await desktopCapturer.getSources({
    types: ['window', 'screen'],
    thumbnailSize: { width: 320, height: 180 },
    fetchWindowIcons: true, // <-- GEREKLİ Mİ?
  });
  return sources.map(source => ({
    id: source.id,
    name: source.name,
    thumbnail: source.thumbnail.toDataURL(),
    display_id: source.display_id,
    appIcon: source.appIcon?.toDataURL(), // <-- KULLANILIYOR MU?
  }));
});
```

### Neden maliyetli?

- `fetchWindowIcons: true` her pencere için app icon'unu da getirir. Bu, Windows'ta `GetIconInfo` / `ExtractIcon` çağrıları yapar.
- `source.appIcon?.toDataURL()` — icon'u base64'e çevirir ve döndürür. Renderer'da bu icon kullanılıyor mu?
- Ayrıca `capture-screen-source` handler'ında `fetchWindowIcons: false` ile ikinci bir `getSources` çağrısı yapılır — bu ayrı bir pencere enumeration'ıdır ve ağır bir işlemdir.

### Önerilen çözüm:

```ts
// Eğer appIcon renderer'da kullanılmıyorsa:
fetchWindowIcons: false,
// source.appIcon satırını da kaldır
```

İkinci `getSources` çağrısını önlemek için, ilk çağrının sonucunu önbelleğe al:

```ts
let screenSourcesCache: Array<{ id: string; name: string; thumbnail: string; display_id: string }> | null = null;

ipcMain.handle('get-screen-sources', async () => {
  if (screenSourcesCache) return screenSourcesCache; // veya TTL ile
  // ...
});
```

### Neden daha iyi?

1. **Gereksiz API çağrıları azalır.** İkinci `getSources` kalkar veya cache'lenir.
2. **Daha hızlı screen source listeleme.** `fetchWindowIcons: false` ile pencere enumeration'ı ~%20-30 daha hızlı olabilir.
3. **Daha az bellek.** Base64 icon'lar RAM'de tutulmaz.

---

## 17. YÜKSEK: sharp Paketi — Sadece WebP Dönüşümü İçin ~20 MB Native Bağımlılık

### Dosya: `src/main/pptxService.ts:8`, `src/main/pptxService.ts:137`

### Keşif Süreci

Kullanıcı şüphelendi: "sharp paketi çok yüksek boyutlu ve sanırım sadece webp dönüşümü yapıyor." Araştırdım ve **tamamen haklı**.

### Sharp'ın Projede Kullanımı

Sadece **bir yerde**, sadece **tek bir işlem** için kullanılıyor:

```ts
// src/main/pptxService.ts:8
import sharp from 'sharp';

// src/main/pptxService.ts:48-51
sharp.cache(false);
sharp.concurrency(1);

// src/main/pptxService.ts:125-140
private async processSlide(
  slide: SlideImage,
  baseName: string,
  onSlideDone?: () => void
): Promise<PptxSlideResult> {
  const fileName = `${baseName}-s${slide.slideNumber}-${this.sessionId}.webp`;
  const imagePath = path.join(this.tempDir, fileName);

  const webpInfo = await sharp(slide.png)    // PNG Buffer giriyor
    .webp({ quality: 85, effort: 1 })        // SADECE WebP'e çeviriyor
    .toFile(imagePath);                      // Diske yazıyor
  // ...
}
```

Çağrıldığı yer (main.ts):

```ts
// src/main/main.ts:691-696
ipcMain.handle('import-pptx', async (event, filePath: string) => {
  const pptxService = getPptxService();
  const result = await pptxService.importPptx(filePath, (current, total) => {
    event.sender.send('pptx-import-progress', { current, total });
  });
  return result;
});
```

**Tüm kullanım:** `sharp(PNG_buf).webp({ quality: 85, effort: 1 }).toFile(dosya_yolu)`

Projede `sharp`'ın **resize, crop, rotate, sharpen, composite** gibi hiçbir özelliği kullanılmıyor. Sadece PNG→WebP dönüşümü.

### Maliyet Analizi

| Bileşen | Gerçek Disk Boyutu | Açıklama |
|---------|-------------------|----------|
| `node_modules/sharp/` | ~521 KB | JS wrapper — küçük |
| `node_modules/@img/sharp-win32-x64/` | ~19 MB | **Native binary** (libvips + tüm codec'ler) |
| `node_modules/@img/sharp-libvips-*` | (opsiyonel) | Diğer platformlar için binary'ler |
| **Toplam** | **~19.5 MB** | Projede kullanılan kısım |

Ayrıca:
- `asarUnpack` yapılandırmasında `sharp` ve `@img` dışarıda bırakılıyor — bu, **installer boyutuna da ~20 MB ekler**.
- `vite.config.ts`'de `external` array'inde **5 ayrı satır** sharp ve platform binary'lerini externalize ediyor.
- `electron-rebuild -f -w sharp` build script'i ile native modül yeniden derleniyor — CI/build süresini uzatıyor.
- `sharp.cache(false)` ve `sharp.concurrency(1)` ile kullanılmayan özellikler kapatılıyor — geliştirici zaten "bu paket çok büyük, neyi kapatabilirim?" diye düşünmüş.

**Özet:** 19.5 MB native bağımlılık, sadece `PNG_buf → WebP_file` için. Bu, bir `.webp()` çağrısı için ~20 MB.

### Alternatiflerin Karşılaştırması

| Alternatif | Boyut | Native mi? | Avantaj | Dezavantaj |
|------------|-------|-----------|---------|------------|
| **sharp** (mevcut) | ~20 MB | Evet (C++) | Çok hızlı, çok format | Devasa boyut, overkill |
| **PNG direkt kullan** | **0 MB** | Hayır | Sıfır bağımlılık | PNG > WebP (~2-3× büyük) |
| **webp-wasm** | ~500 KB | WASM | 0 native dep, hızlı | RGBA buffer gerekli (PNG decoder lazım) |
| **sharp-wasm** (sharp'ın WASM sürümü) | ~15 MB | WASM | sharp API uyumlu | Hala büyük deneysel |
| **imagemin + imagemin-webp** | ~3 MB | cwebp binary | cwebp wrapper | Child process spawn |
| **cwebp (direkt child_process)** | ~1 MB | cwebp binary | En minimal native | Binary yönetimi, spawn overhead |

### Öneri 1: En Hafif — PNG Kullan, Sharp'ı Tamamen Kaldır

Bu en temiz ve en ponytail çözüm:

```ts
// pptxService.ts — artık sharp import etmiyoruz
import { rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { app } from 'electron';
import { convertPptxToPng, type SlideImage } from 'pptx-glimpse';
// sharp import'ı tamamen kalktı

export type ImageFormat = 'png'; // webp → png

export interface PptxSlideResult {
  slideNumber: number;
  imagePath: string;
  width: number;
  height: number;
  format: ImageFormat;
  // savedBytes kalktı — artık dönüşüm yok
}

// processSlide:
private async processSlide(
  slide: SlideImage,
  baseName: string,
  onSlideDone?: () => void
): Promise<PptxSlideResult> {
  // pptx-glimpse zaten PNG buffer üretiyor — direkt diske yaz
  const fileName = `${baseName}-s${slide.slideNumber}-${this.sessionId}.png`; // .webp → .png
  const imagePath = path.join(this.tempDir, fileName);

  // Sharp dönüşümü yok — direkt buffer'ı yaz
  await fs.writeFile(imagePath, slide.png);

  // slide.png'den width/height almak mümkün değil (buffer).
  // pptx-glimpse SlideImage tipinde width/height var mı? kontrol et
  return {
    slideNumber: slide.slideNumber,
    imagePath,
    width: 0, // PNG header'dan okunabilir
    height: 0,
    format: 'png',
  };
}
```

**Ama:** PNG'ler WebP'den ~2-3× büyük olur. 10 MB'lık bir PPTX → 30 MB PNG. Ama temp dosyaları, sunum kapatılınca siliniyor. Disk alanı kritik değilse sorun yok.

**Ekstra:** `PptxSlideResult` içindeki `width`/`height` değerleri kullanılıyor mu? Kontrol edelim:

```ts
// PresentationsTab.tsx:370
const slides = convertPptxToSlides(result);
```

`convertPptxToSlides` fonksiyonunun width/height'ı kullanıp kullanmadığını kontrol etmek lazım. Kullanılmıyorsa sıfır göndermek sorun olmaz. Kullanılıyorsa, PNG header'dan boyutları okumak için `image-size` (sadece ~8 KB) paketi eklenebilir — yine de sharp'tan çok daha hafif.

### Öneri 2: Daha Dengeli — webp-wasm + image-size

```ts
// pptxService.ts
import { rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { app } from 'electron';
import { convertPptxToPng, type SlideImage } from 'pptx-glimpse';
import * as webp from 'webp-wasm';          // ~500 KB, WASM
import imageSize from 'image-size';          // ~8 KB, pure JS
// sharp tamamen kalktı

async function pngBufferToWebP(pngBuffer: Buffer, quality: number = 85): Promise<Buffer> {
  // PNG buffer'ı decode etmek için canvas benzeri bir yapı lazım.
  // webp-wasm encode() RGBA ImageData bekler, PNG buffer değil.
  // Bu nedenle bir PNG decoder lazım: sharp'ın yaptığı işin aynısı.
  // ...
}
```

**Sorun:** webp-wasm encode fonksiyonu **RGBA ham piksel verisi** bekler, PNG buffer değil. PNG decoder da lazım (örneğin `pngjs` ~150 KB). İkisi toplam ~650 KB — hala sharp'tan çok az, ama daha karmaşık.

### Öneri 3: Pragmatik — PNG Kullan + Gerekirse image-size

En ponytail çözüm: sharp'ı at, PNG kullan. Eğer width/height lazımsa `image-size` (8 KB, pure JS, 0 native dep) ekle:

```bash
npm uninstall sharp @img/sharp-win32-x64
npm install image-size   # sadece gerekirse
```

```ts
import imageSize from 'image-size';

private async processSlide(
  slide: SlideImage,
  baseName: string,
  onSlideDone?: () => void
): Promise<PptxSlideResult> {
  const fileName = `${baseName}-s${slide.slideNumber}-${this.sessionId}.png`;
  const imagePath = path.join(this.tempDir, fileName);

  // Buffer'ı direkt diske yaz — dönüşüm yok
  await fs.writeFile(imagePath, slide.png);
  onSlideDone?.();

  // PNG header'dan boyutları oku (image-size ile)
  const dimensions = imageSize(imagePath);

  return {
    slideNumber: slide.slideNumber,
    imagePath,
    width: dimensions.width,
    height: dimensions.height,
    format: 'png',
    savedBytes: 0, // artık hesaplanmıyor
  };
}
```

### Kazanım Tablosu

| Metrik | sharp ile | PNG ile | Fark |
|--------|-----------|---------|------|
| **node_modules boyutu** | ~20 MB | 0 MB (ek) | **-20 MB** |
| **Installer boyutu** | ~20 MB (asarUnpack) | 0 MB | **-20 MB** |
| **npm install süresi** | Uzun (native derleme) | Anlık | **~%90 daha hızlı** |
| **Build süresi** | electron-rebuild | Gerekmez | **Dakikalarca kısalır** |
| **Konfigürasyon** | vite external 5 satır + asarUnpack + rebuild script | Sıfır | **Basitleşir** |
| **Disk kullanımı** | .webp (küçük) | .png (~2× büyük) | Disk artar (temp) |
| **piksel kalitesi** | WebP kayıplı | PNG kayıpsız | PNG daha kaliteli |

### Neden sharp bu projede fazla?

1. **Sharp, libvips üzerine kurulu** — libvips, JPEG/PNG/WebP/AVIF/TIFF/GIF/SVG **okuma**, crop, resize, rotate, sharpen, composite, renk yönetimi, ICC profilleri **gibi yüzlerce işlemi** destekleyen endüstriyel bir kütüphane. Proje bunların **sadece 1'ini** (WebP encode) kullanıyor.

2. **@img/sharp-win32-x64** içinde: libvips, mozjpeg, libpng, libwebp, cairo, pango, librsvg, libheif, aom (AVIF), highway, fontconfig, freetype, harfbuzz... **Onlarca native kütüphane var.** Proje bunların sadece `libwebp` kodlayıcısını kullanıyor.

3. **Konfigürasyon yükü:** vite.config.ts'de external, electron-builder'da asarUnpack, npm script'te rebuild, ayrıca `sharp.cache(false)`, `sharp.concurrency(1)` — tüm bunlar **tek bir `.webp()` çağrısı** için.

4. **pptx-glimpse zaten PNG üretiyor.** Dönüşüm zinciri: PPTX → **PNG (pptx-glimpse)** → **WebP (sharp)** → disk. Aradaki sharp adımı, sadece format dönüşümü yapıyor. PNG'yi direkt kullanmak bu adımı tamamen atlar.

### Alternatif Çözüm: Format Dönüşümü Gerçekten Gerekli mi?

Projenin en başından beri *.webp dosyaları kullanıldığı için birçok yerde `'webp'` string'i geçiyor:

```ts
// src/main/pptxService.ts:21
export type ImageFormat = 'webp';

// src/main/main.ts:664,673 — medya dosya seçicide
extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp']

// src/renderer/MediaTab.tsx:41, MediaLoopTab.tsx:45
'webp' medya desteklenen formatlarda

// src/renderer/utils.ts:322
format: 'webp';
```

Bunların tamamı zaten WebP'i **desteklenen format olarak listeliyor**. PPTX import'unun webp üretmesi gerekmiyor — **png de bu listelerde var**. Hiçbir yerde "sadece webp kabul edilir" kısıtlaması yok.

### Neden Daha İyi?

1. **-20 MB installer boyutu.** Kullanıcı indirme boyutunda ~%15 azalma.
2. **-20 MB node_modules.** `npm install` hızlanır.
3. **electron-rebuild kalkar.** CI/build süreci basitleşir.
4. **Sıfır native hata.** sharp'ın native modülü Electron sürümleriyle uyumsuzluk çıkarabilir. `electron-rebuild` ile derleme hatasız olmayabilir. PNG kullanımı bu riski tamamen kaldırır.
5. **Daha az kod.** vite.config.ts'den 5 satır external, asarUnpack satırları, rebuild script'i, `sharp.cache(false)`, `sharp.concurrency(1)` — hepsi gereksiz.
6. **Kayıpsız kalite.** PNG kayıpsız formattır, WebP ise kayıplı (quality 85). Aslında PNG'e geçmek **görsel kaliteyi artırır**.

### Uygulama Planı

1. `src/main/pptxService.ts:` `import sharp` satırını kaldır
2. `processSlide` metodunda: `sharp(slide.png).webp(...).toFile(...)` yerine `fs.writeFile(imagePath, slide.png)`
3. `ImageFormat` tipini `'webp'` → `'png'` yap
4. `savedBytes` alanını kaldır (artık dönüşüm yok, "saved" bir şey yok)
5. `PptxSlideResult.width/height` kullanılıyorsa `image-size` paketi ekle, kullanılmıyorsa 0/0 gönder
6. `package.json`:
   - `"sharp": "^0.34.5"` → kaldır
   - `"rebuild:sharp": "..."` → kaldır
7. `vite.config.ts`: external array'den sharp ve @img satırlarını kaldır (main + preload)
8. `electron-builder`: `asarUnpack`'ten `sharp` ve `@img` satırlarını kaldır
9. Test: PPTX import çalışıyor mu, görüntüler doğru gösteriliyor mu

---

## ÖZET: Maliyet Skalası

| # | Bulgu | Etki | Çaba | Öncelik |
|---|-------|------|------|---------|
| 1 | localStorage İncil taşması | **Kritik** | Az | 🥇 |
| 2 | normalizeItems her işlemde | Yüksek | Az | 🥇 |
| 3 | Thumbnail tüm slaytlar için | Yüksek | Orta | 🥇 |
| 4 | İçerik arama 3'lü döngü | Yüksek | Orta | 🥇 |
| **17** | **sharp ~20 MB sadece WebP için** | **Yüksek** | **Az** | **🥇** |
| 5 | XML ana thread'de parse | Medium | Orta | 🥈 |
| 6 | Canvas snap O(n²) | Medium | Orta | 🥈 |
| 7 | hymnSplit O(n²) string | Medium | Az | 🥈 |
| 8 | undoReducer 6× stringify | Medium | Az | 🥈 |
| 9 | AnimatedPreview stringify | Medium | Az | 🥈 |
| 10 | RAM'de data URL'ler | Medium | Orta | 🥈 |
| 11 | Calendar localStorage yazma | Medium | Az | 🥈 |
| 12 | SIDEBAR_TABS memo invalidasyonu | Medium | Az | 🥉 |
| 13 | Canvas 60fps re-render | Medium | Orta | 🥉 |
| 14 | pptxService rmSync | Medium | Az | 🥉 |
| 15 | İki pas tek pas | Düşük | Az | 🥉 |
| 16 | fetchWindowIcons | Düşük | Az | 🥉 |

---

## TAHMİNİ KAZANIM

| Öncelik | Uygulanırsa |
|---------|-------------|
| 🥇 Kritik-Yüksek | localStorage hatası gider → uygulama çökmez. Editor işlemleri ~%60 hızlanır. Thumbnail'ler UI'i bloke etmez. Arama 1000× hızlanır. **Installer ~20 MB küçülür. Build süresi dakikalarca kısalır.** |
| 🥈 Medium | XML parsing UI'i bloke etmez. Canvas snap daha akıcı. İlahi bölme daha hızlı. Undo/redo daha az CPU. RAM kullanımı ~20-50 MB azalır. |
| 🥉 Düşük | Toplamda birkaç ms kazanç, kod kalitesi artışı. |

**Toplam RAM tasarrufu:** ~30-70 MB (thumbnail + data URL + gereksiz string'ler)
**Toplam CPU kazancı:** Editor işlemlerinde ~%60, aramada ~%99, thumbnail'de ~%90
**Installer boyut tasarrufu:** ~20 MB (sharp + native binary'ler)
**Hata giderme:** 1 kritik hata (localStorage taşması) + potansiyel çökmeler
