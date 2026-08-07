import type { BibleData, BibleBook } from './bibleParser';

/**
 * Canonical 66 book names in Turkish (canonical protestant order).
 * Source: user-provided list — only book names, no category labels.
 */
export const BOOK_NAMES_TR: readonly string[] = [
  'Yaratılış',
  "Mısır'dan Çıkış",
  'Levililer',
  'Çölde Sayım',
  'Yasanın Tekrarı',
  'Yeşu',
  'Hâkimler',
  'Rut',
  '1. Samuel',
  '2. Samuel',
  '1. Krallar',
  '2. Krallar',
  '1. Tarihler',
  '2. Tarihler',
  'Ezra',
  'Nehemya',
  'Ester',
  'Eyüp',
  'Mezmurlar',
  "Süleyman'ın Özdeyişleri",
  'Vaiz',
  'Ezgiler Ezgisi',
  'Yeşaya',
  'Yeremya',
  'Ağıtlar',
  'Hezekiel',
  'Daniel',
  'Hoşea',
  'Yoel',
  'Amos',
  'Ovadya',
  'Yunus',
  'Mika',
  'Nahum',
  'Habakkuk',
  'Sefanya',
  'Hagay',
  'Zekeriya',
  'Malaki',
  'Matta',
  'Markos',
  'Luka',
  'Yuhanna',
  'Elçilerin İşleri',
  'Romalılar',
  '1. Korintliler',
  '2. Korintliler',
  'Galatyalılar',
  'Efesliler',
  'Filipililer',
  'Koloseliler',
  '1. Selanikliler',
  '2. Selanikliler',
  '1. Timoteos',
  '2. Timoteos',
  'Titus',
  'Filimon',
  'İbraniler',
  'Yakup',
  '1. Petrus',
  '2. Petrus',
  '1. Yuhanna',
  '2. Yuhanna',
  '3. Yuhanna',
  'Yahuda',
  'Vahiy',
];

/**
 * Canonical 66 book names in English (canonical protestant order).
 * Source: user-provided list — only book names, no category labels.
 */
export const BOOK_NAMES_EN: readonly string[] = [
  'Genesis',
  'Exodus',
  'Leviticus',
  'Numbers',
  'Deuteronomy',
  'Joshua',
  'Judges',
  'Ruth',
  '1 Samuel',
  '2 Samuel',
  '1 Kings',
  '2 Kings',
  '1 Chronicles',
  '2 Chronicles',
  'Ezra',
  'Nehemiah',
  'Esther',
  'Job',
  'Psalms',
  'Proverbs',
  'Ecclesiastes',
  'Song of Solomon',
  'Isaiah',
  'Jeremiah',
  'Lamentations',
  'Ezekiel',
  'Daniel',
  'Hosea',
  'Joel',
  'Amos',
  'Obadiah',
  'Jonah',
  'Micah',
  'Nahum',
  'Habakkuk',
  'Zephaniah',
  'Haggai',
  'Zechariah',
  'Malachi',
  'Matthew',
  'Mark',
  'Luke',
  'John',
  'Acts',
  'Romans',
  '1 Corinthians',
  '2 Corinthians',
  'Galatians',
  'Ephesians',
  'Philippians',
  'Colossians',
  '1 Thessalonians',
  '2 Thessalonians',
  '1 Timothy',
  '2 Timothy',
  'Titus',
  'Philemon',
  'Hebrews',
  'James',
  '1 Peter',
  '2 Peter',
  '1 John',
  '2 John',
  '3 John',
  'Jude',
  'Revelation',
];

export type BookNameLanguage = 'tr' | 'en';

export const BOOK_NAMES_BY_LANGUAGE: Record<BookNameLanguage, readonly string[]> = {
  tr: BOOK_NAMES_TR,
  en: BOOK_NAMES_EN,
};

/**
 * Known aliases per canonical position (1-indexed order, arrays are 0-indexed).
 * All entries must already be normalized (see normalizeBookName).
 * Helps match bibles that ship names in English / abbreviations / common variants.
 */
