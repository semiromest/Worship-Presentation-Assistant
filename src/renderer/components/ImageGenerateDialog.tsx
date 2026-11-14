import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, ImagePlus, Presentation, RefreshCw, Sparkles } from 'lucide-react';
import Dialog from './Dialog';
import { toMediaStreamUrl } from '../canvasSource';
import {
  IMAGE_GENERATE_RATIOS,
  IMAGE_GENERATE_STYLES,
  MAX_PROMPT_LENGTH,
  randomSeed,
  type ImageGenerateRatio,
  type ImageGenerateResult,
  type ImageGenerateStyle,
} from '../../shared/imageGenerate';

type Failure = Exclude<ImageGenerateResult, { ok: true }>;
interface Generated { path: string; prompt: string }

const LAST_KEY = 'presenter.imageGenerate.last';
function readLast(): { prompt?: string; style?: ImageGenerateStyle; ratio?: ImageGenerateRatio } {
  try { return JSON.parse(localStorage.getItem(LAST_KEY) ?? '{}') ?? {}; } catch { return {}; }
}

/**
 * Text prompt → AI picture (Pollinations.ai). Every result of the session stays in a strip so the
 * user can compare; the selected one can be added to the media library and/or as a new slide.
 */
export function ImageGenerateDialog({
  onAddToMedia,
  onAddAsSlide,
  onClose,
}: {
  onAddToMedia: (path: string) => void;
  onAddAsSlide: (path: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [last] = useState(readLast);
  const [prompt, setPrompt] = useState(last.prompt ?? '');
  const [style, setStyle] = useState<ImageGenerateStyle>(last.style ?? 'worship');
  const [ratio, setRatio] = useState<ImageGenerateRatio>(last.ratio ?? '16:9');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Failure | null>(null);
  const [results, setResults] = useState<Generated[]>([]);
  const [selected, setSelected] = useState(0);
  const [added, setAdded] = useState<Record<string, { media?: boolean; slide?: boolean }>>({});
  const api = window.electronAPI?.imageGenerate;

  const run = async () => {
    if (!api || !prompt.trim() || busy) return;
    try { localStorage.setItem(LAST_KEY, JSON.stringify({ prompt, style, ratio })); } catch { /* storage off */ }
    setBusy(true);
    setError(null);
    try {
      const result = await api(prompt, style, ratio, randomSeed());
      if (result.ok) {
        setResults((prev) => [{ path: result.path, prompt }, ...prev.filter((r) => r.path !== result.path)].slice(0, 12));
        setSelected(0);
      } else {
        setError(result);
      }
    } catch (e) {
      setError({ ok: false, reason: 'failed', message: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const current = results[selected];
  const state = current ? added[current.path] ?? {} : {};
  const mark = (kind: 'media' | 'slide') => current && setAdded((prev) => ({ ...prev, [current.path]: { ...prev[current.path], [kind]: true } }));
  const close = () => { if (!busy) onClose(); };
  const size = IMAGE_GENERATE_RATIOS.find((r) => r.id === ratio) ?? IMAGE_GENERATE_RATIOS[0];
  const select = 'rounded-lg bg-black/40 border border-white/15 p-2 text-sm disabled:opacity-50';
  const secondary = 'inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-2 text-sm hover:bg-white/15 disabled:opacity-40';

  return (
    <Dialog
      open
      onClose={close}
      labelledBy="image-generate-title"
      closeOnOverlayClick={false}
      className="w-[min(900px,calc(100vw-24px))] max-h-[calc(100vh-24px)] overflow-auto rounded-2xl border border-white/15 bg-[#171717] text-white shadow-2xl"
    >
      <div
        className="p-4 space-y-4"
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'Escape') { event.preventDefault(); close(); }
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void run(); }
        }}
      >
        <div>
          <h2 id="image-generate-title" className="flex items-center gap-2 text-lg font-semibold">
            <Sparkles size={18} className="text-violet-300" aria-hidden="true" />
            {t('common.imageGenerateTitle')}
          </h2>
          <p className="mt-1 text-xs text-white/60">{t('common.imageGenerateHelp')}</p>
        </div>

        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value.slice(0, MAX_PROMPT_LENGTH))}
          disabled={busy}
          rows={3}
          autoFocus
          placeholder={t('common.imageGeneratePlaceholder')}
          aria-label={t('common.imageGeneratePrompt')}
          className="block w-full resize-y rounded-lg border border-white/15 bg-black/40 p-2 text-sm disabled:opacity-50"
        />

        <div className="flex flex-wrap items-center gap-3 text-sm">
          <label className="flex items-center gap-2">
            {t('common.imageGenerateStyle')}
            <select value={style} disabled={busy} onChange={(e) => setStyle(e.target.value as ImageGenerateStyle)} className={select}>
              {IMAGE_GENERATE_STYLES.map((s) => <option key={s.id} value={s.id}>{t(`common.imageGenerateStyle_${s.id}`)}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2">
            {t('common.imageGenerateRatio')}
            <select value={ratio} disabled={busy} onChange={(e) => setRatio(e.target.value as ImageGenerateRatio)} className={select}>
              {IMAGE_GENERATE_RATIOS.map((r) => <option key={r.id} value={r.id}>{r.id}</option>)}
            </select>
          </label>
          <button
            type="button"
            onClick={() => void run()}
            disabled={busy || !api || !prompt.trim()}
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-4 py-2 font-medium hover:bg-violet-500 disabled:opacity-50"
          >
            {busy ? <RefreshCw size={15} className="animate-spin" aria-hidden="true" /> : <Sparkles size={15} aria-hidden="true" />}
            {busy ? t('common.imageGenerateRunning') : results.length ? t('common.imageGenerateAgain') : t('common.imageGenerateRun')}
          </button>
        </div>

        {current && !busy ? (
          <img src={toMediaStreamUrl(current.path)} alt={current.prompt} draggable={false} className="block w-full rounded-lg bg-black/40 object-contain max-h-[50vh]" />
        ) : (
          <div
            className="flex max-h-[50vh] w-full items-center justify-center rounded-lg border border-dashed border-white/15 p-4 text-center text-sm text-white/50"
            style={{ aspectRatio: `${size.width} / ${size.height}` }}
            role="status"
          >
            {busy ? t('common.imageGenerateRunningHint') : t('common.imageGenerateEmpty')}
          </div>
        )}

        {results.length > 1 && (
          <div className="flex gap-2 overflow-x-auto pb-1" role="listbox" aria-label={t('common.imageGenerateHistory')}>
            {results.map((r, i) => (
              <button
                key={r.path}
                type="button"
                role="option"
                aria-selected={i === selected}
                onClick={() => setSelected(i)}
                className={`relative h-14 shrink-0 overflow-hidden rounded-md border-2 ${i === selected ? 'border-violet-400' : 'border-transparent opacity-70 hover:opacity-100'}`}
              >
                <img src={toMediaStreamUrl(r.path)} alt={r.prompt} draggable={false} className="h-full w-auto object-cover" />
              </button>
            ))}
          </div>
        )}

        {error && (
          <p role="alert" className="rounded-lg border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-200">
            {t(`common.imageGenerateError_${error.reason}`)}
            {error.message ? <span className="block text-xs text-red-200/70">{error.message}</span> : null}
          </p>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[11px] text-white/40">{t('common.imageGenerateCredit')}</span>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={close} disabled={busy} className={secondary}>
              {t('common.close')}
            </button>
            <button
              type="button"
              disabled={!current || busy || state.media}
              onClick={() => { if (current) { onAddToMedia(current.path); mark('media'); } }}
              className={secondary}
            >
              {state.media ? <Check size={15} aria-hidden="true" /> : <ImagePlus size={15} aria-hidden="true" />}
              {state.media ? t('common.imageGenerateAddedToMedia') : t('common.imageGenerateAddToMedia')}
            </button>
            <button
              type="button"
              disabled={!current || busy}
              onClick={() => { if (current) { onAddAsSlide(current.path); mark('slide'); } }}
              className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-2 text-sm font-medium text-black hover:bg-white/90 disabled:opacity-40"
            >
              {state.slide ? <Check size={15} aria-hidden="true" /> : <Presentation size={15} aria-hidden="true" />}
              {state.slide ? t('common.imageGenerateAddedAsSlide') : t('common.imageGenerateAddAsSlide')}
            </button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
