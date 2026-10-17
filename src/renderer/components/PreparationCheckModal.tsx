import { playSfx } from '../sfx';
import { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, AlertCircle, CheckCircle2, ClipboardCheck, RefreshCw, X } from 'lucide-react';
import { useStore } from '../state/useStore';
import type { ReadinessIssue } from '../../shared/readiness';
import { usePreparationStore } from '../state/usePreparationStore';
import Dialog from './Dialog';
import { splitScripture } from '../hymnSplit';

const SEVERITY_ICON = {
  error: AlertCircle,
  warning: AlertTriangle,
} as const;

const SEVERITY_CLASS = {
  error: 'flex items-start gap-2 text-xs text-red-300',
  warning: 'flex items-start gap-2 text-xs text-amber-300',
} as const;

const SPLITTABLE_ISSUES = new Set(['textOverflow', 'longTextSmallFont']);
const SlideIssues = memo(function SlideIssues({
  slideId,
  label,
  issues,
  canSplit,
  onJump,
  onSplit,
  focused,
}: {
  slideId: string;
  label: string;
  issues: ReadinessIssue[];
  canSplit: boolean;
  onJump: (slideId: string) => void;
  onSplit: (slideId: string) => void;
  focused: boolean;
}) {
  const { t } = useTranslation();
  const itemRef = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (focused) itemRef.current?.scrollIntoView({ block: 'nearest' });
  }, [focused]);
  const showSplit = canSplit && issues.some((issue) => SPLITTABLE_ISSUES.has(issue.message));
  return (
    <li
      ref={itemRef}
      data-preparation-slide={slideId}
      className={`rounded-xl border bg-white/[0.03] p-3 ${focused ? 'border-blue-400' : 'border-white/10'}`}
    >
      <button
        type="button"
        onClick={() => onJump(slideId)}
        className="w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded-lg"
      >
        <span className="block text-sm font-semibold text-white/85 hover:text-blue-300 transition-colors">{label}</span>
      </button>
      <ul className="mt-2 space-y-1">
        {issues.map((issue, i) => {
          const Icon = SEVERITY_ICON[issue.severity];
          return (
            <li key={`${issue.message}:${issue.detail ?? ''}:${i}`} className={SEVERITY_CLASS[issue.severity]}>
              <Icon className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
              <span className="sr-only">
                {issue.severity === 'error'
                  ? t('prepCheck.severity.error', { defaultValue: 'Error' })
                  : t('prepCheck.severity.warning', { defaultValue: 'Warning' })}
                :{' '}
              </span>
              <span className="min-w-0 break-words">
                {t(`prepCheck.issue.${issue.message}`, { defaultValue: issue.message })}
                {issue.detail && <span className="block text-white/50 text-[11px] break-all">{issue.detail}</span>}
              </span>
            </li>
          );
        })}
      </ul>
      {showSplit && (
        <button
          type="button"
          onClick={() => onSplit(slideId)}
          className="mt-3 rounded-lg border border-blue-400/25 bg-blue-500/10 px-3 py-1.5 text-xs text-blue-200 hover:bg-blue-500/20 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
        >
          {t('prepCheck.splitAction')}
        </button>
      )}
    </li>
  );
});

/* -------------------------------------------------------------------------- */
/* Modal                                                                       */
/* -------------------------------------------------------------------------- */

