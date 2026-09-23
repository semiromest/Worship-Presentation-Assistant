import type { SttToken } from './stt';

export interface CaptionEntry {
  id: string;
  original: string;
  translation: string;
  translations: Record<string, string>;
  at: number;
  order: number;
}
export interface CaptionSnapshot {
  original: string;
  translations: Record<string, string>;
  lastOriginal: string;
  lastTranslations: Record<string, string>;
  history: CaptionEntry[];
  detectedLanguage: string | null;
}
interface StreamSegment {
  id: string;
  original: string;
  partialOriginal: string;
  translation: string;
  partialTranslation: string;
  order: number;
}

/** Each Soniox connection owns its segment boundaries. Translation tokens have
 * no audio timestamps: never align independent connections by endpoint count. */
export class CaptionTimeline {
  private streams = new Map<string, StreamSegment>();
  private sequence = 0;
  private history: CaptionEntry[] = [];
  private lastOriginal = '';
  private lastTranslations: Record<string, string> = {};
  private detectedLanguage: string | null = null;
  constructor(private sessionId: string, private primary: string) {}

  result(key: string, tokens: SttToken[]): void {
    let segment = this.streams.get(key);
    if (!segment) {
      segment = { id: `${this.sessionId}:${key}:${++this.sequence}`, original: '', partialOriginal: '', translation: '', partialTranslation: '', order: Date.now() };
      this.streams.set(key, segment);
    }
    segment.partialOriginal = '';
    segment.partialTranslation = '';
    for (const token of tokens) {
      if (token.translationStatus === 'translation') {
        segment[token.isFinal ? 'translation' : 'partialTranslation'] += token.text;
      } else {
        segment[token.isFinal ? 'original' : 'partialOriginal'] += token.text;
        if (key === this.primary && token.language) this.detectedLanguage = token.language;
      }
    }
  }

  endpoint(key: string): void {
    const segment = this.streams.get(key);
    if (!segment) return;
    this.streams.delete(key);
    const original = key === this.primary ? segment.original.trim() : '';
    const translation = segment.translation.trim();
    if (!original && !translation) return;
    const translations = translation ? { [key]: translation } : {};
    this.history = [...this.history, { id: segment.id, original, translation, translations, at: Date.now(), order: segment.order }]
      .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id)).slice(-50);
    if (key === this.primary) this.lastOriginal = original;
    if (translation) this.lastTranslations[key] = translation;
  }

  finish(): void { for (const key of this.streams.keys()) this.endpoint(key); }
  snapshot(): CaptionSnapshot {
    const primary = this.streams.get(this.primary);
    return {
      original: primary ? primary.original + primary.partialOriginal : '',
      translations: Object.fromEntries([...this.streams].map(([key, s]) => [key, s.translation + s.partialTranslation])),
      lastOriginal: this.lastOriginal,
      lastTranslations: { ...this.lastTranslations },
      history: this.history,
      detectedLanguage: this.detectedLanguage,
    };
  }
}
