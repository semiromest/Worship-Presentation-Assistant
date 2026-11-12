import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { ImagePlus, X } from 'lucide-react';
import { clamp } from '../editorUtils';
import { ColorField, NumberField, Section, SelectField, SliderField, ToolButton } from '../EditorControls';
import { fieldLabelClass } from '../editorStyles';

interface SlideSettingsPanelProps {
  styles: Record<string, unknown>;
  onChange: (updates: Record<string, unknown>) => void;
}

/** Background + text defaults. Grid, snap and safe area are view toggles on the canvas. */
export const SlideSettingsPanel = memo(function SlideSettingsPanel({ styles, onChange }: SlideSettingsPanelProps) {
  const { t } = useTranslation();
  const getStr = (key: string, fallback = '') => (styles[key] as string) || fallback;
  const getNum = (key: string, fallback = 0) => (styles[key] as number) ?? fallback;
  const bgImage = getStr('backgroundImage');
  const bgImageName = bgImage ? decodeURIComponent(bgImage.split(/[\\/]/).pop() || '') : '';

  return (
    <>
      <Section id="slide-background" title={t('common.editorSlideBackground')}>
        <ColorField
          label={t('common.editorBgColor')}
          value={getStr('backgroundColor')}
          fallback="#000000"
          onChange={(color) => onChange({ backgroundColor: color })}
        />
        <div className="space-y-1">
          <span className={fieldLabelClass}>{t('common.editorBgImage')}</span>
          <div className="flex h-7 items-center gap-1">
            <button
              type="button"
              onClick={async () => {
                const file = await window.electronAPI?.selectMediaFile?.('image');
                if (!file) return;
                onChange({ backgroundImage: `file://${file.replace(/\\/g, '/')}` });
              }}
              className="flex h-7 min-w-0 flex-1 items-center gap-2 rounded-md border border-white/[0.08] bg-black/25 px-2 text-left text-xs text-white/75 transition hover:border-white/15 hover:text-white"
            >
              <ImagePlus className="h-3.5 w-3.5 shrink-0 text-white/50" aria-hidden="true" />
              <span className="truncate">{bgImageName || t('common.editorSelectImage')}</span>
            </button>
            {bgImage && (
              <ToolButton label={t('common.editorClear')} icon={X} onClick={() => onChange({ backgroundImage: undefined })} />
            )}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-1.5">
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
          <SliderField
            label={t('common.editorBgBlur')}
            min={0}
            max={20}
            step={0.5}
            value={getNum('backgroundBlur', 0)}
            format={(value) => `${value.toFixed(1)}px`}
            onChange={(value) => onChange({ backgroundBlur: value })}
          />
        </div>
      </Section>

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
