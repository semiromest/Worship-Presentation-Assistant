import { measureSlideReadability } from '../readinessMeasurement';
import { loadGoogleFont, slideFonts } from '../fontLoader';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, AlertCircle, CheckCircle2, ClipboardCheck, X } from 'lucide-react';
import { useStore } from '../state/useStore';
import { analyzePresentationReadiness, collectMediaResources, type SlideReadinessResult, type ReadinessIssue } from '../../shared/readiness';
import Dialog from './Dialog';
import { splitScripture } from '../hymnSplit';

const SEVERITY_ICON = {
  error: AlertCircle,
  warning: AlertTriangle,
} as const;

export default function PreparationCheckModal() {
  const { t } = useTranslation();
  const isOpen = useStore((s) => s.isPrepCheckOpen);
  const setIsOpen = useStore((s) => s.setIsPrepCheckOpen);
  const presentation = useStore((s) => s.presentation);
  const setSelectedSlideId = useStore((s) => s.setSelectedSlideId);
  const setActiveTab = useStore((s) => s.setActiveTab);

  const displays = useStore(s => s.displays);
  const outputs = useStore(s => s.outputAssignments);
  const isProjectorOpen = useStore(s => s.isProjectorWindowOpen);
  const [results, setResults] = useState<SlideReadinessResult[]>([]);
  const [checking, setChecking] = useState(false);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const disconnected = Object.entries(outputs).some(([id, value]) => value.isOpen && !displays.some(display => display.id === id));
  const noOutput = !isProjectorOpen && !Object.values(outputs).some(output => output.isOpen && output.mode !== 'stage');
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setChecking(true); setFailed(false);
    void (async () => {
      try {
        const map = new Map(analyzePresentationReadiness(presentation.slides).map(result => [result.slideId, result]));
        const resources = presentation.slides.flatMap(collectMediaResources);
        const statuses = await window.electronAPI?.checkMediaResources?.(resources);
        if (!statuses) throw new Error('Resource checks unavailable');
        for (let index = 0; index < presentation.slides.length; index++) {
          if (cancelled) return;
          const slide = presentation.slides[index];
          const issues = [...(map.get(slide.id)?.issues ?? [])];
          collectMediaResources(slide).forEach(url => {
            if (statuses[url] === false) issues.push({ severity: 'error', message: 'inaccessibleMedia', detail: url });
          });
          for (const family of slideFonts(slide)) {
            if (!await loadGoogleFont(family)) issues.push({ severity: 'warning', message: 'fontUnavailable', detail: family });
          }
          issues.push(...measureSlideReadability(slide));
          if (issues.length) map.set(slide.id, { slideId: slide.id, index, issues });
          if (index % 8 === 0) await new Promise(resolve => setTimeout(resolve, 0));
        }
        if (!cancelled) setResults([...map.values()].sort((a,b) => a.index - b.index));
      } catch { if (!cancelled) setFailed(true); }
      finally { if (!cancelled) setChecking(false); }
    })();
    return () => { cancelled = true; };
  }, [isOpen, presentation.slides, retry]);

  const jumpToSlide = (slideId: string) => {
    setSelectedSlideId(slideId);
    useStore.getState().setSelectedSlideIds(new Set([slideId]));
    useStore.getState().setSearchQuery('');
    setActiveTab('slides');
    setIsOpen(false);
  };

  const splitLongText = (slideId: string) => {
    const state = useStore.getState();
    const slide = state.presentation.slides.find((item) => item.id === slideId);
    if (!slide || slide.type !== 'text') return;
    const parts = splitScripture(slide.content).parts;
    if (parts.length < 2) return;
    state.dispatchUndo({
      type: 'SET',
      payload: {
        ...state.presentation,
        slides: state.presentation.slides.map((item) => item.id === slideId
          ? { ...item, partsMode: true, parts, activePart: 0, content: parts[0] }
          : item),
      },
    });
  };

  const slideLabel = (_slideId: string, index: number): string => {
    const slide = presentation.slides[index];
    const title = slide?.group?.title?.trim() || slide?.content?.trim().split('\n')[0];
    return title ? `${index + 1}. ${title.slice(0, 40)}` : `${t('common.slide')} ${index + 1}`;
  };

  return (
    <Dialog
      open={isOpen}
      onClose={() => setIsOpen(false)}
      labelledBy="prep-check-title"
      className="bg-surface-overlay border border-white/10 rounded-2xl p-6 max-w-xl w-full mx-4 shadow-2xl max-h-[85vh] overflow-y-auto"
    >
      <div className="flex items-center justify-between mb-4">
        <h2 id="prep-check-title" className="flex items-center gap-2 text-lg font-bold">
          <ClipboardCheck className="w-5 h-5 text-blue-400" aria-hidden="true" />
          {t('prepCheck.title')}
        </h2>
        <button
          onClick={() => setIsOpen(false)}
          aria-label={t('common.close')}
          className="p-1 rounded hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
        >
          <X className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>

      {(noOutput || disconnected) && <p role="status" className="mb-3 text-sm text-amber-300">{t(disconnected ? 'prepCheck.outputDisconnected' : 'prepCheck.outputClosed')}</p>}
      {checking ? <p role="status" className="py-8 text-center">{t('prepCheck.checking')}</p> : failed ? (
        <div role="alert" className="py-6 text-amber-300"><p>{t('prepCheck.checkFailed')}</p><button className="mt-3 rounded bg-white/10 px-3 py-2" onClick={() => setRetry(n => n + 1)}>{t('prepCheck.retry')}</button></div>
      ) : results.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <CheckCircle2 className="w-12 h-12 text-emerald-400" aria-hidden="true" />
          <p className="text-white/80 font-medium">{t(noOutput || disconnected ? 'prepCheck.contentClear' : 'prepCheck.allClear')}</p>
          <p className="text-sm text-white/45">{t('prepCheck.allClearHint')}</p>
        </div>
      ) : (
        <>
          <p className="mb-4 text-sm text-white/55">
            {t('prepCheck.summary', { count: results.length })}
          </p>
          <ul className="space-y-2">
            {results.map((result) => (
              <li
                key={result.slideId}
                className="rounded-xl border border-white/10 bg-white/[0.03] p-3"
              >
                <button
                  onClick={() => jumpToSlide(result.slideId)}
                  className="w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded-lg"
                >
                  <span className="block text-sm font-semibold text-white/85 hover:text-blue-300 transition-colors">
                    {slideLabel(result.slideId, result.index)}
                  </span>
                </button>
                <ul className="mt-2 space-y-1">
                  {result.issues.map((issue: ReadinessIssue, i: number) => {
                    const Icon = SEVERITY_ICON[issue.severity];
                    return (
                      <li
                        key={i}
                        className={
                          issue.severity === 'error'
                            ? 'flex items-start gap-2 text-xs text-red-300'
                            : 'flex items-start gap-2 text-xs text-amber-300'
                        }
                      >
                        <Icon className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
                        <span className="min-w-0 break-words">{t(`prepCheck.issue.${issue.message}`)}{issue.detail && <span className="block text-white/50 text-[11px] break-all">{issue.detail}</span>}</span>
                      </li>
                    );
                  })}
                </ul>
                {result.issues.some((issue) => issue.message === 'textOverflow' || issue.message === 'longTextSmallFont') &&
                  presentation.slides[result.index]?.type === 'text' && (
                    <button
                      type="button"
                      onClick={() => splitLongText(result.slideId)}
                      className="mt-3 rounded-lg border border-blue-400/25 bg-blue-500/10 px-3 py-1.5 text-xs text-blue-200 hover:bg-blue-500/20 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
                    >
                      {t('prepCheck.splitAction')}
                    </button>
                  )}
              </li>
            ))}
          </ul>
        </>
      )}
    </Dialog>
  );
}
