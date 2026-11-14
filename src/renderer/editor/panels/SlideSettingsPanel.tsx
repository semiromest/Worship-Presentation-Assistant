import { memo, useEffect, useState, type ComponentType, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Blend, Image as ImageIcon, ImagePlus, PaintBucket } from 'lucide-react';
import { clamp } from '../editorUtils';
import { ColorField, NumberField, Section, SelectField, SliderField } from '../EditorControls';
import { fieldLabelClass } from '../editorStyles';
import { cn } from '../../utils';
import { resolveCanvasSource } from '../../canvasSource';

export type BackgroundMode = 'color' | 'gradient' | 'image';

/** Which kind of background the slide shows. A generated gradient is stored as an image, so it is checked first. */
function backgroundModeOf(styles: Record<string, unknown>): BackgroundMode {
  if (styles.generatedBackground || styles.backgroundGradient) return 'gradient';
  if (styles.backgroundImage) return 'image';
  return 'color';
}

interface SlideSettingsPanelProps {
  styles: Record<string, unknown>;
  onChange: (updates: Record<string, unknown>) => void;
  /** Image slides also expose how their picture fits the frame. */
  slideType?: string;
  /** Gradient editor; `autoStart` is true when the user just switched to the gradient type. */
  renderGradient?: (autoStart: boolean) => ReactNode;
  /** Removes the gradient from the slides in scope. */
  onClearGradient?: () => void;
  /** Open on the gradient designer (the gallery's "create in editor") without generating one yet. */
  gradientRequested?: boolean;
}

/**
 * Background as one choice — color, gradient or image — so only one set of
 * controls is visible and it is always clear which one the slide uses.
 */
export const SlideSettingsPanel = memo(function SlideSettingsPanel({
  styles,
  onChange,
  slideType,
  renderGradient,
  onClearGradient,
  gradientRequested = false,
}: SlideSettingsPanelProps) {
  const { t } = useTranslation();
  const getStr = (key: string, fallback = '') => (styles[key] as string) || fallback;
  const getNum = (key: string, fallback = 0) => (styles[key] as number) ?? fallback;
  const actual = backgroundModeOf(styles);
  const [mode, setMode] = useState<BackgroundMode>(actual);
  const [picked, setPicked] = useState(false);
  // Undo, redo or a change from elsewhere moves the switch with it.
  useEffect(() => {
    setMode(actual);
    setPicked(false);
  }, [actual]);
  // Declared after the sync above so a request wins on mount; nothing is generated until the user acts.
  const canGradient = !!renderGradient;
  useEffect(() => {
    if (gradientRequested && canGradient) setMode('gradient');
  }, [gradientRequested, canGradient]);

  const bgImage = actual === 'image' ? getStr('backgroundImage') : '';
  const bgImageName = bgImage ? decodeURIComponent(bgImage.split(/[\\/]/).pop() || '') : '';

  /** Resolves false when the picker was cancelled. */
  const pickImage = async (): Promise<boolean> => {
    const file = await window.electronAPI?.selectMediaFile?.('image');
    if (!file) return false;
    onChange({ backgroundImage: `file://${file.replace(/\\/g, '/')}`, backgroundGradient: undefined });
    return true;
  };

  const choose = (next: BackgroundMode) => {
    if (next === mode) return;
    setMode(next);
    setPicked(true);
    if (next === 'color') {
      if (actual === 'gradient') onClearGradient?.();
      else if (actual === 'image') onChange({ backgroundImage: undefined });
    }
    if (next === 'image' && actual !== 'image') void pickImage().then((ok) => { if (!ok) setMode(actual); });
  };

  const modes: Array<{ value: BackgroundMode; label: string; icon: ComponentType<{ className?: string }> }> = [
    { value: 'color', label: t('common.editorBgModeColor'), icon: PaintBucket },
    ...(renderGradient ? [{ value: 'gradient' as const, label: t('common.editorBgModeGradient'), icon: Blend }] : []),
    { value: 'image', label: t('common.editorBgModeImage'), icon: ImageIcon },
  ];

  return (
    <>
      <Section id="slide-background" title={t('common.editorSlideBackground')}>
        <div
          role="radiogroup"
          aria-label={t('common.editorBgModeLabel')}
          className="grid gap-0.5 rounded-md bg-black/30 p-0.5"
          style={{ gridTemplateColumns: `repeat(${modes.length}, minmax(0, 1fr))` }}
          data-testid="background-mode"
        >
          {modes.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={mode === value}
              onClick={() => choose(value)}
              className={cn(
                'flex h-7 min-w-0 items-center justify-center gap-1.5 rounded text-xs transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500',
                mode === value ? 'bg-white/[0.12] font-medium text-white' : 'text-white/55 hover:text-white/85'
              )}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">{label}</span>
            </button>
          ))}
        </div>

        {mode === 'color' && (
          <ColorField
            label={t('common.editorBgColor')}
            value={getStr('backgroundColor')}
            fallback="#000000"
            onChange={(color) => onChange({ backgroundColor: color })}
          />
        )}

        {mode === 'gradient' && renderGradient?.(picked)}

        {mode === 'image' && (
          <>
            <button
              type="button"
              onClick={() => void pickImage()}
              className="flex h-8 w-full min-w-0 items-center gap-2 rounded-md border border-white/[0.08] bg-black/25 px-2 text-left text-xs text-white/75 transition hover:border-white/15 hover:text-white"
            >
              {bgImage ? (
                <span
                  className="h-5 w-8 shrink-0 rounded-sm bg-cover bg-center"
                  style={{ backgroundImage: `url("${resolveCanvasSource(bgImage, false).url}")` }}
                  aria-hidden="true"
                />
              ) : (
                <ImagePlus className="h-3.5 w-3.5 shrink-0 text-white/50" aria-hidden="true" />
              )}
              <span className="truncate">{bgImageName || t('common.editorSelectImage')}</span>
            </button>
            {bgImage && (
              <SliderField
                label={t('common.editorBgBlur')}
                min={0}
                max={20}
                step={0.5}
                value={getNum('backgroundBlur', 0)}
                format={(value) => `${value.toFixed(1)}px`}
                onChange={(value) => onChange({ backgroundBlur: value })}
              />
            )}
          </>
        )}
      </Section>

      {slideType === 'image' && (
        <Section id="slide-image-fit" title={t('common.editorSlideFit')}>
          <SelectField
            label={t('common.editorSlideFit')}
            value={getStr('objectFit', 'contain')}
            onChange={(value) => onChange({ objectFit: value })}
            options={[
              { value: 'contain', label: t('common.editorFitContain') },
              { value: 'cover', label: t('common.editorFitCover') },
              { value: 'fill', label: t('common.editorFitFill') },
            ]}
          />
        </Section>
      )}

      <Section id="slide-text" title={t('common.editorSlideTextDefaults')} defaultOpen={false}>
        <div className="grid grid-cols-[1fr_84px] items-end gap-1.5">
          <ColorField
            label={t('common.editorTextColor')}
            value={getStr('textColor')}
            fallback="#ffffff"
            onChange={(color) => onChange({ textColor: color })}
          />
          <div className="space-y-1">
            <span className={fieldLabelClass}>{t('common.editorDefaultFontSize')}</span>
            <NumberField
              label={t('common.editorDefaultFontSize')}
              prefix="pt"
              min={8}
              max={240}
              value={getNum('fontSize', 48)}
              onChange={(raw) => {
                const value = parseInt(raw);
                if (!Number.isNaN(value)) onChange({ fontSize: clamp(value, 8, 240) });
              }}
            />
          </div>
        </div>
      </Section>
    </>
  );
});
