import { type ReactNode, useLayoutEffect } from 'react';
import { LazyMotion, MotionConfig } from 'motion/react';
import { useUiMotionEnabled } from '../hooks/useUiMotionEnabled';

const loadMotionFeatures = () => import('../motionFeatures').then((module) => module.default);

export default function UiMotionProvider({ children }: { children: ReactNode }) {
  const enabled = useUiMotionEnabled();

  useLayoutEffect(() => {
    document.documentElement.dataset.uiMotion = enabled ? 'on' : 'off';
    return () => {
      delete document.documentElement.dataset.uiMotion;
    };
  }, [enabled]);

  return (
    <MotionConfig reducedMotion={enabled ? 'never' : 'always'}>
      <LazyMotion features={loadMotionFeatures} strict>
        {children}
      </LazyMotion>
    </MotionConfig>
  );
}
