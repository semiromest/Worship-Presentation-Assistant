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
  partialOriginal: string;
  translations: Record<string, string>;
  partialTranslations: Record<string, string>;
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
  startedSequence: number;
}

/** Each Soniox connection owns its segment boundaries. Translation tokens have
 * no audio timestamps: never align independent connections by endpoint count. */
export class CaptionTimeline {
  private streams = new Map<string, StreamSegment>();
  private sequence = 0;
  private eventSequence = 0;
  private history: CaptionEntry[] = [];
  private pendingTranslations: Array<{ key: string; text: string; order: number; startedSequence: number }> = [];
  private primaryHistoryIds = new Set<string>();
  private primaryWindows = new Map<string, { after: number; through: number }>();
  private lastPrimaryEndSequence = 0;
  private lastPrimaryId: string | null = null;
  private lastOriginal = '';
  private lastTranslations: Record<string, string> = {};
  private detectedLanguage: string | null = null;
  constructor(private sessionId: string, private primary: string) {}

  result(key: string, tokens: SttToken[]): void {
    const eventSequence = ++this.eventSequence;
    let segment = this.streams.get(key);
    if (!segment) {
      segment = { id: `${this.sessionId}:${key}:${++this.sequence}`, original: '', partialOriginal: '', translation: '', partialTranslation: '', order: Date.now(), startedSequence: eventSequence };
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
    const endedSequence = ++this.eventSequence;
    const segment = this.streams.get(key);
    if (!segment) return;
    this.streams.delete(key);
    const translation = segment.translation.trim();
    if (key !== this.primary) {
      if (!translation) return;
      // A translated stream can close before or after the primary stream.
      // Its start time identifies the first primary utterance that was still
      // open when this translation began, even if several primary endpoints
      // have completed by the time the translation arrives.
      const owner = this.history.find((entry) => {
        const window = this.primaryWindows.get(entry.id);
        return this.primaryHistoryIds.has(entry.id)
          && !!window
          && segment.startedSequence > window.after
          && segment.startedSequence <= window.through;
      });
      if (owner) this.mergeTranslation(owner.id, key, translation);
      else if (segment.startedSequence > this.lastPrimaryEndSequence) {
        this.pendingTranslations.push({ key, text: translation, order: segment.order, startedSequence: segment.startedSequence });
      }
      // If its window already ended but is no longer retained, the matching
      // primary entry fell outside the 50-item history. Never attach that old
      // translation to a newer utterance.
      return;
    }

    const original = segment.original.trim();
    const translations: Record<string, string> = translation ? { [key]: translation } : {};
    for (const pending of this.pendingTranslations) {
      translations[pending.key] = joinCaptionText(translations[pending.key], pending.text);
    }
    this.pendingTranslations = [];
    if (!original && !Object.values(translations).some(Boolean)) return;

    const entry: CaptionEntry = {
      id: segment.id,
      original,
      translation,
      translations,
      at: Date.now(),
      order: segment.order,
    };
    this.pushHistory(entry);
    this.primaryHistoryIds.add(entry.id);
    this.primaryWindows.set(entry.id, { after: this.lastPrimaryEndSequence, through: endedSequence });
    this.lastPrimaryEndSequence = endedSequence;
    this.lastPrimaryId = entry.id;
    this.lastOriginal = original;
    this.lastTranslations = { ...translations };
  }

  finish(): void {
    // Drain secondary streams first so their text joins the final primary
    // utterance instead of briefly appearing as independent speech.
    const keys = [...this.streams.keys()];
    for (const key of keys) if (key !== this.primary) this.endpoint(key);
    if (this.streams.has(this.primary)) this.endpoint(this.primary);
    if (this.pendingTranslations.length) {
      const translations: Record<string, string> = {};
      let order = Date.now();
      for (const pending of this.pendingTranslations) {
        translations[pending.key] = joinCaptionText(translations[pending.key], pending.text);
        order = Math.min(order, pending.order);
      }
      this.pendingTranslations = [];
      const entry: CaptionEntry = {
        id: `${this.sessionId}:translations:${++this.sequence}`,
        original: '',
        translation: translations[this.primary] ?? '',
        translations,
        at: Date.now(),
        order,
      };
      this.pushHistory(entry);
      this.lastTranslations = { ...translations };
    }
  }

  private pushHistory(entry: CaptionEntry): void {
    this.history = [...this.history, entry]
      .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
      .slice(-50);
    const retained = new Set(this.history.map((item) => item.id));
    for (const id of this.primaryHistoryIds) {
      if (!retained.has(id)) {
        this.primaryHistoryIds.delete(id);
        this.primaryWindows.delete(id);
      }
    }
  }

  private mergeTranslation(entryId: string, key: string, text: string): void {
    this.history = this.history.map((entry) => entry.id === entryId ? {
      ...entry,
      translation: key === this.primary ? joinCaptionText(entry.translation, text) : entry.translation,
      translations: {
        ...entry.translations,
        [key]: joinCaptionText(entry.translations[key], text),
      },
    } : entry);
    if (entryId === this.lastPrimaryId) {
      this.lastTranslations[key] = joinCaptionText(this.lastTranslations[key], text);
    }
  }
  snapshot(): CaptionSnapshot {
    const primary = this.streams.get(this.primary);
    return {
      original: primary?.original ?? '',
      partialOriginal: primary?.partialOriginal ?? '',
      translations: Object.fromEntries([...this.streams].map(([key, s]) => [key, s.translation])),
      partialTranslations: Object.fromEntries([...this.streams].map(([key, s]) => [key, s.partialTranslation])),
      lastOriginal: this.lastOriginal,
      lastTranslations: { ...this.lastTranslations },
      history: this.history,
      detectedLanguage: this.detectedLanguage,
    };
  }
}

function joinCaptionText(current: string | undefined, next: string): string {
  const before = current?.trim();
  const after = next.trim();
  return before ? `${before} ${after}` : after;
}
