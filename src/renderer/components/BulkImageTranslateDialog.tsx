import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Dialog from './Dialog';
import { useStore } from '../state/useStore';
import { makeSlideId } from '../utils';
import type { Slide } from '../types';
import { collectSlideImages, withReplacedImages } from '../slideImages';
import { IMAGE_TRANSLATE_LANGUAGES, isImageTranslateLang, type ImageTranslateLang } from '../../shared/imageTranslate';

type Mode = 'insert' | 'replace';
type Phase =
  | { kind: 'setup' }
  | { kind: 'running'; done: number; total: number }
  | { kind: 'finished'; translated: number; noText: number; failed: number; message?: string; slides: number };

/**
 * Translates the text in every picture of the selected slides (all slides when nothing is
 * selected) and either inserts a translated copy right after each slide or swaps the pictures in
 * place — one undo step. Results are stored by the main process, so running it again is instant.
 */
export function BulkImageTranslateDialog({ onClose }: { onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const uiLang = i18n.language?.slice(0, 2);
  const [source, setSource] = useState<ImageTranslateLang | 'auto'>('auto');
  const [target, setTarget] = useState<ImageTranslateLang>(isImageTranslateLang(uiLang) && uiLang !== 'tr' ? uiLang : 'en');
  const [mode, setMode] = useState<Mode>('insert');
  const [phase, setPhase] = useState<Phase>({ kind: 'setup' });
  const cancelled = useRef(false);
  const names = useMemo(() => {
    let display: Intl.DisplayNames | null = null;
    try { display = new Intl.DisplayNames([i18n.language || 'en'], { type: 'language' }); } catch { /* old runtime */ }
    return (code: string) => display?.of(code) ?? code;
  }, [i18n.language]);

  // Snapshot of the work when the dialog opens.
  const work = useMemo(() => {
    const { presentation, selectedSlideIds } = useStore.getState();
    const chosen = selectedSlideIds.size ? presentation.slides.filter((s) => selectedSlideIds.has(s.id)) : presentation.slides;
    const slides = chosen.filter((s) => collectSlideImages(s).length > 0);
    const urls = [...new Set(slides.flatMap((s) => collectSlideImages(s).map((i) => i.url)))];
    return { slideIds: new Set(slides.map((s) => s.id)), urls, slideCount: slides.length };
  }, []);

  const api = window.electronAPI?.imageTranslate;
  const running = phase.kind === 'running';

  const start = async () => {
    if (!api || !work.urls.length) return;
    cancelled.current = false;
    const replacements = new Map<string, string>();
    let noText = 0;
    let failed = 0;
    let message: string | undefined;
    setPhase({ kind: 'running', done: 0, total: work.urls.length });
    for (let i = 0; i < work.urls.length && !cancelled.current; i++) {
      try {
        const result = await api(work.urls[i], source, target);
        if (result.ok) replacements.set(work.urls[i], result.ref);
        else if (result.reason === 'no-text') noText++;
        else { failed++; message ??= result.message ?? t(`common.imageTranslateError_${result.reason}`); }
      } catch (error) {
        failed++;
        message ??= error instanceof Error ? error.message : String(error);
      }
      setPhase({ kind: 'running', done: i + 1, total: work.urls.length });
    }

    let changedSlides = 0;
    if (replacements.size) {
      const state = useStore.getState();
      const created: string[] = [];
      const slides: Slide[] = [];
      for (const slide of state.presentation.slides) {
        const touched = work.slideIds.has(slide.id) && collectSlideImages(slide).some((img) => replacements.has(img.url));
        if (!touched) { slides.push(slide); continue; }
        changedSlides++;
        const translated = withReplacedImages(slide, replacements);
        if (mode === 'replace') { slides.push(translated); continue; }
        const id = makeSlideId();
        slides.push(slide, { ...translated, id, locked: false, group: undefined });
        created.push(id);
      }
      state.dispatchUndo({ type: 'SET', payload: { ...state.presentation, slides } });
      if (created.length) {
        useStore.getState().selectSlides({ ids: new Set(created), activeId: created[0], anchorIndex: slides.findIndex((s) => s.id === created[created.length - 1]) });
      }
    }
    setPhase({ kind: 'finished', translated: replacements.size, noText, failed, message, slides: changedSlides });
  };

  const close = () => {
    if (running) { cancelled.current = true; return; }
    onClose();
  };
  const select = 'rounded-lg bg-black/40 border border-white/15 p-2 text-sm disabled:opacity-50';

  return (
    <Dialog
      open
      onClose={close}
      labelledBy="bulk-image-translate-title"
      closeOnOverlayClick={false}
      className="w-[min(560px,calc(100vw-24px))] max-h-[calc(100vh-24px)] overflow-auto rounded-2xl border border-white/15 bg-[#171717] text-white shadow-2xl"
    >
      <div className="p-4 space-y-4" onKeyDown={(event) => { event.stopPropagation(); if (event.key === 'Escape') { event.preventDefault(); close(); } }}>
        <h2 id="bulk-image-translate-title" className="text-lg font-semibold">{t('common.imageTranslateBulkTitle')}</h2>
        <p className="text-sm text-white/70">
          {work.urls.length
            ? t('common.imageTranslateBulkSummary', { images: work.urls.length, slides: work.slideCount })
            : t('common.imageTranslateBulkNone')}
        </p>

        {phase.kind !== 'finished' && work.urls.length > 0 && (
          <>
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <label className="flex items-center gap-2">
                {t('common.imageTranslateFrom')}
                <select value={source} disabled={running} onChange={(e) => setSource(e.target.value as ImageTranslateLang | 'auto')} className={select}>
                  <option value="auto">{t('common.imageTranslateAuto')}</option>
                  {IMAGE_TRANSLATE_LANGUAGES.map((lang) => <option key={lang.code} value={lang.code}>{names(lang.code)}</option>)}
                </select>
              </label>
              <label className="flex items-center gap-2">
                {t('common.imageTranslateTo')}
                <select value={target} disabled={running} onChange={(e) => setTarget(e.target.value as ImageTranslateLang)} className={select}>
                  {IMAGE_TRANSLATE_LANGUAGES.map((lang) => <option key={lang.code} value={lang.code}>{names(lang.code)}</option>)}
                </select>
              </label>
            </div>
            <fieldset className="space-y-2 text-sm" disabled={running}>
              <label className="flex items-start gap-2">
                <input type="radio" name="bulk-image-translate-mode" checked={mode === 'insert'} onChange={() => setMode('insert')} className="mt-0.5" />
                <span>{t('common.imageTranslateModeInsert')}</span>
              </label>
              <label className="flex items-start gap-2">
                <input type="radio" name="bulk-image-translate-mode" checked={mode === 'replace'} onChange={() => setMode('replace')} className="mt-0.5" />
                <span>{t('common.imageTranslateModeReplace')}</span>
              </label>
            </fieldset>
          </>
        )}

        {phase.kind === 'running' && (
          <div role="status" className="space-y-1.5">
            <div className="h-2 overflow-hidden rounded-full bg-white/10">
              <div className="h-full bg-blue-500 transition-[width]" style={{ width: `${(phase.done / Math.max(1, phase.total)) * 100}%` }} />
            </div>
            <p className="text-xs text-white/60">{t('common.imageTranslateBulkProgress', { done: phase.done, total: phase.total })}</p>
          </div>
        )}

        {phase.kind === 'finished' && (
          <div role="status" className="space-y-1 rounded-lg border border-white/10 bg-white/[0.04] p-3 text-sm">
            <p>{t(mode === 'insert' ? 'common.imageTranslateBulkDoneInsert' : 'common.imageTranslateBulkDoneReplace', { count: phase.slides })}</p>
            {phase.noText > 0 && <p className="text-white/60">{t('common.imageTranslateBulkNoText', { count: phase.noText })}</p>}
            {phase.failed > 0 && (
              <p className="text-red-200">
                {t('common.imageTranslateBulkFailed', { count: phase.failed })}
                {phase.message ? <span className="block text-xs text-red-200/70">{phase.message}</span> : null}
              </p>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={close} className="rounded-lg bg-white/10 px-3 py-2 text-sm hover:bg-white/15">
            {running ? t('common.imageTranslateBulkStop') : phase.kind === 'finished' ? t('common.close') : t('common.cancel')}
          </button>
          {phase.kind === 'setup' && (
            <button
              type="button"
              onClick={() => void start()}
              disabled={!api || !work.urls.length}
              className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium hover:bg-blue-500 disabled:opacity-50"
            >
              {t('common.imageTranslateRun')}
            </button>
          )}
        </div>
      </div>
    </Dialog>
  );
}
