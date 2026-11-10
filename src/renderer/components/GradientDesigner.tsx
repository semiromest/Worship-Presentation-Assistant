import ControlTooltip from './ControlTooltip';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { GRADIENT_ANIMATIONS, GRADIENT_PALETTES, isTwoColorStyle, type GeneratedBackground, type GradientAnimation } from '../../shared/generatedBackground';
import type { GradientDraft } from '../../shared/gradientDraft';
import type { GradientStyle } from '../../shared/presentation';
import type { GradientLibraryEntry } from '../../shared/gradientLibrary';
import { generatedStyles } from '../gradientBackground';
import { GradientLibraryGallery, useGradientLibrary } from './GradientLibraryGallery';
import { playSfx } from '../sfx';
import { Check } from 'lucide-react';
import './GradientDesigner.css';

export interface GradientPreview {
  slideId: string;
  styles: Record<string, unknown>;
}

type Motion = NonNullable<GeneratedBackground['motion']>;
type Patch = Partial<GeneratedBackground>;
type Tab = 'design' | 'library';

const CONTROL = 'gradient-control';
const TABS: readonly Tab[] = ['design', 'library'];
type Style = GeneratedBackground['style'];
interface Look { id: string; style: Style; animation?: GradientAnimation }

/** One list replaces the old style select + "live motion" switch + animation select. */
const STILL_LOOKS: Look[] = (['linear', 'soft', 'flow', 'radial'] as const).map((style) => ({ id: style, style }));
const LIVE_LOOKS: Look[] = GRADIENT_ANIMATIONS.map((animation) => ({ id: 'live:' + animation, style: 'flow', animation }));
const LOOK_GROUPS = [
  { group: 'still', looks: STILL_LOOKS },
  { group: 'live', looks: LIVE_LOOKS },
] as const;

const lookIdOf = (recipe: GeneratedBackground): string =>
  recipe.motion?.enabled && !isTwoColorStyle(recipe.style) ? 'live:' + (recipe.motion.type ?? 'flow') : recipe.style;

/** Swatches show each look in the colors currently chosen, so the grid doubles as a preview. */
function lookSwatch(look: Look, [a, b, c, d]: string[]): string {
  if (look.id === 'linear') return `linear-gradient(135deg,${a},${d})`;
  if (look.id === 'radial') return `radial-gradient(circle at 50% 50%,${c},${a} 85%)`;
  const blobs = `radial-gradient(at 18% 22%,${b} 0,transparent 58%),radial-gradient(at 82% 30%,${c} 0,transparent 55%),radial-gradient(at 36% 88%,${d} 0,transparent 60%),${a}`;
  switch (look.animation) {
    case 'aurora': return `linear-gradient(100deg,transparent 15%,${c}99 38%,transparent 52%,${d}88 70%,transparent 90%),linear-gradient(180deg,${a},${b})`;
    case 'waves': return `repeating-linear-gradient(165deg,${a} 0 9px,${b} 9px 18px,${c} 18px 27px,${d} 27px 36px)`;
    case 'fog': return `radial-gradient(ellipse at 30% 40%,${c}aa,transparent 60%),radial-gradient(ellipse at 75% 65%,${d}aa,transparent 55%),linear-gradient(180deg,${a},${b})`;
    case 'bokeh': return `radial-gradient(circle at 25% 30%,${c} 0 9%,transparent 11%),radial-gradient(circle at 68% 24%,${d} 0 12%,transparent 14%),radial-gradient(circle at 55% 72%,${c} 0 8%,transparent 10%),linear-gradient(180deg,${a},${b})`;
    case 'rays': return `conic-gradient(from 160deg at 42% -18%,transparent 0 6%,${c}aa 9%,transparent 13% 20%,${d}99 24%,transparent 29% 36%,${c}88 40%,transparent 46%),linear-gradient(180deg,${a},${b})`;
    case 'lava': return `radial-gradient(circle at 30% 65%,${c} 0 22%,transparent 24%),radial-gradient(circle at 66% 32%,${d} 0 18%,transparent 20%),linear-gradient(180deg,${a},${b})`;
    case 'pulse': return `repeating-radial-gradient(circle at 50% 50%,${c} 0 6px,${b} 6px 13px,${a} 13px 20px)`;
    default: return blobs;
  }
}
const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;
const DEFAULT_MOTION: Motion = { enabled: false, type: 'flow', speed: 55, amount: 70 };
const GENERATE_DEBOUNCE_MS = 180;
const NAME_MAX_LENGTH = 80;

