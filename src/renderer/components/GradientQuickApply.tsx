import ControlTooltip from './ControlTooltip';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Popover } from '@base-ui/react/popover';
import { useTranslation } from 'react-i18next';
import { Palette } from 'lucide-react';
import { useStore } from '../state/useStore';
import { GradientLibraryGallery, useGradientLibrary } from './GradientLibraryGallery';
import { applyGeneratedBackground } from '../gradientBackground';
import { requestGradientEditor } from '../gradientEditorRequest';
import type { GradientLibraryEntry } from '../../shared/gradientLibrary';
import { playSfx } from '../sfx';

export function GradientQuickApply() {
  const { t } = useTranslation();
  const presentation = useStore((s) => s.presentation);
  const selection = useStore((s) => s.selectedSlideIds);
  const liveSlideId = useStore((s) => s.liveSlideId);
  const liveOpen = useStore((s) => s.isProjectorWindowOpen);
  const [open, setOpen] = useState(false);
  const targets = useMemo(
    () => presentation.slides.filter((slide) => selection.has(slide.id) && slide.type === 'text'),
    [presentation, selection]
  );
  const eligibleSelected = presentation.slides.filter((slide) => selection.has(slide.id)).length;
  const library = useGradientLibrary(open);
  const base = useRef({ presentation, selection });
  useEffect(() => {
    if (open && (base.current.presentation !== presentation || base.current.selection !== selection)) setOpen(false);
  }, [open, presentation, selection]);
  function choose(entry: GradientLibraryEntry) {
    const state = useStore.getState();
    if (state.presentation !== base.current.presentation || state.selectedSlideIds !== base.current.selection) {
      setOpen(false);
      return;
    }
    const ids = state.presentation.slides
      .filter((slide) => state.selectedSlideIds.has(slide.id) && slide.type === 'text')
      .map((slide) => slide.id);
    if (!ids.length) return;
    state.dispatchUndo({
      type: 'SET',
      payload: applyGeneratedBackground(state.presentation, ids, entry.image, entry.recipe, false),
    });
    setOpen(false);
    playSfx('success');
  }
  function openEditor() {
    const state = useStore.getState();
    const target = targets.find((slide) => slide.id === state.selectedSlideId) ?? targets[0];
    if (!target) return;
    setOpen(false);
    requestGradientEditor(target.id);
    state.openEditor(target.id);
  }
  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        if (next) base.current = { presentation, selection };
        setOpen(next);
      }}
    >
      <ControlTooltip suppress={open}><Popover.Trigger
        disabled={!targets.length}
        aria-label={t('gradientLibrary.quickApply')}
        title={t('gradientLibrary.quickApply')}
        data-testid="gradient-quick-apply"
      >
        <Palette size={16} aria-hidden="true" />
        <span>{t('gradientLibrary.quickApply')}</span>
      </Popover.Trigger></ControlTooltip>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="end" sideOffset={8} className="z-[80]">
          <Popover.Popup
            aria-label={t('gradientLibrary.quickApply')}
            className="base-popover-popup w-[360px] max-w-[calc(100vw-24px)] rounded-xl border border-white/15 bg-[#202128] p-3 text-white shadow-2xl"
          >
            <h2 className="text-sm font-semibold">{t('gradient.targetCount', { count: targets.length })}</h2>
            {eligibleSelected > targets.length && (
              <p className="mt-1 text-xs text-white/60">
                {t('gradientLibrary.skipped', { count: eligibleSelected - targets.length })}
              </p>
            )}
            {liveOpen && targets.some((slide) => slide.id === liveSlideId) && (
              <p className="mt-1 text-xs text-amber-300">{t('gradientLibrary.liveIncluded')}</p>
            )}
            <div className="my-3 max-h-[45vh] overflow-y-auto">
              <GradientLibraryGallery {...library} onChoose={choose} />
            </div>
            <button
              type="button"
              onClick={openEditor}
              className="w-full rounded-md border border-violet-400/30 px-2 py-2 text-xs text-violet-200 hover:bg-violet-400/10 focus-visible:ring-2 focus-visible:ring-violet-300"
            >
              {t('gradientLibrary.openEditor')}
            </button>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
