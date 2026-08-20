// ─── Slide locator: low-latency matching engine ──────────────────────────────
// Real-time STT → slide matching.
//
// Optimised for fast reaction when the speaker starts a new line while keeping
// a stricter fallback path for ambiguous matches.
//
// Main ideas:
//   1. Shorter rolling context (14 words).
//   2. Exponential recency decay: old speech disappears quickly.
//   3. Hot window: newest words get an additional signal.
//   4. Prefix fast-path: the very newest words matching the start of a slide
//      (especially a deck-unique opening phrase) switch on the first
//      evaluation, without waiting for a large margin.
//   5. Strong phrase fast-path for the rest of the line.
//   6. Candidate pruning through an inverted index.
//   7. O(k) top-2 selection with no candidate sorting.
//   8. All buffer-only work is computed once per STT update.

import type { Slide, SlideItem } from '../types';

// ─── Normalisation ───────────────────────────────────────────────────────────

const TR_FOLD: Record<string, string> = {
  ç: 'c',
  ğ: 'g',
  ı: 'i',
  ö: 'o',
  ş: 's',
  ü: 'u',
  ß: 'ss',
};

function foldChar(ch: string): string {
  const code = ch.codePointAt(0) ?? 0;

  if (code < 128) return ch;

  const tr = TR_FOLD[ch];
  if (tr) return tr;

  return (
    ch
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') || ch
  );
}

export function foldText(text: string): string {
  let out = '';

  for (const ch of text.toLocaleLowerCase('tr')) {
    out += foldChar(ch);
  }

  return out;
}

const APOSTROPHES = new Set([
  "'",
  '\u2018',
  '\u2019',
  '`',
]);

export function tokenize(text: string): string[] {
  let folded = '';

  for (const ch of text.toLocaleLowerCase('tr')) {
    if (APOSTROPHES.has(ch)) continue;
    folded += foldChar(ch);
  }

  return folded
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 0);
}

// ─── Stopwords ───────────────────────────────────────────────────────────────

const STOPWORDS = new Set<string>([
  // Turkish
  've', 'bir', 'bu', 'su', 'de', 'da', 'ki', 'ile', 'icin', 'gibi',
  'ama', 'veya', 'cok', 'daha', 'en', 'ne', 'mi', 'mu', 'ya', 'le',
  'ise', 'degil', 'diye', 'kadar', 'olarak', 'sonra', 'once',
  'ben', 'sen', 'o', 'biz', 'siz',

  // English
  'the', 'and', 'a', 'an', 'of', 'to', 'in', 'is', 'it', 'you',
  'i', 'we', 'they', 'for', 'on', 'that', 'this', 'are', 'was',
  'be', 'but', 'or', 'with', 'as', 'by', 'at', 'from', 'so',
  'not', 'do', 'does', 'will', 'shall', 'have', 'has', 'had',
  'your', 'my', 'our', 'he', 'she', 'me', 'him', 'her', 'us',

  // Spanish
  'el', 'la', 'los', 'las', 'de', 'y', 'que', 'en', 'un', 'una',
  'por', 'para', 'con', 'es', 'se', 'lo', 'del', 'al', 'no',
  'mi', 'tu', 'su', 'a', 'o', 'e',

  // German
  'der', 'die', 'das', 'und', 'ein', 'eine', 'ich', 'du', 'er',
  'sie', 'es', 'wir', 'ihr', 'nicht', 'zu', 'in', 'im', 'von',
  'mit', 'auf', 'ist', 'sind', 'den', 'dem', 'fur', 'aus',
  'bei', 'nach', 'euch', 'auch',
]);

// ─── Slide text extraction ───────────────────────────────────────────────────

function collectItemText(
  item: SlideItem,
  out: string[],
): void {
  if (
    typeof item.content === 'string' &&
    item.content.trim()
  ) {
    out.push(item.content);
  }

  if (item.groupItems?.length) {
    for (const child of item.groupItems) {
      collectItemText(child, out);
    }
  }
}

