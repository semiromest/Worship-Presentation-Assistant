import type { BibleData } from '../bibleParser';
import type { BibleSourceDescriptor } from '../bibleRepository';
import type { Hymn } from '../hymnImport';
import type { MediaItem, MediaKind } from '../../shared/presentation';
import { createScriptureSlides, saveRecentScriptureReference } from '../scriptureModel';
import { QUICK_SEARCH_LIMIT, searchHymns, searchMedia, searchScripture, type ScriptureHit } from '../quickSearchModel';
import { importSetLinkSongs, isSetLink, parseSetLink } from '../worshipLeaderApi';
import { prepareHymn } from '../hymnLyrics';

/** Same chunking the Bible tab uses, so a verse added from search looks identical. */
export const SCRIPTURE_CHUNK_CONFIG = { maxVerses: 3, maxChars: 120, maxLines: 2 } as const;

export type QuickResultKind = 'scripture' | 'hymn' | 'media' | 'setLink';

/** Serializable result row: safe to send to the phone remote. */
export interface QuickResult {
  id: string;
  kind: QuickResultKind;
  title: string;
  subtitle?: string;
  /** media: image | video */
  mediaType?: MediaKind;
  /** hymn: carries chords */
  hasChords?: boolean;
  /** setLink: number of songs in the link */
  songCount?: number;
  /** setLink: link can't be imported (local set view only) */
  error?: 'set-id-only';
}

export type QuickEntry =
  | { result: QuickResult; kind: 'scripture'; hit: ScriptureHit }
  | { result: QuickResult; kind: 'hymn'; hymn: Hymn }
  | { result: QuickResult; kind: 'media'; item: MediaItem }
  | { result: QuickResult; kind: 'setLink'; link: string };

export interface QuickSearchContext {
  bible: BibleData | null;
  source: BibleSourceDescriptor | null;
  sourceId?: string;
  hymns: Hymn[];
  media: MediaItem[];
}

/** Builds every result for a query. A pasted set link yields a single set-link row. */
export function buildQuickSearch(query: string, ctx: QuickSearchContext, limit = QUICK_SEARCH_LIMIT): QuickEntry[] {
  const trimmed = query.trim();
  if (!trimmed) return [];

  if (isSetLink(trimmed)) {
    const info = parseSetLink(trimmed);
    return [
      {
        kind: 'setLink',
        link: trimmed,
        result: {
          id: 'set:link',
          kind: 'setLink',
          title: info.setTitle ?? '',
          songCount: info.songIds.length,
          error: info.kind === 'set_id' ? 'set-id-only' : undefined,
        },
      },
    ];
  }

  const entries: QuickEntry[] = [];
  for (const hit of searchScripture(ctx.bible, ctx.source, trimmed, limit)) {
    entries.push({
      kind: 'scripture',
      hit,
      result: { id: `s:${hit.id}`, kind: 'scripture', title: hit.label, subtitle: hit.preview },
    });
  }
  for (const hymn of searchHymns(ctx.hymns, trimmed, limit)) {
    entries.push({
      kind: 'hymn',
      hymn,
      result: {
        id: `h:${hymn.id}`,
        kind: 'hymn',
        title: hymn.title,
        subtitle: [hymn.author, hymn.chordPro && hymn.key ? hymn.key : null].filter(Boolean).join(' · ') || undefined,
        hasChords: !!hymn.chordPro,
      },
    });
  }
  for (const item of searchMedia(ctx.media, trimmed, limit)) {
    entries.push({
      kind: 'media',
      item,
      result: { id: `m:${item.id}`, kind: 'media', title: item.name, mediaType: item.type },
    });
  }
  return entries;
}

export interface QuickSearchActions {
  addScripture: (content: string | string[], options?: { groupTitle?: string; goLive?: boolean }) => void;
  addHymn: (hymn: Hymn & { showAuthorOnSlides?: boolean }, partsMode?: boolean, goLive?: boolean) => void;
  addMedia: (type: MediaKind, path: string) => void;
  /** Id of the slide the last add selected (the first new slide). */
  selectedSlideId: () => string | null;
  /** Library add (persisted) for songs that arrive through a set link. */
  addToLibrary: (hymns: Hymn[]) => void;
  hymnPreferences: () => { partsMode: boolean; showAuthor: boolean };
}

export interface QuickRunOutcome {
  ok: boolean;
  /** Display label of what was added (reference, song title, set title). */
  label: string;
  /** First slide that was added; go-live targets this. */
  firstSlideId: string | null;
  added: number;
  failed: number;
  error?: 'no-verses' | 'set-id-only' | 'set-empty' | 'set-fetch';
}

/**
 * Adds a result to the presentation (never goes live itself — callers decide,
 * so the broadcast lock and projector handling live in one place).
 */
export async function runQuickEntry(
  entry: QuickEntry,
  actions: QuickSearchActions,
  ctx: Pick<QuickSearchContext, 'source' | 'sourceId'>,
  onProgress?: (fetched: number, total: number) => void
): Promise<QuickRunOutcome> {
  const empty = { firstSlideId: null, added: 0, failed: 0 };
  switch (entry.kind) {
    case 'scripture': {
      const { hit } = entry;
      const slides = createScriptureSlides(hit.book, hit.chapter, hit.verseNumbers, SCRIPTURE_CHUNK_CONFIG, ctx.source);
      if (!slides.length) return { ok: false, label: hit.label, ...empty, error: 'no-verses' };
      actions.addScripture(slides.length === 1 ? slides[0] : slides, {
        groupTitle: `${hit.book.name} ${hit.chapter.number}`,
      });
      if (ctx.sourceId !== undefined) {
        try {
          saveRecentScriptureReference(ctx.sourceId, { book: hit.book, chapter: hit.chapter, verseNumbers: hit.verseNumbers });
        } catch {
          /* storage unavailable */
        }
      }
      return { ok: true, label: hit.label, firstSlideId: actions.selectedSlideId(), added: 1, failed: 0 };
    }
    case 'hymn': {
      const prefs = actions.hymnPreferences();
      actions.addHymn({ ...entry.hymn, showAuthorOnSlides: prefs.showAuthor }, prefs.partsMode);
      return { ok: true, label: entry.hymn.title, firstSlideId: actions.selectedSlideId(), added: 1, failed: 0 };
    }
    case 'media': {
      actions.addMedia(entry.item.type, entry.item.path);
      return { ok: true, label: entry.item.name, firstSlideId: actions.selectedSlideId(), added: 1, failed: 0 };
    }
    case 'setLink': {
      if (entry.result.error === 'set-id-only') return { ok: false, label: '', ...empty, error: 'set-id-only' };
      let imported;
      try {
        imported = await importSetLinkSongs(entry.link, onProgress);
      } catch {
        return { ok: false, label: entry.result.title, ...empty, error: 'set-fetch' };
      }
      const label = imported.setTitle ?? entry.result.title;
      if (!imported.hymns.length) {
        return { ok: false, label, ...empty, failed: imported.failed, error: 'set-empty' };
      }
      const hymns = imported.hymns.map(prepareHymn).filter((hymn) => hymn.lyrics.trim());
      const prefs = actions.hymnPreferences();
      let firstSlideId: string | null = null;
      for (const hymn of hymns) {
        actions.addHymn({ ...hymn, showAuthorOnSlides: prefs.showAuthor }, prefs.partsMode);
        firstSlideId ??= actions.selectedSlideId();
      }
      actions.addToLibrary(hymns);
      return { ok: true, label, firstSlideId, added: hymns.length, failed: imported.requested - hymns.length };
    }
  }
}
