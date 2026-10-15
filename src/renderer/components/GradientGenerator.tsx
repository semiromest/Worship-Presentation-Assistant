import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { GRADIENT_PALETTES, type GeneratedBackground } from '../../shared/generatedBackground';
import type { ContrastRegion, ContrastResult } from '../../shared/gradientContrast';
import type { Slide } from '../types';
import { gradientTargets, type GradientScope } from '../gradientBackground';
import { LivePreview } from '../LivePreview';
import Dialog from './Dialog';

export interface GradientDraft {
  token: string;
  image: string;
  recipe: GeneratedBackground;
  contrast: ContrastResult;
  byteLength: number;
  hash: string;
}
export interface GradientGeneratorProps {
  label?: string;
  slides: Slide[];
  activeId: string;
  selectedIds: string[];
  onApply: (ids: string[], image: string, recipe: GeneratedBackground, groupDefault: boolean) => void;
}
export function GradientButton(props: GradientGeneratorProps) {
  const [open, setOpen] = useState(false);
  const { t } = useTranslation();
  return (
    <>
      <button
        type="button"
        className="w-full rounded-lg border border-violet-400/30 bg-violet-500/15 px-3 py-2 text-sm text-violet-100 hover:bg-violet-500/25"
        onClick={() => setOpen(true)}
      >
        {props.label ?? t('gradient.open')}
      </button>
      {open && <GradientGenerator {...props} onClose={() => setOpen(false)} />}
    </>
  );
}

