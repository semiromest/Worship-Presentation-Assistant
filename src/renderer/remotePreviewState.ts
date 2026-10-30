import type { Slide } from './types';
import { previewCacheMatches, type PreviewCacheEntry } from './previewCache';
import type { PreviewDeck, PreviewAssetRequest } from '../shared/remotePreview';

type Record = PreviewCacheEntry & { version: number };

/** Revision metadata is independent of the encoded-image cache. Evicting image
 * bytes cannot make an unchanged slide dirty or retain an old document. */
export class RemotePreviewState {
  token = '';
  private document = '';
  private serial = 0;
  private records = new Map<string, Record>();
  constructor(private mint: () => string = () => crypto.randomUUID()) {}
  update(document: string, slides: Slide[], watermark: unknown, fontEpoch: (slide: Slide) => number): PreviewDeck {
    if (document !== this.document || !this.token) { this.document = document; this.token = this.mint(); this.records.clear(); }
    const next = new Map<string, Record>();
    for (const slide of slides) {
      const previous = this.records.get(slide.id), epoch = fontEpoch(slide);
      next.set(slide.id, { url: '', slide, watermark, fontEpoch: epoch,
        version: previewCacheMatches(previous, slide, watermark, epoch) ? previous.version : ++this.serial });
    }
    this.records = next;
    return { token: this.token, slots: [...next].map(([id, record]) => ({ id, version: record.version })) };
  }
  get(request: PreviewAssetRequest) {
    const record = this.records.get(request.id);
    return request.token === this.token && record?.version === request.version ? record : undefined;
  }
  get size() { return this.records.size; }
}
