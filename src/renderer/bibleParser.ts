export interface Verse {
  number: string;
  text: string;
}

export interface Chapter {
  number: string;
  verses: Verse[];
}

export interface BibleBook {
  name: string;
  number: string;
  chapters: Chapter[];
}

export interface BibleData {
  name: string;
  books: BibleBook[];
  format: 'zefania' | 'holyBible' | 'helloAo';
}

export interface IBibleParser {
  parse(xmlString: string): BibleData;
  format: 'zefania' | 'holyBible' | 'helloAo';
}

const BOOK_NAMES_TR: string[] = [
  'Tekvin', 'Çıkış', 'Levililer', 'Sayılar', 'Yasa\'nın Tekrarı',
  'Yeşu', 'Hakimler', 'Rut', '1.Samuel', '2.Samuel',
  '1.Krallar', '2.Krallar', '1.Tarihler', '2.Tarihler', 'Ezra',
  'Nehemya', 'Ester', 'Eyüp', 'Mezmurlar', 'Süleyman\'ın Özdeyişleri',
  'Vaiz', 'Ezgiler Ezgisi', 'Yeşaya', 'Yeremya', 'Ağıtlar',
  'Hezekiel', 'Daniel', 'Hoşea', 'Yoel', 'Amos',
  'Ovadya', 'Yunus', 'Mika', 'Nahum', 'Habakkuk',
  'Sefanya', 'Haggay', 'Zekeriya', 'Malaki',
  'Matta', 'Markos', 'Luka', 'Yuhanna',
  'Elçilerin İşleri', 'Romalılar', '1.Korintliler', '2.Korintliler', 'Galatyalılar',
  'Efesliler', 'Filipililer', 'Koloseliler', '1.Selanikliler', '2.Selanikliler',
  '1.Timoteos', '2.Timoteos', 'Titus', 'Filimon', 'İbraniler',
  'Yakup', '1.Petrus', '2.Petrus', '1.Yuhanna', '2.Yuhanna',
  '3.Yuhanna', 'Yahuda', 'Vahiy',
];

function getBookName(index: number): string {
  return BOOK_NAMES_TR[index - 1] || `Kitap ${index}`;
}

function hasParseError(doc: Document): boolean {
  return doc.getElementsByTagName('parsererror').length > 0;
}

export class ZefaniaParser implements IBibleParser {
  format: 'zefania' | 'holyBible' = 'zefania';

  parse(xmlString: string): BibleData {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlString, 'text/xml');

    if (hasParseError(doc)) {
      throw new Error('Invalid XML format for Zefania parser');
    }

    const name = doc.querySelector('XMLBIBLE')?.getAttribute('biblename') ?? 'Kutsal Kitap';

    const bookElements = doc.querySelectorAll('BIBLEBOOK, BibleBook');
    const books: BibleBook[] = Array.from(bookElements, (b, index) => {
      const bnumber = b.getAttribute('bnumber') ?? '';
      const bname = b.getAttribute('bname') ?? '';
      const isNumeric = /^\d+$/.test(bnumber.trim());

      const bookName = bname || (!isNumeric ? bnumber : `Kitap ${index + 1}`);
      const bookNumber = isNumeric ? bnumber : String(index + 1);

      const chapterElements = b.querySelectorAll('CHAPTER, Chapter');
      const chapters = Array.from(chapterElements, c => {
        const verseElements = c.querySelectorAll('VERS, vers, V');
        const verses = Array.from(verseElements, v => ({
          number: v.getAttribute('vnumber') ?? '',
          text: v.textContent ?? '',
        }));
        return {
          number: c.getAttribute('cnumber') ?? '',
          verses,
        };
      });

      return { number: bookNumber, name: bookName, chapters };
    });

    return { name, books, format: 'zefania' };
  }
}

export class HolyBibleParser implements IBibleParser {
  format: 'zefania' | 'holyBible' = 'holyBible';

  parse(xmlString: string): BibleData {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlString, 'text/xml');

    if (hasParseError(doc)) {
      throw new Error('Invalid XML format for Holy Bible parser');
    }

    const bibleElement = doc.querySelector('bible');
    let bibleName = bibleElement?.getAttribute('translation') || 'Holy Bible';

    const allBooks: BibleBook[] = [];
    let bookIndex = 0;

    const testamentElements = doc.querySelectorAll('testament');
    if (testamentElements.length > 0) {
      testamentElements.forEach((t) => {
        const bookElements = t.querySelectorAll('book');
        bookElements.forEach(b => {
          bookIndex++;
          const bookNumber = b.getAttribute('number') || String(bookIndex);
          const bookName =
            b.getAttribute('name') ||
            b.getAttribute('title') ||
            `Book ${bookNumber}`;

          const chapterElements = b.querySelectorAll('chapter');
          const chapters = Array.from(chapterElements, c => {
            const chapterNumber = c.getAttribute('number') || '';
            const verseElements = c.querySelectorAll('verse');
            const verses = Array.from(verseElements, v => ({
              number: v.getAttribute('number') || '',
              text: (v.textContent ?? '').trim(),
            }));
            return { number: chapterNumber, verses };
          });

          allBooks.push({ number: bookNumber, name: bookName, chapters });
        });
      });
    } else {
      const bookElements = doc.querySelectorAll('book, BOOK, Book');
      bookElements.forEach(b => {
        bookIndex++;
        const bookNumber = b.getAttribute('number') || String(bookIndex);
        const bookName =
          b.getAttribute('name') ||
          b.getAttribute('title') ||
          `Book ${bookNumber}`;

        const chapterElements = b.querySelectorAll('chapter, CHAPTER, Chapter');
        const chapters = Array.from(chapterElements, c => {
          const chapterNumber = c.getAttribute('number') || '';
          const verseElements = c.querySelectorAll('verse, VERSE, Verse');
          const verses = Array.from(verseElements, v => ({
            number: v.getAttribute('number') || '',
            text: (v.textContent ?? '').trim(),
          }));
          return { number: chapterNumber, verses };
        });

        allBooks.push({ number: bookNumber, name: bookName, chapters });
      });
    }

    return { name: bibleName, books: allBooks, format: 'holyBible' };
  }
}

export function createParser(format: 'zefania' | 'holyBible'): IBibleParser {
  switch (format) {
    case 'zefania':
      return new ZefaniaParser();
    case 'holyBible':
      return new HolyBibleParser();
  }
}

export function detectBibleFormat(xmlString: string): 'zefania' | 'holyBible' {
  if (xmlString.includes('XMLBIBLE') || xmlString.includes('BIBLEBOOK')) {
    return 'zefania';
  }
  if (xmlString.includes('<bible') || xmlString.includes('<book')) {
    return 'holyBible';
  }
  return 'holyBible';
}

export function parseBibleXML(xmlString: string): BibleData {
  const format = detectBibleFormat(xmlString);
  const parser = createParser(format);
  return parser.parse(xmlString);
}

export async function parseBibleXMLAsync(xmlString: string, _format?: 'zefania' | 'holyBible'): Promise<BibleData> {
  return parseBibleXML(xmlString);
}
