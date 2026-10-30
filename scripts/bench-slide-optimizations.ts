/** node --import tsx scripts/bench-slide-optimizations.ts
 * Measures reducer CPU only, not input-to-paint or Electron IPC.
 */
import { performance } from 'node:perf_hooks';
import { normalizeSections } from '../src/shared/sectionModel';
import { withSlideContent } from '../src/shared/slideContent';
import { undoReducer, type UndoState } from '../src/renderer/state/undoReducer';
import type { Presentation } from '../src/renderer/types';

function measure(fn: () => void) {
  for (let i = 0; i < 50; i++) fn();
  const samples: number[] = [];
  for (let i = 0; i < 300; i++) {
    const start = performance.now(); fn(); samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  return { p50_ms: +samples[150].toFixed(4), p95_ms: +samples[285].toFixed(4) };
}

for (const count of [100, 1000, 5000]) {
  const deck = normalizeSections({ id: 'bench', name: 'Bench', zoom: 1,
    transition: { type: 'fade', duration: 400 },
    slides: Array.from({ length: count }, (_, i) => ({ id: 's' + i, type: 'text', content: 'Slide ' + i,
      sectionId: 'section-' + Math.floor(i / 50), styles: { fontSize: 48, textColor: '#fff', backgroundColor: '#000' } })),
    sections: Array.from({ length: Math.ceil(count / 50) }, (_, i) => ({ id: 'section-' + i, title: 'Section ' + i })),
  } as Presentation);
  const id = 's' + (count - 1);
  const initial = (): UndoState => ({ present: deck, past: [], future: [] });
  let full = initial(), incremental = initial(), sequence = 0;
  const setPath = measure(() => {
    const content = String(sequence++);
    const next = { ...full.present, slides: full.present.slides.map(slide => slide.id === id ? withSlideContent(slide, content) : slide) };
    full = undoReducer(full, { type: 'SET', payload: normalizeSections(next) });
  });
  const editPath = measure(() => {
    incremental = undoReducer(incremental, { type: 'EDIT_SLIDES', ids: [id], edit: { kind: 'content', content: String(sequence++) } });
  });
  console.log(JSON.stringify({ slides: count, normalized_SET: setPath, EDIT_SLIDES: editPath }));
}
