import { memo } from 'react';
import type { ImageStyle } from '../types';
import { useImageSize } from '../hooks/useImageSize';
import { normalizeCrop } from '../imageGeometry';
import { resolveCanvasSource } from '../canvasSource';

/** All image-item surfaces share crop, fit, flip, and filters. */
export const SlideImage = memo(function SlideImage({
  src,
  styles = {},
  alt = '',
  lazy = false,
}: {
  src?: string;
  styles?: ImageStyle;
  alt?: string;
  lazy?: boolean;
}) {
  src = src ? resolveCanvasSource(src, false).url : undefined;
  const source = styles.cropMode === 'source' && !!styles.crop;
  const size = useImageSize(source ? src : undefined);
  const crop = normalizeCrop(styles.crop);
  const filter =
    [
      styles.brightness != null ? `brightness(${styles.brightness})` : '',
      styles.contrast != null ? `contrast(${styles.contrast})` : '',
      styles.grayscale ? `grayscale(${styles.grayscale})` : '',
      styles.sepia ? `sepia(${styles.sepia})` : '',
      styles.blur ? `blur(${styles.blur}px)` : '',
    ]
      .filter(Boolean)
      .join(' ') || undefined;
  const flip = `${styles.flipX ? 'scaleX(-1)' : ''} ${styles.flipY ? 'scaleY(-1)' : ''}`.trim() || undefined;
  const clipPath =
    !source && styles.crop
      ? `inset(${crop.y}% ${100 - crop.x - crop.width}% ${100 - crop.y - crop.height}% ${crop.x}%)`
      : undefined;
  return (
    <div className="h-full w-full overflow-hidden" style={{ clipPath }}>
      <div className="h-full w-full" style={{ opacity: styles.opacity ?? 1, filter, transform: flip }}>
        {source ? (
          size.width > 0 && (
            <svg
              width="100%"
              height="100%"
              viewBox={`${(crop.x / 100) * size.width} ${(crop.y / 100) * size.height} ${(crop.width / 100) * size.width} ${(crop.height / 100) * size.height}`}
              preserveAspectRatio="xMidYMid slice"
              role={alt ? 'img' : undefined}
              aria-label={alt || undefined}
              aria-hidden={!alt}
              style={{ display: 'block', overflow: 'hidden' }}
            >
              <image href={src} width={size.width} height={size.height} />
            </svg>
          )
        ) : (
          <img
            src={src}
            alt={alt}
            draggable={false}
            loading={lazy ? 'lazy' : undefined}
            className="h-full w-full pointer-events-none"
            style={{ objectFit: styles.objectFit ?? 'contain' }}
          />
        )}
      </div>
    </div>
  );
});