const BOOK_ALIASES: readonly (readonly string[])[] = [
  ['genesis', 'gen', 'tekvin', 'beresit', 'bereshit'],
  ['exodus', 'exo', 'ex', 'cikis', 'shemot'],
  ['leviticus', 'lev', 'levi'],
  ['numbers', 'num', 'sayilar', 'bemidbar'],
  ['deuteronomy', 'deut', 'dt', 'tesniye'],
  ['joshua', 'josh', 'jos'],
  ['judges', 'judg', 'hakimler'],
  ['ruth', 'rut'],
  ['1 samuel', '1sam', 'i samuel', '1st samuel'],
  ['2 samuel', '2sam', 'ii samuel', '2nd samuel'],
  ['1 kings', '1kgs', '1ki', 'i kings', '1st kings', '1. krallar'],
  ['2 kings', '2kgs', '2ki', 'ii kings', '2nd kings', '2. krallar'],
  ['1 chronicles', '1chr', '1ch', 'i chronicles', '1st chronicles', '1. tarihler'],
  ['2 chronicles', '2chr', '2ch', 'ii chronicles', '2nd chronicles', '2. tarihler'],
  ['ezra'],
  ['nehemiah', 'neh'],
  ['esther', 'est'],
  ['job', 'eyup'],
  ['psalms', 'psalm', 'ps', 'mezmur'],
  ['proverbs', 'prov', 'pr', 'ozdeyisler', 'suleymanin ozdeyisleri'],
  ['ecclesiastes', 'eccl', 'ecc'],
  ['song of songs', 'song of solomon', 'song', 'canticles', 'ezgiler'],
  ['isaiah', 'isa', 'is', 'yeseyah'],
  ['jeremiah', 'jer'],
  ['lamentations', 'lam'],
  ['ezekiel', 'ezek', 'ezk', 'ez'],
  ['daniel', 'dan'],
  ['hosea', 'hos'],
  ['joel', 'jol'],
  ['amos'],
  ['obadiah', 'obad', 'oba'],
  ['jonah', 'jon'],
  ['micah', 'mic'],
  ['nahum', 'nam'],
  ['habakkuk', 'hab'],
  ['zephaniah', 'zeph', 'zep'],
  ['haggai', 'hag'],
  ['zechariah', 'zech', 'zec', 'zac'],
  ['malachi', 'mal'],
  ['matthew', 'matt', 'mt'],
  ['mark', 'mrk', 'mk', 'mar'],
  ['luke', 'luk', 'lk'],
  ['john', 'jhn', 'joh', 'jn'],
  ['acts', 'act', 'elcilerin isleri', 'resuller'],
  ['romans', 'rom'],
  ['1 corinthians', '1cor', '1co', 'i corinthians', '1st corinthians', '1. korintliler'],
  ['2 corinthians', '2cor', '2co', 'ii corinthians', '2nd corinthians', '2. korintliler'],
  ['galatians', 'gal'],
  ['ephesians', 'eph'],
  ['philippians', 'phil', 'php'],
  ['colossians', 'col'],
  ['1 thessalonians', '1thes', '1th', '1. selanikliler'],
  ['2 thessalonians', '2thes', '2th', '2. selanikliler'],
  ['1 timothy', '1tim', '1ti', '1. timoteos'],
  ['2 timothy', '2tim', '2ti', '2. timoteos'],
  ['titus', 'tit'],
  ['philemon', 'phlm', 'phm', 'filemon'],
  ['hebrews', 'heb'],
  ['james', 'jas', 'jam'],
  ['1 peter', '1pet', '1pe', 'i peter', '1st peter', '1. petrus'],
  ['2 peter', '2pet', '2pe', 'ii peter', '2nd peter', '2. petrus'],
  ['1 john', '1jhn', '1jn', 'i john', '1st john', '1. yuhanna'],
  ['2 john', '2jhn', '2jn', 'ii john', '2nd john', '2. yuhanna'],
  ['3 john', '3jhn', '3jn', 'iii john', '3rd john', '3. yuhanna'],
  ['jude', 'jud'],
  ['revelation', 'rev', 'apocalypse'],
];

const TURKISH_CHARS_MAP: Record<string, string> = {
  ı: 'i',
  ğ: 'g',
  ü: 'u',
  ş: 's',
  ö: 'o',
  ç: 'c',
  İ: 'i',
  Ğ: 'g',
  Ü: 'u',
  Ş: 's',
  Ö: 'o',
  Ç: 'c',
  â: 'a',
  î: 'i',
  û: 'u',
  ê: 'e',
  Â: 'a',
  Î: 'i',
  Û: 'u',
  Ê: 'e',
};