export function collectSlideText(slide: Slide): string {
  const parts: string[] = [];

  if (slide.partsMode && slide.parts?.length) {
    parts.push(...slide.parts);
  }

  if (
    typeof slide.content === 'string' &&
    slide.content.trim()
  ) {
    parts.push(slide.content);
  }

  if (slide.items?.length) {
    for (const item of slide.items) {
      collectItemText(item, parts);
    }
  }

  return parts.join('\n');
}

// ─── Deck index ──────────────────────────────────────────────────────────────

export interface SlideDoc {
  index: number;
  id: string;

  tokens: string[];

  unigrams: Set<string>;
  bigrams: Set<string>;
  trigrams: Set<string>;

  idfWeights: Map<string, number>;
  coverageDenom: number;
}

export interface DeckIndex {
  docs: SlideDoc[];
  idf: Map<string, number>;

  /**
   * Deck-unique opening n-gram (bigram/trigram of a slide's first words) →
   * the single slide that starts with it. Exact, order-aware lookup for the
   * prefix fast path; shared openings never appear here.
   */
  uniquePrefixGrams: Map<string, SlideDoc>;

  /**
   * Token → slide documents containing the token.
   *
   * Candidate generation means we never score a slide that cannot
   * possibly have a positive score.
   */
  postings: Map<string, SlideDoc[]>;
}

function ngrams(
  tokens: string[],
  n: number,
): Set<string> {
  const out = new Set<string>();

  for (let i = 0; i + n <= tokens.length; i++) {
    let key = tokens[i];

    for (let j = 1; j < n; j++) {
      key += `\u0001${tokens[i + j]}`;
    }

    out.add(key);
  }

  return out;
}

export function buildDeckIndex(
  slides: Slide[],
): DeckIndex {
  const entries: {
    index: number;
    id: string;
    tokens: string[];
  }[] = [];

  const df = new Map<string, number>();

  // Pass 1: tokenize + document frequencies.
  slides.forEach((slide, index) => {
    if (slide.type !== 'text') return;

    const tokens = tokenize(
      collectSlideText(slide),
    );

    if (tokens.length === 0) return;

    entries.push({
      index,
      id: slide.id,
      tokens,
    });

    const seen = new Set<string>();

    for (const token of tokens) {
      if (seen.has(token)) continue;

      seen.add(token);

      df.set(
        token,
        (df.get(token) ?? 0) + 1,
      );
    }
  });

  const n = entries.length;
  const idf = new Map<string, number>();

  for (const [token, count] of df) {
    const base =
      1 + Math.log((n + 1) / (count + 1));

    idf.set(
      token,
      STOPWORDS.has(token)
        ? base * 0.35
        : base,
    );
  }

  const postings =
    new Map<string, SlideDoc[]>();

  const docs: SlideDoc[] = entries.map(
    ({ index, id, tokens }) => {
      const unigrams = new Set(tokens);

      const idfWeights =
        new Map<string, number>();

      let coverageDenom = 0;

      for (const token of unigrams) {
        const weight =
          idf.get(token) ?? 1;

        idfWeights.set(token, weight);
        coverageDenom += weight;
      }

      const doc: SlideDoc = {
        index,
        id,
        tokens,
        unigrams,
        bigrams: ngrams(tokens, 2),
        trigrams: ngrams(tokens, 3),
        idfWeights,
        coverageDenom,
      };

      for (const token of unigrams) {
        let posting = postings.get(token);

        if (!posting) {
          posting = [];
          postings.set(token, posting);
        }

        posting.push(doc);
      }

      return doc;
    },
  );

  // Deck-unique opening n-grams: an exact bigram/trigram of the first
  // PREFIX_WORDS tokens that belongs to exactly one slide. This powers the
  // direct prefix→slide lookup used by the fast path.
  const gramOwners =
    new Map<string, SlideDoc>();

  const gramCount =
    new Map<string, number>();

  for (const doc of docs) {
    const prefixTokens =
      doc.tokens.slice(0, PREFIX_WORDS);

    const grams = new Set<string>();

    for (const gram of ngrams(prefixTokens, 2)) {
      grams.add(gram);
    }

    for (const gram of ngrams(prefixTokens, 3)) {
      grams.add(gram);
    }

    for (const gram of grams) {
      gramCount.set(
        gram,
        (gramCount.get(gram) ?? 0) + 1,
      );

      if (!gramOwners.has(gram)) {
        gramOwners.set(gram, doc);
      }
    }
  }

  const uniquePrefixGrams =
    new Map<string, SlideDoc>();

  for (const [gram, count] of gramCount) {
    if (count !== 1) continue;

    const owner = gramOwners.get(gram);

    if (owner) {
      uniquePrefixGrams.set(gram, owner);
    }
  }

  return {
    docs,
    idf,
    uniquePrefixGrams,
    postings,
  };
}

