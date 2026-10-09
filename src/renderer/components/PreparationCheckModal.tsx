import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, AlertCircle, CheckCircle2, ClipboardCheck, RefreshCw, X } from 'lucide-react';
import { measureSlideReadability } from '../readinessMeasurement';
import { loadGoogleFont, slideFonts } from '../fontLoader';
import { useStore } from '../state/useStore';
import {
  analyzePresentationReadiness,
  collectMediaResources,
  type SlideReadinessResult,
  type ReadinessIssue,
} from '../../shared/readiness';
import Dialog from './Dialog';
import { splitScripture } from '../hymnSplit';

type Slide = ReturnType<typeof useStore.getState>['presentation']['slides'][number];

const SEVERITY_ICON = {
  error: AlertCircle,
  warning: AlertTriangle,
} as const;

const SEVERITY_CLASS = {
  error: 'flex items-start gap-2 text-xs text-red-300',
  warning: 'flex items-start gap-2 text-xs text-amber-300',
} as const;

const SPLITTABLE_ISSUES = new Set(['textOverflow', 'longTextSmallFont']);
/** Max time (ms) the check may hold the main thread before yielding to the UI. */
const YIELD_BUDGET_MS = 12;

const severityRank = (issue: ReadinessIssue) => (issue.severity === 'error' ? 0 : 1);

/* -------------------------------------------------------------------------- */
/* The check itself (pure async function, no React)                            */
/* -------------------------------------------------------------------------- */

/**
 * Runs every readiness check. Returns `undefined` if cancelled; throws if media
 * cannot be verified (an "all clear" that skipped the media check would be misleading).
 */
async function runPreparationCheck(
  slides: Slide[],
  isCancelled: () => boolean
): Promise<SlideReadinessResult[] | undefined> {
  const base = new Map(analyzePresentationReadiness(slides).map((result) => [result.slideId, result]));

  // Collect once per slide and de-duplicate, so shared media/fonts are checked a single time.
  const mediaBySlide = slides.map((slide) => [...new Set(collectMediaResources(slide))]);
  const fontsBySlide = slides.map((slide) => [...new Set(Array.from(slideFonts(slide)))]);

  const resources = [...new Set(mediaBySlide.flat())];
  let statuses: Record<string, boolean> = {};
  if (resources.length > 0) {
    const checked = await window.electronAPI?.checkMediaResources?.(resources);
    if (!checked) throw new Error('Resource checks unavailable');
    statuses = checked;
  }
  if (isCancelled()) return undefined;

  // Load every distinct font in parallel up front; a font that throws becomes a warning, not a failed check.
  const families = [...new Set(fontsBySlide.flat())];
  const fontStatus = new Map(
    await Promise.all(
      families.map(async (family) => {
        try {
          return [family, !!(await loadGoogleFont(family))] as const;
        } catch {
          return [family, false] as const;
        }
      })
    )
  );
  if (isCancelled()) return undefined;

  const results: SlideReadinessResult[] = [];
  let lastYield = performance.now();
  for (let index = 0; index < slides.length; index++) {
    if (isCancelled()) return undefined;
    const slide = slides[index];
    const issues: ReadinessIssue[] = [...(base.get(slide.id)?.issues ?? [])];

    for (const url of mediaBySlide[index]) {
      if (statuses[url] === false) issues.push({ severity: 'error', message: 'inaccessibleMedia', detail: url });
    }
    for (const family of fontsBySlide[index]) {
      if (!fontStatus.get(family)) issues.push({ severity: 'warning', message: 'fontUnavailable', detail: family });
    }
    issues.push(...measureSlideReadability(slide));

    if (issues.length) {
      // Errors first; sort is stable so the original order is kept within a severity.
      results.push({ slideId: slide.id, index, issues: issues.sort((a, b) => severityRank(a) - severityRank(b)) });
    }
    if (performance.now() - lastYield > YIELD_BUDGET_MS) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      lastYield = performance.now();
    }
  }
  return results;
}

/* -------------------------------------------------------------------------- */
/* One slide's issues (memoized: only re-renders when its own data changes)    */
/* -------------------------------------------------------------------------- */

