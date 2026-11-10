import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRight, Lock } from 'lucide-react';
import { useStore } from '../state/useStore';
import { findLockedSlideIndex } from '../slideLock';
import { SlidePreviewAny } from './SlidePreview';

const THUMB_WIDTH = 112;

/** First readable line of a slide, for the "next" label (text slides only). */
function slideExcerpt(content: unknown): string {
  if (typeof content !== 'string') return '';
  return content.split('\n').map(line => line.trim()).find(Boolean) ?? '';
}

/**
 * Optional operator aid under the live preview: shows what goes on screen next and
 * sends it live with one click — the same step as the remote's "next" command
 * (respects the broadcast lock, stops at the last slide). Off by default; toggled
 * in Settings → Presentation.
 */
function NextSlidePreview() {
  const { t } = useTranslation();
  const slides = useStore(s => s.presentation.slides);
  const liveIndex = useStore(s => s.liveIndex);
  const nextIndex = liveIndex + 1;
  const next = slides[nextIndex];
  const locked = findLockedSlideIndex(slides) >= 0;
  const excerpt = next?.type === 'text' ? slideExcerpt(next.content) : '';

  const goNext = () => {
    const state = useStore.getState();
    const current = state.presentation.slides;
    if (findLockedSlideIndex(current) >= 0) return;
    const target = current[state.liveIndex + 1];
    if (!target) return;
    state.selectSlides({ activeId: target.id, liveTargetId: target.id });
  };

  if (!next) {
    return (
      <div className="next-slide-preview px-3 py-2 border-b border-white/10" data-testid="next-slide-preview">
        <p role="status" className="text-xs text-white/60">{t('common.nextSlideEnd')}</p>
      </div>
    );
  }

  const label = excerpt ? `${t('common.nextSlideGoLive')}: ${excerpt}` : t('common.nextSlideGoLive');
  return (
    <div className="next-slide-preview px-3 py-2 border-b border-white/10" data-testid="next-slide-preview">
      <button
        type="button"
        onClick={goNext}
        disabled={locked}
        aria-label={label}
        title={locked ? t('common.slideLockActiveHint') : label}
        className="group flex w-full items-center gap-3 rounded-lg border border-white/10 bg-white/[0.03] p-1.5 text-left transition-colors hover:bg-white/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span className="relative aspect-video shrink-0 overflow-hidden rounded-md border border-white/10 bg-black" style={{ width: THUMB_WIDTH }} aria-hidden="true">
          <SlidePreviewAny slide={next} cardWidth={THUMB_WIDTH} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 text-xs font-semibold text-white/75">
            {t('common.upcomingSlide')}
            <span className="font-mono font-normal text-white/60">{nextIndex + 1} / {slides.length}</span>
          </span>
          {excerpt && <span className="mt-0.5 block truncate text-sm text-white/90">{excerpt}</span>}
        </span>
        {locked
          ? <Lock className="h-4 w-4 shrink-0 text-amber-300" aria-hidden="true" />
          : <ChevronRight className="h-4 w-4 shrink-0 text-white/60 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />}
      </button>
    </div>
  );
}

export default memo(NextSlidePreview);
