import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Dialog from '../components/Dialog';
import { SlideImage } from '../components/SlideImage';
import { useImageSize } from '../hooks/useImageSize';
import type { SlideItem } from '../types';
import { FULL_CROP, fitCropRatio, moveCrop, resizeCrop, sourceCrop, type CropRect } from '../imageGeometry';
import { finishEditorGesture, usePointerGesture } from './usePointerGesture';
import type { ResizeCorner } from './canvasGeometry';

export function ImageCropDialog({
  item,
  onApply,
  onClose,
}: {
  item: SlideItem;
  onApply: (crop: CropRect) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [retry, setRetry] = useState(0);
  const size = useImageSize(item.mediaUrl, retry);
  const [crop, setCrop] = useState<CropRect>(FULL_CROP);
  const cropRef = useRef(crop);
  const imageRef = useRef<HTMLDivElement>(null);
  const initialized = useRef(false);
  const [ratio, setRatio] = useState('free');
  const frameRatio = (item.width * 16) / (item.height * 9);
  const pixelRatio =
    ratio === 'original'
      ? size.width / size.height
      : ratio === 'frame'
        ? frameRatio
        : ratio === 'free'
          ? 0
          : Number(ratio);
  const update = (next: CropRect) => {
    cropRef.current = next;
    setCrop(next);
  };
  useEffect(() => {
    if (!size.width || initialized.current) return;
    initialized.current = true;
    const next = sourceCrop(item.imageStyles ?? {}, size, { width: item.width * 19.2, height: item.height * 10.8 });
    cropRef.current = next;
    setCrop(next);
  }, [size, item]);
  const begin = usePointerGesture<{
    kind: 'move' | ResizeCorner;
    crop: CropRect;
    x: number;
    y: number;
    rect: DOMRect;
    ratio: number;
  }>(
    (event, start) => {
      const dx = ((event.clientX - start.x) / start.rect.width) * 100,
        dy = ((event.clientY - start.y) / start.rect.height) * 100;
      update(
        start.kind === 'move' ? moveCrop(start.crop, dx, dy) : resizeCrop(start.crop, start.kind, dx, dy, start.ratio)
      );
    },
    () => {}
  );
  const start = (kind: 'move' | ResizeCorner) => (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !imageRef.current || !size.width) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.focus({ preventScroll: true });
    begin(event, {
      kind,
      crop: cropRef.current,
      x: event.clientX,
      y: event.clientY,
      rect: imageRef.current.getBoundingClientRect(),
      ratio: (pixelRatio * size.height) / size.width,
    });
  };
  const apply = () => {
    finishEditorGesture();
    if (size.width && !size.error) onApply(cropRef.current);
  };
  const close = () => {
    finishEditorGesture();
    onClose();
  };
  return (
    <Dialog
      open
      onClose={close}
      labelledBy="editor-crop-title"
      closeOnOverlayClick={false}
      className="w-[min(960px,calc(100vw-24px))] max-h-[calc(100vh-24px)] overflow-auto rounded-2xl border border-white/15 bg-[#171717] text-white shadow-2xl"
    >
      <div
        className="p-4 space-y-4"
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'Escape') {
            event.preventDefault();
            close();
          }
          if (event.key === 'Enter' && !(event.target as Element).closest('button,select,input')) {
            event.preventDefault();
            apply();
          }
        }}
      >
        <h2 id="editor-crop-title" className="text-lg font-semibold">
          {t('common.editorVisualCrop')}
        </h2>
        <p className="text-xs text-white/60">{t('common.editorCropHelp')}</p>
        <label className="flex items-center gap-3 text-sm">
          {t('common.editorCropRatio')}
          <select
            value={ratio}
            disabled={!size.width || size.error}
            onChange={(event) => {
              finishEditorGesture();
              setRatio(event.target.value);
              const value = event.target.value;
              const r =
                value === 'original'
                  ? size.width / size.height
                  : value === 'frame'
                    ? frameRatio
                    : value === 'free'
                      ? 0
                      : Number(value);
              update(fitCropRatio(cropRef.current, r, size));
            }}
            className="rounded-lg bg-black/40 border border-white/15 p-2"
          >
            <option value="free">{t('common.editorCropFree')}</option>
            <option value="original">{t('common.editorCropOriginal')}</option>
            <option value="frame">{t('common.editorCropFrame')}</option>
            <option value="1">1:1</option>
            <option value={4 / 3}>4:3</option>
            <option value={16 / 9}>16:9</option>
          </select>
        </label>
        {size.error ? (
          <div role="alert" className="p-8 text-center space-y-3">
            <p>{t('common.editorImageLoadError')}</p>
            <button className="rounded-lg bg-white/10 p-2" onClick={() => setRetry((n) => n + 1)}>
              {t('common.editorImageRetry')}
            </button>
          </div>
        ) : !size.width ? (
          <p role="status">{t('common.editorImageLoading')}</p>
        ) : (
          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_180px] items-start">
            <div className="flex justify-center min-w-0">
              <div
                ref={imageRef}
                className="relative overflow-hidden touch-none select-none bg-[repeating-conic-gradient(#333_0%_25%,#222_0%_50%)] bg-[length:16px_16px]"
                style={{
                  width: `min(100%, ${Math.min(650, (0.5 * window.innerHeight * size.width) / size.height)}px)`,
                  aspectRatio: size.width / size.height,
                }}
              >
                <img src={item.mediaUrl} alt="" draggable={false} className="block w-full h-full pointer-events-none" />
                <div
                  role="button"
                  tabIndex={0}
                  aria-label={t('common.editorCropArea')}
                  onPointerDown={start('move')}
                  onKeyDown={(event) => {
                    const dx = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0,
                      dy = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
                    if (dx || dy) {
                      event.preventDefault();
                      update(moveCrop(cropRef.current, dx * (event.shiftKey ? 5 : 1), dy * (event.shiftKey ? 5 : 1)));
                    }
                  }}
                  className="absolute cursor-move border-2 border-white focus-visible:outline-blue-400"
                  style={{
                    left: `${crop.x}%`,
                    top: `${crop.y}%`,
                    width: `${crop.width}%`,
                    height: `${crop.height}%`,
                    boxShadow: '0 0 0 2000px rgba(0,0,0,.6)',
                    clipPath: 'inset(-2000px)',
                  }}
                >
                  <div className="absolute inset-0 pointer-events-none grid grid-cols-3 grid-rows-3">
                    {Array.from({ length: 9 }, (_, i) => (
                      <div key={i} className="border border-white/20" />
                    ))}
                  </div>
                  {(['tl', 'tr', 'bl', 'br'] as const).map((corner) => (
                    <div
                      key={corner}
                      role="button"
                      tabIndex={0}
                      aria-label={t(`common.editorCropCorner_${corner}`)}
                      onPointerDown={start(corner)}
                      onKeyDown={(event) => {
                        const dx = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0,
                          dy = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
                        if (dx || dy) {
                          event.preventDefault();
                          event.stopPropagation();
                          update(resizeCrop(cropRef.current, corner, dx, dy, (pixelRatio * size.height) / size.width));
                        }
                      }}
                      className="absolute w-4 h-4 bg-white border border-blue-500 rounded-sm"
                      style={{
                        [corner.endsWith('l') ? 'left' : 'right']: 0,
                        [corner.startsWith('t') ? 'top' : 'bottom']: 0,
                        cursor: corner === 'tl' || corner === 'br' ? 'nwse-resize' : 'nesw-resize',
                      }}
                    />
                  ))}
                </div>
              </div>
            </div>
            <div className="space-y-2">
              <p className="text-xs text-white/60">{t('common.editorCropPreview')}</p>
              <div className="bg-black border border-white/15" style={{ aspectRatio: frameRatio }}>
                <SlideImage src={item.mediaUrl} styles={{ ...item.imageStyles, crop, cropMode: 'source' }} />
              </div>
            </div>
          </div>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <button
            className="rounded-lg border border-white/15 p-2 text-sm"
            disabled={!size.width}
            onClick={() => update(fitCropRatio(FULL_CROP, pixelRatio, size))}
          >
            {t('common.editorCropResetSelection')}
          </button>
          <button className="rounded-lg border border-white/15 p-2 text-sm" onClick={close}>
            {t('common.cancel')}
          </button>
          <button
            className="rounded-lg bg-blue-600 p-2 text-sm disabled:opacity-40"
            disabled={!size.width || size.error}
            onClick={apply}
          >
            {t('common.editorCropApply')}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
