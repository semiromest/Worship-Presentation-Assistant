import { useState, useEffect } from 'react';
import type { BibleData } from './bibleParser';
import type { BibleSourceDescriptor } from './bibleRepository';
import { createBibleSearchIndexer, type BibleSearchIndex } from './bibleSearchIndex';
import { tokenizeScriptureText } from './scriptureModel';
const indexCache = new WeakMap<BibleData, Map<string, BibleSearchIndex>>();

export function useScriptureIndex(bible: BibleData | null, source: BibleSourceDescriptor | null) {
  const [index, setIndex] = useState<BibleSearchIndex | null>(null);
  const [indexing, setIndexing] = useState(false);
  useEffect(() => {
    if (!bible) {
      setIndex(null);
      setIndexing(false);
      return;
    }
    const indexScope = JSON.stringify(source);
    const cached = indexCache.get(bible)?.get(indexScope);
    if (cached) {
      setIndex(cached);
      setIndexing(false);
      return;
    }
    const builder = createBibleSearchIndexer(bible, tokenizeScriptureText, source);
    let cancelled = false,
      idle: number | null = null,
      timer: number | null = null;
    setIndex(null);
    setIndexing(true);
    const run = () => {
      if (cancelled) return;
      if (builder.step(160)) {
        const scopes = indexCache.get(bible) ?? new Map<string, BibleSearchIndex>();
        scopes.set(indexScope, builder.index);
        indexCache.set(bible, scopes);
        setIndex(builder.index);
        setIndexing(false);
      } else schedule();
    };
    const schedule = () => {
      if (window.requestIdleCallback) idle = window.requestIdleCallback(run, { timeout: 400 });
      else timer = window.setTimeout(run, 0);
    };
    schedule();
    return () => {
      cancelled = true;
      if (idle != null) window.cancelIdleCallback?.(idle);
      if (timer != null) clearTimeout(timer);
    };
  }, [bible, source]);

  return { index, indexing, setIndex, setIndexing };
}