export default function PreparationCheckModal() {
  const { t } = useTranslation();
  const isOpen = useStore((s) => s.isPrepCheckOpen);
  const setIsOpen = useStore((s) => s.setIsPrepCheckOpen);
  const presentation = useStore((s) => s.presentation);
  const setSelectedSlideId = useStore((s) => s.setSelectedSlideId);
  const setActiveTab = useStore((s) => s.setActiveTab);
  const displays = useStore((s) => s.displays);
  const outputs = useStore((s) => s.outputAssignments);
  const isProjectorOpen = useStore((s) => s.isProjectorWindowOpen);

  const results = usePreparationStore((s) => s.results);
  const status = usePreparationStore((s) => s.status);
  const focusedSlideId = usePreparationStore((s) => s.focusedSlideId);
  const requestCheck = usePreparationStore((s) => s.requestCheck);
  const disconnectedIds = usePreparationStore((s) => s.disconnectedOutputIds);
  const checking = status === 'checking';
  const disconnected =
    disconnectedIds.length > 0 ||
    Object.entries(outputs).some(([id, output]) => output.isOpen && !displays.some((display) => display.id === id));
  const noOutput =
    !isProjectorOpen && !Object.values(outputs).some((output) => output.isOpen && output.mode !== 'stage');

  // Results can briefly outlive the slides they describe (e.g. right after a split or delete),
  // so positions and existence are always resolved against the current slide list.
  const slideIndex = useMemo(
    () => new Map(presentation.slides.map((slide, index) => [slide.id, index])),
    [presentation.slides]
  );
  const visible = useMemo(
    () =>
      (results ?? [])
        .filter((result) => slideIndex.has(result.slideId))
        .map((result) => ({ ...result, index: slideIndex.get(result.slideId)! })),
    [results, slideIndex]
  );

  const jumpToSlide = useCallback(
    (slideId: string) => {
      const state = useStore.getState();
      setSelectedSlideId(slideId);
      state.setSelectedSlideIds(new Set([slideId]));
      state.setSearchQuery('');
      state.setSectionFilterId('');
      setActiveTab('slides');
      setIsOpen(false);
    },
    [setSelectedSlideId, setActiveTab, setIsOpen]
  );

  const splitLongText = useCallback((slideId: string) => {
    const state = useStore.getState();
    const slide = state.presentation.slides.find((item) => item.id === slideId);
    // A slide already in parts mode only holds its active part in `content`; splitting again would drop the rest.
    if (!slide || slide.type !== 'text' || slide.partsMode) return;
    const parts = splitScripture(slide.content).parts;
    if (parts.length < 2) return;
    state.dispatchUndo({
      type: 'SET',
      payload: {
        ...state.presentation,
        slides: state.presentation.slides.map((item) =>
          item.id === slideId ? { ...item, partsMode: true, parts, activePart: 0, content: parts[0] } : item
        ),
      },
    });
  }, []);

  const slideLabel = (index: number): string => {
    const slide = presentation.slides[index];
    const title = slide?.group?.title?.trim() || slide?.content?.trim().split('\n')[0];
    return title ? `${index + 1}. ${title.slice(0, 40)}` : `${t('common.slide')} ${index + 1}`;
  };

  return (
    <Dialog
      open={isOpen}
      onClose={() => { setIsOpen(false); playSfx('close'); }}
      labelledBy="prep-check-title"
      className="bg-surface-overlay border border-white/10 rounded-2xl p-6 max-w-xl w-full mx-4 shadow-2xl max-h-[85vh] overflow-y-auto"
    >
      <div className="flex items-center justify-between mb-4">
        <h2 id="prep-check-title" className="flex items-center gap-2 text-lg font-bold">
          <ClipboardCheck className="w-5 h-5 text-blue-400" aria-hidden="true" />
          {t('prepCheck.title')}
        </h2>
        <button
          type="button"
          onClick={() => { setIsOpen(false); playSfx('close'); }}
          aria-label={t('common.close')}
          className="p-1 rounded hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
        >
          <X className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>

      {(disconnected || noOutput) && (
        <p role="status" className={`mb-3 text-sm ${disconnected ? 'text-amber-300' : 'text-white/55'}`}>
          {t(disconnected ? 'prepCheck.outputDisconnected' : 'prepCheck.outputClosed')}
        </p>
      )}

      <div className="mb-3 flex items-center justify-between gap-3">
        <p
          role={status === 'failed' ? 'alert' : 'status'}
          className={`text-xs ${status === 'failed' ? 'text-amber-300' : 'text-white/60'}`}
          data-preparation-status={status}
        >
          {t(
            status === 'failed'
              ? 'prepCheck.checkFailed'
              : status === 'checking'
                ? 'prepCheck.checking'
                : status === 'stale'
                  ? 'prepCheck.stale'
                  : 'prepCheck.completed'
          )}
        </p>
        <button
          type="button"
          onClick={requestCheck}
          disabled={checking}
          className="shrink-0 inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs hover:bg-white/10 disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
        >
          <RefreshCw className={checking ? 'w-3.5 h-3.5 animate-spin' : 'w-3.5 h-3.5'} aria-hidden="true" />
          {t('prepCheck.retry')}
        </button>
      </div>

      {status === 'complete' &&
        (visible.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <CheckCircle2 className="w-12 h-12 text-emerald-400" aria-hidden="true" />
            <p className="text-white/80 font-medium">{t('prepCheck.contentClear')}</p>
            <p className="text-sm text-white/45">{t('prepCheck.allClearHint')}</p>
          </div>
        ) : (
          <>
            <div className="mb-4 flex items-center justify-between gap-3">
              <p className="text-sm text-white/55">{t('prepCheck.summary', { count: visible.length })}</p>
            </div>
            <ul className="space-y-2" aria-busy={checking}>
              {visible.map((result) => (
                <SlideIssues
                  key={result.slideId}
                  focused={isOpen && result.slideId === focusedSlideId}
                  slideId={result.slideId}
                  label={slideLabel(result.index)}
                  issues={result.issues}
                  canSplit={
                    presentation.slides[result.index]?.type === 'text' && !presentation.slides[result.index]?.partsMode
                  }
                  onJump={jumpToSlide}
                  onSplit={splitLongText}
                />
              ))}
            </ul>
          </>
        ))}
    </Dialog>
  );
}
