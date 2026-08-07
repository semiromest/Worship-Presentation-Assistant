import type { Slide, WatermarkConfig, Position } from '../types';
import { cn, shouldRenderWatermark } from '../utils';

export interface WatermarkOverlayProps {
  slide: Slide;
  config: WatermarkConfig;
}

const POSITION_CLASSES: Record<Position, string> = {
  'top-left': 'top-[2%] left-[2%]',
  'top-center': 'top-[2%] left-1/2 -translate-x-1/2',
  'top-right': 'top-[2%] right-[2%]',
  'bottom-left': 'bottom-[2%] left-[2%]',
  'bottom-center': 'bottom-[2%] left-1/2 -translate-x-1/2',
  'bottom-right': 'bottom-[2%] right-[2%]',
};

export function WatermarkOverlay({ slide, config }: WatermarkOverlayProps) {
  if (!shouldRenderWatermark(slide, config)) return null;

  const posClass = POSITION_CLASSES[config.position] ?? POSITION_CLASSES['bottom-right'];
  const opacity = Math.min(1, Math.max(0, config.opacity / 100));

  return (
    <img
      src={config.logoDataUrl!}
      alt=""
      aria-hidden="true"
      className={cn(
        'absolute pointer-events-none select-none',
        posClass,
      )}
      style={{
        width: `${config.size}%`,
        height: 'auto',
        opacity,
        zIndex: 50,
      }}
    />
  );
}
