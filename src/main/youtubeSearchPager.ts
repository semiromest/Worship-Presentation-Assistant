import { randomBytes } from 'node:crypto';
import { isYouTubeMusicResult, type YouTubeMusicResult, type YouTubeSearchResponse } from '../shared/youtubeMusic';

export interface YouTubeSearchPage {
  results: YouTubeMusicResult[];
  next?: () => Promise<YouTubeSearchPage>;
}
interface SearchSession {
  query: string;
  pending: YouTubeMusicResult[];
  seen: Set<string>;
  next?: YouTubeSearchPage['next'];
  expires: number;
  busy: boolean;
}
const PAGE_SIZE = 12;
const TTL = 10 * 60 * 1000;

/** Provider continuation objects stay in main; only bounded, expiring opaque IDs cross IPC. */
export class YouTubeSearchPager {
  private sessions = new Map<string, SearchSession>();
  private generation = 0;
  constructor(
    private load: (query: string) => Promise<YouTubeSearchPage>,
    private now = Date.now
  ) {}

  async search(query: unknown, cursor?: unknown): Promise<YouTubeSearchResponse> {
    if (typeof query !== 'string' || !query.trim() || query.length > 200) return { ok: false, error: 'invalid-query' };
    const text = query.trim();
    for (const [id, session] of this.sessions)
      if (!session.busy && session.expires <= this.now()) this.sessions.delete(id);
    let session: SearchSession;
    let id: string;
    const generation = this.generation;
    if (cursor !== undefined) {
      if (typeof cursor !== 'string' || cursor.length > 100) return { ok: false, error: 'search-expired' };
      const existing = this.sessions.get(cursor);
      if (!existing || existing.query !== text || existing.expires <= this.now())
        return { ok: false, error: 'search-expired' };
      if (existing.busy) return { ok: false, error: 'search-busy' };
      session = existing;
      id = cursor;
    } else {
      id = randomBytes(18).toString('hex');
      session = { query: text, pending: [], seen: new Set(), expires: this.now() + TTL, busy: false };
    }
    session.busy = true;
    try {
      // Work on a copy so failed continuation requests can be retried without losing buffered results.
      const pending = [...session.pending];
      const seen = new Set(session.seen);
      let next = session.next;
      if (cursor === undefined || (pending.length < PAGE_SIZE && next)) {
        const page = cursor === undefined ? await this.load(text) : await next!();
        for (const result of page.results)
          if (isYouTubeMusicResult(result) && !seen.has(result.id)) {
            pending.push(result);
            seen.add(result.id);
          }
        next = page.next;
      }
      if (generation !== this.generation) return { ok: false, error: 'unavailable' };
      const results = pending.splice(0, PAGE_SIZE);
      if (pending.length || next) {
        Object.assign(session, { pending, seen, next, expires: this.now() + TTL });
        // Refresh insertion order; retain at most eight active searches.
        this.sessions.delete(id);
        this.sessions.set(id, session);
        while (this.sessions.size > 8) this.sessions.delete(this.sessions.keys().next().value!);
        return { ok: true, results, nextCursor: id };
      }
      this.sessions.delete(id);
      return { ok: true, results };
    } catch {
      return { ok: false, error: 'search-failed' };
    } finally {
      session.busy = false;
    }
  }

  clear() {
    ++this.generation;
    this.sessions.clear();
  }
}
