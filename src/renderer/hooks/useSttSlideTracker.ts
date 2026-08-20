import { useEffect, useRef } from 'react';
import { IS_PROJECTOR_MODE } from '../constants';
import { useStore } from '../state/useStore';
import { useSttStore } from '../state/useSttStore';
import { useSlideTrackerStore } from '../state/useSlideTrackerStore';
import {
  buildBuffer,
  buildDeckIndex,
  collectSlideText,
  DEFAULT_WINDOW_WORDS,
  evaluateTracking,
  type DeckIndex,
} from '../stt/slideMatcher';
import type { Slide } from '../types';

// ─── STT slide tracker ───────────────────────────────────────────────────────
// Listens to the live transcript (committed utterances + the in-progress text)
// and compares a rolling window of its words against the deck's TEXT slides.
// When one slide keeps winning decisively, the engine jumps to it — so the
// presentation follows the speaker without explicit "next slide" commands.
//
// - Runs in the CONTROL window only (navigation belongs here; the projector
//   window's store is synchronized one-way via IPC).
// - Re-uses the existing Soniox session and original-language text, so it adds
//   zero cost and is independent of translation.
// - Evaluation is throttled. Fast paths (prefix / strong phrase) switch on a
//   single tick; the normal path keeps a two-tick hysteresis + margin gate to
//   avoid flickering between near-duplicate slides.
// - The deck index is rebuilt lazily, only when the slides array reference
//   actually changes (never on every STT tick).
// - A slide switch is applied as one store update via autoTrackToSlide.

const THROTTLE_MS = 30;
const REQUIRED_WINS = 2;
const MAX_UTTERANCE_AGE_MS = 10_000;
const MAX_UTTERANCES = 10;

/**
 * buildBuffer only keeps the last DEFAULT_WINDOW_WORDS tokens, so the
 * transcript never needs to accumulate more than a small word budget.
 */
const TRANSCRIPT_WORD_BUDGET = DEFAULT_WINDOW_WORDS + 8;

/** Identity + text of text slides; changes only when the index must rebuild. */
function slidesSignature(slides: Slide[]): string {
  return slides
    .map((s) => (s.type === 'text' ? `${s.id}\u0001${collectSlideText(s)}` : s.id))
    .join('\u0003');
}

function wordCount(text: string): number {
  let count = 0;
  let inWord = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (ch === ' ' || ch === '\n' || ch === '\t') {
      inWord = false;
    } else if (!inWord) {
      inWord = true;
      count++;
    }
  }

  return count;
}

/**
 * Rolling transcript: newest utterances (walked backwards) + the current live
 * text. Stops once the word budget is reached — buildBuffer discards anything
 * beyond the last window words anyway.
 */
function buildTranscript(state: ReturnType<typeof useSttStore.getState>): string {
  const now = Date.now();
  const parts: string[] = [];
  let words = 0;

  const live = `${state.currentOriginal} ${state.partialOriginal}`.trim();
  if (live) {
    parts.push(live);
    words += wordCount(live);
  }

  const utterances = state.utterances;
  const floor = Math.max(0, utterances.length - MAX_UTTERANCES);

  for (let i = utterances.length - 1; i >= floor; i--) {
    if (words >= TRANSCRIPT_WORD_BUDGET) break;

    const u = utterances[i];
    if (now - u.at > MAX_UTTERANCE_AGE_MS) break;
    if (!u.original) continue;

    parts.unshift(u.original);
    words += wordCount(u.original);
  }

  return parts.join(' ').trim();
}

export function useSttSlideTracker(): void {
  const indexRef = useRef<DeckIndex | null>(null);
  const signatureRef = useRef<string | null>(null);
  const slidesRef = useRef<Slide[] | null>(null);
  const candidateRef = useRef<{ index: number; wins: number } | null>(null);

  useEffect(() => {
    // The engine has no meaning in the projector window (see note above).
    if (IS_PROJECTOR_MODE) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    let lastRunAt = 0;

    const run = () => {
      timer = null;
      lastRunAt = Date.now();

      const tracker = useSlideTrackerStore.getState();
      if (!tracker.enabled) {
        candidateRef.current = null;
        return;
      }

      const store = useStore.getState();
      const stt = useSttStore.getState();

      const slides = store.presentation.slides;
      if (slides.length === 0) return;

      // Rebuild the index only when the deck's slides array actually changed
      // (immutable updates produce a new reference); skip the O(deck)
      // signature walk on every STT tick.
      if (slides !== slidesRef.current) {
        slidesRef.current = slides;

        const signature = slidesSignature(slides);
        if (signature !== signatureRef.current) {
          indexRef.current = buildDeckIndex(slides);
          signatureRef.current = signature;
          candidateRef.current = null;
        }
      }

      const deck = indexRef.current;
      if (!deck || deck.docs.length === 0) return;

      const transcript = buildTranscript(stt);
      if (!transcript) return;

      const buffer = buildBuffer(transcript, DEFAULT_WINDOW_WORDS);
      const decision = evaluateTracking(buffer, deck, store.liveIndex, tracker.sensitivity);
      if (!decision) return;

      // Feedback for the panel (shown even when not confident).
      tracker.setLastResult({
        index: decision.index,
        score: decision.score,
        confident: decision.confident,
        at: Date.now(),
      });

      if (!decision.confident || decision.index === null || decision.index === store.liveIndex) {
        candidateRef.current = null;
        return;
      }

      // Fast paths switch on the first evaluation. Hysteresis stays for the
      // normal path to damp brief ambiguous mid-line states.
      const winsNeeded = decision.fastPath ? 1 : REQUIRED_WINS;

      const cand = candidateRef.current;
      if (cand && cand.index === decision.index) {
        cand.wins += 1;
      } else {
        candidateRef.current = { index: decision.index, wins: 1 };
      }

      if ((candidateRef.current?.wins ?? 0) >= winsNeeded) {
        // One store update: navigate, select, and skip the transition.
        store.autoTrackToSlide(decision.index);
        candidateRef.current = null;
      }
    };

    const schedule = () => {
      const elapsed = Date.now() - lastRunAt;
      if (elapsed >= THROTTLE_MS) {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        run();
      } else if (!timer) {
        timer = setTimeout(run, THROTTLE_MS - elapsed);
      }
    };

    const unsubscribe = useSttStore.subscribe((state, prev) => {
      const changed =
        state.utterances !== prev.utterances ||
        state.currentOriginal !== prev.currentOriginal ||
        state.partialOriginal !== prev.partialOriginal;
      if (changed) schedule();
    });

    return () => {
      unsubscribe();
      if (timer) clearTimeout(timer);
    };
  }, []);
}
