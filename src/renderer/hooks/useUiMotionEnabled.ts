import { useEffect, useState } from 'react';
import { IS_PROJECTOR_MODE } from '../constants';
import { useStore } from '../state/useStore';

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

function readReducedMotionPreference(): boolean {
  return typeof window !== 'undefined' && window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

/** Effective animation state, combining the in-app preference with the OS setting. */
export function useUiMotionEnabled(): boolean {
  const preferenceEnabled = useStore((state) => state.uiMotionEnabled);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(readReducedMotionPreference);

  useEffect(() => {
    const query = window.matchMedia(REDUCED_MOTION_QUERY);
    const updatePreference = () => setPrefersReducedMotion(query.matches);
    updatePreference();
    query.addEventListener('change', updatePreference);
    return () => query.removeEventListener('change', updatePreference);
  }, []);

  return !IS_PROJECTOR_MODE && preferenceEnabled && !prefersReducedMotion;
}