// ─── Rolling transcript buffer ───────────────────────────────────────────────

export interface BufferedToken {
  token: string;

  /**
   * Exponential recency weight.
   *
   * Newest token = 1.
   * Older tokens decay rapidly.
   */
  weight: number;
}

/**
 * Shorter context means old slide text stops influencing the decision sooner.
 */
export const DEFAULT_WINDOW_WORDS = 14;

/**
 * Two words are enough for the fast phrase path.
 * The normal path remains stricter.
 */
export const MIN_BUFFER_TOKENS = 2;

/**
 * Newest N words form the "hot" context.
 */
export const HOT_WINDOW_WORDS = 8;

/**
 * Exponential decay.
 *
 * distance 0 → 1.00
 * distance 5 → 0.44
 * distance 10 → 0.20
 * distance 13 → 0.12
 */
export const RECENCY_DECAY = 0.85;

/**
 * How many leading slide words count as the slide "opening" for the
 * prefix fast path.
 */
export const PREFIX_WORDS = 6;

/**
 * The prefix fast path only looks at the very newest tokens, so the tail of
 * the previous line cannot keep the old slide winning.
 */
export const PREFIX_TAIL_WORDS = 4;

const APPROX_CHARS_PER_WORD = 20;
const WINDOW_CHAR_PADDING = 96;

function trailingWindowText(
  text: string,
  windowWords: number,
): string {
  const maxChars =
    windowWords * APPROX_CHARS_PER_WORD +
    WINDOW_CHAR_PADDING;

  if (text.length <= maxChars) {
    return text;
  }

  const cut = text.length - maxChars;

  const boundary =
    text.slice(cut).search(/\s/);

  const start =
    boundary === -1
      ? cut
      : cut + boundary + 1;

  return text.slice(start);
}

export function buildBuffer(
  transcript: string,
  windowWords = DEFAULT_WINDOW_WORDS,
): BufferedToken[] {
  const tokens = tokenize(
    trailingWindowText(
      transcript,
      windowWords,
    ),
  ).slice(-windowWords);

  if (tokens.length === 0) {
    return [];
  }

  const lastIndex = tokens.length - 1;

  return tokens.map((token, index) => ({
    token,

    // Exponential decay makes previous-slide speech disappear
    // significantly faster than the old linear weighting.
    weight: Math.pow(
      RECENCY_DECAY,
      lastIndex - index,
    ),
  }));
}

// ─── Buffer statistics ───────────────────────────────────────────────────────

interface BufferStats {
  maxWeight: Map<string, number>;

  /**
   * Token → Σ(recency × idf)
   */
  idfWeighted: Map<string, number>;

  /**
   * Newest tokens get an additional signal so a newly started line
   * can win before the entire rolling context catches up.
   */
  hotIdfWeighted: Map<string, number>;
}

