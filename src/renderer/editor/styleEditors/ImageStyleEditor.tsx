import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import type { SlideItem, ImageStyle } from '../../types';
import { DEFAULT_IMAGE_STYLE } from '../editorUtils';
import { Image, FlipHorizontal, FlipVertical, Crop, RotateCcw } from 'lucide-react';
import { cn } from '../../utils';

interface ImageStyleEditorProps {
  item: SlideItem;
  onChange: (styles: ImageStyle) => void;
  onCrop: () => void;
  canCrop: boolean;
}

export const ImageStyleEditor = memo(function ImageStyleEditor({
  item,
  onChange,
  onCrop,
  canCrop,
}: ImageStyleEditorProps) {
  const { t } = useTranslation();
  const styles = item.imageStyles ?? DEFAULT_IMAGE_STYLE;
  const update = (patch: Partial<ImageStyle>) => onChange({ ...styles, ...patch });

  return (
    <fieldset
      disabled={item.locked}
      className="space-y-3 rounded-2xl border border-white/10 bg-[#1a1a1a] p-4 shadow-sm"
    >
      <div className="flex items-center gap-2 text-sm font-semibold text-white/80">
        <Image className="h-4 w-4" />
        <span>{t('common.editorImageStyles')}</span>
      </div>

      {/* Object fit + Opacity */}
      <div className="grid grid-cols-2 gap-3">
        <label className="space-y-1">
          <span className="block text-[10px] uppercase tracking-wide text-white/40">{t('common.editorFitLabel')}</span>
          <select
            disabled={styles.cropMode === 'source' && !!styles.crop}
            value={styles.objectFit || 'contain'}
            onChange={(e) => update({ objectFit: e.target.value as ImageStyle['objectFit'] })}
            className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs outline-none transition focus:border-blue-500"
          >
            <option value="contain">{t('common.editorFitContain')}</option>
            <option value="cover">{t('common.editorFitCover')}</option>
            <option value="fill">{t('common.editorFitFill')}</option>
          </select>
        </label>

        <label className="space-y-1">
          <span className="block text-[10px] uppercase tracking-wide text-white/40">{t('common.editorOpacity')}</span>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={styles.opacity ?? 1}
              onChange={(e) => update({ opacity: parseFloat(e.target.value) })}
              className="w-full accent-blue-500"
            />
            <span className="text-[10px] text-white/50 min-w-[2.5rem] text-right">
              {Math.round((styles.opacity ?? 1) * 100)}%
            </span>
          </div>
        </label>
      </div>

      {/* Flip controls */}
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => update({ flipX: !styles.flipX })}
          className={cn(
            'flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-xs transition',
            styles.flipX
              ? 'border-blue-500/50 bg-blue-600/25 text-blue-200'
              : 'border-white/10 bg-black/20 text-white/60 hover:bg-black/35'
          )}
        >
          <FlipHorizontal className="h-4 w-4" />
          {t('common.editorFlipX')}
        </button>
        <button
          type="button"
          onClick={() => update({ flipY: !styles.flipY })}
          className={cn(
            'flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-xs transition',
            styles.flipY
              ? 'border-blue-500/50 bg-blue-600/25 text-blue-200'
              : 'border-white/10 bg-black/20 text-white/60 hover:bg-black/35'
          )}
        >
          <FlipVertical className="h-4 w-4" />
          {t('common.editorFlipY')}
        </button>
      </div>

      {/* Adjustments */}
      <div className="grid grid-cols-2 gap-3">
        {[
          { labelKey: 'common.editorBrightness', key: 'brightness' as const, min: 0, max: 2, step: 0.05 },
          { labelKey: 'common.editorContrast', key: 'contrast' as const, min: 0, max: 2, step: 0.05 },
          { labelKey: 'common.editorGrayscale', key: 'grayscale' as const, min: 0, max: 1, step: 0.05 },
          { labelKey: 'common.editorSepia', key: 'sepia' as const, min: 0, max: 1, step: 0.05 },
        ].map(({ labelKey, key, min, max, step }) => (
          <label key={key} className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-wide text-white/40">{t(labelKey)}</span>
              <span className="text-[10px] text-white/50">
                {(styles[key] ?? (key === 'brightness' || key === 'contrast' ? 1 : 0)).toFixed(2)}
              </span>
            </div>
            <input
              type="range"
              min={min}
              max={max}
              step={step}
              value={styles[key] ?? (key === 'brightness' || key === 'contrast' ? 1 : 0)}
              onChange={(e) => update({ [key]: parseFloat(e.target.value) })}
              className="w-full accent-blue-500"
            />
          </label>
        ))}
      </div>

      {/* Blur */}
      <label className="space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-wide text-white/40">{t('common.editorBlur')}</span>
          <span className="text-[10px] text-white/50">{(styles.blur ?? 0).toFixed(1)}px</span>
        </div>
        <input
          type="range"
          min={0}
          max={20}
          step={0.5}
          value={styles.blur ?? 0}
          onChange={(e) => update({ blur: parseFloat(e.target.value) })}
          className="w-full accent-blue-500"
        />
      </label>

      {/* Crop controls */}
      <div className="space-y-2">
        <button
          type="button"
          disabled={!canCrop}
          onClick={onCrop}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 p-2 text-sm disabled:opacity-40"
        >
          <Crop className="h-4 w-4" />
          {t('common.editorVisualCrop')}
        </button>
        {styles.crop && (
          <button
            type="button"
            onClick={() => update({ crop: undefined, cropMode: undefined })}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-white/10 p-2 text-xs"
          >
            <RotateCcw className="h-4 w-4" />
            {t('common.editorResetCrop')}
          </button>
        )}
        {styles.cropMode === 'source' && styles.crop && (
          <p className="text-xs text-white/50">{t('common.editorCropFillNotice')}</p>
        )}
      </div>

      {!item.mediaUrl && (
        <div className="rounded-xl border border-yellow-500/20 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-200">
          {t('common.editorNoImage')}
        </div>
      )}
    </fieldset>
  );
});
