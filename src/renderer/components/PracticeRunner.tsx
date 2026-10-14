import { Component, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Compass } from 'lucide-react';
import { guideCardClass } from './GuideCard';
import { useTranslation } from 'react-i18next';
import { useStore } from '../state/useStore';
import { guideSteps, visibleGuideSteps, guideChapters, practiceTasks, guideTab, guideNarrative, isGuideResultStep, type GuideUi, type GuideStep, type PracticeWorkspace } from '../../shared/practice';
import { confirmDialog } from '../dialogs';
import { mergePracticeObservation } from '../../shared/practiceMerge';
import type { Presentation } from '../types';
import PracticeSpotlight from './PracticeSpotlight';
import PracticeResult from './PracticeResult';
import { getTourAnchor } from './Tour/tourController';
import { registerGuideEscape } from './Tour/guideBoundary';

const TARGET_WAIT_MS = 5000;
const TARGET_TIMEOUT_MS = 10000;
const STUCK_HELP_MS = 30000;
/** Bu bölümlerde uygulamalı görev yok; kart bunu açıkça söylemeli. */
const INTRO_ONLY = new Set<GuideStep>(['screen-intro', 'calendar-intro', 'settings-intro']);
const LANGUAGES = { tr: 'Türkçe', en: 'English', de: 'Deutsch', es: 'Español', ko: '한국어' } as const;

class GuideErrorBoundary extends Component<{ children: ReactNode; fail: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.fail(); }
  render() { return this.state.failed ? null : this.props.children; }
}

const anchor = (name: string) => document.querySelector<HTMLElement>(`[data-guide-anchor="${name}"]`);

function findGuideTarget(step: GuideStep, sample?: string, peer?: string): HTMLElement | null {
  switch (step) {
    case 'welcome':
    case 'done': return null;
    case 'presentations': return getTourAnchor('page-presentations');
    case 'sidebar': return getTourAnchor('sidebar');
    case 'delete': return anchor('delete-slide');
    case 'editor-select': return peer ? document.querySelector<HTMLElement>(`[data-editor-item-id="${CSS.escape(peer)}"]`) : null;
    case 'image-tools': return anchor('image-tools');
    case 'reorder': {
      const card = sample ? document.querySelector<HTMLElement>(`[data-slide-id="${CSS.escape(sample)}"]`) : null;
      const other = peer ? document.querySelector<HTMLElement>(`[data-slide-id="${CSS.escape(peer)}"]`) : null;
      let parent = card?.parentElement ?? null;
      while (parent && other && !parent.contains(other)) parent = parent.parentElement;
      return other ? parent : null;
    }
    case 'image-select':
    case 'select': return sample ? document.querySelector<HTMLElement>(`[data-slide-id="${CSS.escape(sample)}"]`) : null;
    case 'add': return anchor('add-slide');
    case 'nav-save': return anchor('nav-presentations');
  }
  if (step.startsWith('nav-')) return anchor(step);
  if (step.endsWith('-intro')) return getTourAnchor(`page-${step.slice(0, -6)}`);
  return anchor(step);
}

/**
 * Render'ın okuduğu alanlar aynıysa state'i yenileme. Rehber her gözlemde yeni bir nesne döndürür;
 * bu kontrol olmadan her mağaza değişikliği tüm bileşeni yeniden çizer.
 * UYARI: render yeni bir workspace alanı okumaya başlarsa buraya da eklenmeli.
 */
const sameView = (a: PracticeWorkspace | null, b: PracticeWorkspace) => !!a &&
  a.guide.id === b.guide.id && a.guide.step === b.guide.step && a.guide.paused === b.guide.paused &&
  a.guide.skipped.length === b.guide.skipped.length && a.guide.skipped.every((s, i) => s === b.guide.skipped[i]) &&
  a.guide.focusSlideId === b.guide.focusSlideId && a.active?.id === b.active?.id && a.active?.target === b.active?.target && a.active?.peer === b.active?.peer && JSON.stringify(a.guide.result) === JSON.stringify(b.guide.result);

