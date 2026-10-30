import type { CSSProperties } from 'react';
import { usePreviewImage } from '../hooks/usePreviewImage';

/** Small surfaces only. Projector and editor canvas keep original sources. */
export function PreviewImage({ source, width = 320, enabled = true, ...props }: {
  source?: string; width?: number; enabled?: boolean; alt: string; className?: string; style?: CSSProperties;
}) {
  const src = usePreviewImage(source, width, enabled);
  return <img {...props} src={src} draggable={false} decoding="async" loading="lazy" />;
}
