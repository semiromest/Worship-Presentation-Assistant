import type { HTMLAttributes, MouseEventHandler } from 'react';
import { useTranslation } from 'react-i18next';
import { finishTour } from './tourController';

export type TourCardProps = {
  id: string; index: number; size: number; last: boolean;
  container: HTMLAttributes<HTMLDivElement>;
  onBack: MouseEventHandler<HTMLButtonElement>;
  onNext: MouseEventHandler<HTMLButtonElement>;
};
export const tourButton = 'px-4 py-2 rounded-lg text-sm font-semibold bg-white/10 hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400';
export default function TourCard({ id, index, size, last, container, onBack, onNext }: TourCardProps) {
  const { t } = useTranslation();
  const page = id.startsWith('page-') ? id.slice(5) : null;
  return <div {...container} data-tour-surface data-testid="tour-card" aria-labelledby="tour-step-title" aria-describedby="tour-step-body"
    className="bg-surface-overlay text-white border border-white/15 rounded-2xl p-5 shadow-2xl w-[360px] max-w-[calc(100vw-32px)] max-h-[calc(100vh-32px)] overflow-y-auto">
    <div className="flex justify-between items-center gap-3 mb-3">
      <span className="text-xs text-white/60">{t('tour.progress', { current: index + 1, total: size })}</span>
      <button className={tourButton} onClick={() => finishTour('dismissed')} aria-label={t('tour.close')}>×</button>
    </div>
    <h2 id="tour-step-title" className="font-bold text-lg mb-2">{t(page ? `nav.${page}` : `tour.steps.${id}.title`)}</h2>
    <p id="tour-step-body" className="text-sm text-white/75 leading-relaxed">{t(page ? `tour.pages.${page}` : `tour.steps.${id}.body`)}</p>
    <div className="flex justify-end gap-2 mt-5">
      {index > 0 && <button data-action="back" className={tourButton} onClick={onBack}>{t('tour.back')}</button>}
      <button data-action="primary" className={`${tourButton} bg-blue-600 hover:bg-blue-500`} onClick={onNext}>{t(last ? 'tour.done' : 'tour.next')}</button>
    </div>
  </div>;
}
