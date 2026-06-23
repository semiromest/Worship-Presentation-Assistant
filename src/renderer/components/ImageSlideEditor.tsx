import { useTranslation } from 'react-i18next';
import { Image as ImageIcon, X, FlipHorizontal, FlipVertical, Layers, ChevronDown } from 'lucide-react';
import { useStore } from '../state/useStore';
import { cn } from '../utils';
import type { Slide } from '../types';

interface ImageSlideEditorProps {
  selectedSlide: Slide;
  updateSlideStyles: (styles: Partial<Slide['styles']>) => void;
  replaceSlideMedia: () => void;
  removeSlideMedia: () => void;
  applyStyleFieldToAll: (pick: Partial<Slide['styles']> | 'all') => void;
}

const RANGE_STYLES = 'w-full h-1.5 bg-white/10 rounded-lg appearance-none cursor-pointer accent-blue-500';

export default function ImageSlideEditor({
  selectedSlide,
  updateSlideStyles,
  replaceSlideMedia,
  removeSlideMedia,
  applyStyleFieldToAll,
}: ImageSlideEditorProps) {
  const { t } = useTranslation();
  const { panels, setPanels } = useStore();

  const styles = (selectedSlide.styles || {}) as Record<string, any>;
  const imageUrl = selectedSlide.mediaUrl;

  const update = (partial: Partial<Slide['styles']>) => updateSlideStyles(partial);

  const fitOptions = [
    { value: 'contain', label: t('editorFitContain') },
    { value: 'cover', label: t('editorFitCover') },
    { value: 'fill', label: t('editorFitFill') },
  ] as const;

  return (
    <>
      {/* Image Preview */}
      {imageUrl ? (
        <div className="aspect-video rounded-xl border border-white/10 overflow-hidden bg-black shadow-inner relative group">
          <img
            src={imageUrl}
            className={cn(
              'w-full h-full',
              styles.objectFit === 'cover' ? 'object-cover' : styles.objectFit === 'fill' ? 'object-fill' : 'object-contain'
            )}
            style={{
              opacity: styles.opacity ?? 1,
              filter: [
                styles.imageBrightness !== 1 ? `brightness(${styles.imageBrightness ?? 1})` : null,
                styles.imageContrast !== 1 ? `contrast(${styles.imageContrast ?? 1})` : null,
                styles.imageGrayscale ? `grayscale(${styles.imageGrayscale})` : null,
                styles.imageSepia ? `sepia(${styles.imageSepia})` : null,
                styles.imageBlur ? `blur(${styles.imageBlur}px)` : null,
              ].filter(Boolean).join(' ') || undefined,
              transform: [
                styles.imageFlipX ? 'scaleX(-1)' : '',
                styles.imageFlipY ? 'scaleY(-1)' : '',
              ].filter(Boolean).join(' ') || undefined,
            }}
            alt=""
          />
        </div>
      ) : (
        <div className="aspect-video rounded-xl border border-white/10 bg-white/5 flex items-center justify-center">
          <div className="flex flex-col items-center gap-2 opacity-40">
            <ImageIcon className="w-8 h-8" />
            <span className="text-xs">{t('common.noImagePreview') || 'No image'}</span>
          </div>
        </div>
      )}

      {/* Object Fit */}
      <div className="space-y-1.5">
        <span className="block text-[10px] text-white/45 uppercase font-bold tracking-tight">
          {t('editorFitLabel')}
        </span>
        <div className="flex gap-1.5">
          {fitOptions.map((opt) => (
            <button
              key={opt.value}
              onClick={() => update({ objectFit: opt.value })}
              className={cn(
                'flex-1 px-2 py-1.5 rounded-lg text-[10px] font-semibold border transition-[background-color,border-color]',
                styles.objectFit === opt.value
                  ? 'bg-blue-600/20 border-blue-500/40 text-blue-300'
                  : 'bg-white/5 border-white/10 text-white/50 hover:bg-white/10 active:scale-[0.95]'
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Opacity */}
      <div className="space-y-1.5">
        <div className="flex justify-between items-center">
          <span className="text-[10px] text-white/45 uppercase font-bold tracking-tight">{t('editorOpacity')}</span>
          <span className="text-[10px] text-white/45 font-mono">{Math.round((styles.opacity ?? 1) * 100)}%</span>
        </div>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={styles.opacity ?? 1}
          onChange={(e) => update({ opacity: parseFloat(e.target.value) })}
          aria-label={t('editorOpacity')}
          className={RANGE_STYLES}
        />
      </div>

      {/* Brightness */}
      <div className="space-y-1.5">
        <div className="flex justify-between items-center">
          <span className="text-[10px] text-white/45 uppercase font-bold tracking-tight">{t('editorBrightness')}</span>
          <span className="text-[10px] text-white/45 font-mono">{Math.round((styles.imageBrightness ?? 1) * 100)}%</span>
        </div>
        <input
          type="range"
          min={0}
          max={3}
          step={0.05}
          value={styles.imageBrightness ?? 1}
          onChange={(e) => update({ imageBrightness: parseFloat(e.target.value) })}
          aria-label={t('editorBrightness')}
          className={RANGE_STYLES}
        />
      </div>

      {/* Contrast */}
      <div className="space-y-1.5">
        <div className="flex justify-between items-center">
          <span className="text-[10px] text-white/45 uppercase font-bold tracking-tight">{t('editorContrast')}</span>
          <span className="text-[10px] text-white/45 font-mono">{Math.round((styles.imageContrast ?? 1) * 100)}%</span>
        </div>
        <input
          type="range"
          min={0}
          max={3}
          step={0.05}
          value={styles.imageContrast ?? 1}
          onChange={(e) => update({ imageContrast: parseFloat(e.target.value) })}
          aria-label={t('editorContrast')}
          className={RANGE_STYLES}
        />
      </div>

      {/* Blur */}
      <div className="space-y-1.5">
        <div className="flex justify-between items-center">
          <span className="text-[10px] text-white/45 uppercase font-bold tracking-tight">{t('editorBlur')}</span>
          <span className="text-[10px] text-white/45 font-mono">{styles.imageBlur ?? 0}px</span>
        </div>
        <input
          type="range"
          min={0}
          max={20}
          step={0.5}
          value={styles.imageBlur ?? 0}
          onChange={(e) => update({ imageBlur: parseFloat(e.target.value) })}
          aria-label={t('editorBlur')}
          className={RANGE_STYLES}
        />
      </div>

      {/* Grayscale */}
      <div className="space-y-1.5">
        <div className="flex justify-between items-center">
          <span className="text-[10px] text-white/45 uppercase font-bold tracking-tight">{t('editorGrayscale')}</span>
          <span className="text-[10px] text-white/45 font-mono">{Math.round((styles.imageGrayscale ?? 0) * 100)}%</span>
        </div>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={styles.imageGrayscale ?? 0}
          onChange={(e) => update({ imageGrayscale: parseFloat(e.target.value) })}
          aria-label={t('editorGrayscale')}
          className={RANGE_STYLES}
        />
      </div>

      {/* Sepia */}
      <div className="space-y-1.5">
        <div className="flex justify-between items-center">
          <span className="text-[10px] text-white/45 uppercase font-bold tracking-tight">{t('editorSepia')}</span>
          <span className="text-[10px] text-white/45 font-mono">{Math.round((styles.imageSepia ?? 0) * 100)}%</span>
        </div>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={styles.imageSepia ?? 0}
          onChange={(e) => update({ imageSepia: parseFloat(e.target.value) })}
          aria-label={t('editorSepia')}
          className={RANGE_STYLES}
        />
      </div>

      {/* Flip Buttons */}
      <div className="flex gap-2">
        <button
          onClick={() => update({ imageFlipX: !styles.imageFlipX })}
          aria-label={t('editorFlipX')}
          className={cn(
            'flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-[11px] font-semibold transition-[background-color,border-color] border active:scale-[0.96]',
            styles.imageFlipX
              ? 'bg-blue-600/20 border-blue-500/40 text-blue-300'
              : 'bg-white/5 border-white/10 text-white/60 hover:bg-white/10'
          )}
        >
          <FlipHorizontal className="w-3.5 h-3.5" aria-hidden="true" />
          {t('editorFlipX')}
        </button>
        <button
          onClick={() => update({ imageFlipY: !styles.imageFlipY })}
          aria-label={t('editorFlipY')}
          className={cn(
            'flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-[11px] font-semibold transition-[background-color,border-color] border active:scale-[0.96]',
            styles.imageFlipY
              ? 'bg-blue-600/20 border-blue-500/40 text-blue-300'
              : 'bg-white/5 border-white/10 text-white/60 hover:bg-white/10'
          )}
        >
          <FlipVertical className="w-3.5 h-3.5" aria-hidden="true" />
          {t('editorFlipY')}
        </button>
      </div>

      {/* Media Buttons */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={replaceSlideMedia}
          className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-[11px] font-semibold transition-[background-color,border-color,color] border bg-white/5 border-white/10 text-white/60 hover:bg-white/10 hover:text-white active:scale-[0.96]"
        >
          <ImageIcon className="w-3.5 h-3.5" />
          {t('common.imageReplace') || 'Replace Image'}
        </button>
        {imageUrl && (
          <button
            onClick={removeSlideMedia}
            className="p-2 rounded-lg bg-red-600/20 text-red-400 border border-red-500/20 hover:bg-red-600/30 transition-colors"
            title={t('common.removeImage')}
            aria-label={t('common.removeImage')}
          >
            <X className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        )}
      </div>

      {/* Apply to All Dropdown */}
      <div className="relative apply-styles-dropdown">
        <button
          onClick={() => setPanels((p) => ({ ...p, imageStyles: !p.imageStyles }))}
          className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-[11px] font-semibold text-white/70 hover:bg-white/10 transition-[background-color] active:scale-[0.97] group"
        >
          <div className="flex items-center gap-2">
            <Layers className="w-3.5 h-3.5 text-blue-400" />
            {t('common.applyToAll')}
          </div>
          <ChevronDown
            className={cn(
              'w-3.5 h-3.5 transition-transform opacity-40 group-hover:opacity-100',
              panels.imageStyles && 'rotate-180'
            )}
          />
        </button>
        {panels.imageStyles && (
          <div className="absolute top-full left-0 right-0 mt-1 bg-[#1a1a1a] border border-white/10 rounded-xl shadow-2xl z-50 overflow-hidden py-1">
            {[
              { label: t('common.applyObjectFit'), action: () => applyStyleFieldToAll({ objectFit: undefined }) },
              { label: t('common.applyImageAdjustments'), action: () => applyStyleFieldToAll({ opacity: undefined, imageBrightness: undefined, imageContrast: undefined, imageBlur: undefined, imageGrayscale: undefined, imageSepia: undefined, imageFlipX: undefined, imageFlipY: undefined }) },
              { label: t('common.applyAllProperties'), action: () => applyStyleFieldToAll('all'), important: true },
            ].map((item, idx) => (
              <button
                key={idx}
                onClick={() => {
                  item.action();
                  setPanels((p) => ({ ...p, imageStyles: false }));
                }}
                className={cn(
                  'w-full text-left px-4 py-2 text-[11px] hover:bg-white/5 transition-colors',
                  item.important ? 'text-blue-400 font-bold border-t border-white/5 mt-1 pt-3' : 'text-white/60'
                )}
              >
                {item.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