// charCode bounds for ASCII 'a'-'z' and '0'-'9', used by normalizeBookName's
// single-pass scan below instead of a chain of regex .replace() calls.
const CODE_LOWER_A = 97; // 'a'
const CODE_LOWER_Z = 122; // 'z'
const CODE_DIGIT_0 = 48; // '0'
const CODE_DIGIT_9 = 57; // '9'

function isAsciiAlnumCode(code: number): boolean {
  return (code >= CODE_LOWER_A && code <= CODE_LOWER_Z) || (code >= CODE_DIGIT_0 && code <= CODE_DIGIT_9);
}

/**
 * Normalizes a book name for matching: lowercase, Turkish diacritics folded to
 * ASCII, apostrophes stripped, everything else collapsed to single spaces,
 * trimmed.
 *
 * Optimization: the original implementation chained four separate
 * `.replace()` calls, each scanning the whole string and allocating a new
 * intermediate string. This does the same work in a single left-to-right
 * pass with no intermediate allocations, and no regex/backtracking overhead.
 */
export function normalizeBookName(str: string): string {
  const lower = str.toLowerCase();
  let out = '';
  let pendingSpace = false;

  for (let i = 0; i < lower.length; i++) {
    const ch = lower[i];

    // Apostrophes are dropped entirely (no separator introduced),
    // matching the original `.replace(/['`]/g, '')` step.
    if (ch === "'" || ch === '`') continue;

    const mapped = TURKISH_CHARS_MAP[ch] ?? ch;
    const code = mapped.charCodeAt(0);

    if (mapped.length === 1 && isAsciiAlnumCode(code)) {
      if (pendingSpace) {
        out += ' ';
        pendingSpace = false;
      }
      out += mapped;
    } else if (out.length > 0) {
      // Any other character (spaces, punctuation, unmapped diacritics) acts
      // as a separator; runs of separators collapse to a single space and
      // leading/trailing separators are dropped (no leading emit, and a
      // trailing pendingSpace is simply never flushed).
      pendingSpace = true;
    }
  }

  return out;
}

// Aliases pre-built per position: normalized canonical Turkish name + known aliases
const ALIASES_NORMALIZED: readonly (readonly string[])[] = BOOK_ALIASES.map((aliases, i) => [
  normalizeBookName(BOOK_NAMES_TR[i]),
  ...aliases,
]);

const MIN_CONTAINMENT_LENGTH = 4;

interface AliasEntry {
  readonly alias: string;
  readonly bookIndex: number;
}

/**
 * O(1) exact-match lookup: alias string -> canonical book index.
 * When the same alias text appears under multiple books (shouldn't normally
 * happen, but defensively handled), the lowest book index wins — this
 * mirrors the original code's `for (i = 0..65) return first match` order.
 */
const EXACT_MATCH_MAP: Map<string, number> = new Map();

// Flat list of every (alias, bookIndex) pair, kept sorted lexicographically
// by alias so that "does any alias start with X" can be answered with a
// binary search instead of scanning all ~200 aliases.
const ALIASES_SORTED: AliasEntry[] = [];

for (let i = 0; i < ALIASES_NORMALIZED.length; i++) {
  for (const alias of ALIASES_NORMALIZED[i]) {
    if (!EXACT_MATCH_MAP.has(alias)) {
      EXACT_MATCH_MAP.set(alias, i);
    }
    ALIASES_SORTED.push({ alias, bookIndex: i });
  }
}

ALIASES_SORTED.sort((a, b) => {
  if (a.alias < b.alias) return -1;
  if (a.alias > b.alias) return 1;
  return a.bookIndex - b.bookIndex;
});

/** First index in `arr` whose `.alias` is >= target (standard binary lower bound). */
function lowerBound(arr: readonly AliasEntry[], target: string): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid].alias < target) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo;
}

/**
 * Finds the canonical book index for a normalized name.
 *
 * Optimization vs. the original nested-loop scan (66 books x up to ~6
 * aliases, twice — once for exact match, once for prefix/containment):
 *  - Exact match is a single hashmap lookup: O(1) instead of O(books x aliases).
 *  - "some alias is a prefix of the input" is answered by hashing each
 *    prefix of the input (length >= 4) against the same map: O(len(input))
 *    lookups instead of scanning every alias's `startsWith`.
 *  - "input is a prefix of some alias" is answered with a binary search over
 *    a pre-sorted alias list, then a short scan of just the matching range:
 *    O(log A + k) instead of O(A) `startsWith` checks.
 * Priority (lowest book index wins on ties) is preserved to match the
 * original's book-ascending iteration order.
 */
