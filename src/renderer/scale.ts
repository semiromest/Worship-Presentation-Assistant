import { useState, useEffect, useCallback, useMemo } from 'react';
import { SLIDE_REFERENCE_WIDTH } from './constants';

export interface ScaleState {
  scale:      number;
  containerWidth:  number;
  actualWidth: number;
}

export function useSlideScale(containerRef: React.RefObject<HTMLElement | null>) {
  const [state, setState] = useState<ScaleState>({
    scale:        1,
    containerWidth:  0,
    actualWidth:   SLIDE_REFERENCE_WIDTH,
  });

  const updateScale = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    const containerWidth = container.clientWidth;
    if (containerWidth <= 0) return;

    const actualWidth = SLIDE_REFERENCE_WIDTH;
    const scale = containerWidth / actualWidth;

    setState({ scale, containerWidth, actualWidth });
  }, [containerRef]);

  useEffect(() => {
    updateScale();
    const ro = new ResizeObserver(updateScale);
    const container = containerRef.current;
    if (container) ro.observe(container);
    return () => ro.disconnect();
  }, [updateScale, containerRef]);

  return state;
}

export function createScaleStyle<T>(
  baseValue: number | undefined,
  scale: number,
  defaultVal: number = 0
): number {
  if (baseValue === undefined || baseValue === null) return defaultVal;
  return baseValue * scale;
}