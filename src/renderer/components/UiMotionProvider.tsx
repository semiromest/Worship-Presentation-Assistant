import { type ReactNode, useLayoutEffect } from 'react';
import { LazyMotion, MotionConfig } from 'motion/react';
import { useUiMotionEnabled } from '../hooks/useUiMotionEnabled';
import { uiMotion } from '../uiMotion';

const loadMotionFeatures = () => import('../motionFeatures').then((module) => module.default);

export default function UiMotionProvider({ children }: { children: ReactNode }) {
  const enabled = useUiMotionEnabled();

  useLayoutEffect(() => {
    document.documentElement.dataset.uiMotion = enabled ? 'on' : 'off';
    for (const [name, seconds] of Object.entries(uiMotion.duration)) {
      document.documentElement.style.setProperty(`--ui-motion-${name}`, `${seconds * 1000}ms`);
    }
    document.documentElement.style.setProperty('--ui-motion-ease', `cubic-bezier(${uiMotion.ease.join(',')})`);
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