function matchBookPosition(normalizedName: string): number {
  if (!normalizedName) return -1;

  const exact = EXACT_MATCH_MAP.get(normalizedName);
  if (exact !== undefined) return exact;

  let best = -1;

  // Case A: some known alias (length >= 4) is a prefix of the input.
  if (normalizedName.length > MIN_CONTAINMENT_LENGTH) {
    for (let len = MIN_CONTAINMENT_LENGTH; len < normalizedName.length; len++) {
      const idx = EXACT_MATCH_MAP.get(normalizedName.slice(0, len));
      if (idx !== undefined && (best === -1 || idx < best)) best = idx;
    }
  }

  // Case B: the input is a prefix of some known alias (length >= 4).
  const start = lowerBound(ALIASES_SORTED, normalizedName);
  for (let k = start; k < ALIASES_SORTED.length; k++) {
    const entry = ALIASES_SORTED[k];
    if (!entry.alias.startsWith(normalizedName)) break; // sorted -> range is contiguous
    if (entry.alias.length >= MIN_CONTAINMENT_LENGTH && (best === -1 || entry.bookIndex < best)) {
      best = entry.bookIndex;
    }
  }

  return best;
}

// Auto-generated placeholder names from parsers ("Book 1", "kitap 2", "1", ...)
const PLACEHOLDER_NAME_RE = /^(book|kitap|bolum|bölüm|libro|capitulo|livre)?\s*\d+$/i;

function isPlaceholderName(rawName: string): boolean {
  return PLACEHOLDER_NAME_RE.test(rawName.trim());
}

export interface FixBibleBookNamesResult {
  bible: BibleData;
  renamedCount: number;
}

/**
 * Renames books of a downloaded Bible to the canonical Turkish names.
 *
 * Strategy:
 * 1. Match each book's current name against known aliases (Turkish/English/variants).
 * 2. For unmatched books (e.g. "Book 1", "book 2"), fall back to canonical
 *    position — but only when the Bible is in canonical order (verified by how
 *    many matched books sit at their expected index).
 *
 * Optimization: the original implementation made six separate passes over
 * the book list (map/filter/reduce/every/map/reduce), each with its own
 * closure-call overhead. This computes everything in two plain `for` loops:
 * one to classify every book (match position, expected-index count, and the
 * canonical-order check) and one to build the renamed list, avoiding
 * redundant iteration and intermediate arrays.
 */
export function fixBibleBookNames(bible: BibleData, names: readonly string[] = BOOK_NAMES_TR): FixBibleBookNamesResult {
  const books = bible.books;
  const n = books.length;
  const positions: number[] = new Array(n);

  let matchedCount = 0;
  let atExpectedIndex = 0;
  let allMatchedOrPlaceholder = n > 0;

  for (let i = 0; i < n; i++) {
    const book = books[i];
    const pos = matchBookPosition(normalizeBookName(book.name));
    positions[i] = pos;

    if (pos !== -1) {
      matchedCount++;
      if (pos === i) atExpectedIndex++;
    } else if (allMatchedOrPlaceholder && !isPlaceholderName(book.name)) {
      allMatchedOrPlaceholder = false;
    }
  }

  // Trust positional fallback when the bible is in canonical order: either most
  // recognized names sit at their expected index, or every book is an
  // auto-generated placeholder (parsers emit those in canonical order).
  const looksCanonical = matchedCount > 0 ? atExpectedIndex / matchedCount >= 0.5 : allMatchedOrPlaceholder;

  const newBooks: BibleBook[] = new Array(n);
  let renamedCount = 0;

  for (let i = 0; i < n; i++) {
    const book = books[i];
    const matched = positions[i];
    const target = matched !== -1 ? matched : looksCanonical && i < names.length ? i : -1;

    if (target === -1) {
      newBooks[i] = book;
      continue;
    }

    const newName = names[target];
    if (!newName || newName === book.name) {
      newBooks[i] = book;
      continue;
    }

    newBooks[i] = { ...book, name: newName };
    renamedCount++;
  }

  if (renamedCount === 0) return { bible, renamedCount: 0 };
  return { bible: { ...bible, books: newBooks }, renamedCount };
}