function GradientGenerator({
  slides,
  activeId,
  selectedIds,
  onApply,
  onClose,
}: GradientGeneratorProps & { onClose: () => void }) {
  const { t } = useTranslation();
  const titleId = useId();
  const active = slides.find((s) => s.id === activeId)!;
  const initial = active.styles?.generatedBackground;
  const [palette, setPalette] = useState<keyof typeof GRADIENT_PALETTES>(
    initial && initial.palette in GRADIENT_PALETTES ? (initial.palette as keyof typeof GRADIENT_PALETTES) : 'ocean'
  );
  const [style, setStyle] = useState<'soft' | 'flow'>(initial?.style ?? 'flow');
  const [darkness, setDarkness] = useState(initial?.darkness ?? 25);
  const [motionEnabled, setMotionEnabled] = useState(initial?.motion?.enabled ?? false);
  const [motionType, setMotionType] = useState<'flow' | 'aurora' | 'waves' | 'fog'>(initial?.motion?.type ?? 'flow');
  const [motionSpeed, setMotionSpeed] = useState(initial?.motion?.speed ?? 55);
  const [motionAmount, setMotionAmount] = useState(initial?.motion?.amount ?? 70);
  const [seed, setSeed] = useState(initial?.seed ?? crypto.getRandomValues(new Uint32Array(1))[0]);
  const [scope, setScope] = useState<GradientScope>(
    active.group ? 'group' : selectedIds.length > 1 ? 'selection' : 'slide'
  );
  const [draft, setDraft] = useState<GradientDraft | null>(null);
  const [error, setError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [override, setOverride] = useState(false);
  const [unknown, setUnknown] = useState(false);
  const measuring = useRef<HTMLDivElement>(null);
  const requestId = useRef(0);
  const targets = gradientTargets(slides, activeId, selectedIds, scope);
  const targetSignature = JSON.stringify(targets);
  const latestSignature = useRef(targetSignature);
  latestSignature.current = targetSignature;
  useEffect(() => {
    const measuredTargets = JSON.parse(targetSignature) as Slide[];
    const request = ++requestId.current;
    let cancelled = false;
    setDraft(null);
    setError(false);
    setOverride(false);
    const timer = setTimeout(async () => {
      try {
        await document.fonts.ready;
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        if (cancelled) return;
        const regions: ContrastRegion[] = [];
        let unverified = measuredTargets.length === 0;
        for (const root of measuring.current?.querySelectorAll<HTMLElement>('[data-gradient-slide]') ?? []) {
          const bounds = root.getBoundingClientRect();
          for (const text of root.querySelectorAll<HTMLElement>('[data-gradient-text]')) {
            if (!text.textContent?.trim()) continue;
            const css = getComputedStyle(text),
              rect = text.getBoundingClientRect();
            const color = css.color.match(/[\d.]+/g)?.map(Number);
            if (!color || color.length < 3 || (color.length > 3 && color[3] !== 1) || css.opacity !== '1') {
              unverified = true;
              continue;
            }
            regions.push({
              x: ((rect.x - bounds.x) * 1920) / bounds.width,
              y: ((rect.y - bounds.y) * 1080) / bounds.height,
              width: (rect.width * 1920) / bounds.width,
              height: (rect.height * 1080) / bounds.height,
              color: color.slice(0, 3) as [number, number, number],
            });
          }
        }
        const painted = (color?: string) => !!color && color !== 'transparent';
        unverified ||= measuredTargets.some(
          (s) =>
            painted(s.styles?.textHighlight) ||
            s.items?.some(
              (i) =>
                i.visible !== false &&
                (i.type !== 'text' ||
                  !!i.rotation ||
                  i.styles?.opacity != null ||
                  painted(i.textStyles?.textHighlight) ||
                  painted(i.textStyles?.backgroundColor))
            ) ||
            !!s.group?.author
        );
        setUnknown(unverified || regions.length === 0);
        const recipe: GeneratedBackground = {
          engineVersion: 1,
          seed,
          colors: [...GRADIENT_PALETTES[palette]],
          palette,
          style,
          darkness,
          width: 1920,
          height: 1080,
        };
        const result = await window.electronAPI.generateGradient(recipe, regions);
        if (!cancelled && requestId.current === request) setDraft(result);
      } catch {
        if (!cancelled) setError(true);
      }
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      void window.electronAPI.discardGradient();
    };
    // Signature includes target text/styles; any concurrent edit invalidates the draft.
  }, [palette, style, darkness, seed, targetSignature]);
  const failed = motionEnabled || unknown || draft?.contrast.minimum == null || draft.contrast.minimum < 4.5;
  const apply = async () => {
    if (!draft || saving || (failed && !override) || targets.length === 0) return;
    setSaving(true);
    const signature = targetSignature;
    try {
      const image = await window.electronAPI.saveGradient(draft.token);
      if (latestSignature.current !== signature) throw new Error('Targets changed');
      onApply(
        targets.map((s) => s.id),
        image,
        { ...draft.recipe, motion: { enabled: motionEnabled, speed: motionSpeed, amount: motionAmount, type: motionType } },
        scope === 'group'
      );
      onClose();
    } catch {
      setError(true);
      setSaving(false);
    }
  };
  const preview: Slide = {
    ...active,
    styles: {
      ...active.styles,
      backgroundImage: draft?.image,
      backgroundVideo: undefined,
      backgroundGradient: undefined,
      backgroundBlur: 0,
      generatedBackground: draft ? { ...draft.recipe, motion: { enabled: motionEnabled, speed: motionSpeed, amount: motionAmount, type: motionType } } : undefined,
    } as Slide['styles'],
  };
  const control = 'rounded-lg border border-white/15 bg-[#252733] px-3 py-2 text-sm';
  return (
    <Dialog
      open
      onClose={() => {
        if (!saving) onClose();
      }}
      labelledBy={titleId}
      className="w-[min(1000px,94vw)] max-h-[92vh] overflow-y-auto rounded-2xl border border-white/15 bg-[#171921] p-5 text-white shadow-2xl"
    >
      <h2 id={titleId} className="mb-4 text-lg font-semibold">
        {t('gradient.open')}
      </h2>
      <div className="grid gap-5 md:grid-cols-[1fr_260px]">
        <div>
          <div data-testid="gradient-preview" className="aspect-video overflow-hidden rounded-xl bg-black">
            <LivePreview slide={preview} muted isActive={motionEnabled} />
          </div>
          <p role="status" className="mt-3 text-sm text-white/70">
            {error
              ? t('gradient.error')
              : !draft
                ? t('gradient.generating')
                : `${(draft.byteLength / 1024).toFixed(0)} KiB · 1920 × 1080 · ${t(unknown ? 'gradient.unknown' : 'gradient.contrast', { ratio: draft.contrast.minimum?.toFixed(2) ?? '—' })}`}
          </p>
          {draft && failed && (
            <label className="mt-3 flex gap-2 text-sm text-amber-200">
              <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} />
              {t('gradient.override')}
            </label>
          )}
          {motionEnabled && <p className="mt-2 text-xs text-amber-200/80">{t('gradient.motionNote')}</p>}
        </div>
        <div className="space-y-4">
          <fieldset disabled={saving} className="space-y-4">
            <legend className="mb-2 text-xs text-white/60">{t('gradient.palette')}</legend>
            <div className="grid grid-cols-2 gap-2">
              {Object.entries(GRADIENT_PALETTES).map(([key, colors]) => (
                <button
                  type="button"
                  aria-pressed={palette === key}
                  key={key}
                  onClick={() => setPalette(key as keyof typeof GRADIENT_PALETTES)}
                  className={`${control} ${palette === key ? 'ring-2 ring-violet-400' : ''}`}
                >
                  <span
                    className="mb-1 block h-5 rounded"
                    style={{ background: `linear-gradient(120deg,${colors.join(',')})` }}
                  />
                  {t(`gradient.palettes.${key}`)}
                </button>
              ))}
            </div>
            <label className="block text-sm">
              {t('gradient.style')}
              <select
                className={`${control} mt-1 w-full`}
                value={style}
                onChange={(e) => setStyle(e.target.value as 'soft' | 'flow')}
              >
                <option value="soft">{t('gradient.soft')}</option>
                <option value="flow">{t('gradient.flow')}</option>
              </select>
            </label>
            <label className="block text-sm">
              {t('gradient.darkness')} · {darkness}%
              <input
                className="mt-2 w-full"
                type="range"
                min="0"
                max="85"
                value={darkness}
                onChange={(e) => setDarkness(Number(e.target.value))}
              />
            </label>
            <label className="flex items-center justify-between gap-3 text-sm">
              {t('gradient.motion')}
              <input type="checkbox" checked={motionEnabled} onChange={e => { setMotionEnabled(e.target.checked); setOverride(false); }} />
            </label>
              <fieldset className="space-y-2">
                <legend className="text-sm">{t('gradient.animation')}</legend>
                <div className="grid grid-cols-2 gap-2">
                  {(['flow', 'aurora', 'waves', 'fog'] as const).map(type => <button key={type} type="button"
                    aria-pressed={motionEnabled && motionType === type} onClick={() => { setMotionType(type); setMotionEnabled(true); setOverride(false); }}
                    className={`${control} ${motionEnabled && motionType === type ? 'ring-2 ring-violet-400 bg-violet-500/20' : ''}`}>
                    {t(`gradient.${type}`)}
                  </button>)}
                </div>
              </fieldset>
            {motionEnabled && <div className="space-y-3">
              <label className="block text-sm">{t('gradient.speed')} · {motionSpeed}%
                <input className="mt-2 w-full" type="range" min="1" max="100" value={motionSpeed} onChange={e => setMotionSpeed(Number(e.target.value))} />
              </label>
              <label className="block text-sm">{t('gradient.amount')} · {motionAmount}%
                <input className="mt-2 w-full" type="range" min="1" max="100" value={motionAmount} onChange={e => setMotionAmount(Number(e.target.value))} />
              </label>
            </div>}
            <button
              type="button"
              className={`${control} w-full`}
              onClick={() => setSeed(crypto.getRandomValues(new Uint32Array(1))[0])}
            >
              {t('gradient.regenerate')}
            </button>
            <label className="block text-sm">
              {t('gradient.target')}
              <select
                className={`${control} mt-1 w-full`}
                value={scope}
                onChange={(e) => setScope(e.target.value as GradientScope)}
              >
                <option value="slide">{t('gradient.slide')}</option>
                {active.group && <option value="group">{t('gradient.group')}</option>}
                {selectedIds.length > 1 && <option value="selection">{t('gradient.selection')}</option>}
              </select>
            </label>
          </fieldset>
        </div>
      </div>
      <div className="mt-5 flex justify-end gap-3">
        <button type="button" disabled={saving} className={control} onClick={onClose}>
          {t('gradient.cancel')}
        </button>
        <button
          type="button"
          disabled={!draft || error || saving || !targets.length || (failed && !override)}
          onClick={apply}
          className="rounded-lg bg-violet-600 px-4 py-2 disabled:opacity-40"
        >
          {t('gradient.apply', { count: targets.length })}
        </button>
      </div>
      <div
        ref={measuring}
        aria-hidden="true"
        className="pointer-events-none fixed"
        style={{ left: -20000, top: 0, visibility: 'hidden' }}
      >
        {targets
          .flatMap((s) =>
            s.partsMode && s.parts?.length ? s.parts.map((_, index) => ({ ...s, activePart: index })) : [s]
          )
          .map((s, index) => (
            <div key={`${s.id}-${index}`} data-gradient-slide="" style={{ width: 1920, height: 1080 }}>
              <LivePreview
                slide={{
                  ...s,
                  styles: { ...s.styles, backgroundImage: undefined, backgroundVideo: undefined } as Slide['styles'],
                }}
                muted
                isActive={false}
              />
            </div>
          ))}
      </div>
    </Dialog>
  );
}