function bufferStats(
  buffer: BufferedToken[],
  idf: Map<string, number>,
): BufferStats {
  const maxWeight =
    new Map<string, number>();

  const idfWeighted =
    new Map<string, number>();

  const hotIdfWeighted =
    new Map<string, number>();

  const hotStart = Math.max(
    0,
    buffer.length - HOT_WINDOW_WORDS,
  );

  for (let i = 0; i < buffer.length; i++) {
    const { token, weight } = buffer[i];

    const previous =
      maxWeight.get(token);

    if (
      previous === undefined ||
      weight > previous
    ) {
      maxWeight.set(token, weight);
    }

    const tokenIdf =
      idf.get(token) ?? 1;

    const weighted =
      weight * tokenIdf;

    idfWeighted.set(
      token,
      (idfWeighted.get(token) ?? 0) +
        weighted,
    );

    if (i >= hotStart) {
      hotIdfWeighted.set(
        token,
        (hotIdfWeighted.get(token) ?? 0) +
          weighted,
      );
    }
  }

  return {
    maxWeight,
    idfWeighted,
    hotIdfWeighted,
  };
}

// ─── N-grams ─────────────────────────────────────────────────────────────────

interface NGramData {
  grams: {
    key: string;
    weight: number;
    hot: boolean;
  }[];

  weightSum: number;
  hotWeightSum: number;
}

function buildNGramData(
  buffer: BufferedToken[],
  n: number,
): NGramData {
  const grams: NGramData['grams'] = [];

  let weightSum = 0;
  let hotWeightSum = 0;

  const hotStart = Math.max(
    0,
    buffer.length - HOT_WINDOW_WORDS,
  );

  for (
    let i = 0;
    i + n <= buffer.length;
    i++
  ) {
    let weightSumLocal = 0;
    let key = buffer[i].token;

    for (let j = 0; j < n; j++) {
      weightSumLocal +=
        buffer[i + j].weight;

      if (j > 0) {
        key +=
          `\u0001${buffer[i + j].token}`;
      }
    }

    const weight =
      weightSumLocal / n;

    const hot =
      i >= hotStart;

    grams.push({
      key,
      weight,
      hot,
    });

    weightSum += weight;

    if (hot) {
      hotWeightSum += weight;
    }
  }

  return {
    grams,
    weightSum,
    hotWeightSum,
  };
}

// ─── Prefix query ────────────────────────────────────────────────────────────

interface PrefixQueryGram {
  key: string;
  weight: number;
  n: number;
}

/**
 * Builds the ordered n-grams (bigrams + trigrams) of the very newest tokens
 * once per evaluation. The prefix fast path looks these up directly in the
 * deck's unique-opening map — no per-candidate work and no order-agnostic
 * token counting.
 */
function buildPrefixQuery(
  buffer: BufferedToken[],
): PrefixQueryGram[] {
  const start = Math.max(
    0,
    buffer.length - PREFIX_TAIL_WORDS,
  );

  const tail = buffer.slice(start);

  const grams: PrefixQueryGram[] = [];

  for (const n of [2, 3]) {
    for (
      let i = 0;
      i + n <= tail.length;
      i++
    ) {
      let key = tail[i].token;
      let weight = 0;

      for (let j = 0; j < n; j++) {
        weight += tail[i + j].weight;

        if (j > 0) {
          key += `\u0001${tail[i + j].token}`;
        }
      }

      grams.push({
        key,
        weight: weight / n,
        n,
      });
    }
  }

  // Newest first, so the freshest opening phrase wins on the first hit.
  grams.sort((a, b) => b.weight - a.weight);

  return grams;
}

// ─── Scoring ─────────────────────────────────────────────────────────────────

export interface SlideScore {
  index: number;

  score: number;

  containment: number;
  coverage: number;

  bigram: number;
  trigram: number;

  /**
   * Match quality in the newest HOT_WINDOW_WORDS.
   */
  hotContainment: number;
  hotBigram: number;
  hotTrigram: number;

  matched: number;
}

