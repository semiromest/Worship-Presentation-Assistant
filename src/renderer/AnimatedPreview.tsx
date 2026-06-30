import { useState, useEffect, useRef, memo, useCallback, useMemo } from 'react';
import type { Slide, TransitionType } from './types';
import { ANIM_MAP } from './constants';
import { LivePreview } from './LivePreview';
import { useTranslation } from 'react-i18next';

interface AnimatedPreviewProps {
  slide: Slide | undefined;
  transitionType: TransitionType;
  duration: number;
  size?: 'preview' | 'projector';
  volume?: number;
  muted?: boolean;
  isActive?: boolean;
}

interface TransitionState {
  incoming: Slide | undefined;
  outgoing: Slide | undefined;
  isTransitioning: boolean;
}

const ANIMATION_DELAY_BUFFER = 60; // ms buffer for cleanup
const DEFAULT_TRANSITION = { in: '', out: '' };

// Custom hook for transition logic
function useTransitionManager(
  slide: Slide | undefined,
  transitionType: TransitionType,
  duration: number
) {
  const [state, setState] = useState<TransitionState>(() => ({
    incoming: slide,
    outgoing: undefined,
    isTransitioning: false,
  }));

  const prevSlideRef = useRef(slide);
  const isFirstRender = useRef(true);
  const transitionTimerRef = useRef<NodeJS.Timeout | null>(null);
  const transitionIdRef = useRef(0);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (transitionTimerRef.current) {
        clearTimeout(transitionTimerRef.current);
      }
    };
  }, []);

  // Handle slide changes
  useEffect(() => {
    // Skip transition on first render
    if (isFirstRender.current) {
      isFirstRender.current = false;
      prevSlideRef.current = slide;
      setState({
        incoming: slide,
        outgoing: undefined,
        isTransitioning: false,
      });
      return;
    }

    const prevSlide = prevSlideRef.current;
    const currentSlide = slide;

    // Same slide ID — update content only
    if (currentSlide?.id === prevSlide?.id) {
      if (currentSlide && prevSlide) {
          // Update if content actually changed
          const shallowEqual = (a: any, b: any) => {
            if (a === b) return true;
            if (!a || !b) return false;
            if (typeof a !== 'object' || typeof b !== 'object') return a === b;
            const aKeys = Object.keys(a);
            const bKeys = Object.keys(b);
            if (aKeys.length !== bKeys.length) return false;
            for (const k of aKeys) {
              if (a[k] !== b[k]) return false;
            }
            return true;
          };

          const itemsEqual = (x: any[], y: any[]) => {
            if (x === y) return true;
            if (!Array.isArray(x) || !Array.isArray(y)) return false;
            if (x.length !== y.length) return false;
            for (let i = 0; i < x.length; i++) {
              if (x[i]?.id !== y[i]?.id) return false;
            }
            return true;
          };

          const hasContentChanged =
            currentSlide.content !== prevSlide.content ||
            !shallowEqual(currentSlide.styles, prevSlide.styles) ||
            !itemsEqual(currentSlide.items ?? [], prevSlide.items ?? []) ||
            !shallowEqual(currentSlide.loopTransition, prevSlide.loopTransition);

          if (hasContentChanged) {
            setState({
              incoming: currentSlide,
              outgoing: undefined,
              isTransitioning: false,
            });
          }
      }
      prevSlideRef.current = currentSlide;
      return;
    }

    // Different slide — manage transition
    if (transitionTimerRef.current) {
      clearTimeout(transitionTimerRef.current);
    }

    // Skip if no transition
    if (transitionType === 'none' || duration === 0) {
      setState({
        incoming: currentSlide,
        outgoing: undefined,
        isTransitioning: false,
      });
      prevSlideRef.current = currentSlide;
      return;
    }

    // Start transition
    transitionIdRef.current += 1;
    const currentTransitionId = transitionIdRef.current;

    setState({
      incoming: currentSlide,
      outgoing: prevSlide,
      isTransitioning: true,
    });

    // Schedule cleanup
    transitionTimerRef.current = setTimeout(() => {
      // Clean up if this transition is still active
      if (transitionIdRef.current === currentTransitionId) {
        setState(prev => ({
          ...prev,
          outgoing: undefined,
          isTransitioning: false,
        }));
      }
    }, duration + ANIMATION_DELAY_BUFFER);

    prevSlideRef.current = currentSlide;
  }, [slide, transitionType, duration]);

  return state;
}

// Slide layer component
const SlideLayer = memo(({ 
  slide, 
  size, 
  zIndex, 
  animation,
  volume,
  muted,
  isActive,
}: { 
  slide: Slide; 
  size: 'preview' | 'projector'; 
  zIndex: number; 
  animation?: string;
  volume?: number;
  muted?: boolean;
  isActive?: boolean;
}) => {
  const style = useMemo(() => ({
    zIndex,
    animation: animation || undefined,
  }), [zIndex, animation]);

  return (
    <div
      className="absolute inset-0"
      style={style}
      aria-hidden={!animation}
    >
      <LivePreview slide={slide} size={size} volume={volume} muted={muted} isActive={isActive} />
    </div>
  );
});

SlideLayer.displayName = 'SlideLayer';

// Main component
export const AnimatedPreview = memo(({
  slide,
  transitionType,
  duration,
  size = 'preview',
  volume = 1,
  muted = false,
  isActive = true,
}: AnimatedPreviewProps) => {
  const { t } = useTranslation();
  const { incoming, outgoing, isTransitioning } = useTransitionManager(
    slide, 
    transitionType, 
    duration
  );

  const { in: inAnim, out: outAnim } = useMemo(
    () => ANIM_MAP[transitionType] || DEFAULT_TRANSITION,
    [transitionType]
  );

  const durationStr = useMemo(() => `${duration}ms`, [duration]);
  // Stabilize animation strings so memoized SlideLayer sees stable props
  const inAnimStyle = useMemo(
    () => (inAnim ? `${inAnim} ${durationStr} ease forwards` : undefined),
    [inAnim, durationStr]
  );

  const outAnimStyle = useMemo(
    () => (outAnim ? `${outAnim} ${durationStr} ease forwards` : undefined),
    [outAnim, durationStr]
  );

  return (
    <div className="relative w-full h-full overflow-hidden bg-black">
      {/* Outgoing layer */}
      {outgoing && isTransitioning && (
        <SlideLayer
          slide={outgoing}
          size={size}
          zIndex={1}
          animation={outAnimStyle}
          volume={volume}
          muted={muted}
          isActive={isActive}
        />
      )}

      {/* Incoming layer */}
      {incoming && (
        <SlideLayer
          slide={incoming}
          size={size}
          zIndex={2}
          animation={isTransitioning ? inAnimStyle : undefined}
          volume={volume}
          muted={muted}
          isActive={isActive}
        />
      )}

      {/* Empty state */}
      {!incoming && !outgoing && (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-white/20 text-sm">{t('preview.waiting')}</span>
        </div>
      )}
    </div>
  );
});

AnimatedPreview.displayName = 'AnimatedPreview';