export default function PracticeRunner({ resetView }: { resetView: () => void }) {
  const { t, i18n } = useTranslation();
  const [workspace, setWorkspace] = useState<PracticeWorkspace | null>(null);
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [recovery, setRecovery] = useState(false);
  const [help, setHelp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [suspended, setSuspended] = useState(false);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [languageBusy, setLanguageBusy] = useState(false);
  const current = useRef<PracticeWorkspace | null>(null);
  const metadataEpoch = useRef(0);
  const failedObservation = useRef<Presentation | null>(null);
  const initializing = useRef<Promise<void>>(Promise.resolve());
  const applying = useRef(false);
  const live = useRef(false);
  const request = useRef(false);
  const dirty = useRef(false);
  const commandLock = useRef(false);
  const pending = useRef<Promise<void>>(Promise.resolve());
  const pauseRequested = useRef(false);
  const closeRequested = useRef(false);
  const exit = useRef<(action?: string) => void>(() => {});
  const label = useRef(t('practice.demoSlide')); label.current = t('practice.demoSlide');
  const deckName = useRef(t('practice.deckName'));

  const observation = () => {
    const s = useStore.getState();
    let ui: GuideUi = {};
    for (const element of document.querySelectorAll<HTMLElement>('[data-guide-state]')) {
      if (!element.getClientRects().length) continue;
      try { ui = { ...ui, ...JSON.parse(element.dataset.guideState ?? '{}') }; } catch { /* Geçerli bir durum commit edilene kadar bekle. */ }
    }
    return { deck: s.presentation, tab: s.activeTab, selected: [...s.selectedSlideIds], ui };
  };

  const apply = useCallback((value: PracticeWorkspace, reset = false) => {
    metadataEpoch.current++;
    const previous = current.current;
    current.current = value;
    const live_ = useStore.getState().presentation;
    // Referans eşitliği ucuz kısa devre; aksi halde (büyük sunumlarda pahalı) tam karşılaştırma.
    if (reset || (live_ !== value.deck && JSON.stringify(live_) !== JSON.stringify(value.deck))) {
      applying.current = true;
      try { useStore.getState().dispatchUndo({ type: reset ? 'RESET' : 'SET', payload: value.deck }); }
      finally { applying.current = false; } // dispatch fırlatsa bile mağaza aboneliği sonsuza dek kilitli kalmaz
    }
    if (value.active?.exercise === 'canvas-edit' && value.active.target) {
      applying.current = true;
      try { const state = useStore.getState(); if (state.selectedSlideId !== value.active.target) { state.setSelectedSlideId(value.active.target); state.setSelectedSlideIds(new Set([value.active.target])); } }
      finally { applying.current = false; }
    }
    if (previous?.guide.step !== value.guide.step && (value.guide.step === 'image-select' || value.guide.step === 'select' && previous?.guide.step === 'reorder')) {
      useStore.getState().setActiveTab('slides');
      useStore.getState().setSelectedSlideIds(new Set());
      useStore.getState().setSelectedSlideId('');
    }
    if (previous?.guide.step !== value.guide.step) { setHelp(false); setRecovery(false); setWaiting(false); setTarget(null); setPreviewFailed(false); }
    setWorkspace(prev => (sameView(prev, value) ? prev : value));
  }, []);

  const pump = useCallback(async () => {
    dirty.current = true;
    if (request.current) return;
    request.current = true;
    let submitted: Presentation | null = null;
    try {
      while (dirty.current && live.current && !commandLock.current) {
        dirty.current = false;
        const value = current.current;
        if (!value || value.guide.paused) break;
        const input = observation();
        submitted = input.deck;
        const epoch = metadataEpoch.current;
        const result = await window.electronAPI.controlPracticeGuide(value.guide.id, value.guide.step, 'observe', input, label.current);
        if (live.current && current.current?.guide.id === value.guide.id) {
          if (epoch === metadataEpoch.current) {
            apply({ ...result, deck: mergePracticeObservation(input.deck as Presentation, result.deck, useStore.getState().presentation) });
          } else dirty.current = true;
        }
      }
    } catch { if (live.current) { failedObservation.current ??= submitted; setError(true); setRecovery(true); } }
    finally { request.current = false; }
  }, [apply]);

  const schedulePump = useCallback(() => {
    if (request.current) dirty.current = true; else pending.current = pump();
  }, [pump]);

  useEffect(() => {
    live.current = true;
    let cancelled = false;
    initializing.current = (async () => {
      try {
        let value = await window.electronAPI.readPracticeWorkspace({ ...useStore.getState().presentation, name: deckName.current });
        if (cancelled) return;
        // Yüklenen çalışma, duraklatma kaydı başarısız olsa bile korunur; kullanıcı kapatmayı yeniden deneyebilir.
        setSuspended(true);
        apply(value, true);
        useStore.getState().setActiveTab(guideTab(value.guide.step));
        if (!value.guide.paused) {
          value = await window.electronAPI.controlPracticeGuide(value.guide.id, value.guide.step, 'pause',
            { deck: value.deck, tab: '', selected: [] }, label.current);
          if (cancelled) return;
          apply(value, true);
          useStore.getState().setActiveTab(guideTab(value.guide.step));
        }
        setSuspended(false);
      } catch { if (!cancelled) setError(true); }
    })();
    const off = useStore.subscribe((state, previous) => {
      if (applying.current || commandLock.current || !current.current || current.current.guide.paused) return;
      if (state.presentation !== previous.presentation || state.activeTab !== previous.activeTab || state.selectedSlideIds !== previous.selectedSlideIds) schedulePump();
    });
    const ui = new MutationObserver(() => {
      if (!current.current || commandLock.current || current.current.guide.paused) return;
      schedulePump();
    });
    ui.observe(document.getElementById('root') ?? document.body, { subtree: true, attributes: true, attributeFilter: ['data-guide-state', 'aria-expanded'] });
    const offResult = window.electronAPI.onPracticeWorkspaceChanged(({ sessionId, workspace: value }) => {
      if (!live.current || current.current?.active?.id !== sessionId && current.current?.active?.saveIntent?.sessionId !== sessionId) return;
      apply({ ...value, deck: useStore.getState().presentation });
      schedulePump();
    });
    const offClose = window.electronAPI.onPracticeCloseRequested(() => exit.current('close'));
    return () => { cancelled = true; live.current = false; off(); ui.disconnect(); offResult(); offClose(); };
  }, [apply, schedulePump]);

  const step = workspace?.guide.step;
  const active = !!workspace && !workspace.guide.paused && !suspended;
  exit.current = (action = 'pause') => { void command(action); };
  useEffect(() => active ? registerGuideEscape(() => exit.current()) : undefined, [active]);
  const resultStep = !!step && isGuideResultStep(step);
  const resultUnavailable = resultStep && (!workspace?.guide.result || previewFailed);
  const actionStep = !!step && !guideNarrative(step) && !resultStep && step !== 'done';

  useEffect(() => {
    if (!active || !step) return;
    if (step === 'hymns-parts' || step === 'hymns-font') {
      const id = current.current?.guide.focusSlideId;
      if (id) { useStore.getState().setActiveTab('slides'); useStore.getState().setSelectedSlideId(id); useStore.getState().setSelectedSlideIds(new Set([id])); }
      useStore.getState().setIsRightPanelOpen(true);
      return;
    }
    if (step === 'image-tools' || step === 'image-fit' || step === 'image-grayscale' || step === 'delete') {
      const id = current.current?.active?.target;
      if (id) { useStore.getState().setActiveTab('slides'); useStore.getState().setSelectedSlideId(id); useStore.getState().setSelectedSlideIds(new Set([id])); }
      useStore.getState().setIsRightPanelOpen(true); return;
    }
    if (!actionStep) return;
    const viewport = matchMedia('(max-width: 1023px)');
    const prepareLayout = () => { if (viewport.matches) useStore.getState().setIsRightPanelOpen(false); };
    prepareLayout();
    viewport.addEventListener('change', prepareLayout);
    return () => viewport.removeEventListener('change', prepareLayout);
  }, [active, actionStep, step]);

  useEffect(() => {
    if (!active || !step || step === 'welcome' || step === 'done' || isGuideResultStep(step) || recovery) return;
    setWaiting(false);
    const started = performance.now();
    let timer: ReturnType<typeof setTimeout>;
    let stopped = false;
    const check = () => {
      if (stopped) return;
      const element = findGuideTarget(step, current.current?.active?.target, current.current?.active?.peer);
      if (!element && (step === 'reorder' || step === 'image-select' || step === 'select' || step === 'delete' || step === 'add')) {
        const grid = document.querySelector<HTMLElement>('[data-guide-scroll]');
        if (grid) grid.scrollTop = grid.scrollHeight;
      }
      if (element?.isConnected && element.getClientRects().length && element.getBoundingClientRect().width > 0) {
        element.scrollIntoView({ block: step === 'image-grayscale' ? 'center' : 'nearest', inline: 'nearest', behavior: 'instant' });
        setTarget(element); setWaiting(false);
        return;
      }
      const waited = performance.now() - started;
      if (waited >= TARGET_TIMEOUT_MS) { setRecovery(true); setTarget(null); return; }
      if (waited >= TARGET_WAIT_MS) setWaiting(true);
      timer = setTimeout(check, 100);
    };
    check();
    return () => { stopped = true; clearTimeout(timer); };
  }, [active, step, recovery, retry, workspace?.active?.target, workspace?.active?.peer]);

  useEffect(() => {
    if (!active || !actionStep || !target || recovery) return;
    let elapsed = 0;
    let previous = performance.now();
    const timer = setInterval(() => {
      const now = performance.now();
      if (document.visibilityState === 'visible' && document.hasFocus()) elapsed += now - previous;
      previous = now;
      if (elapsed >= STUCK_HELP_MS) { setHelp(true); clearInterval(timer); } // yardım bir kez çıkar, sayaç durur
    }, 500);
    return () => clearInterval(timer);
  }, [active, actionStep, target, recovery, step]);

  async function command(action: string, destination?: GuideStep) {
    await initializing.current;
    if (!current.current) {
      if (action === 'close') { try { await window.electronAPI.closePractice(); } catch { setError(true); } }
      return;
    }
    // Tamamlandı ekranında duraklatma sunulmaz; Esc burada etkisiz kalır.
    if (action === 'pause' && current.current.guide.step === 'done') return;
    if (commandLock.current) {
      if (action === 'pause' || action === 'close') {
        if (action === 'close') closeRequested.current = true; else pauseRequested.current = true;
        setSuspended(true);
      }
      return;
    }
    commandLock.current = true;
    dirty.current = false;
    if (action === 'pause' || action === 'close') setSuspended(true);
    setBusy(true);
    let submitted: Presentation | null = null;
    try {
      await pending.current;
      const value = current.current;
      if (!value) return;
      if (action === 'resume' && value.guide.step === 'welcome') useStore.getState().setPresentationName(t('practice.deckName'));
      const input = observation(); submitted = input.deck;
      const result = await window.electronAPI.controlPracticeGuide(value.guide.id, value.guide.step, action === 'close' ? 'pause' : action, input, label.current, destination);
      if (!live.current) return;
      apply(result, action === 'restart');
      failedObservation.current = null;
      if (action === 'retry-result') setPreviewFailed(false);
      setError(false); setRecovery(false);
      if (action === 'close') { await window.electronAPI.closePractice(result.guide.id); return; }
      if (action === 'restart') {
        const s = useStore.getState();
        s.setSelectedSlideIds(new Set()); s.setMediaItems([]); s.setLoopItems([]);
        // Depolama kapalı/dolu olabilir; bu, başarılı bir yeniden başlatmayı hataya çevirmemeli.
        try { localStorage.removeItem('wpa.practice.sampleMedia'); } catch { /* yok say */ }
        resetView();
      }
      if (action === 'resume' || action === 'restart' || action === 'jump' || action === 'skip') {
        useStore.getState().setActiveTab(guideTab(result.guide.step));
        setSuspended(false);
      }
    } catch { if (live.current) { failedObservation.current ??= submitted; setError(true); setRecovery(true); } }
    finally {
      commandLock.current = false;
      if (live.current) {
        setBusy(false);
        if (closeRequested.current) { closeRequested.current = false; pauseRequested.current = false; void command('close'); }
        else if (pauseRequested.current) { pauseRequested.current = false; void command('pause'); }
      }
    }
  }

  async function restart() {
    if (busy) return;
    if (await confirmDialog(t('guide.restartConfirm'), { detail: t('guide.restartDetail'), confirmLabel: t('guide.restart'), cancelLabel: t('common.cancel') })) void command('restart');
  }

  async function retryNow() {
    if (resultStep) { void command('retry-result'); return; }
    if (error) {
      if (commandLock.current) return;
      commandLock.current = true; setBusy(true);
      try {
        await pending.current;
        const before = failedObservation.current ?? useStore.getState().presentation;
        const value = await window.electronAPI.readPracticeWorkspace(useStore.getState().presentation);
        if (!live.current) return;
        apply({ ...value, deck: mergePracticeObservation(before,value.deck,useStore.getState().presentation) });
        failedObservation.current = null;
        setRecovery(false); setHelp(false); setError(false);
      } catch { if (live.current) setError(true); }
      finally { commandLock.current = false; if(live.current)setBusy(false); }
      return;
    }
    setRecovery(false); setHelp(false); setError(false); setTarget(null); setRetry(value => value + 1);
    // Hata gözlem aşamasında oluştuysa, bir sonraki değişikliği beklemeden durumu yeniden eşitle.
    if (!commandLock.current) { dirty.current = true; pending.current = pump(); }
  }

  const interactionTargets = useMemo(() => {
    if (step !== 'delete' && step !== 'reorder') return undefined;
    const ids = step === 'reorder' ? [workspace?.active?.target, workspace?.active?.peer] : [workspace?.active?.target];
    const cards = ids.flatMap(id => { const card = id ? document.querySelector<HTMLElement>(`[data-slide-id="${CSS.escape(id)}"]`) : null; return card ? [card] : []; });
    return step === 'delete' && target ? [target, ...cards] : cards;
  }, [step, target, workspace?.active?.target, workspace?.active?.peer]);

  const paused = !!workspace?.guide.paused || suspended;
  const stepNumber = step ? Math.max(1, visibleGuideSteps.indexOf(step as typeof visibleGuideSteps[number]) + 1) : 1;
  const content = <div data-testid="practice-guidance" data-guide-step={step} className="space-y-4 max-h-[calc(100vh-80px)] overflow-y-auto">
    <header className="space-y-3">
      <div className="flex items-center gap-3">
        <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sky-100 text-sky-700"><Compass className="h-5 w-5" /></span>
        <div className="min-w-0 flex-1"><h2 className="text-sm font-semibold tracking-wide text-slate-700">{t('guide.title')}</h2>
          {step && <p className="mt-0.5 text-xs font-medium text-slate-500">{t('guide.progress', { current: stepNumber, total: visibleGuideSteps.length })}</p>}
        </div>
      </div>
      {step && <div aria-hidden="true" className="h-1.5 overflow-hidden rounded-full bg-slate-200"><div className="h-full rounded-full bg-sky-500" style={{ width: `${stepNumber / visibleGuideSteps.length * 100}%` }} /></div>}
    </header>
    {step && <>
      <h3 id="guide-step-title" aria-live={resultStep ? 'polite' : undefined} className={resultStep && !resultUnavailable ? 'text-xl font-bold leading-snug text-emerald-700' : 'text-xl font-bold leading-snug text-slate-900'}>{t(resultUnavailable ? 'guide.result.unavailableTitle' : `guide.steps.${step}.title`)}</h3>
      <p id="guide-step-body" className="whitespace-pre-line text-sm leading-6 text-slate-600">{t(resultUnavailable ? 'guide.result.unavailable' : `guide.steps.${step}.body`)}</p>
      {INTRO_ONLY.has(step) && <p className="text-sm leading-6 text-slate-600">{t('guide.onlyIntroducing')}</p>}
      {active && !previewFailed && isGuideResultStep(step) && workspace?.guide.result && <PracticeResult step={step} result={workspace.guide.result} />}
    </>}
    {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{t('guide.error')}</p>}
    {!workspace && <p role="status">{t('common.loading')}</p>}
    {waiting && !target && <p role="status">{t('guide.waiting')}</p>}
    {paused && <label className="block text-sm">{t('settings.language')}
      <select data-testid="guide-language" disabled={busy || languageBusy} value={i18n.resolvedLanguage ?? i18n.language} className="mt-2 w-full rounded-xl border border-slate-300 bg-white p-3 text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
        onChange={async event => {
          setLanguageBusy(true);
          try { await i18n.changeLanguage(event.target.value); } catch { setError(true); } finally { setLanguageBusy(false); }
        }}>
        {Object.entries(LANGUAGES).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
      </select></label>}
    <footer className="-mx-5 -mb-5 mt-5 flex flex-wrap items-center gap-2 rounded-b-2xl border-t border-slate-200 bg-[#EEF2F7] p-4 text-slate-600">
    {paused && step !== 'done'
      ? <button autoFocus disabled={busy || languageBusy} data-testid="guide-resume" onClick={() => command('resume')} className="w-full rounded-xl bg-sky-600 px-4 py-3 text-sm font-semibold text-white shadow-sm hover:bg-sky-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 disabled:opacity-50">{t(step === 'welcome' ? 'guide.begin' : 'guide.resume')}</button>
      : active && step && (guideNarrative(step) || resultStep && !resultUnavailable) && <button autoFocus disabled={busy || recovery} aria-describedby={resultStep ? 'guide-step-title guide-step-body' : undefined} data-testid="guide-next" onClick={() => command('next')} className="w-full rounded-xl bg-sky-600 px-4 py-3 text-sm font-semibold text-white shadow-sm hover:bg-sky-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 disabled:opacity-50">{t(step === 'welcome' ? 'guide.begin' : 'guide.next')}</button>}
    {step === 'done' && active && <p role="status">{t(workspace?.guide.skipped.length ? 'guide.finishedSkipped' : 'guide.finished')}</p>}
    {(recovery || help || resultUnavailable) && <div data-testid="guide-recovery" className="w-full space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
      <p role="status">{t(recovery ? 'guide.unavailable' : 'guide.stuck')}</p>
      <div className="flex flex-col gap-2">
        <button disabled={busy} data-testid="guide-retry" onClick={retryNow} className="rounded-lg border border-amber-300 bg-white px-3 py-2.5 text-sm font-semibold text-amber-900 hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 disabled:opacity-50">{t('guide.retry')}</button>
        {!resultStep && <button disabled={busy} data-testid="guide-skip" onClick={() => command('skip')} className="rounded-lg border border-amber-300 bg-amber-100 px-3 py-2.5 text-sm font-semibold text-amber-900 hover:bg-amber-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 disabled:opacity-50">{t('guide.skip')}</button>}
      </div>
    </div>}
    {workspace && active && step !== 'done' && <button disabled={busy} data-testid="guide-pause" onClick={() => command('pause')} className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm font-medium text-slate-600 hover:border-slate-400 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 disabled:opacity-50">{t('guide.pause')}</button>}
    <button disabled={busy} data-testid="guide-close" onClick={() => command('close')} className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm font-medium text-slate-600 hover:border-slate-400 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 disabled:opacity-50">{t('guide.close')}</button>
    {workspace && (workspace.guide.paused || step === 'done') && <button disabled={busy} data-testid="guide-restart" onClick={restart} className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm font-medium text-slate-600 hover:border-slate-400 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 disabled:opacity-50">{t('guide.restart')}</button>}
    {workspace?.guide.paused && <details className="w-full border-t border-slate-200 pt-3"><summary className="text-sm font-medium cursor-pointer">{t('guide.chapters')}</summary><p className="text-xs my-2">{t('guide.jumpWarning')}</p>
      <div className="flex flex-wrap gap-2">{practiceTasks.map(page => <button disabled={busy} key={page} data-testid={`guide-chapter-${page}`} onClick={() => command('jump', guideChapters[page])} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium hover:border-sky-400 hover:text-sky-700">{t(`nav.${page}`)}</button>)}</div>
    </details>}
    </footer>
  </div>;

  if ((!active || recovery && !resultStep) && !busy) {
    return createPortal(<aside data-guide-card role="complementary" aria-label={t('guide.title')}
      className={`fixed bottom-4 right-4 z-[250] w-[min(320px,calc(100vw-32px))] ${guideCardClass}`}
      onKeyDown={event => event.stopPropagation()}>{content}</aside>, document.body);
  }
  if (!workspace) return null;
  if (previewFailed) return <PracticeSpotlight target={null} centered index={guideSteps.indexOf(workspace.guide.step)} exit={() => command('pause')}>{content}</PracticeSpotlight>;
  return <GuideErrorBoundary key={workspace.guide.id} fail={() => { setPreviewFailed(true); setRecovery(true); setError(true); }}>
    <PracticeSpotlight target={busy || resultStep ? null : target} centered={resultStep} interactionTargets={busy ? undefined : interactionTargets} index={guideSteps.indexOf(workspace.guide.step)} interactive={actionStep && !busy} exit={() => command('pause')}
      fail={failedIndex => { if (current.current && guideSteps.indexOf(current.current.guide.step) === failedIndex) { setTarget(null); setRecovery(true); } }}
      deleteAllowed={() => {
        const s = useStore.getState();
        return !commandLock.current && current.current?.guide.step === 'delete' && s.activeTab === 'slides' && s.selectedSlideIds.size === 1 && s.selectedSlideIds.has(current.current.active!.target!);
      }}>{content}</PracticeSpotlight>
  </GuideErrorBoundary>;
}