function scoreDoc(
  doc: SlideDoc,
  stats: BufferStats,
  bigramData: NGramData,
  trigramData: NGramData,
): SlideScore {
  const {
    maxWeight,
    idfWeighted,
    hotIdfWeighted,
  } = stats;

  let contNum = 0;
  let contDen = 0;

  let hotContNum = 0;
  let hotContDen = 0;

  let matched = 0;
  let coverageNum = 0;

  // One bounded pass over spoken vocabulary.
  for (const [token, weight] of idfWeighted) {
    contDen += weight;

    if (!doc.unigrams.has(token)) {
      continue;
    }

    contNum += weight;
    matched++;

    const slideWeight =
      doc.idfWeights.get(token);

    if (slideWeight !== undefined) {
      coverageNum +=
        (maxWeight.get(token) ?? 0) *
        slideWeight;
    }
  }

  // Hot containment only considers newest words.
  for (const [token, weight] of hotIdfWeighted) {
    hotContDen += weight;

    if (doc.unigrams.has(token)) {
      hotContNum += weight;
    }
  }

  const containment =
    contDen > 0
      ? contNum / contDen
      : 0;

  const hotContainment =
    hotContDen > 0
      ? hotContNum / hotContDen
      : 0;

  const coverage =
    doc.coverageDenom > 0
      ? coverageNum /
        doc.coverageDenom
      : 0;

  let bigramHit = 0;
  let hotBigramHit = 0;

  for (
    const {
      key,
      weight,
      hot,
    } of bigramData.grams
  ) {
    if (!doc.bigrams.has(key)) {
      continue;
    }

    bigramHit += weight;

    if (hot) {
      hotBigramHit += weight;
    }
  }

  const bigram =
    bigramData.weightSum > 0
      ? bigramHit /
        bigramData.weightSum
      : 0;

  const hotBigram =
    bigramData.hotWeightSum > 0
      ? hotBigramHit /
        bigramData.hotWeightSum
      : 0;

  let trigramHit = 0;
  let hotTrigramHit = 0;

  for (
    const {
      key,
      weight,
      hot,
    } of trigramData.grams
  ) {
    if (!doc.trigrams.has(key)) {
      continue;
    }

    trigramHit += weight;

    if (hot) {
      hotTrigramHit += weight;
    }
  }

  const trigram =
    trigramData.weightSum > 0
      ? trigramHit /
        trigramData.weightSum
      : 0;

  const hotTrigram =
    trigramData.hotWeightSum > 0
      ? hotTrigramHit /
        trigramData.hotWeightSum
      : 0;

  /**
   * Order-aware matching matters more for lyrics and repeated text.
   */
  let score =
    0.40 * containment +
    0.15 * coverage;

  let denominator = 0.55;

  if (bigramData.grams.length > 0) {
    score +=
      0.30 * bigram;

    denominator += 0.30;
  }

  if (trigramData.grams.length > 0) {
    score +=
      0.15 * trigram;

    denominator += 0.15;
  }

  return {
    index: doc.index,

    score:
      denominator > 0
        ? score / denominator
        : 0,

    containment,
    coverage,

    bigram,
    trigram,

    hotContainment,
    hotBigram,
    hotTrigram,

    matched,
  };
}

// ─── Decision ────────────────────────────────────────────────────────────────

export interface TrackingDecision {
  index: number | null;

  score: number;
  secondScore: number;
  margin: number;

  matched: number;

  confident: boolean;
  backward: boolean;

  /**
   * True when the decision came from a fast path (prefix or strong phrase),
   * so the tracker can switch on the first evaluation instead of waiting for
   * hysteresis.
   */
  fastPath: boolean;
}

export const SENSITIVITY_MIN = 0;
export const SENSITIVITY_MAX = 100;
export const SENSITIVITY_DEFAULT = 50;

// ─── Fast switch thresholds ──────────────────────────────────────────────────

/**
 * Strong overall match.
 */
