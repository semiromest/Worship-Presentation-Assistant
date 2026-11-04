import type { BibleData } from '../src/renderer/bibleParser';
import type { Hymn } from '../src/renderer/hymnImport';
import type { Presentation, Slide } from '../src/renderer/types';
import { DEFAULT_STYLES } from '../src/renderer/defaultSlideStyles';

const preferred = localStorage.getItem('wpa-site-language');
export const language = preferred === 'tr' || preferred === 'en' ? preferred : navigator.language.startsWith('tr') ? 'tr' : 'en';
export const tr = language === 'tr';
export const sampleImage = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900"><defs><linearGradient id="s" x2="0" y2="1"><stop stop-color="#2c4669"/><stop offset=".65" stop-color="#c49a84"/><stop offset="1" stop-color="#e4c995"/></linearGradient></defs><path fill="url(#s)" d="M0 0h1600v900H0z"/><circle cx="1100" cy="480" r="95" fill="#ffddab" opacity=".85"/><path d="M0 720 350 370 730 760 1080 530 1600 830v70H0Z" fill="#314657"/><path d="m0 830 300-210 430 200 500-170 370 180v70H0Z" fill="#162c3b"/></svg>`);
export const sampleHymns: Hymn[] = [
  { id: 'demo-hymn-1', title: tr ? 'Yolumu aydınlat' : 'Light along the way', author: 'WPA Demo', lyrics: tr ? 'Sevginle yolumu aydınlat\nYüreğimde umut yeşersin\n\nBirlikte sevgiyle yürüyelim\nHer gün şükranla söyleyelim' : 'Light my path with your love\nLet hope grow in my heart\n\nTogether we walk in kindness\nEach day we sing with thankful hearts' },
  { id: 'demo-hymn-2', title: tr ? 'Birlikte gelelim' : 'Together we gather', author: 'WPA Demo', lyrics: tr ? 'Birlikte umutla gelelim\nAçık ellerle söyleyelim\n\nSevgiyle adım atalım\nHer gün barışla yaşayalım' : 'Together we gather in hope\nWith open hands we sing\n\nTogether we walk in love\nAnd carry peace into the day' },
  { id: 'demo-hymn-3', title: tr ? 'Şükranla' : 'With thankful hearts', author: 'WPA Demo', lyrics: tr ? 'Bugünü şükranla karşılayalım\nBirbirimize umut olalım\n\nHer adımda sevgiyle\nHer nefeste şükranla' : 'We greet this day with thankful hearts\nAnd bring each other hope\n\nWith kindness in each step\nWith gratitude in every breath' },
];
// Original paraphrases for demonstration, not a licensed Bible translation.
export const sampleBible: BibleData = {
  name: tr ? 'Örnek İncil — anlam aktarımları' : 'Sample Bible — illustrative paraphrases', format: 'zefania',
  books: [
    { number: '1', name: tr ? 'Yaratılış' : 'Genesis', chapters: [{ number: '1', verses: [
      { number: '1', text: tr ? 'Başlangıçta Tanrı gökleri ve yeri yarattı.' : 'In the beginning, God made the heavens and the earth.' },
      { number: '2', text: tr ? 'Yeryüzü henüz şekillenmemişti; karanlık engin suların üzerindeydi.' : 'The earth was not yet formed, and darkness covered the deep waters.' },
      { number: '3', text: tr ? 'Tanrı ışığın var olmasını buyurdu ve ışık doğdu.' : 'God called for light, and light came to be.' },
    ] }] },
    { number: '19', name: tr ? 'Mezmurlar' : 'Psalms', chapters: [{ number: '23', verses: [
      { number: '1', text: tr ? 'Rab bana bir çoban gibi bakar; ihtiyacım olanı sağlar.' : 'The Lord cares for me like a shepherd; I have what I need.' },
      { number: '2', text: tr ? 'Beni yeşil çayırlarda dinlendirir, sakin sulara götürür.' : 'He gives me rest in green fields and leads me to peaceful waters.' },
      { number: '3', text: tr ? 'İçime yeniden güç verir ve beni doğru yollara yöneltir.' : 'He renews my strength and guides me along good paths.' },
    ] }] },
  ],
};
const make = (id: string, content: string, background: string): Slide => ({ id, type: 'text', content, styles: { ...DEFAULT_STYLES, fontSize: 64, backgroundColor: background, backgroundExplicit: true } });
export const sampleDeck: Presentation = {
  id: 'browser-demo-presentation', name: tr ? 'Örnek pazar sunumu' : 'Sample Sunday service', transition: { type: 'fade', duration: 400 },
  slides: [
    make('demo-welcome', tr ? 'Hoş geldiniz\nBirlikte umutla, birlikte sevgiyle' : 'Welcome\nTogether in hope, together in love', '#22354a'),
    { ...make('demo-song', sampleHymns[0].lyrics.split('\n\n')[0], '#253d3e'), partsMode: true, parts: sampleHymns[0].lyrics.split('\n\n'), activePart: 0 },
    make('demo-verse', sampleBible.books[1].chapters[0].verses[0].text, '#392f49'),
    { id: 'demo-landscape', type: 'image', content: '', mediaUrl: sampleImage, styles: { ...DEFAULT_STYLES, objectFit: 'cover' } },
  ],
};