// Palet listesi ve arka plan dizeleri her render'da değil, modül yüklenirken bir kez üretilir.
const PALETTES = Object.entries(GRADIENT_PALETTES).map(([key, colors]) => ({
  key,
  colors,
  background: `linear-gradient(120deg,${colors.join(',')})`,
}));

const randomSeed = () => crypto.getRandomValues(new Uint32Array(1))[0];

/** Eski iki duraklı lineer gradyanı yeni tarife çevirir; dönüştürülemezse undefined. */
function recipeFromLegacy(legacy?: GradientStyle): GeneratedBackground | undefined {
  if (legacy?.type !== 'linear') return undefined;
  const stops = legacy.stops;
  if (stops?.length !== 2) return undefined;
  const [from, to] = stops;
  if (from.position !== 0 || to.position !== 100) return undefined;
  if (!HEX_COLOR_RE.test(from.color) || !HEX_COLOR_RE.test(to.color)) return undefined;
  const { angle } = legacy;
  return {
    engineVersion: 1,
    width: 1920,
    height: 1080,
    seed: 0,
    palette: 'custom',
    style: 'linear',
    darkness: 0,
    colors: [from.color, to.color],
    angle: typeof angle === 'number' && Number.isFinite(angle) ? ((Math.round(angle) % 360) + 360) % 360 : 90,
  };
}

function createInitialRecipe(initial?: GeneratedBackground, legacy?: GradientStyle): GeneratedBackground {
  return (
    initial ??
    recipeFromLegacy(legacy) ?? {
      engineVersion: 1,
      width: 1920,
      height: 1080,
      seed: randomSeed(),
      palette: 'ocean',
      colors: [...GRADIENT_PALETTES.ocean],
      style: 'flow',
      darkness: 25,
    }
  );
}

function tabForKey(key: string, current: Tab): Tab | null {
  switch (key) {
    case 'Home':
      return 'design';
    case 'End':
      return 'library';
    case 'ArrowLeft':
    case 'ArrowRight':
      return current === 'design' ? 'library' : 'design';
    default:
      return null;
  }
}

