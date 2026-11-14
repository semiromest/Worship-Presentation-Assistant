import ControlTooltip from './ControlTooltip';
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { GRADIENT_ANIMATIONS, GRADIENT_PALETTES, isTwoColorStyle, type GeneratedBackground, type GradientAnimation } from '../../shared/generatedBackground';
import type { GradientDraft } from '../../shared/gradientDraft';
import type { GradientStyle } from '../../shared/presentation';
import type { GradientLibraryEntry } from '../../shared/gradientLibrary';
import { generatedStyles } from '../gradientBackground';
import { useGradientLibrary } from './GradientLibraryGallery';
import { playSfx } from '../sfx';
import { ArrowUp, Bookmark, Check, Loader2, Shuffle, X } from 'lucide-react';
import './GradientDesigner.css';

export interface GradientPreview {
  slideId: string;
  styles: Record<string, unknown>;
}

type Motion = NonNullable<GeneratedBackground['motion']>;
type Patch = Partial<GeneratedBackground>;
type Style = GeneratedBackground['style'];

const CONTROL = 'gradient-control';
const STYLES: readonly Style[] = ['linear', 'radial', 'soft', 'flow'];
const DIRECTIONS = [0, 45, 90, 135, 180, 225, 270, 315] as const;

/** Swatches show each style/animation in the colors currently chosen, so the picker doubles as a preview. */
function swatch(style: Style, animation: GradientAnimation | undefined, [a, b, c, d]: string[]): string {
  if (!animation && style === 'linear') return `linear-gradient(135deg,${a},${d})`;
  if (!animation && style === 'radial') return `radial-gradient(circle at 50% 50%,${a},${d} 85%)`;
  if (!animation && style === 'soft') return `radial-gradient(at 30% 30%,${b} 0,transparent 70%),radial-gradient(at 75% 75%,${c} 0,transparent 70%),${a}`;
  const blobs = `radial-gradient(at 18% 22%,${b} 0,transparent 58%),radial-gradient(at 82% 30%,${c} 0,transparent 55%),radial-gradient(at 36% 88%,${d} 0,transparent 60%),${a}`;
  switch (animation) {
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
/** A finished render is written to the slide once the controls have been still this long. */
const COMMIT_SETTLE_MS = 400;
const NAME_MAX_LENGTH = 80;

// Palet listesi ve arka plan dizeleri her render'da değil, modül yüklenirken bir kez üretilir.
const PALETTES = Object.entries(GRADIENT_PALETTES).map(([key, colors]) => ({
  key,
  colors: colors as readonly string[],
  background: `linear-gradient(120deg,${colors.join(',')})`,
}));

const randomSeed = () => crypto.getRandomValues(new Uint32Array(1))[0];

/** Names the palette whose colors these are, or `custom`. Two-color recipes match on a palette's ends. */
function paletteOf(colors: string[]): string {
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  const match = PALETTES.find(({ colors: p }) =>
    colors.length === 2 ? same(colors[0], p[0]) && same(colors[1], p[3]) : colors.every((c, i) => same(c, p[i]))
  );
  return match?.key ?? 'custom';
}

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

/**
 * Gradient background picker. Every change previews on the canvas at once and is
 * written to the target slides as soon as the controls settle, like any other
 * editor setting: one undo step per settled change, no separate apply button.
 */
export function GradientDesigner({
  slideId,
  initial,
  legacy,
  onClear,
  canClear,
  targetIds,
  enabled,
  autoStart = false,
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
  /** Apply the starting recipe right away (the user just picked "gradient" as the background type). */
  autoStart?: boolean;
  onPreview: (preview: GradientPreview | null) => void;
  onApply: (ids: string[], image: string, recipe: GeneratedBackground) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
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
  /** Full recipe (motion included): what the slides must end up holding. */
  const recipeKey = useMemo(() => JSON.stringify(recipe), [recipe]);
  const targetSignature = JSON.stringify(targetIds);
  const initialKey = initial ? JSON.stringify(initial) : '';

  /** Recipe key last written to the slides (or found on them). */
  const committed = useRef(initialKey);
  const [committedKey, setCommittedKey] = useState(initialKey);

  // Async işlemler bitince güncel değerleri okumak için. Ref render sırasında değil, commit sonrası güncellenir.
  const latest = useRef({ signature, recipeKey, targetSignature, enabled });
  useEffect(() => {
    latest.current = { signature, recipeKey, targetSignature, enabled };
  }, [signature, recipeKey, targetSignature, enabled]);

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  /** Saves the rendered raster and writes it to the slides. Safe to call while unmounting. */
  const commit = useCallback(
    async (draft: GradientDraft, value: GeneratedBackground, ids: string[]) => {
      const key = JSON.stringify(value);
      committed.current = key;
      try {
        const image = await window.electronAPI.saveGradient(draft.token);
        // A newer settled change will commit itself; only a vanished editor flushes a stale one.
        if (mounted.current && latest.current.recipeKey !== key) return;
        onApply(ids, image, value);
        if (mounted.current) setCommittedKey(key);
      } catch {
        if (committed.current === key) committed.current = '';
        if (mounted.current) setError(true);
      }
    },
    [onApply]
  );

  // Undo/redo or another surface changed the slide's gradient: follow it instead of fighting it.
  useEffect(() => {
    if (initialKey === committed.current) return;
    committed.current = initialKey;
    setCommittedKey(initialKey);
    setDesigning(false);
    if (initial) setRecipe(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialKey]);

  const ready = !!rendered && rendered.signature === signature && !generating && !error && enabled;
  const pending = designing && recipeKey !== committedKey;

  // Leaving the slide, the tab or the editor never drops a finished change.
  const flush = useRef<() => void>(() => {});
  useLayoutEffect(() => {
    flush.current = () => {
      if (ready && rendered && targetIds.length && recipeKey !== committed.current) void commit(rendered.draft, recipe, [...targetIds]);
    };
  });
  useEffect(() => {
    if (!enabled) return;
    return () => flush.current();
  }, [enabled]);

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

  // Settled → written to the slides.
  useEffect(() => {
    if (!ready || !rendered || !targetIds.length || recipeKey === committed.current) return;
    const timer = setTimeout(() => void commit(rendered.draft, recipe, [...targetIds]), COMMIT_SETTLE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, rendered, recipeKey, targetSignature, commit]);

  useEffect(() => {
    if (!enabled || !designing || !rendered) {
      onPreview(null);
      return;
    }
    // Keep the last complete raster with its own recipe while another request runs.
    onPreview({
      slideId,
      styles: generatedStyles(rendered.draft.image, { ...rendered.draft.recipe, motion: recipe.motion }),
    });
    return () => onPreview(null);
  }, [enabled, designing, rendered, recipe.motion, slideId, onPreview]);

  // Fonksiyonel güncelleme: art arda gelen olaylarda eski `recipe` kapanışına bağımlı kalmaz.
  const edit = useCallback((patch: Patch | ((current: GeneratedBackground) => Patch)) => {
    setRecipe((current) => ({ ...current, ...(typeof patch === 'function' ? patch(current) : patch) }));
    setDesigning(true);
    setError(false);
    setNotice('');
  }, []);

  useEffect(() => {
    if (autoStart && !initial) edit({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Four-color set kept aside while a two-color style is active, so switching back restores it. */
  const fourColors = useRef<string[]>(recipe.colors.length === 4 ? recipe.colors : [...GRADIENT_PALETTES.ocean]);
  useEffect(() => {
    if (recipe.colors.length === 4) fourColors.current = recipe.colors;
  }, [recipe.colors]);

  const editMotion = useCallback(
    (patch: Partial<Motion>) => edit((current) => ({ motion: { ...DEFAULT_MOTION, ...current.motion, ...patch } })),
    [edit],
  );

  function changeStyle(style: Style) {
    edit((current) => {
      const fromTwo = isTwoColorStyle(current.style);
      if (isTwoColorStyle(style)) {
        const colors = fromTwo ? current.colors : [current.colors[0], current.colors[current.colors.length - 1]];
        return {
          style,
          colors,
          palette: fromTwo ? current.palette : paletteOf(colors),
          angle: style === 'linear' ? current.angle ?? 90 : undefined,
          darkness: fromTwo ? current.darkness : 0,
          motion: undefined,
        };
      }
      if (!fromTwo) return { style };
      // Keep the user's two colors as the ends of the remembered four-color set.
      const [first, last] = current.colors;
      const colors = [first, fourColors.current[1], fourColors.current[2], last];
      return { style, angle: undefined, colors, palette: paletteOf(colors), darkness: 25 };
    });
  }

  function toggleMotion(on: boolean) {
    if (!on) {
      editMotion({ enabled: false });
      return;
    }
    // Motion runs on a four-color field: leave a two-color style on the way in.
    if (isTwoColorStyle(recipe.style)) changeStyle('flow');
    editMotion({ enabled: true });
  }

  function choosePalette(colors: readonly string[], key: string) {
    edit((current) => ({ palette: key, colors: isTwoColorStyle(current.style) ? [colors[0], colors[3]] : [...colors] }));
  }

  function changeColor(index: number, value: string) {
    edit((current) => {
      const colors = current.colors.map((color, i) => (i === index ? value : color));
      return { colors, palette: paletteOf(colors) };
    });
  }

  async function save() {
    const trimmed = name.trim();
    if (!ready || busy || !rendered || !trimmed) return;
    setBusy(true);
    try {
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
    } catch {
      if (mounted.current) setError(true);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  function choose(entry: GradientLibraryEntry) {
    if (!targetIds.length) return;
    const key = JSON.stringify(entry.recipe);
    committed.current = key;
    setCommittedKey(key);
    setRecipe(entry.recipe);
    setDesigning(false);
    setError(false);
    onPreview(null);
    onApply([...targetIds], entry.image, entry.recipe);
    playSfx('success');
  }

  async function remove(entry: GradientLibraryEntry) {
    setBusy(true);
    try {
      const list = await window.electronAPI.deleteGradientLibrary(entry.id);
      if (!mounted.current) return;
      library.setEntries(list);
      setNotice(t('gradientLibrary.removed'));
    } catch {
      if (mounted.current) setError(true);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  function openNaming() {
    // Saving needs a fresh render of the current recipe; start one if the panel is idle.
    if (!designing) setDesigning(true);
    setNaming((value) => !value);
  }

  const motionSettings = recipe.motion;
  const twoColor = isTwoColorStyle(recipe.style);
  const live = !!motionSettings?.enabled && !twoColor;
  const swatchColors = recipe.colors.length === 4 ? recipe.colors : [recipe.colors[0], fourColors.current[1], fourColors.current[2], recipe.colors[1]];
  const working = designing && (generating || pending) && !error;
  const angle = recipe.angle ?? 90;

  return (
    <section
      className="gradient-designer min-w-0 space-y-3"
      aria-label={t('gradientLibrary.title')}
      data-testid="gradient-designer"
    >
      {library.entries.length > 0 && (
        <div className="space-y-1.5">
          <span className="gradient-label">{t('gradientLibrary.library')}</span>
          <ul className="gradient-saved" aria-label={t('gradientLibrary.library')}>
            {library.entries.map((entry) => (
              <li key={entry.id} className="gradient-saved-item">
                <ControlTooltip description={t('tooltipText.useGradient', { name: entry.name })}><button
                  type="button"
                  disabled={busy || !enabled || !targetIds.length}
                  aria-label={entry.name}
                  data-gradient-entry={entry.id}
                  onClick={() => choose(entry)}
                  className="gradient-saved-thumb"
                >
                  <img src={entry.image} alt="" loading="lazy" />
                </button></ControlTooltip>
                <button
                  type="button"
                  disabled={busy || !enabled}
                  onClick={() => void remove(entry)}
                  aria-label={t('gradientLibrary.deleteNamed', { name: entry.name })}
                  title={t('gradientLibrary.deleteNamed', { name: entry.name })}
                  className="gradient-saved-remove"
                >
                  <X size={10} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <fieldset disabled={!enabled} className="min-w-0 space-y-3">
        <div className="space-y-1.5">
          <span className="gradient-label">{t('gradient.style')}</span>
          <div className="gradient-looks" role="group" aria-label={t('gradient.style')}>
            {STYLES.map((style) => (
              <button
                key={style}
                type="button"
                aria-pressed={recipe.style === style}
                onClick={() => changeStyle(style)}
                className="gradient-look"
                title={t('gradient.' + style)}
              >
                <span className="gradient-look-swatch" aria-hidden="true" style={{ background: swatch(style, undefined, swatchColors) }} />
                <span className="gradient-look-name">{t('gradient.' + style)}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <span className="gradient-label">{t('gradient.colors')}</span>
          <div className="gradient-palettes" data-testid="gradient-palettes" role="group" aria-label={t('gradient.presets')}>
            {PALETTES.map(({ key, colors, background }) => (
              <button
                key={key}
                type="button"
                aria-label={t('gradient.palettes.' + key)}
                title={t('gradient.palettes.' + key)}
                aria-pressed={recipe.palette === key}
                onClick={() => choosePalette(colors, key)}
                className="gradient-palette-chip"
                style={{ background: twoColor ? `linear-gradient(120deg,${colors[0]},${colors[3]})` : background }}
              >
                {recipe.palette === key && <Check size={11} aria-hidden="true" />}
              </button>
            ))}
          </div>
          <div className={'gradient-colors' + (twoColor ? ' gradient-colors-linear' : ' gradient-colors-row')} data-testid="gradient-colors">
            {recipe.colors.map((color, index) => (
              <ControlTooltip key={index} description={t('tooltipText.editColor', { color: color.toUpperCase() })}>
                <input
                  type="color"
                  value={color}
                  aria-label={
                    twoColor
                      ? t(index === 0 ? (recipe.style === 'radial' ? 'gradient.centerColor' : 'gradient.startColor') : (recipe.style === 'radial' ? 'gradient.edgeColor' : 'gradient.endColor'))
                      : t('gradient.colorNumber', { number: index + 1 })
                  }
                  className="gradient-color"
                  onChange={(e) => changeColor(index, e.target.value)}
                />
              </ControlTooltip>
            ))}
          </div>
        </div>

        {recipe.style === 'linear' && (
          <div className="space-y-1.5">
            <span className="gradient-label">{t('gradient.direction')}</span>
            <div className="gradient-directions" role="group" aria-label={t('gradient.direction')}>
              {DIRECTIONS.map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={angle === value}
                  aria-label={`${value}°`}
                  title={`${value}°`}
                  onClick={() => edit({ angle: value })}
                  className="gradient-direction"
                >
                  <ArrowUp size={13} aria-hidden="true" style={{ transform: `rotate(${value}deg)` }} />
                </button>
              ))}
            </div>
          </div>
        )}

        {!twoColor && (
          <div className="space-y-2">
            <label className="gradient-motion-toggle">
              <span className="gradient-label">{t('gradient.motion')}</span>
              <input type="checkbox" role="switch" checked={live} onChange={(e) => toggleMotion(e.target.checked)} />
            </label>
            {live && (
              <>
                <div className="gradient-animations" role="group" aria-label={t('gradient.animation')}>
                  {GRADIENT_ANIMATIONS.map((animation) => (
                    <button
                      key={animation}
                      type="button"
                      aria-pressed={(motionSettings?.type ?? 'flow') === animation}
                      onClick={() => editMotion({ enabled: true, type: animation })}
                      className="gradient-animation"
                      title={t('gradient.' + animation)}
                    >
                      <span className="gradient-animation-swatch" aria-hidden="true" style={{ background: swatch(recipe.style, animation, swatchColors) }} />
                      <span className="truncate">{t('gradient.' + animation)}</span>
                    </button>
                  ))}
                </div>
                <RangeField
                  label={t('gradient.speed')}
                  value={motionSettings?.speed ?? DEFAULT_MOTION.speed}
                  min={1}
                  max={100}
                  unit="%"
                  onChange={(speed) => editMotion({ speed })}
                />
              </>
            )}
          </div>
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
              <RangeField label={t('gradient.angle')} value={angle} min={0} max={360} step={1} unit="°" onChange={(value) => edit({ angle: value })} />
            )}
            {live && (
              <RangeField
                label={t('gradient.amount')}
                value={motionSettings?.amount ?? DEFAULT_MOTION.amount}
                min={1}
                max={100}
                unit="%"
                onChange={(amount) => editMotion({ amount })}
              />
            )}
            {!twoColor && (
              <button type="button" className="gradient-regenerate" onClick={() => edit({ seed: randomSeed() })}>
                <Shuffle size={12} aria-hidden="true" />
                {t('gradient.regenerate')}
              </button>
            )}
          </div>
        </details>
      </fieldset>

      <div className="gradient-footer">
        <p role="status" className="gradient-status">
          {working ? (
            <>
              <Loader2 size={12} className="animate-spin" aria-hidden="true" />
              {t('gradient.applying')}
            </>
          ) : designing && !error && committedKey === recipeKey ? (
            <>
              <Check size={12} aria-hidden="true" />
              {t('gradient.appliedCount', { count: targetIds.length })}
            </>
          ) : null}
        </p>
        <ControlTooltip description={t('gradientLibrary.saveLibrary')}>
          <button
            type="button"
            disabled={busy || !enabled}
            onClick={openNaming}
            aria-label={t('gradientLibrary.saveLibrary')}
            aria-expanded={naming}
            aria-controls={id + '-name-form'}
            className="gradient-icon-button"
          >
            <Bookmark size={14} aria-hidden="true" />
          </button>
        </ControlTooltip>
      </div>
      {naming && (
        <form
          id={id + '-name-form'}
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
          className="flex items-end gap-1.5"
        >
          <label className="gradient-color-label min-w-0 flex-1">
            <span>{t('gradientLibrary.name')}</span>
            <input autoFocus maxLength={NAME_MAX_LENGTH} value={name} onChange={(e) => setName(e.target.value)} className={CONTROL} />
          </label>
          <button type="submit" disabled={!ready || busy || !name.trim()} className="gradient-save">
            {t('gradientLibrary.confirmSave')}
          </button>
        </form>
      )}
      {canClear && onClear && (
        <button
          type="button"
          disabled={busy || !enabled}
          className="gradient-remove"
          onClick={() => {
            committed.current = '';
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
