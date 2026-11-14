import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Dialog from '../components/Dialog';
import { resolveCanvasSource } from '../canvasSource';
import type { SlideItem } from '../types';
import {
  IMAGE_TRANSLATE_LANGUAGES,
  isImageTranslateLang,
  type ImageTranslateLang,
  type ImageTranslateResult,
} from '../../shared/imageTranslate';

type Status =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'done'; ref: string; regions: { original: string; translated: string }[]; cached?: boolean }
  | { kind: 'error'; reason: Exclude<ImageTranslateResult, { ok: true }>['reason']; message?: string };

/** Previews an image with its baked-in text translated; Apply swaps the item's image (one undo step). */
export function ImageTranslateDialog({
  item,
  onApply,
  onClose,
}: {
  item: SlideItem;
  onApply: (ref: string) => void;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const uiLang = i18n.language?.slice(0, 2);
  const [source, setSource] = useState<ImageTranslateLang | 'auto'>('auto');
  const [target, setTarget] = useState<ImageTranslateLang>(isImageTranslateLang(uiLang) ? uiLang : 'en');
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const names = useMemo(() => {
    let display: Intl.DisplayNames | null = null;
    try { display = new Intl.DisplayNames([i18n.language || 'en'], { type: 'language' }); } catch { /* old runtime */ }
    return (code: string) => display?.of(code) ?? code;
  }, [i18n.language]);

  const originalSrc = item.mediaUrl ? resolveCanvasSource(item.mediaUrl, false).url : undefined;
  const resultSrc = status.kind === 'done' ? resolveCanvasSource(status.ref, false).url : undefined;
  const api = window.electronAPI?.imageTranslate;

  // A stored result for this picture and language pair shows up at once (nothing is lost).
  useEffect(() => {
    if (!api || !item.mediaUrl) return;
    let live = true;
    setStatus({ kind: 'idle' });
    api(item.mediaUrl, source, target, { cachedOnly: true })
      .then((result) => { if (live && result.ok) setStatus({ kind: 'done', ref: result.ref, regions: result.regions, cached: true }); })
      .catch(() => undefined);
    return () => { live = false; };
  }, [api, item.mediaUrl, source, target]);

  const run = async () => {
    if (!api || !item.mediaUrl) return;
    setStatus({ kind: 'running' });
    try {
      const result = await api(item.mediaUrl, source, target);
      setStatus(result.ok ? { kind: 'done', ref: result.ref, regions: result.regions, cached: result.cached } : { kind: 'error', reason: result.reason, message: result.message });
    } catch (error) {
      setStatus({ kind: 'error', reason: 'failed', message: error instanceof Error ? error.message : String(error) });
    }
  };

  const busy = status.kind === 'running';
  const close = () => { if (!busy) onClose(); };
  const select = 'rounded-lg bg-black/40 border border-white/15 p-2 text-sm disabled:opacity-50';

  return (
    <Dialog
      open
      onClose={close}
      labelledBy="editor-image-translate-title"
      closeOnOverlayClick={false}
      className="w-[min(960px,calc(100vw-24px))] max-h-[calc(100vh-24px)] overflow-auto rounded-2xl border border-white/15 bg-[#171717] text-white shadow-2xl"
    >
      <div
        className="p-4 space-y-4"
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'Escape') { event.preventDefault(); close(); }
        }}
      >
        <h2 id="editor-image-translate-title" className="text-lg font-semibold">{t('common.imageTranslateTitle')}</h2>
        <p className="text-xs text-white/60">{t('common.imageTranslateHelp')}</p>

        <div className="flex flex-wrap items-center gap-3 text-sm">
          <label className="flex items-center gap-2">
            {t('common.imageTranslateFrom')}
            <select value={source} disabled={busy} onChange={(e) => setSource(e.target.value as ImageTranslateLang | 'auto')} className={select}>
              <option value="auto">{t('common.imageTranslateAuto')}</option>
              {IMAGE_TRANSLATE_LANGUAGES.map((lang) => <option key={lang.code} value={lang.code}>{names(lang.code)}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2">
            {t('common.imageTranslateTo')}
            <select value={target} disabled={busy} onChange={(e) => setTarget(e.target.value as ImageTranslateLang)} className={select}>
              {IMAGE_TRANSLATE_LANGUAGES.map((lang) => <option key={lang.code} value={lang.code}>{names(lang.code)}</option>)}
            </select>
          </label>
          <button
            type="button"
            onClick={() => void run()}
            disabled={busy || !api || !item.mediaUrl}
            className="rounded-lg bg-blue-600 px-3 py-2 font-medium hover:bg-blue-500 disabled:opacity-50"
          >
            {busy ? t('common.imageTranslateRunning') : status.kind === 'done' ? t('common.imageTranslateAgain') : t('common.imageTranslateRun')}
          </button>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <figure className="space-y-1">
            <figcaption className="text-xs text-white/60">{t('common.imageTranslateOriginal')}</figcaption>
            {originalSrc && <img src={originalSrc} alt="" draggable={false} className="block w-full rounded-lg bg-black/40 object-contain max-h-[50vh]" />}
          </figure>
          <figure className="space-y-1">
            <figcaption className="text-xs text-white/60">{t('common.imageTranslateResult')}</figcaption>
            {resultSrc ? (
              <img src={resultSrc} alt="" draggable={false} className="block w-full rounded-lg bg-black/40 object-contain max-h-[50vh]" />
            ) : (
              <div className="flex aspect-video items-center justify-center rounded-lg border border-dashed border-white/15 p-4 text-center text-sm text-white/50" role="status">
                {busy ? t('common.imageTranslateRunningHint') : status.kind === 'error' ? null : t('common.imageTranslateEmpty')}
              </div>
            )}
          </figure>
        </div>

        {status.kind === 'error' && (
          <p role="alert" className="rounded-lg border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-200">
            {t(`common.imageTranslateError_${status.reason}`)}
            {status.message ? <span className="block text-xs text-red-200/70">{status.message}</span> : null}
          </p>
        )}

        {status.kind === 'done' && status.cached && (
          <p className="text-xs text-emerald-200/80">{t('common.imageTranslateCached')}</p>
        )}

        {status.kind === 'done' && status.regions.length > 0 && (
          <details className="text-xs text-white/70">
            <summary className="cursor-pointer">{t('common.imageTranslateTexts', { count: status.regions.length })}</summary>
            <ul className="mt-2 space-y-1">
              {status.regions.map((region, i) => (
                <li key={i}><span className="text-white/45">{region.original}</span> → {region.translated}</li>
              ))}
            </ul>
          </details>
        )}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={close} disabled={busy} className="rounded-lg bg-white/10 px-3 py-2 text-sm hover:bg-white/15 disabled:opacity-50">
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={() => status.kind === 'done' && onApply(status.ref)}
            disabled={status.kind !== 'done'}
            className="rounded-lg bg-white px-3 py-2 text-sm font-medium text-black hover:bg-white/90 disabled:opacity-40"
          >
            {t('common.imageTranslateApply')}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
