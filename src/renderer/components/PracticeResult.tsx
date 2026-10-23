import { useTranslation } from 'react-i18next';
import { useLayoutEffect, useRef, useState } from 'react';
import type { GuideResult, GuideResultStep } from '../../shared/practice';
import { SlidePreviewAny } from './SlidePreview';

const PREVIEW_WIDTH = 480;
const PREVIEW_HEIGHT = 270;

function ResultSlidePreview({ slide }: { slide: GuideResult['slides'][number] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const update = (width: number, height: number) => setSize(previous =>
      previous.width === width && previous.height === height ? previous : { width, height });
    update(container.clientWidth, container.clientHeight);
    const observer = new ResizeObserver(([entry]) => update(entry.contentRect.width, entry.contentRect.height));
    observer.observe(container);
    return () => observer.disconnect();
  }, []);
  const scale = Math.min(size.width / PREVIEW_WIDTH, size.height / PREVIEW_HEIGHT);
  // Legacy slides use an empty textColor to inherit the dark app's white text.
  // Keep that fallback inside the preview rather than inheriting the light guide card.
  return <div ref={containerRef} className="absolute inset-0 overflow-hidden text-white">
    {scale > 0 && <div className="absolute" style={{
      width: PREVIEW_WIDTH, height: PREVIEW_HEIGHT,
      left: (size.width - PREVIEW_WIDTH * scale) / 2,
      top: (size.height - PREVIEW_HEIGHT * scale) / 2,
      transform: `scale(${scale})`, transformOrigin: 'top left',
    }}>
      <SlidePreviewAny slide={slide} cardWidth={PREVIEW_WIDTH} enabled={false} />
    </div>}
  </div>;
}

/** Read-only snapshots of verified operations, never live output or playable media. */
export default function PracticeResult({ result, step }: { result: GuideResult; step: GuideResultStep }) {
  const { t } = useTranslation();
  return <div data-testid="guide-result" data-result-operation={result.operation} className="space-y-3">
    {step === 'delete-result' && <p className="text-sm text-slate-600">{t('guide.result.countChange', { before: result.beforeCount, after: result.afterCount })}</p>}
    {step === 'save-result' && <div className="rounded-lg bg-slate-100 p-3">
      <p className="font-semibold" data-testid="guide-saved-name">{result.savedName}</p>
      <p className="text-sm text-slate-600">{t('guide.result.savedCount', { count: result.afterCount })}</p>
    </div>}
    {step === 'delete-result' && <p className="text-sm font-semibold text-amber-700">{t('guide.result.deletedPreview')}</p>}
    {result.slides.length > 0 ? <div className="grid min-w-0 grid-cols-1 gap-4">
      {result.slides.map(slide => <figure key={slide.id} data-testid="guide-result-slide" data-result-slide-id={slide.id} className="space-y-2">
        <div aria-hidden="true" className={`relative aspect-video overflow-hidden rounded-lg border border-slate-300 bg-black pointer-events-none ${step === 'delete-result' ? 'opacity-50 grayscale' : ''}`}>
          <ResultSlidePreview slide={slide} />
        </div>
        <figcaption className="text-sm break-words text-slate-700">
          {slide.type === 'text' ? slide.content : t(`guide.result.${slide.type === 'countdown' ? 'countdownPreview' : 'imagePreview'}`)}
        </figcaption>
      </figure>)}
    </div> : <p className="text-sm">{t('guide.result.emptyPresentation')}</p>}
    {step === 'delete-result' && <div className="space-y-2">
      <h4 className="text-sm font-semibold">{t('guide.result.remaining', { count: result.afterCount })}</h4>
      {result.remaining?.length ? <ul className="space-y-1 text-sm text-slate-600">{result.remaining.map(slide => <li key={slide.id} className="truncate">{slide.content || t('guide.result.imagePreview')}</li>)}</ul>
        : <p className="text-sm text-slate-600">{t('guide.result.emptyPresentation')}</p>}
    </div>}
  </div>;
}