function RangeField({
  label,
  value,
  min,
  max,
  step,
  unit,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="gradient-range">
      <span>
        {label}
        <span>
          {value}
          {unit}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}

export function GradientDesigner({
  slideId,
  initial,
  legacy,
  onClear,
  canClear,
  targetIds,
  enabled,
  onPreview,
  onApply,
}: {
  slideId: string;
  initial?: GeneratedBackground;
  legacy?: GradientStyle;
  onClear?: () => void;
  canClear?: boolean;
  targetIds: string[];
  enabled: boolean;
  onPreview: (preview: GradientPreview | null) => void;
  onApply: (ids: string[], image: string, recipe: GeneratedBackground) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [tab, setTab] = useState<Tab>('design');
  const [recipe, setRecipe] = useState(() => createInitialRecipe(initial, legacy));
  const [designing, setDesigning] = useState(false);
  const [rendered, setRendered] = useState<{ draft: GradientDraft; signature: string } | null>(null);
  const [generating, setGenerating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const [notice, setNotice] = useState('');
  const library = useGradientLibrary(enabled);

  // Raster imzası motion'ı içermez; yalnızca recipe değişince yeniden hesaplanır (her render'da değil).
  const signature = useMemo(() => {
    const base = { ...recipe, motion: undefined };
    return JSON.stringify(base);
  }, [recipe]);
  // Imza aynı kaldıkça nesne kimliği de sabit kalır, böylece motion değişimi yeniden üretimi tetiklemez.
  const raster = useMemo(() => JSON.parse(signature) as GeneratedBackground, [signature]);
  const targetSignature = JSON.stringify(targetIds);

  // Async işlemler bitince güncel değerleri okumak için. Ref render sırasında değil, commit sonrası güncellenir.
  const latest = useRef({ signature, targetSignature, enabled });
  useEffect(() => {
    latest.current = { signature, targetSignature, enabled };
  }, [signature, targetSignature, enabled]);

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!enabled || !designing) {
      setRendered(null);
      setGenerating(false);
      return;
    }
    let cancelled = false;
    let requested = false;
    setGenerating(true);
    setError(false);
    const timer = setTimeout(() => {
      requested = true;
      window.electronAPI
        .generateGradient(raster, [])
        .then((draft) => {
          if (!cancelled) setRendered({ draft, signature });
        })
        .catch(() => {
          if (!cancelled) setError(true);
        })
        .finally(() => {
          if (!cancelled) setGenerating(false);
        });
    }, GENERATE_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      // İstek hiç gönderilmediyse (debounce içinde yeni değişiklik geldi) atılacak taslak yoktur.
      if (requested) void window.electronAPI.discardGradient().catch(() => {});
    };
  }, [enabled, designing, signature, raster]);

  useEffect(() => {
    if (!enabled || tab !== 'design' || !designing || !rendered) {
      onPreview(null);
      return;
    }
    // Keep the last complete raster with its own recipe while another request runs.
    onPreview({
      slideId,
      styles: generatedStyles(rendered.draft.image, { ...rendered.draft.recipe, motion: recipe.motion }),
    });
    return () => onPreview(null);
  }, [enabled, tab, designing, rendered, recipe.motion, slideId, onPreview]);

  const ready = !!rendered && rendered.signature === signature && !generating && !error && enabled;

  // Fonksiyonel güncelleme: art arda gelen olaylarda eski `recipe` kapanışına bağımlı kalmaz.
  const edit = useCallback((patch: Patch | ((current: GeneratedBackground) => Patch)) => {
    setRecipe((current) => ({ ...current, ...(typeof patch === 'function' ? patch(current) : patch) }));
    setDesigning(true);
    setNotice('');
  }, []);

  const editMotion = useCallback(
    (patch: Partial<Motion>) => edit((current) => ({ motion: { ...DEFAULT_MOTION, ...current.motion, ...patch } })),
    [edit],
  );

  function changeStyle(style: GeneratedBackground['style']) {
    edit((current) => {
      if (isTwoColorStyle(style)) {
        return {
          style,
          colors: [current.colors[0], current.colors[current.colors.length - 1]],
          palette: 'custom',
          angle: style === 'linear' ? current.angle ?? 90 : undefined,
          darkness: 0,
          motion: undefined,
        };
      }
      const fromLinear = isTwoColorStyle(current.style);
      return {
        style,
        angle: undefined,
        motion: current.motion ? { ...current.motion, enabled: false } : undefined,
        colors: fromLinear ? [...GRADIENT_PALETTES.ocean] : current.colors,
        palette: fromLinear ? 'ocean' : current.palette,
      };
    });
  }

  function chooseLook(look: Look) {
    if (!look.animation) {
      changeStyle(look.style);
      return;
    }
    // Live looks run on a four-color field: leave a two-color style on the way in.
    edit((current) => ({
      style: isTwoColorStyle(current.style) ? 'flow' : current.style,
      angle: undefined,
      colors: isTwoColorStyle(current.style) ? [...GRADIENT_PALETTES.ocean] : current.colors,
      palette: isTwoColorStyle(current.style) ? 'ocean' : current.palette,
      darkness: isTwoColorStyle(current.style) ? 25 : current.darkness,
      motion: { ...DEFAULT_MOTION, ...current.motion, enabled: true, type: look.animation },
    }));
  }

  function changeColor(index: number, value: string) {
    edit((current) => ({
      ...(!isTwoColorStyle(current.style) ? { palette: 'custom' } : {}),
      colors: current.colors.map((color, i) => (i === index ? value : color)),
    }));
  }

  /** busy/error/unmount kalıbı üç async işlemde aynıydı; tek yerde toplandı. */
  async function run(task: () => Promise<void>) {
    setBusy(true);
    setError(false);
    try {
      await task();
    } catch {
      if (mounted.current) setError(true);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  async function apply() {
    if (!ready || busy || !targetIds.length || !rendered) return;
    const targets = targetSignature;
    const current = signature;
    await run(async () => {
      const image = await window.electronAPI.saveGradient(rendered.draft.token);
      const now = latest.current;
      if (!mounted.current || !now.enabled || now.signature !== current || now.targetSignature !== targets) return;
      onApply([...targetIds], image, recipe);
      onPreview(null);
      setNotice(t('gradientLibrary.appliedDraft'));
      playSfx('success');
    });
  }

  async function save() {
    const trimmed = name.trim();
    if (!ready || busy || !rendered || !trimmed) return;
    await run(async () => {
      const list = await window.electronAPI.saveGradientLibrary({
        name: trimmed,
        token: rendered.draft.token,
        recipe,
      });
      if (!mounted.current) return;
      library.setEntries(list);
      setNaming(false);
      setName('');
      setNotice(t('gradientLibrary.saved'));
      playSfx('success');
    });
  }

  function choose(entry: GradientLibraryEntry) {
    setRecipe(entry.recipe);
    setDesigning(false);
    setError(false);
    onPreview(null);
    onApply([...targetIds], entry.image, entry.recipe);
    setNotice(t('gradientLibrary.appliedDraft'));
    playSfx('success');
  }

  async function remove(entry: GradientLibraryEntry) {
    await run(async () => {
      const list = await window.electronAPI.deleteGradientLibrary(entry.id);
      if (!mounted.current) return;
      library.setEntries(list);
      setNotice(t('gradientLibrary.removed'));
    });
  }

  const motionSettings = recipe.motion;
  const twoColor = isTwoColorStyle(recipe.style);
  const currentLook = lookIdOf(recipe);
  const swatchColors = recipe.colors.length === 4 ? recipe.colors : [...GRADIENT_PALETTES.ocean].map((color, i) => (i === 0 ? recipe.colors[0] : i === 3 ? recipe.colors[1] : color));

  return (
    <section
      className="gradient-designer space-y-3 rounded-xl border border-white/10 p-3"
      aria-label={t('gradientLibrary.title')}
      data-testid="gradient-designer"
    >
      <h3 className="text-sm font-semibold">{t('gradientLibrary.title')}</h3>
      <div role="tablist" aria-label={t('gradientLibrary.title')} className="flex rounded-lg bg-black/20 p-1">
        {TABS.map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            id={`${id}-${value}`}
            aria-controls={`${id}-panel`}
            aria-selected={tab === value}
            tabIndex={tab === value ? 0 : -1}
            onKeyDown={(event) => {
              const next = tabForKey(event.key, tab);
              if (!next) return;
              event.preventDefault();
              event.stopPropagation();
              setTab(next);
              document.getElementById(`${id}-${next}`)?.focus();
            }}
            onClick={() => setTab(value)}
            className={`flex-1 rounded px-2 py-2 text-xs focus-visible:ring-2 focus-visible:ring-violet-400 ${tab === value ? 'bg-violet-500/25 text-violet-100' : 'text-white/60'}`}
          >
            {t(`gradientLibrary.${value}`)}
          </button>
        ))}
      </div>
      <div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-${tab}`}>
        {tab === 'design' ? (
          <fieldset disabled={busy || !enabled} className="min-w-0 space-y-4">
            {!notice && <p className="gradient-hint">{t('gradientLibrary.previewHint')}</p>}
            <fieldset className="gradient-section">
              <legend>{t('gradient.look')}</legend>
              {LOOK_GROUPS.map(({ group, looks }) => (
                <div key={group} className="space-y-1.5">
                  <div className="gradient-color-heading">
                    <span>{t('gradient.' + group + 'Looks')}</span>
                  </div>
                  <div className="gradient-looks" role="group" aria-label={t('gradient.' + group + 'Looks')}>
                    {looks.map((look) => (
                      <button
                        key={look.id}
                        type="button"
                        aria-pressed={currentLook === look.id}
                        onClick={() => chooseLook(look)}
                        className="gradient-look"
                        data-live={look.animation ? '' : undefined}
                      >
                        <span className="gradient-look-swatch" aria-hidden="true" style={{ background: lookSwatch(look, swatchColors) }} />
                        <span className="gradient-look-name">
                          <span>{t('gradient.' + (look.animation ?? look.style))}</span>
                          {currentLook === look.id && <Check size={12} aria-hidden="true" className="shrink-0" />}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </fieldset>
            <fieldset className="gradient-section">
              <legend>{t('gradient.colors')}</legend>
              {!twoColor && (
                <div className="gradient-palettes" data-testid="gradient-palettes" role="group" aria-label={t('gradient.presets')}>
                  {PALETTES.map(({ key, colors, background }) => (
                    <button
                      key={key}
                      type="button"
                      aria-label={t('gradient.palettes.' + key)}
                      title={t('gradient.palettes.' + key)}
                      aria-pressed={recipe.palette === key}
                      onClick={() => edit({ palette: key, colors: [...colors] })}
                      className="gradient-palette-chip"
                      style={{ background }}
                    >
                      {recipe.palette === key && <Check size={12} aria-hidden="true" />}
                    </button>
                  ))}
                </div>
              )}
              <div
                className={'gradient-colors' + (twoColor ? ' gradient-colors-linear' : ' gradient-colors-row')}
                data-testid="gradient-colors"
              >
                {recipe.colors.map((color, index) => (
                  <label key={index} className="gradient-color-label">
                    <span>
                      {twoColor
                        ? t(index === 0 ? (recipe.style === 'radial' ? 'gradient.centerColor' : 'gradient.startColor') : (recipe.style === 'radial' ? 'gradient.edgeColor' : 'gradient.endColor'))
                        : t('gradient.colorNumber', { number: index + 1 })}
                    </span>
                    <ControlTooltip description={t('tooltipText.editColor', { color: color.toUpperCase() })}><input
                      type="color"
                      value={color}
                      title={color.toUpperCase()}
                      className="gradient-color"
                      onChange={(e) => changeColor(index, e.target.value)}
                    /></ControlTooltip>
                  </label>
                ))}
              </div>
              {recipe.palette === 'custom' && !twoColor && <span className="text-violet-200">{t('gradient.customColors')}</span>}
            </fieldset>
            {motionSettings?.enabled && !twoColor && (
              <fieldset className="gradient-section">
                <RangeField
                  label={t('gradient.speed')}
                  value={motionSettings.speed ?? DEFAULT_MOTION.speed}
                  min={1}
                  max={100}
                  unit="%"
                  onChange={(speed) => editMotion({ speed })}
                />
              </fieldset>
            )}
            <details className="gradient-more">
              <summary>{t('gradient.moreOptions')}</summary>
              <div className="gradient-section">
                <RangeField
                  label={t('gradient.darkness')}
                  value={recipe.darkness}
                  min={0}
                  max={85}
                  unit="%"
                  onChange={(darkness) => edit({ darkness })}
                />
                {recipe.style === 'linear' && (
                  <RangeField
                    label={t('gradient.angle')}
                    value={recipe.angle ?? 90}
                    min={0}
                    max={360}
                    step={1}
                    unit="°"
                    onChange={(angle) => edit({ angle })}
                  />
                )}
                {motionSettings?.enabled && !twoColor && (
                  <RangeField
                    label={t('gradient.amount')}
                    value={motionSettings.amount ?? DEFAULT_MOTION.amount}
                    min={1}
                    max={100}
                    unit="%"
                    onChange={(amount) => editMotion({ amount })}
                  />
                )}
                {(!twoColor || !designing || error) && (
                  <button type="button" className="gradient-regenerate" onClick={() => edit({ seed: randomSeed() })}>
                    {t('gradient.regenerate')}
                  </button>
                )}
              </div>
            </details>
            <div className="gradient-actions">
              {generating && (
                <p role="status" className="gradient-hint">
                  {t('gradient.generating')}
                </p>
              )}
              <button
                type="button"
                disabled={!ready || !targetIds.length}
                onClick={() => void apply()}
                className="gradient-apply"
              >
                {t('gradientLibrary.applyDraft', { count: targetIds.length })}
              </button>
              <button
                type="button"
                disabled={!ready}
                onClick={() => setNaming((v) => !v)}
                aria-expanded={naming}
                aria-controls={id + '-name-form'}
                className={CONTROL}
              >
                {t('gradientLibrary.saveLibrary')}
              </button>
              {naming && (
                <form
                  id={id + '-name-form'}
                  onSubmit={(e) => {
                    e.preventDefault();
                    void save();
                  }}
                  className="space-y-2"
                >
                  <p className="gradient-hint">{t('gradientLibrary.saveHint')}</p>
                  <label className="gradient-color-label">
                    <span>{t('gradientLibrary.name')}</span>
                    <input
                      autoFocus
                      maxLength={NAME_MAX_LENGTH}
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className={CONTROL}
                    />
                  </label>
                  <button type="submit" disabled={!ready || !name.trim()} className={CONTROL}>
                    {t('gradientLibrary.confirmSave')}
                  </button>
                </form>
              )}
            </div>
          </fieldset>
        ) : (
          <GradientLibraryGallery
            {...library}
            disabled={busy || !enabled || !targetIds.length}
            onChoose={choose}
            onRemove={(entry) => void remove(entry)}
          />
        )}
      </div>
      {canClear && onClear && (
        <button
          type="button"
          disabled={busy || !enabled}
          className="gradient-remove"
          onClick={() => {
            setDesigning(false);
            onPreview(null);
            onClear();
          }}
        >
          {t('gradient.remove')}
        </button>
      )}
      {error && (
        <p role="alert" className="text-xs text-red-300">
          {t('gradient.error')}
        </p>
      )}
      {notice && (
        <p role="status" className="text-xs leading-5 text-violet-200">
          {notice}
        </p>
      )}
    </section>
  );
}