export const FAST_SWITCH_SCORE = 0.60;

/**
 * Two distinctive words can already trigger a phrase match.
 */
export const FAST_SWITCH_MATCHED = 2;

/**
 * Strong order-aware phrase evidence.
 */
export const FAST_BIGRAM = 0.35;
export const FAST_TRIGRAM = 0.20;

/**
 * If only two tokens are available, demand much stronger evidence.
 */
export const FAST_TWO_TOKEN_SCORE = 0.82;
export const FAST_TWO_TOKEN_BIGRAM = 0.60;

/**
 * Strong newest-context match can switch before the older context catches up.
 */
export const HOT_SWITCH_CONTAINMENT = 0.80;

function clamp01(v: number): number {
  return v < 0
    ? 0
    : v > 1
      ? 1
      : v;
}

export function evaluateTracking(
  buffer: BufferedToken[],
  deck: DeckIndex,
  currentIndex: number,
  sensitivity: number,
): TrackingDecision | null {
  if (
    buffer.length < MIN_BUFFER_TOKENS ||
    deck.docs.length === 0
  ) {
    return null;
  }

  const sensitivityNormalized =
    clamp01(sensitivity / 100);

  // ─── Prefix fast path ──────────────────────────────────────────────────────
  // Before scoring the deck, look the newest words up in the unique opening
  // map. A hit is an exact, order-aware match to exactly one slide, so we can
  // switch immediately. Shared openings and STT garble simply miss the map and
  // fall through to normal scoring.

  const minPrefixTokens =
    sensitivityNormalized >= 0.5
      ? 2
      : 3;

  const minPrefixMargin =
    0.10 -
    0.05 * sensitivityNormalized;

  const prefixQuery =
    buildPrefixQuery(buffer);

  let prefixFastDoc: SlideDoc | null =
    null;

  let prefixFastWeight =
    -Infinity;

  let prefixFastN = 0;

  let prefixSecondWeight =
    -Infinity;

  for (
    const { key, weight, n } of prefixQuery
  ) {
    if (n < minPrefixTokens) continue;

    const doc =
      deck.uniquePrefixGrams.get(key);

    if (!doc) continue;

    if (!prefixFastDoc) {
      prefixFastDoc = doc;
      prefixFastWeight = weight;
      prefixFastN = n;
      continue;
    }

    if (doc === prefixFastDoc) {
      if (weight > prefixFastWeight) {
        prefixFastWeight = weight;
        prefixFastN = n;
      }
      continue;
    }

    if (weight > prefixSecondWeight) {
      prefixSecondWeight = weight;
    }
  }

  if (prefixFastDoc) {
    const prefixBackward =
      prefixFastDoc.index < currentIndex;

    const prefixMargin =
      prefixFastWeight -
      (prefixSecondWeight === -Infinity
        ? 0
        : prefixSecondWeight);

    const uniqueAndUncontested =
      prefixSecondWeight === -Infinity;

    if (
      !prefixBackward &&
      (
        uniqueAndUncontested ||
        prefixMargin >= minPrefixMargin
      )
    ) {
      return {
        index: prefixFastDoc.index,

        // A deck-unique, exact, order-aware opening match is maximal
        // evidence.
        score: 1,

        secondScore: 0,

        margin: prefixMargin,

        matched: prefixFastN,

        confident: true,
        backward: false,
        fastPath: true,
      };
    }
  }

  // ─── Full scoring ──────────────────────────────────────────────────────────

  const stats =
    bufferStats(
      buffer,
      deck.idf,
    );

  const bigramData =
    buildNGramData(buffer, 2);

  const trigramData =
    buildNGramData(buffer, 3);

  // ─── Candidate generation ──────────────────────────────────────────────────

  const candidates =
    new Set<SlideDoc>();

  for (
    const token of
      stats.idfWeighted.keys()
  ) {
    const posting =
      deck.postings.get(token);

    if (!posting) continue;

    for (const doc of posting) {
      candidates.add(doc);
    }
  }

  let best: SlideScore | null =
    null;

  let bestScore =
    -Infinity;

  let secondScore =
    -Infinity;

  // ─── O(k) top-2 selection ──────────────────────────────────────────────────
  //
  // No Array.from(...).sort().
  //
  // Tie-breaking still prefers the earlier slide index.

  for (const doc of candidates) {
    const score =
      scoreDoc(
        doc,
        stats,
        bigramData,
        trigramData,
      );

    const isBetter =
      score.score > bestScore ||
      (
        score.score === bestScore &&
        best !== null &&
        score.index < best.index
      );

    if (isBetter) {
      secondScore = bestScore;
      bestScore = score.score;
      best = score;

      continue;
    }

    if (score.score > secondScore) {
      secondScore = score.score;
    }
  }

  if (!best) {
    const fallback =
      deck.docs[0];

    best = {
      index: fallback.index,

      score: 0,

      containment: 0,
      coverage: 0,

      bigram: 0,
      trigram: 0,

      hotContainment: 0,
      hotBigram: 0,
      hotTrigram: 0,

      matched: 0,
    };
  }

  if (secondScore === -Infinity) {
    secondScore = 0;
  }

  // Normal safety gates.
  const minScore =
    0.46 -
    0.30 * sensitivityNormalized;

  const minMargin =
    0.16 -
    0.10 * sensitivityNormalized;

  const backward =
    best.index < currentIndex;

  const scoreGate =
    backward
      ? minScore + 0.06
      : minScore;

  const marginGate =
    backward
      ? minMargin * 1.6
      : minMargin;

  const margin =
    best.score -
    secondScore;

  // ─── Fast path ─────────────────────────────────────────────────────────────

  const strongPhraseMatch =
    best.bigram >= FAST_BIGRAM ||
    best.trigram >= FAST_TRIGRAM;

  const strongHotPhrase =
    best.hotBigram >= FAST_BIGRAM ||
    best.hotTrigram >= FAST_TRIGRAM;

  /**
   * Two-word mode:
   *
   * Very strict because only a single bigram exists.
   * This allows extremely fast transitions when the phrase is distinctive.
   */
  const twoTokenFastPath =
    buffer.length === 2 &&
    best.score >=
      FAST_TWO_TOKEN_SCORE &&
    best.matched >= 2 &&
    best.bigram >=
      FAST_TWO_TOKEN_BIGRAM;

  /**
   * Strong phrase or strong newest-context evidence.
   *
   * No margin wait here: if the newest words clearly identify a slide,
   * react immediately.
   */
  const multiTokenFastPath =
    buffer.length >= 3 &&
    best.score >= FAST_SWITCH_SCORE &&
    best.matched >=
      FAST_SWITCH_MATCHED &&
    (
      strongPhraseMatch ||
      strongHotPhrase ||
      best.hotContainment >=
        HOT_SWITCH_CONTAINMENT
    );

  /**
   * Backward jumps are more dangerous, so fast-path backwards switching
   * requires stronger evidence.
   */
  const fastConfident =
    !backward
      ? (
          twoTokenFastPath ||
          multiTokenFastPath
        )
      : (
          best.score >=
            FAST_SWITCH_SCORE + 0.10 &&
          best.matched >= 2 &&
          (
            best.trigram >=
              FAST_TRIGRAM ||
            best.hotTrigram >=
              FAST_TRIGRAM ||
            best.hotContainment >= 0.90
          )
        );

  // ─── Normal path ───────────────────────────────────────────────────────────

  const normalConfident =
    best.score >= scoreGate &&
    margin >= marginGate &&
    best.matched >= 2;

  const confident =
    fastConfident ||
    normalConfident;

  return {
    index: best.index,

    score: best.score,
    secondScore,

    margin,

    matched: best.matched,

    confident,
    backward,

    fastPath: fastConfident,
  };
}