const SlideIssues = memo(function SlideIssues({
  slideId,
  label,
  issues,
  canSplit,
  onJump,
  onSplit,
}: {
  slideId: string;
  label: string;
  issues: ReadinessIssue[];
  canSplit: boolean;
  onJump: (slideId: string) => void;
  onSplit: (slideId: string) => void;
}) {
  const { t } = useTranslation();
  const showSplit = canSplit && issues.some((issue) => SPLITTABLE_ISSUES.has(issue.message));
  return (
    <li className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
      <button
        type="button"
        onClick={() => onJump(slideId)}
        className="w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded-lg"
      >
        <span className="block text-sm font-semibold text-white/85 hover:text-blue-300 transition-colors">
          {label}
        </span>
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

  // `null` = no result yet for this open session (distinct from "checked, nothing found").
  const [results, setResults] = useState<SlideReadinessResult[] | null>(null);
  const [checking, setChecking] = useState(false);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);

  const { disconnected, noOutput } = useMemo(() => {
    const entries = Object.entries(outputs);
    return {
      disconnected: entries.some(([id, value]) => value.isOpen && !displays.some((display) => display.id === id)),
      noOutput: !isProjectorOpen && !entries.some(([, output]) => output.isOpen && output.mode !== 'stage'),
    };
  }, [outputs, displays, isProjectorOpen]);
  const outputProblem = disconnected || noOutput;

  useEffect(() => {
    if (!isOpen) {
      // Never show a previous session's results when the dialog is reopened.
      setResults(null);
      setChecking(false);
      setFailed(false);
      return;
    }
    let cancelled = false;
    setChecking(true);
    setFailed(false);
    runPreparationCheck(presentation.slides, () => cancelled)
      .then((next) => {
        if (!cancelled && next) setResults(next);
      })
      .catch((error) => {
        if (cancelled) return;
        console.error('Preparation check failed', error);
        setFailed(true);
      })
      .finally(() => {
        if (!cancelled) setChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, presentation.slides, retry]);

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

  // Full-screen "checking" only when there is nothing to show yet; re-checks keep the list visible.
  const showInitialChecking = !failed && (results === null || (checking && visible.length === 0));

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
          type="button"
          onClick={() => setIsOpen(false)}
          aria-label={t('common.close')}
          className="p-1 rounded hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
        >
          <X className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>

      {outputProblem && (
        <p role="status" className="mb-3 text-sm text-amber-300">
          {t(disconnected ? 'prepCheck.outputDisconnected' : 'prepCheck.outputClosed')}
        </p>
      )}

      {failed ? (
        <div role="alert" className="py-6 text-amber-300">
          <p>{t('prepCheck.checkFailed')}</p>
          <button
            type="button"
            className="mt-3 rounded bg-white/10 px-3 py-2 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
            onClick={() => setRetry((n) => n + 1)}
          >
            {t('prepCheck.retry')}
          </button>
        </div>
      ) : showInitialChecking ? (
        <p role="status" className="py-8 text-center">
          {t('prepCheck.checking')}
        </p>
      ) : visible.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <CheckCircle2 className="w-12 h-12 text-emerald-400" aria-hidden="true" />
          <p className="text-white/80 font-medium">{t(outputProblem ? 'prepCheck.contentClear' : 'prepCheck.allClear')}</p>
          <p className="text-sm text-white/45">{t('prepCheck.allClearHint')}</p>
        </div>
      ) : (
        <>
          <div className="mb-4 flex items-center justify-between gap-3">
            <p className="text-sm text-white/55">{t('prepCheck.summary', { count: visible.length })}</p>
            <button
              type="button"
              onClick={() => setRetry((n) => n + 1)}
              disabled={checking}
              className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-white/60 hover:bg-white/10 hover:text-white/85 disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
            >
              <RefreshCw className={checking ? 'w-3.5 h-3.5 animate-spin' : 'w-3.5 h-3.5'} aria-hidden="true" />
              {t('prepCheck.retry')}
            </button>
          </div>
          <ul className="space-y-2" aria-busy={checking}>
            {visible.map((result) => (
              <SlideIssues
                key={result.slideId}
                slideId={result.slideId}
                label={slideLabel(result.index)}
                issues={result.issues}
                canSplit={presentation.slides[result.index]?.type === 'text' && !presentation.slides[result.index]?.partsMode}
                onJump={jumpToSlide}
                onSplit={splitLongText}
              />
            ))}
          </ul>
        </>
      )}
    </Dialog>
  );
}