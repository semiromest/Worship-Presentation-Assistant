import { useState, useEffect, useRef, memo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  parseCountdownContent,
  getCountdownRemaining,
  formatCountdownTime,
} from './countdownUtils';

// ─── Tipler ──────────────────────────────────────────────────────────────────

interface Slide {
  id: string;
  content: string;
  styles?: {
    fontSize?: number;
    backgroundColor?: string;
    textColor?: string;
  };
}

interface CountdownRendererProps {
  slide: Slide | undefined;
  size?: 'preview' | 'projector';
}

// ─── Sabitler ────────────────────────────────────────────────────────────────

const DEFAULT_BG_COLOR = '#000000';
const DEFAULT_TEXT_COLOR = '#FFFFFF';
const DEFAULT_FONT_SIZE = 120;
const PROJECTOR_FONT_SIZE = '20vw';

const formatTime = formatCountdownTime;

const getFontSize = (size: 'preview' | 'projector', customSize?: number): string => {
  return size === 'projector' ? PROJECTOR_FONT_SIZE : `${customSize ?? DEFAULT_FONT_SIZE}px`;
};

// ─── Hook: useCountdown ─────────────────────────────────────────────────────

const useCountdown = (content: string) => {
  const [timeLeft, setTimeLeft] = useState(() =>
    getCountdownRemaining(parseCountdownContent(content))
  );

  const contentRef = useRef(content);
  contentRef.current = content;

  useEffect(() => {
    const tick = () => {
      const data = parseCountdownContent(contentRef.current);
      const remaining = getCountdownRemaining(data);
      setTimeLeft(prev => (prev === remaining ? prev : remaining));
    };

    tick();
    if (parseCountdownContent(content).paused) return;

    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [content]);

  return timeLeft;
};

// ─── Memoized alt bileşenler ────────────────────────────────────────────────

const TimerDisplay = memo(({ 
  timeLeft, 
  fontSize, 
  bgColor, 
  textColor 
}: { 
  timeLeft: number; 
  fontSize: string; 
  bgColor: string; 
  textColor: string; 
}) => {
  const { t } = useTranslation();
  return (
    <div
      className="relative w-full h-full flex items-center justify-center"
      style={{ backgroundColor: bgColor, aspectRatio: '16 / 9' }}
      role="timer"
      aria-label={t('countdown.remaining', { time: formatTime(timeLeft) })}
    >
      <div
        className="font-mono font-bold tabular-nums select-none"
        style={{ fontSize, color: textColor }}
      >
        {formatTime(timeLeft)}
      </div>
    </div>
  );
});

TimerDisplay.displayName = 'TimerDisplay';

// ─── Ana bileşen ────────────────────────────────────────────────────────────

const CountdownRenderer = memo(({ slide, size = 'preview' }: CountdownRendererProps) => {
  const timeLeft = useCountdown(slide?.content ?? '{}');

  if (!slide) return null;

  const bgColor = slide.styles?.backgroundColor ?? DEFAULT_BG_COLOR;
  const textColor = slide.styles?.textColor ?? DEFAULT_TEXT_COLOR;
  const fontSize = getFontSize(size, slide.styles?.fontSize);

  return (
    <TimerDisplay
      timeLeft={timeLeft}
      fontSize={fontSize}
      bgColor={bgColor}
      textColor={textColor}
    />
  );
});

CountdownRenderer.displayName = 'CountdownRenderer';

export default CountdownRenderer;
export { useCountdown, formatTime };
