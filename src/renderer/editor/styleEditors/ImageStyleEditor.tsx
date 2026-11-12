import { memo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Crop, FlipHorizontal, FlipVertical, RotateCcw } from 'lucide-react';
import type { ImageStyle, SlideItem } from '../../types';
import { DEFAULT_IMAGE_STYLE } from '../editorUtils';
import { Section, SelectField, SliderField, ToolButton } from '../EditorControls';

interface ImageStyleEditorProps {
  item: SlideItem;
  onChange: (styles: ImageStyle) => void;
  onCrop: () => void;
  canCrop: boolean;
  /** Source actions (replace / remove) rendered at the top of the section. */
  source?: ReactNode;
}

export const ImageStyleEditor = memo(function ImageStyleEditor({
  item,
  onChange,
  onCrop,
  canCrop,
  source,
}: ImageStyleEditorProps) {
  const { t } = useTranslation();
  const styles = item.imageStyles ?? DEFAULT_IMAGE_STYLE;
  const update = (patch: Partial<ImageStyle>) => onChange({ ...styles, ...patch });
  const sourceCrop = styles.cropMode === 'source' && !!styles.crop;

  return (
    <fieldset disabled={item.locked} className="m-0 min-w-0 border-0 p-0">
      <Section
        id="image"
        title={t('common.editorImageStyles')}
        actions={
          <>
            <ToolButton
              label={t('common.editorVisualCrop')}
              icon={Crop}
              disabled={!canCrop}
              onClick={onCrop}
            />
            {styles.crop && (
              <ToolButton
                label={t('common.editorResetCrop')}
                icon={RotateCcw}
                onClick={() => update({ crop: undefined, cropMode: undefined })}
              />
            )}
            <ToolButton
              label={t('common.editorFlipX')}
              icon={FlipHorizontal}
              active={!!styles.flipX}
              pressed={!!styles.flipX}
              onClick={() => update({ flipX: !styles.flipX })}
            />
            <ToolButton
              label={t('common.editorFlipY')}
              icon={FlipVertical}
              active={!!styles.flipY}
              pressed={!!styles.flipY}
              onClick={() => update({ flipY: !styles.flipY })}
            />
          </>
        }
      >
        {source}
        {!item.mediaUrl && (
          <p className="rounded-md bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-100/85">{t('common.editorNoImage')}</p>
        )}
        <div className="grid grid-cols-2 gap-1.5">
          <SelectField
            label={t('common.editorFitLabel')}
            disabled={sourceCrop}
            value={styles.objectFit || 'contain'}
            onChange={(value) => update({ objectFit: value as ImageStyle['objectFit'] })}
            options={[
              { value: 'contain', label: t('common.editorFitContain') },
              { value: 'cover', label: t('common.editorFitCover') },
              { value: 'fill', label: t('common.editorFitFill') },
            ]}
          />
          <SliderField
            label={t('common.editorOpacity')}
            min={0}
            max={1}
            step={0.05}
            value={styles.opacity ?? 1}
            format={(value) => `${Math.round(value * 100)}%`}
            onChange={(value) => update({ opacity: value })}
          />
        </div>
        {sourceCrop && <p className="text-[11px] text-white/45">{t('common.editorCropFillNotice')}</p>}
      </Section>

      <Section id="image-adjust" title={t('common.editorImageAdjust')} defaultOpen={false}>
        <div className="grid grid-cols-2 gap-x-3 gap-y-2">
          {[
            { labelKey: 'common.editorBrightness', key: 'brightness' as const, min: 0, max: 2, fallback: 1 },
            { labelKey: 'common.editorContrast', key: 'contrast' as const, min: 0, max: 2, fallback: 1 },
            { labelKey: 'common.editorGrayscale', key: 'grayscale' as const, min: 0, max: 1, fallback: 0 },
            { labelKey: 'common.editorSepia', key: 'sepia' as const, min: 0, max: 1, fallback: 0 },
          ].map(({ labelKey, key, min, max, fallback }) => (
            <SliderField
              key={key}
              label={t(labelKey)}
              min={min}
              max={max}
              step={0.05}
              value={styles[key] ?? fallback}
              format={(value) => value.toFixed(2)}
              onChange={(value) => update({ [key]: value })}
            />
          ))}
        </div>
        <SliderField
          label={t('common.editorBlur')}
          min={0}
          max={20}
          step={0.5}
          value={styles.blur ?? 0}
          format={(value) => `${value.toFixed(1)}px`}
          onChange={(value) => update({ blur: value })}
        />
      </Section>
    </fieldset>
  );
});
