import { useTranslation } from 'react-i18next';
import { Music } from 'lucide-react';
import { useStore } from '../state/useStore';
import { getSlideChordKey, normalizeTranspose } from '../../shared/slideChords';
import { writeStageChordsEnabled, useStageChordsEnabled } from '../stageChordsPreference';
import { playSfx } from '../sfx';
import type { Slide } from '../types';

/**
 * Service-level key control for a song that carries chords: transposes every
 * slide of the same song group (undoable). The library song is not changed.
 * Also toggles chords on the stage display.
 */
export default function SlideChordControl({ slide }: { slide: Slide }) {
  const { t } = useTranslation();
  const dispatchUndo = useStore((s) => s.dispatchUndo);
  const stageChords = useStageChordsEnabled();
  if (!slide.chords?.parts?.length) return null;
  const { from, to, transpose } = getSlideChordKey(slide);

  const shift = (step: number) => {
    const state = useStore.getState();
    const groupId = slide.group?.id;
    const next = normalizeTranspose((slide.chords?.transpose ?? 0) + step);
    const slides = state.presentation.slides.map((candidate) =>
      candidate.chords && (candidate.id === slide.id || (groupId && candidate.group?.id === groupId))
        ? { ...candidate, chords: { ...candidate.chords, transpose: next } }
        : candidate,
    );
    dispatchUndo({ type: 'SET', payload: { ...state.presentation, slides } });
    playSfx('select');
  };

  return (
    <div className="m-4 rounded-xl border border-violet-400/20 bg-violet-500/5 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[11px] font-bold text-violet-200/80">
          <Music className="h-3.5 w-3.5" aria-hidden="true" />
          {t('hymnChords.slideKey')}
        </span>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => shift(-1)}
            className="h-7 w-7 rounded-md border border-white/10 bg-white/5 text-sm hover:bg-white/10"
            aria-label={t('hymnChords.transposeDown')}
            title={t('hymnChords.transposeDown')}
          >
            −
          </button>
          <span className="min-w-[72px] text-center text-xs font-semibold tabular-nums text-white/85" aria-live="polite">
            {from ? (transpose ? `${from} → ${to}` : from) : '—'}
            {transpose !== 0 && <span className="ml-1 text-white/50">({transpose > 0 ? `+${transpose}` : transpose})</span>}
          </span>
          <button
            type="button"
            onClick={() => shift(1)}
            className="h-7 w-7 rounded-md border border-white/10 bg-white/5 text-sm hover:bg-white/10"
            aria-label={t('hymnChords.transposeUp')}
            title={t('hymnChords.transposeUp')}
          >
            +
          </button>
        </div>
      </div>
      <label className="flex items-center gap-2 text-[11px] text-white/60 cursor-pointer">
        <input
          type="checkbox"
          checked={stageChords}
          onChange={(e) => { writeStageChordsEnabled(e.target.checked); playSfx(e.target.checked ? 'toggle-on' : 'toggle-off'); }}
          className="accent-violet-500"
        />
        {t('hymnChords.showOnStage')}
      </label>
    </div>
  );
}
