import { useTranslation } from 'react-i18next';
import type { GuideResult, GuideResultStep } from '../../shared/practice';
import { SlidePreviewAny } from './SlidePreview';

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
    {result.slides.length > 0 ? <div className={result.slides.length > 1 ? 'grid gap-4 sm:grid-cols-2' : 'mx-auto max-w-lg'}>
      {result.slides.map(slide => <figure key={slide.id} data-testid="guide-result-slide" data-result-slide-id={slide.id} className="space-y-2">
        <div aria-hidden="true" className={`aspect-video overflow-hidden rounded-lg border border-slate-300 bg-black pointer-events-none ${step === 'delete-result' ? 'opacity-50 grayscale' : ''}`}>
          <SlidePreviewAny slide={slide} cardWidth={480} enabled={false} />
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
