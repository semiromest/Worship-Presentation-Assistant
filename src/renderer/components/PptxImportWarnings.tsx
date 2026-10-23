import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';

/** Remains visible when a successful import navigates from the library to Slides. */
export default function PptxImportWarnings({ warnings, onClose }: { warnings: string[]; onClose: () => void }) {
  const { t } = useTranslation();
  if (!warnings.length) return null;
  return <aside role="status" aria-live="polite" className="fixed bottom-4 left-4 right-4 sm:left-auto sm:w-[min(36rem,calc(100vw-2rem))] z-[90] rounded-lg border border-amber-400/40 bg-surface-raised p-4 text-sm text-amber-100 shadow-xl">
    <div className="flex items-start gap-3">
      <p className="font-semibold flex-1">{t('common.importCompleteWithWarnings')}</p>
      <button type="button" onClick={onClose} aria-label={t('common.close')} className="p-1 rounded focus-visible:ring-2 focus-visible:ring-amber-300"><X size={18} aria-hidden="true" /></button>
    </div>
    <p className="mt-1">{t('common.importReviewWarnings')}</p>
    <ul tabIndex={0} aria-label={t('common.importCompleteWithWarnings')} className="mt-2 max-h-[30vh] overflow-y-auto list-disc pl-5 space-y-1 break-words focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300">
      {warnings.map((warning, i) => <li key={i}>{warning}</li>)}
    </ul>
  </aside>;
}
